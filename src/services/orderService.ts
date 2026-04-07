import { supabase } from './supabase';
import { quickbooksPayments } from './quickbooks';
import { activityLogService } from './activityLog';
import { commissionService } from './commissionService';
import { emailService } from './emailService';

export interface RefundOptions {
  amount?: number;
  includeShipping?: boolean;
  cancelCommission?: boolean;
  reason?: string;
  refundedBy?: string;
}

export interface OrderItem {
  productId: number;
  name: string;
  quantity: number;
  price: number;
  retailPrice?: number;
  cost?: number;
  image?: string;
  hasMarkup?: boolean;
  backorder?: boolean;
  backorder_reason?: string;
  brand?: string;
}

export interface Address {
  firstName: string;
  lastName: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone?: string;
}

export interface CreateOrderData {
  userId: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  shippingAddress?: Address;
  billingAddress?: Address;
  customerEmail: string;
  organizationId?: string;
  locationId?: string;
  notes?: string;
  is_test_order?: boolean;
  paymentStatus?: string;
  paymentAuthorizationId?: string;
  paymentMethod?: string;
  paymentLastFour?: string;
}

interface Order {
  id: string;
  user_id: string;
  order_number?: string;
  status: string;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;
  items: OrderItem[];
  shipping_address?: Address;
  billing_address?: Address;
  customer_email: string;
  organization_id?: string;
  location_id?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  parent_order_id?: string;
  split_from_order_id?: string;
  order_type?: string;
  payment_status?: string;
  payment_authorization_id?: string;
  payment_captured_at?: string;
  shipped_at?: string;
  backorder_reason?: string;
  vendor_brand?: string;
  is_sub_order?: boolean;
  is_test_order?: boolean;
}

class OrderService {
  async createOrder(data: CreateOrderData): Promise<{ order: Order | null; error?: string }> {
    try {
      let salesRepId = null;

      if (data.organizationId) {
        const { data: orgData, error: orgError } = await supabase
          .from('organizations')
          .select('default_sales_rep_id, is_house_account')
          .eq('id', data.organizationId)
          .maybeSingle();

        if (!orgError && orgData && !orgData.is_house_account) {
          salesRepId = orgData.default_sales_rep_id;

          if (!salesRepId) {
            const { data: salesRepData } = await supabase
              .from('organization_sales_reps')
              .select('sales_rep_id')
              .eq('organization_id', data.organizationId)
              .eq('is_active', true)
              .maybeSingle();

            if (salesRepData) {
              salesRepId = salesRepData.sales_rep_id;
            }
          } else {
            // The organization has a default_sales_rep_id set.
            // Do NOT auto-create an organization_sales_reps record with a
            // made-up rate. The sales rep must be explicitly assigned with
            // a commission rate through the Sales Rep Assignment UI.
            // The commission trigger will log to commission_audit_log if
            // no org-rep config is found for this order.
          }
        }
      }

      const { data: order, error } = await supabase
        .from('orders')
        .insert({
          user_id: data.userId,
          status: 'pending',
          subtotal: data.subtotal,
          tax: data.tax,
          shipping: data.shipping,
          total: data.total,
          items: data.items,
          shipping_address: data.shippingAddress,
          billing_address: data.billingAddress,
          customer_email: data.customerEmail,
          organization_id: data.organizationId,
          location_id: data.locationId,
          sales_rep_id: salesRepId,
          notes: data.notes,
          is_test_order: data.is_test_order || false,
          payment_status: data.paymentStatus || 'pending',
          payment_authorization_id: data.paymentAuthorizationId || null,
          payment_method: data.paymentMethod || null,
          payment_last_four: data.paymentLastFour || null,
        })
        .select()
        .single();

      if (error) {
        console.error('[OrderService] Error creating order:', error.message, error.code, error.details);
        activityLogService.logAction({
          userId: data.userId,
          action: 'checkout_order_failed',
          resourceType: 'order',
          details: {
            error: error.message,
            error_code: error.code,
            error_details: error.details,
            organization_id: data.organizationId,
            location_id: data.locationId,
            total: data.total,
            items_count: data.items.length,
            sales_rep_id: salesRepId,
          },
        });
        return { order: null, error: error.message };
      }

      // Log the order placement
      activityLogService.logAction({
        userId: data.userId,
        action: 'order_placed',
        resourceType: 'order',
        resourceId: order.id,
        details: {
          total: data.total,
          items_count: data.items.length,
          organization_id: data.organizationId,
          location_id: data.locationId,
        },
      });

      // Send order confirmation email (fire-and-forget)
      emailService.sendNotification({
        to: data.customerEmail,
        email_type: 'order_confirmation',
        subject: `Order Confirmed — #${order.id.slice(0, 8).toUpperCase()}`,
        template_data: {
          order_id: order.id,
          order_date: order.created_at,
          items: data.items.map(i => ({ name: i.name, quantity: i.quantity, price: i.price })),
          subtotal: data.subtotal,
          shipping: data.shipping,
          shipping_method: (data as Record<string, unknown>).shippingMethod || 'Standard',
          tax: data.tax,
          total: data.total,
          customer_email: data.customerEmail,
          shipping_address: data.shippingAddress || null,
          billing_address: data.billingAddress || null,
          payment_status: order.payment_status || 'pending',
          payment_method: (data as Record<string, unknown>).paymentMethod || '',
          payment_last_four: (data as Record<string, unknown>).paymentLastFour || '',
        },
        user_id: data.userId,
      }).catch(err => console.warn('Failed to send order confirmation email:', err));

      // Notify internal order management (fire-and-forget)
      emailService.sendNotification({
        to: 'order@hs360.co',
        email_type: 'order_confirmation',
        subject: `New Order Placed — #${order.id.slice(0, 8).toUpperCase()}`,
        template_data: {
          order_id: order.id,
          order_date: order.created_at,
          items: data.items.map(i => ({ name: i.name, quantity: i.quantity, price: i.price })),
          subtotal: data.subtotal,
          shipping: data.shipping,
          shipping_method: (data as Record<string, unknown>).shippingMethod || 'Standard',
          tax: data.tax,
          total: data.total,
          customer_email: data.customerEmail,
          shipping_address: data.shippingAddress || null,
          billing_address: data.billingAddress || null,
          payment_status: order.payment_status || 'pending',
          payment_method: (data as Record<string, unknown>).paymentMethod || '',
          payment_last_four: (data as Record<string, unknown>).paymentLastFour || '',
        },
      }).catch(err => console.warn('Failed to send internal order notification:', err));

      return { order };
    } catch (error) {
      console.error('Error creating order:', error);
      return {
        order: null,
        error: error instanceof Error ? error.message : 'Failed to create order'
      };
    }
  }

  async cancelOrder(orderId: string, isAdmin = false): Promise<{ success: boolean; error?: string }> {
    try {
      const { order, error: fetchError } = await this.getOrderById(orderId);
      if (fetchError || !order) {
        return { success: false, error: fetchError || 'Order not found' };
      }

      // Admins can cancel pending or processing orders; non-admins only pending
      if (!isAdmin && order.status !== 'pending') {
        return { success: false, error: 'Only pending orders can be cancelled' };
      }

      if (isAdmin && !['pending', 'processing'].includes(order.status)) {
        return { success: false, error: 'Only pending or processing orders can be cancelled' };
      }

      const { error } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId);

      if (error) {
        console.error('Error cancelling order:', error);
        return { success: false, error: error.message };
      }

      // Auto-void authorized payment (best-effort, don't block cancellation)
      if (order.payment_status === 'authorized') {
        const voidResult = await this.voidPayment(orderId);
        if (!voidResult.success) {
          console.warn(`Auto-void failed for order ${orderId}: ${voidResult.error}`);
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Error cancelling order:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel order'
      };
    }
  }

  async updateOrderStatus(
    orderId: string,
    status: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const updateData: any = {
        status,
        updated_at: new Date().toISOString()
      };

      if (status === 'completed') {
        updateData.completed_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', orderId);

      if (error) {
        console.error('Error updating order status:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('Error updating order status:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update order status'
      };
    }
  }

  async updateOrderSalesRep(
    orderId: string,
    salesRepId: string | null
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          sales_rep_id: salesRepId,
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId);

      if (error) {
        console.error('Error updating order sales rep:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('Error updating order sales rep:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update sales rep'
      };
    }
  }

  async adminUpdateOrder(
    orderId: string,
    updates: {
      shipping_address?: any;
      billing_address?: any;
      shipping?: number;
      tax?: number;
      notes?: string;
      customer_email?: string;
      payment_status?: string;
      payment_authorization_id?: string;
      payment_method?: string;
      payment_last_four?: string;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Recalculate total if shipping or tax changed
      const updateData: Record<string, any> = {
        ...updates,
        updated_at: new Date().toISOString(),
      };

      if (updates.shipping !== undefined || updates.tax !== undefined) {
        const { order } = await this.getOrderById(orderId);
        if (order) {
          const newShipping = updates.shipping ?? order.shipping;
          const newTax = updates.tax ?? order.tax;
          updateData.total = order.subtotal + newTax + newShipping;
        }
      }

      const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', orderId);

      if (error) {
        console.error('[OrderService] adminUpdateOrder error:', error.message);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('[OrderService] adminUpdateOrder exception:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update order',
      };
    }
  }

  async getOrderById(orderId: string): Promise<{ order: Order | null; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching order:', error);
        return { order: null, error: error.message };
      }

      return { order: data };
    } catch (error) {
      console.error('Error fetching order:', error);
      return {
        order: null,
        error: error instanceof Error ? error.message : 'Failed to fetch order'
      };
    }
  }

  async getNewOrderCount(userId?: string, userRole?: string): Promise<{ count: number; error?: string }> {
    try {
      let query = supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('viewed_by_admin', false)
        .in('status', ['pending', 'processing']);

      // Apply same filtering as OrderManagement component
      if (userRole === 'sales_rep' && userId) {
        query = query.eq('sales_rep_id', userId);
      } else if (userRole === 'distributor' && userId) {
        // First get the distributor record for this user
        const { data: distributorData } = await supabase
          .from('distributors')
          .select('id')
          .eq('profile_id', userId)
          .maybeSingle();

        if (distributorData) {
          // Get all sales reps under this distributor
          const { data: salesReps } = await supabase
            .from('distributor_sales_reps')
            .select('sales_rep_id')
            .eq('distributor_id', distributorData.id)
            .eq('is_active', true);

          if (salesReps && salesReps.length > 0) {
            const salesRepIds = salesReps.map(sr => sr.sales_rep_id);
            // Include distributor's own ID in case they also have direct orders
            salesRepIds.push(userId);
            query = query.in('sales_rep_id', salesRepIds);
          } else {
            // If no sales reps, only show distributor's own orders
            query = query.eq('sales_rep_id', userId);
          }
        } else {
          // If distributor record not found, only show their own orders
          query = query.eq('sales_rep_id', userId);
        }
      }

      const { count, error } = await query;

      if (error) {
        console.error('Error fetching new order count:', error);
        return { count: 0, error: error.message };
      }

      return { count: count || 0 };
    } catch (error) {
      console.error('Error fetching new order count:', error);
      return {
        count: 0,
        error: error instanceof Error ? error.message : 'Failed to fetch new order count'
      };
    }
  }

  async markOrderAsViewed(orderId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('orders')
        .update({ viewed_by_admin: true })
        .eq('id', orderId);

      if (error) {
        console.error('Error marking order as viewed:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('Error marking order as viewed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to mark order as viewed'
      };
    }
  }

  async getPendingUserCount(): Promise<{ count: number; error?: string }> {
    try {
      const { count, error } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('approval_status', 'pending');

      if (error) {
        console.error('Error fetching pending user count:', error);
        return { count: 0, error: error.message };
      }

      return { count: count || 0 };
    } catch (error) {
      console.error('Error fetching pending user count:', error);
      return {
        count: 0,
        error: error instanceof Error ? error.message : 'Failed to fetch pending user count'
      };
    }
  }

  async splitOrderByBackorder(
    orderId: string,
    backorderedItemIds: number[]
  ): Promise<{ originalOrder: Order | null; backorder: Order | null; error?: string }> {
    try {
      const { order: originalOrder, error: fetchError } = await this.getOrderById(orderId);

      if (fetchError || !originalOrder) {
        return {
          originalOrder: null,
          backorder: null,
          error: fetchError || 'Order not found'
        };
      }

      const availableItems = originalOrder.items.filter(
        item => !backorderedItemIds.includes(item.productId)
      );
      const backorderedItems = originalOrder.items.filter(
        item => backorderedItemIds.includes(item.productId)
      );

      if (backorderedItems.length === 0) {
        return {
          originalOrder: null,
          backorder: null,
          error: 'No backordered items specified'
        };
      }

      const availableSubtotal = availableItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const backorderSubtotal = backorderedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

      const taxRatio = originalOrder.subtotal > 0 ? originalOrder.tax / originalOrder.subtotal : 0;
      const shippingRatio = originalOrder.subtotal > 0 ? originalOrder.shipping / originalOrder.subtotal : 0;

      const availableTax = availableSubtotal * taxRatio;
      const availableShipping = availableSubtotal * shippingRatio;
      const backorderTax = backorderSubtotal * taxRatio;
      const backorderShipping = backorderSubtotal * shippingRatio;

      const { data: updatedOriginal, error: updateError } = await supabase
        .from('orders')
        .update({
          items: availableItems,
          subtotal: availableSubtotal,
          tax: availableTax,
          shipping: availableShipping,
          total: availableSubtotal + availableTax + availableShipping,
          order_type: 'partial',
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating original order:', updateError);
        return { originalOrder: null, backorder: null, error: updateError.message };
      }

      const uniqueBrands = [...new Set(backorderedItems.map(item => item.brand).filter(Boolean))];
      const vendorBrand = uniqueBrands.length === 1 ? uniqueBrands[0] : undefined;

      const { data: backorderOrder, error: backorderError } = await supabase
        .from('orders')
        .insert({
          user_id: originalOrder.user_id,

          status: 'backorder',
          order_type: 'backorder',
          subtotal: backorderSubtotal,
          tax: backorderTax,
          shipping: backorderShipping,
          total: backorderSubtotal + backorderTax + backorderShipping,
          currency: originalOrder.currency,
          items: backorderedItems,
          shipping_address: originalOrder.shipping_address,
          billing_address: originalOrder.billing_address,
          customer_email: originalOrder.customer_email,
          organization_id: originalOrder.organization_id,
          location_id: originalOrder.location_id,
          parent_order_id: originalOrder.parent_order_id || orderId,
          split_from_order_id: orderId,
          payment_status: originalOrder.payment_status,
          payment_authorization_id: originalOrder.payment_authorization_id,
          vendor_brand: vendorBrand,
          notes: `Backordered items from order ${originalOrder.order_number || orderId}`
        })
        .select()
        .single();

      if (backorderError) {
        console.error('Error creating backorder:', backorderError);
        return { originalOrder: null, backorder: null, error: backorderError.message };
      }

      return { originalOrder: updatedOriginal, backorder: backorderOrder };
    } catch (error) {
      console.error('Error splitting order:', error);
      return {
        originalOrder: null,
        backorder: null,
        error: error instanceof Error ? error.message : 'Failed to split order'
      };
    }
  }

  async splitOrderByBackorderWithQuantities(
    orderId: string,
    backorderedItems: Array<{ productId: number; quantity: number }>
  ): Promise<{ originalOrder: Order | null; backorder: Order | null; error?: string }> {
    try {
      const { order: originalOrder, error: fetchError } = await this.getOrderById(orderId);

      if (fetchError || !originalOrder) {
        return {
          originalOrder: null,
          backorder: null,
          error: fetchError || 'Order not found'
        };
      }

      if (backorderedItems.length === 0) {
        return {
          originalOrder: null,
          backorder: null,
          error: 'No backordered items specified'
        };
      }

      const backorderMap = new Map(backorderedItems.map(item => [item.productId, item.quantity]));

      const updatedOriginalItems: OrderItem[] = [];
      const backorderItemsList: OrderItem[] = [];

      originalOrder.items.forEach(item => {
        const backorderQty = backorderMap.get(item.productId);

        if (backorderQty && backorderQty > 0) {
          const remainingQty = item.quantity - backorderQty;

          if (remainingQty > 0) {
            updatedOriginalItems.push({
              ...item,
              quantity: remainingQty
            });
          }

          backorderItemsList.push({
            ...item,
            quantity: backorderQty
          });
        } else {
          updatedOriginalItems.push(item);
        }
      });

      if (backorderItemsList.length === 0) {
        return {
          originalOrder: null,
          backorder: null,
          error: 'No valid backorder quantities specified'
        };
      }

      const availableSubtotal = updatedOriginalItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const backorderSubtotal = backorderItemsList.reduce((sum, item) => sum + (item.price * item.quantity), 0);

      const taxRatio = originalOrder.subtotal > 0 ? originalOrder.tax / originalOrder.subtotal : 0;
      const shippingRatio = originalOrder.subtotal > 0 ? originalOrder.shipping / originalOrder.subtotal : 0;

      const availableTax = availableSubtotal * taxRatio;
      const availableShipping = availableSubtotal * shippingRatio;
      const backorderTax = backorderSubtotal * taxRatio;
      const backorderShipping = backorderSubtotal * shippingRatio;

      const { data: updatedOriginal, error: updateError } = await supabase
        .from('orders')
        .update({
          items: updatedOriginalItems,
          subtotal: availableSubtotal,
          tax: availableTax,
          shipping: availableShipping,
          total: availableSubtotal + availableTax + availableShipping,
          order_type: 'partial',
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating original order:', updateError);
        return { originalOrder: null, backorder: null, error: updateError.message };
      }

      const uniqueBrands = [...new Set(backorderItemsList.map(item => item.brand).filter(Boolean))];
      const vendorBrand = uniqueBrands.length === 1 ? uniqueBrands[0] : undefined;

      const { data: backorderOrder, error: backorderError } = await supabase
        .from('orders')
        .insert({
          user_id: originalOrder.user_id,

          status: 'backorder',
          order_type: 'backorder',
          subtotal: backorderSubtotal,
          tax: backorderTax,
          shipping: backorderShipping,
          total: backorderSubtotal + backorderTax + backorderShipping,
          currency: originalOrder.currency,
          items: backorderItemsList,
          shipping_address: originalOrder.shipping_address,
          billing_address: originalOrder.billing_address,
          customer_email: originalOrder.customer_email,
          organization_id: originalOrder.organization_id,
          location_id: originalOrder.location_id,
          parent_order_id: originalOrder.parent_order_id || orderId,
          split_from_order_id: orderId,
          payment_status: originalOrder.payment_status,
          payment_authorization_id: originalOrder.payment_authorization_id,
          vendor_brand: vendorBrand,
          notes: `Backordered items from order ${originalOrder.order_number || orderId}`
        })
        .select()
        .single();

      if (backorderError) {
        console.error('Error creating backorder:', backorderError);
        return { originalOrder: null, backorder: null, error: backorderError.message };
      }

      return { originalOrder: updatedOriginal, backorder: backorderOrder };
    } catch (error) {
      console.error('Error splitting order:', error);
      return {
        originalOrder: null,
        backorder: null,
        error: error instanceof Error ? error.message : 'Failed to split order'
      };
    }
  }

  async updatePaymentStatus(
    orderId: string,
    paymentStatus: string,
    paymentAuthorizationId?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const updateData: any = {
        payment_status: paymentStatus,
        updated_at: new Date().toISOString()
      };

      if (paymentAuthorizationId) {
        updateData.payment_authorization_id = paymentAuthorizationId;
      }

      if (paymentStatus === 'captured') {
        updateData.payment_captured_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', orderId);

      if (error) {
        console.error('Error updating payment status:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('Error updating payment status:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update payment status'
      };
    }
  }

  async capturePaymentOnShipment(orderId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { order, error: fetchError } = await this.getOrderById(orderId);

      if (fetchError || !order) {
        return { success: false, error: fetchError || 'Order not found' };
      }

      if (order.payment_status === 'captured') {
        await this.logPaymentEvent(orderId, {
          event: 'capture_skipped',
          status: 'captured',
          method: 'Already captured',
          lastFour: order.payment_authorization_id?.slice(-4) || '----',
          transactionId: order.payment_authorization_id || 'none',
          amount: order.total,
        });
        return { success: true };
      }

      if (order.payment_status !== 'authorized') {
        await this.logPaymentEvent(orderId, {
          event: 'capture_skipped',
          status: order.payment_status || 'none',
          method: 'No authorization found',
          lastFour: '----',
          transactionId: 'none',
          amount: order.total,
        });
        return { success: false, error: 'Payment must be authorized before capture' };
      }

      if (order.payment_authorization_id && !order.payment_authorization_id.startsWith('auth_') && !order.payment_authorization_id.startsWith('saved_')) {
        try {
          await quickbooksPayments.captureCharge(order.payment_authorization_id, order.total);
        } catch (captureError: any) {
          console.error('QB Payments capture failed:', captureError);
          await this.logPaymentEvent(orderId, {
            event: 'capture_api_error',
            status: 'failed',
            method: 'QuickBooks Payments API',
            lastFour: order.payment_authorization_id?.slice(-4) || '----',
            transactionId: order.payment_authorization_id || 'unknown',
            amount: order.total,
          });
          return { success: false, error: `Payment capture failed: ${captureError.message}` };
        }
      }

      const captureResult = await this.updatePaymentStatus(orderId, 'captured');

      if (!captureResult.success) {
        await this.logPaymentEvent(orderId, {
          event: 'capture_failed',
          status: 'failed',
          method: 'QuickBooks Payments',
          lastFour: order.payment_authorization_id?.slice(-4) || '----',
          transactionId: order.payment_authorization_id || 'unknown',
          amount: order.total,
        });
        return captureResult;
      }

      await this.logTransaction(orderId, 'capture', order.total, 'success', order.payment_authorization_id || undefined, order.payment_authorization_id?.slice(-4));
      await this.logPaymentEvent(orderId, {
        event: 'payment_captured',
        status: 'captured',
        method: 'QuickBooks Payments',
        lastFour: order.payment_authorization_id?.slice(-4) || '----',
        transactionId: order.payment_authorization_id || 'unknown',
        amount: order.total,
      });

      return { success: true };
    } catch (error) {
      console.error('Error capturing payment:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to capture payment'
      };
    }
  }

  async logPaymentEvent(
    orderId: string,
    event: {
      event: string;
      status: string;
      method: string;
      lastFour: string;
      transactionId: string;
      amount: number;
    }
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${event.event}: ${event.method} ****${event.lastFour} - $${event.amount.toFixed(2)} - ${event.status} (txn: ${event.transactionId})`;

      const { order } = await this.getOrderById(orderId);
      if (!order) return;

      const existingNotes = order.notes || '';
      const updatedNotes = existingNotes
        ? `${existingNotes}\n${logEntry}`
        : logEntry;

      await supabase
        .from('orders')
        .update({ notes: updatedNotes, updated_at: timestamp })
        .eq('id', orderId);
    } catch (error) {
      console.warn('Failed to log payment event:', error);
    }
  }

  async logTransaction(
    orderId: string,
    transactionType: 'authorization' | 'capture' | 'void' | 'refund',
    amount: number,
    status: 'success' | 'failed' | 'pending' | 'declined',
    gatewayTransactionId?: string,
    lastFour?: string,
    paymentMethod?: string,
    errorMessage?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('payment_transactions').insert({
        order_id: orderId,
        transaction_type: transactionType,
        payment_method: paymentMethod,
        gateway_transaction_id: gatewayTransactionId,
        amount,
        status,
        last_four: lastFour,
        error_message: errorMessage,
        metadata: metadata || {},
        created_by: user?.id,
      });
    } catch (error) {
      console.warn('Failed to log payment transaction:', error);
    }
  }

  async voidPayment(orderId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { order, error: fetchError } = await this.getOrderById(orderId);
      if (fetchError || !order) {
        return { success: false, error: fetchError || 'Order not found' };
      }

      if (order.payment_status !== 'authorized') {
        return { success: false, error: 'Only authorized payments can be voided' };
      }

      const authId = order.payment_authorization_id;
      if (authId && !authId.startsWith('auth_') && !authId.startsWith('saved_')) {
        try {
          // ACH echeck IDs typically start with 'E' or contain 'ech'
          if (authId.toLowerCase().startsWith('e') || authId.toLowerCase().includes('ech')) {
            await quickbooksPayments.voidECheck(authId);
          } else {
            await quickbooksPayments.voidCharge(authId);
          }
        } catch (voidError: any) {
          console.error('QB Payments void failed:', voidError);
          await this.logTransaction(orderId, 'void', order.total, 'failed', authId, authId?.slice(-4), undefined, voidError.message);
          await this.logPaymentEvent(orderId, {
            event: 'void_api_error',
            status: 'failed',
            method: 'QuickBooks Payments API',
            lastFour: authId?.slice(-4) || '----',
            transactionId: authId || 'unknown',
            amount: order.total,
          });
          return { success: false, error: `Payment void failed: ${voidError.message}` };
        }
      }

      const result = await this.updatePaymentStatus(orderId, 'cancelled');
      if (!result.success) {
        return result;
      }

      await this.logTransaction(orderId, 'void', order.total, 'success', authId || undefined, authId?.slice(-4));
      await this.logPaymentEvent(orderId, {
        event: 'payment_voided',
        status: 'cancelled',
        method: 'QuickBooks Payments',
        lastFour: authId?.slice(-4) || '----',
        transactionId: authId || 'none',
        amount: order.total,
      });

      return { success: true };
    } catch (error) {
      console.error('Error voiding payment:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to void payment'
      };
    }
  }

  async refundPayment(orderId: string, amountOrOptions?: number | RefundOptions): Promise<{ success: boolean; error?: string }> {
    try {
      // Support both legacy (amount) and new (options) signatures
      const options: RefundOptions = typeof amountOrOptions === 'number'
        ? { amount: amountOrOptions }
        : amountOrOptions || {};

      const { order, error: fetchError } = await this.getOrderById(orderId);
      if (fetchError || !order) {
        return { success: false, error: fetchError || 'Order not found' };
      }

      if (order.payment_status !== 'captured') {
        return { success: false, error: 'Only captured payments can be refunded' };
      }

      // Calculate refund amount
      let refundAmount: number;
      if (options.amount !== undefined) {
        refundAmount = options.amount;
      } else if (options.includeShipping) {
        refundAmount = Number(order.total);
      } else {
        // Default full refund includes shipping
        refundAmount = Number(order.total);
      }

      const isPartial = refundAmount < Number(order.total);
      const authId = order.payment_authorization_id;

      if (authId && !authId.startsWith('auth_') && !authId.startsWith('saved_')) {
        try {
          if (authId.toLowerCase().startsWith('e') || authId.toLowerCase().includes('ech')) {
            await quickbooksPayments.refundECheck(authId, refundAmount);
          } else {
            await quickbooksPayments.refundCharge(authId, refundAmount);
          }
        } catch (refundError: any) {
          console.error('QB Payments refund failed:', refundError);
          await this.logTransaction(orderId, 'refund', refundAmount, 'failed', authId, authId?.slice(-4), undefined, refundError.message);
          await this.logPaymentEvent(orderId, {
            event: 'refund_api_error',
            status: 'failed',
            method: 'QuickBooks Payments API',
            lastFour: authId?.slice(-4) || '----',
            transactionId: authId || 'unknown',
            amount: refundAmount,
          });
          return { success: false, error: `Payment refund failed: ${refundError.message}` };
        }
      }

      const newStatus = isPartial ? 'partially_refunded' : 'refunded';
      const result = await this.updatePaymentStatus(orderId, newStatus);
      if (!result.success) {
        return result;
      }

      const reasonNote = options.reason ? ` | Reason: ${options.reason}` : '';
      const shippingNote = options.includeShipping ? ' (includes shipping)' : '';
      await this.logTransaction(orderId, 'refund', refundAmount, 'success', authId || undefined, authId?.slice(-4));
      await this.logPaymentEvent(orderId, {
        event: isPartial ? 'payment_partially_refunded' : 'payment_refunded',
        status: newStatus,
        method: 'QuickBooks Payments',
        lastFour: authId?.slice(-4) || '----',
        transactionId: authId || 'none',
        amount: refundAmount,
      });

      // Append reason to order notes
      if (options.reason || shippingNote) {
        const { data: currentOrder } = await supabase
          .from('orders')
          .select('notes')
          .eq('id', orderId)
          .single();

        const timestamp = new Date().toISOString();
        const refundNote = `[${timestamp}] Refund $${refundAmount.toFixed(2)}${shippingNote}${reasonNote}`;
        await supabase
          .from('orders')
          .update({ notes: (currentOrder?.notes ? currentOrder.notes + '\n' : '') + refundNote })
          .eq('id', orderId);
      }

      // Handle commission cancellation
      if (options.cancelCommission) {
        try {
          const { data: commission } = await supabase
            .from('commissions')
            .select('id, status')
            .eq('order_id', orderId)
            .maybeSingle();

          if (commission && commission.status !== 'paid' && commission.status !== 'cancelled') {
            const cancelReason = isPartial
              ? `Partial refund of $${refundAmount.toFixed(2)} on order`
              : `Full refund of $${refundAmount.toFixed(2)} on order`;
            await commissionService.cancelCommission(
              commission.id,
              cancelReason,
              options.refundedBy || 'system'
            );
          }
        } catch (commError) {
          console.warn('Failed to cancel commission during refund:', commError);
          // Don't fail the refund if commission cancel fails
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Error refunding payment:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to refund payment'
      };
    }
  }

  async getRelatedOrders(orderId: string): Promise<{ orders: Order[]; error?: string }> {
    try {
      const { order, error: fetchError } = await this.getOrderById(orderId);

      if (fetchError || !order) {
        return { orders: [], error: fetchError || 'Order not found' };
      }

      const parentId = order.parent_order_id || orderId;

      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .or(`id.eq.${parentId},parent_order_id.eq.${parentId},split_from_order_id.eq.${orderId}`)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching related orders:', error);
        return { orders: [], error: error.message };
      }

      return { orders: data || [] };
    } catch (error) {
      console.error('Error fetching related orders:', error);
      return {
        orders: [],
        error: error instanceof Error ? error.message : 'Failed to fetch related orders'
      };
    }
  }

  async splitOrderByVendor(
    orderId: string
  ): Promise<{ parentOrder: Order | null; subOrders: Order[]; error?: string }> {
    try {
      const { order: originalOrder, error: fetchError } = await this.getOrderById(orderId);

      if (fetchError || !originalOrder) {
        return {
          parentOrder: null,
          subOrders: [],
          error: fetchError || 'Order not found'
        };
      }

      const brandMap = new Map<string, OrderItem[]>();
      const noBrandItems: OrderItem[] = [];

      // Debug: Log all items and their brands
      console.log('Order items and brands:', originalOrder.items.map(item => ({
        name: item.name,
        brand: item.brand
      })));

      originalOrder.items.forEach(item => {
        const brand = item.brand || 'Unknown';
        if (brand === 'Unknown' || !brand) {
          noBrandItems.push(item);
        } else {
          if (!brandMap.has(brand)) {
            brandMap.set(brand, []);
          }
          brandMap.get(brand)!.push(item);
        }
      });

      if (noBrandItems.length > 0) {
        brandMap.set('Unknown', noBrandItems);
      }

      console.log('Brand map after grouping:', Array.from(brandMap.keys()));
      console.log('Brand map size:', brandMap.size);

      if (brandMap.size <= 1) {
        return {
          parentOrder: originalOrder,
          subOrders: [],
          error: 'Order contains only one brand, no split needed. Brands found: ' + Array.from(brandMap.keys()).join(', ')
        };
      }

      const { data: updatedParent, error: updateError } = await supabase
        .from('orders')
        .update({
          is_sub_order: false,
          order_type: 'split_parent',
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating parent order:', updateError);
        return { parentOrder: null, subOrders: [], error: updateError.message };
      }

      const subOrders: Order[] = [];

      for (const [brand, items] of brandMap.entries()) {
        const brandSubtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const taxRatio = originalOrder.subtotal > 0 ? originalOrder.tax / originalOrder.subtotal : 0;
        const shippingRatio = originalOrder.subtotal > 0 ? originalOrder.shipping / originalOrder.subtotal : 0;
        const brandTax = brandSubtotal * taxRatio;
        const brandShipping = brandSubtotal * shippingRatio;

        const { data: subOrder, error: subOrderError } = await supabase
          .from('orders')
          .insert({
            user_id: originalOrder.user_id,
  
            status: originalOrder.status,
            order_type: 'vendor_sub_order',
            is_sub_order: true,
            vendor_brand: brand,
            subtotal: brandSubtotal,
            tax: brandTax,
            shipping: brandShipping,
            total: brandSubtotal + brandTax + brandShipping,
            currency: originalOrder.currency,
            items: items,
            shipping_address: originalOrder.shipping_address,
            billing_address: originalOrder.billing_address,
            customer_email: originalOrder.customer_email,
            organization_id: originalOrder.organization_id,
            location_id: originalOrder.location_id,
            parent_order_id: orderId,
            payment_status: originalOrder.payment_status,
            payment_authorization_id: originalOrder.payment_authorization_id,
            notes: `Vendor sub-order for ${brand} from order ${originalOrder.order_number || orderId}`
          })
          .select()
          .single();

        if (subOrderError) {
          console.error(`Error creating sub-order for ${brand}:`, subOrderError);
          continue;
        }

        if (subOrder) {
          subOrders.push(subOrder);
        }
      }

      return { parentOrder: updatedParent, subOrders };
    } catch (error) {
      console.error('Error splitting order by vendor:', error);
      return {
        parentOrder: null,
        subOrders: [],
        error: error instanceof Error ? error.message : 'Failed to split order by vendor'
      };
    }
  }

  async getSubOrders(parentOrderId: string): Promise<{ subOrders: Order[]; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('parent_order_id', parentOrderId)
        .eq('is_sub_order', true)
        .order('vendor_brand', { ascending: true });

      if (error) {
        console.error('Error fetching sub-orders:', error);
        return { subOrders: [], error: error.message };
      }

      return { subOrders: data || [] };
    } catch (error) {
      console.error('Error fetching sub-orders:', error);
      return {
        subOrders: [],
        error: error instanceof Error ? error.message : 'Failed to fetch sub-orders'
      };
    }
  }

  async getOrdersByVendor(vendorBrand: string): Promise<{ orders: Order[]; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('vendor_brand', vendorBrand)
        .eq('is_sub_order', true)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching vendor orders:', error);
        return { orders: [], error: error.message };
      }

      return { orders: data || [] };
    } catch (error) {
      console.error('Error fetching vendor orders:', error);
      return {
        orders: [],
        error: error instanceof Error ? error.message : 'Failed to fetch vendor orders'
      };
    }
  }
}

export const orderService = new OrderService();
