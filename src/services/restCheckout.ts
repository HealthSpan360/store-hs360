import { supabase } from './supabase';
import { orderService, CreateOrderData, OrderItem, Address } from './orderService';
import { activityLogService } from './activityLog';

export interface CartLineItem {
  product_id: number;
  quantity: number;
  variant_id?: number;
}

export interface AddressData {
  first_name: string;
  last_name: string;
  email: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  state_or_province: string;
  postal_code: string;
  country_code: string;
  phone?: string;
}

interface CheckoutSessionData {
  id: string;
  user_id: string;
  organization_id?: string;
  location_id?: string;
  cart_id?: string;
  checkout_id?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'abandoned';
  cart_items: any[];
  shipping_address?: AddressData;
  billing_address?: AddressData;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  error?: string;
  created_at: string;
  updated_at: string;
}

interface CheckoutFlowResult {
  success: boolean;
  sessionId?: string;
  cartId?: string;
  checkoutId?: string;
  orderId?: string;
  error?: string;
}

class RestCheckoutService {
  async createCheckoutSession(
    userId: string,
    items: any[],
    organizationId?: string,
    locationId?: string
  ): Promise<CheckoutFlowResult> {
    try {
      const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const tax = 0;
      const shipping = 0;
      const total = subtotal + tax + shipping;

      const { data: session, error } = await supabase
        .from('checkout_sessions')
        .insert({
          user_id: userId,
          organization_id: organizationId,
          location_id: locationId,
          cart_items: items,
          status: 'pending',
          subtotal,
          tax,
          shipping,
          total,
          metadata: locationId ? { location_id: locationId } : {},
        })
        .select()
        .maybeSingle();

      if (error || !session) {
        console.error('Failed to create checkout session:', error);
        return {
          success: false,
          error: 'Failed to create checkout session',
        };
      }

      return {
        success: true,
        sessionId: session.id,
      };
    } catch (error) {
      console.error('Error creating checkout session:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async createCart(sessionId: string, items: CartLineItem[]): Promise<CheckoutFlowResult> {
    try {
      const cartId = `cart_${sessionId}`;

      const { error } = await supabase
        .from('checkout_sessions')
        .update({
          cart_id: cartId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId);

      if (error) {
        console.error('[RestCheckout] Failed to update session with cart ID:', error.message, error.code);
        return {
          success: false,
          error: 'Failed to initialize cart. Please try again.',
        };
      }

      return {
        success: true,
        sessionId,
        cartId,
      };
    } catch (error) {
      console.error('Error creating cart:', error);

      await supabase
        .from('checkout_sessions')
        .update({
          status: 'failed',
          last_error: error instanceof Error ? error.message : 'Failed to create cart',
        })
        .eq('id', sessionId);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create cart',
      };
    }
  }

  async addAddresses(
    sessionId: string,
    cartId: string,
    billingAddress: AddressData,
    shippingAddress: AddressData,
    shippingCost?: number
  ): Promise<CheckoutFlowResult> {
    try {
      const checkoutId = `checkout_${sessionId}`;

      // Build update payload, including shipping cost if provided
      const updateData: Record<string, any> = {
        checkout_id: checkoutId,
        billing_address: billingAddress,
        shipping_address: shippingAddress,
        status: 'processing',
        updated_at: new Date().toISOString(),
      };

      if (shippingCost !== undefined) {
        // Recalculate total with the actual shipping cost
        const { data: session } = await supabase
          .from('checkout_sessions')
          .select('subtotal, tax')
          .eq('id', sessionId)
          .maybeSingle();

        if (session) {
          updateData.shipping = shippingCost;
          updateData.total = session.subtotal + (session.tax || 0) + shippingCost;
        }
      }

      const { error } = await supabase
        .from('checkout_sessions')
        .update(updateData)
        .eq('id', sessionId);

      if (error) {
        console.error('[RestCheckout] Failed to update session with addresses:', error.message, error.code);
        return {
          success: false,
          error: 'Failed to save address information. Please try again.',
        };
      }

      return {
        success: true,
        sessionId,
        cartId,
        checkoutId,
      };
    } catch (error) {
      console.error('Error adding addresses:', error);

      await supabase
        .from('checkout_sessions')
        .update({
          status: 'failed',
          last_error: error instanceof Error ? error.message : 'Failed to add addresses',
        })
        .eq('id', sessionId);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add addresses',
      };
    }
  }

  async processPayment(
    sessionId: string,
    checkoutId: string,
    paymentData: {
      cardholder_name: string;
      number: string;
      expiry_month: number;
      expiry_year: number;
      verification_value?: string;
    },
    paymentAuthId?: string,
    options?: {
      is_test_order?: boolean;
      paymentStatus?: string;
      paymentMethod?: string;
      paymentLastFour?: string;
    }
  ): Promise<CheckoutFlowResult> {
    let session: any = null;
    try {

      await supabase
        .from('checkout_sessions')
        .update({
          status: 'processing',
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId);

      const { data: sessionData } = await supabase
        .from('checkout_sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();
      session = sessionData;

      if (!session) {
        throw new Error('Checkout session not found');
      }


      const mapAddress = (addr: AddressData | null | undefined): Address | undefined => {
        if (!addr) return undefined;
        return {
          firstName: addr.first_name,
          lastName: addr.last_name,
          company: addr.company,
          address1: addr.address1,
          address2: addr.address2,
          city: addr.city,
          state: addr.state_or_province,
          postalCode: addr.postal_code,
          country: addr.country_code,
          phone: addr.phone,
        };
      };

      const orderData: CreateOrderData = {
        userId: session.user_id,
        items: session.cart_items.map((item: any) => ({
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          retailPrice: item.retailPrice,
          cost: item.cost,
          image: item.image,
          hasMarkup: item.hasMarkup,
          brand: item.brand,
        })),
        subtotal: session.subtotal,
        tax: session.tax,
        shipping: session.shipping,
        total: session.total,
        shippingAddress: mapAddress(session.shipping_address),
        billingAddress: mapAddress(session.billing_address),
        customerEmail: session.billing_address?.email || '',
        organizationId: session.organization_id,
        locationId: session.location_id || session.metadata?.location_id,
        notes: `Order placed via checkout session ${sessionId}`,
        is_test_order: options?.is_test_order,
        paymentStatus: options?.paymentStatus || (paymentAuthId ? 'authorized' : 'pending'),
        paymentAuthorizationId: paymentAuthId || undefined,
        paymentMethod: options?.paymentMethod,
        paymentLastFour: options?.paymentLastFour,
      };

      const result = await orderService.createOrder(orderData);

      if (!result.order) {
        throw new Error(result.error || 'Failed to create order');
      }

      // Payment fields (payment_status, payment_authorization_id, payment_method,
      // payment_last_four) are now set atomically in createOrder above.
      // No separate updatePaymentStatus call needed — and it would fail for
      // non-admin users due to RLS UPDATE restrictions on the orders table.

      // Log the initial authorization in payment_transactions for audit trail
      if (paymentAuthId) {
        try {
          await orderService.logTransaction(
            result.order.id,
            'authorization',
            orderData.total,
            orderData.paymentStatus === 'pending' ? 'pending' : 'success',
            paymentAuthId,
            options?.paymentLastFour,
            options?.paymentMethod,
          );
        } catch (txnLogErr) {
          console.warn('Failed to log payment transaction (order was still created):', txnLogErr);
        }
      }

      await supabase
        .from('checkout_sessions')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId);

      return {
        success: true,
        sessionId,
        checkoutId,
        orderId: result.order.id,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Payment failed';
      console.error('[RestCheckout] processPayment error:', errorMsg, error);

      await supabase
        .from('checkout_sessions')
        .update({
          status: 'failed',
          last_error: errorMsg,
        })
        .eq('id', sessionId);

      // Log to activity log so admins can see checkout failures
      activityLogService.logAction({
        userId: session?.user_id || 'unknown',
        action: 'checkout_order_failed',
        resourceType: 'checkout',
        resourceId: sessionId,
        details: {
          error: errorMsg,
          step: 'process_payment',
          organization_id: session?.organization_id,
          total: session?.total,
          items_count: session?.cart_items?.length,
        },
      });

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  async getSession(sessionId: string): Promise<CheckoutSessionData | null> {
    try {
      const { data, error } = await supabase
        .from('checkout_sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();

      if (error || !data) {
        console.error('Failed to get session:', error);
        return null;
      }

      return data as CheckoutSessionData;
    } catch (error) {
      console.error('Error getting session:', error);
      return null;
    }
  }
}

export const restCheckoutService = new RestCheckoutService();
