import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { orderService } from '../../services/orderService';
import { Package, Search, Eye, X, Loader, Calendar, Mail, MapPin, CreditCard, Truck, Plus, Building2, ChevronDown, ChevronUp, Split, AlertTriangle, DollarSign, FileText, Activity, Trash2, UserCheck, RefreshCw, Pencil, Save, XCircle, Check } from 'lucide-react';
import { customerAddressService, type CustomerAddress } from '../../services/customerAddresses';
import type { Order, OrderItem, Shipment } from './orders/types';
import { normalizeAddress } from './orders/types';
import { activityLogService } from '../../services/activityLog';
import { softDeleteService } from '../../services/softDeleteService';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import RefundModal from './orders/RefundModal';

const OrderManagement: React.FC = () => {
  const { user, profile, effectiveProfile, effectiveUserId } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [sortBy, setSortBy] = useState<'date' | 'customer' | 'total'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showAddShipment, setShowAddShipment] = useState(false);
  const [canManageOrders, setCanManageOrders] = useState(false);
  const [organizationNames, setOrganizationNames] = useState<Record<string, string>>({});
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showBackorderModal, setShowBackorderModal] = useState(false);
  const [selectedBackorderItems, setSelectedBackorderItems] = useState<Set<number>>(new Set());
  const [backorderQuantities, setBackorderQuantities] = useState<Record<number, number>>({});
  const [backorderReason, setBackorderReason] = useState('');
  const [processingBackorder, setProcessingBackorder] = useState(false);
  const [relatedOrders, setRelatedOrders] = useState<Order[]>([]);
  const [subOrders, setSubOrders] = useState<Order[]>([]);
  const [showSubOrders, setShowSubOrders] = useState(false);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [debugOrder, setDebugOrder] = useState<Order | null>(null);
  const [selectedOrderOrgName, setSelectedOrderOrgName] = useState<string | null>(null);
  const [orderCommission, setOrderCommission] = useState<any>(null);
  const [paymentLogs, setPaymentLogs] = useState<any[]>([]);
  const [paymentTransactions, setPaymentTransactions] = useState<any[]>([]);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [showDeleteOrderModal, setShowDeleteOrderModal] = useState(false);
  const [deleteTargetOrder, setDeleteTargetOrder] = useState<Order | null>(null);
  const [isDeletingOrder, setIsDeletingOrder] = useState(false);
  const [availableSalesReps, setAvailableSalesReps] = useState<{ id: string; full_name: string; email: string; role?: string; distributor_name?: string }[]>([]);
  const [orderSalesRepName, setOrderSalesRepName] = useState<string | null>(null);
  // Order editing state
  const [editingSection, setEditingSection] = useState<'shipping_address' | 'billing_address' | 'order_summary' | 'notes' | null>(null);
  const [editAddress, setEditAddress] = useState({ firstName: '', lastName: '', company: '', address1: '', address2: '', city: '', state: '', postalCode: '', country: 'US', phone: '', email: '' });
  const [editShipping, setEditShipping] = useState(0);
  const [editTax, setEditTax] = useState(0);
  const [editNotes, setEditNotes] = useState('');
  const [editPaymentStatus, setEditPaymentStatus] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[]>([]);
  const [loadingSavedAddresses, setLoadingSavedAddresses] = useState(false);
  const [showAddressPicker, setShowAddressPicker] = useState(true);

  const [newShipment, setNewShipment] = useState<Shipment>({
    carrier: '',
    tracking_number: '',
    shipped_date: '',
    estimated_delivery: '',
    status: 'in_transit',
    notes: ''
  });

  useEffect(() => {
    fetchOrders();
    checkManagementPermissions();
  }, [user, profile, effectiveProfile, effectiveUserId]);

  useEffect(() => {
    if (selectedOrder) {
      loadSubOrders(selectedOrder.id);
      resolveSelectedOrderNames(selectedOrder);
      fetchOrderCommission(selectedOrder.id);
      fetchPaymentLogs(selectedOrder.id);
      fetchPaymentTransactions(selectedOrder.id);
      fetchAvailableSalesReps(selectedOrder);
      resolveOrderSalesRepName(selectedOrder);
    } else {
      setSubOrders([]);
      setShowSubOrders(false);
      setSelectedOrderOrgName(null);
      setOrderCommission(null);
      setPaymentLogs([]);
      setPaymentTransactions([]);
      setAvailableSalesReps([]);
      setOrderSalesRepName(null);
    }
  }, [selectedOrder?.id]);

  const resolveSelectedOrderNames = async (order: Order) => {
    if (order.organization_id) {
      const cached = organizationNames[order.organization_id];
      if (cached) {
        setSelectedOrderOrgName(cached);
      } else {
        const { data } = await supabase
          .from('organizations')
          .select('name')
          .eq('id', order.organization_id)
          .maybeSingle();
        setSelectedOrderOrgName(data?.name || null);
        if (data?.name) {
          setOrganizationNames(prev => ({ ...prev, [order.organization_id!]: data.name }));
        }
      }
    } else {
      setSelectedOrderOrgName(null);
    }

  };

  const resolveOrderSalesRepName = async (order: Order) => {
    if (order.sales_rep_id) {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', order.sales_rep_id)
        .maybeSingle();
      setOrderSalesRepName(data?.full_name || data?.email || null);
    } else {
      setOrderSalesRepName(null);
    }
  };

  const fetchAvailableSalesReps = async (order: Order) => {
    try {
      const viewRole = effectiveProfile?.role ?? profile?.role;
      const viewUserId = effectiveUserId ?? user?.id;

      if (viewRole === 'distributor' && viewUserId) {
        // Distributors see their own sales reps
        const { data: dist } = await supabase
          .from('distributors')
          .select('id, profile_id')
          .eq('profile_id', viewUserId)
          .maybeSingle();

        if (dist) {
          const { data: reps } = await supabase
            .from('distributor_sales_reps')
            .select('sales_rep_id, profiles!distributor_sales_reps_sales_rep_id_fkey(id, full_name, email)')
            .eq('distributor_id', dist.id)
            .eq('is_active', true);

          const repList: { id: string; full_name: string; email: string }[] = [];
          // Add the distributor themselves
          const { data: distProfile } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .eq('id', dist.profile_id)
            .maybeSingle();
          if (distProfile) repList.push(distProfile);

          if (reps) {
            for (const r of reps) {
              const p = r.profiles as any;
              if (p?.id) repList.push({ id: p.id, full_name: p.full_name || '', email: p.email });
            }
          }
          setAvailableSalesReps(repList);
        }
      } else if (viewRole === 'admin') {
        // Admins see all sales reps + distributors with role labels
        const { data: profileData } = await supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .in('role', ['sales_rep', 'distributor'])
          .order('full_name', { ascending: true });

        if (profileData) {
          // For distributors, fetch their company name from the distributors table
          const distributorProfileIds = profileData.filter(p => p.role === 'distributor').map(p => p.id);
          let distributorNames: Record<string, string> = {};
          if (distributorProfileIds.length > 0) {
            const { data: distData } = await supabase
              .from('distributors')
              .select('profile_id, name')
              .in('profile_id', distributorProfileIds);
            if (distData) {
              for (const d of distData) {
                distributorNames[d.profile_id] = d.name;
              }
            }
          }

          // Also fetch which distributor each sales_rep belongs to
          const salesRepIds = profileData.filter(p => p.role === 'sales_rep').map(p => p.id);
          let repDistributorMap: Record<string, string> = {};
          if (salesRepIds.length > 0) {
            const { data: dsrData } = await supabase
              .from('distributor_sales_reps')
              .select('sales_rep_id, distributors!inner(name)')
              .in('sales_rep_id', salesRepIds)
              .eq('is_active', true);
            if (dsrData) {
              for (const dsr of dsrData) {
                const dist = dsr.distributors as any;
                if (dist?.name) {
                  repDistributorMap[dsr.sales_rep_id] = dist.name;
                }
              }
            }
          }

          setAvailableSalesReps(profileData.map(p => ({
            ...p,
            distributor_name: p.role === 'distributor'
              ? distributorNames[p.id]
              : repDistributorMap[p.id],
          })));
        } else {
          setAvailableSalesReps([]);
        }
      } else {
        setAvailableSalesReps([]);
      }
    } catch (error) {
      console.error('Error fetching available sales reps:', error);
      setAvailableSalesReps([]);
    }
  };

  const handleChangeSalesRep = async (orderId: string, salesRepId: string | null) => {
    const result = await orderService.updateOrderSalesRep(orderId, salesRepId);
    if (result.success) {
      if (selectedOrder?.id === orderId) {
        const updated = { ...selectedOrder, sales_rep_id: salesRepId ?? undefined };
        setSelectedOrder(updated);
        resolveOrderSalesRepName(updated);
        // Refresh commission if order is completed (trigger will recalculate)
        // Delay to allow the DB trigger to finish before fetching
        if (selectedOrder.status === 'completed') {
          setTimeout(() => fetchOrderCommission(orderId), 1500);
        }
      }
      fetchOrders();
    } else {
      alert(result.error || 'Failed to update sales rep');
    }
  };

  const fetchOrderCommission = async (orderId: string) => {
    try {
      const { data, error } = await supabase
        .from('commissions')
        .select('*, profiles:sales_rep_id(full_name, email)')
        .eq('order_id', orderId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching commission:', error);
        setOrderCommission(null);
      } else {
        setOrderCommission(data);
      }
    } catch (error) {
      console.error('Error fetching commission:', error);
      setOrderCommission(null);
    }
  };

  const [isRecalculating, setIsRecalculating] = useState(false);

  const recalculateCommission = async (order: Order) => {
    if (order.status !== 'completed') {
      alert('Commission can only be calculated for completed orders.');
      return;
    }
    setIsRecalculating(true);
    try {
      // Touch the order's updated_at to re-fire the commission trigger
      // The trigger fires on UPDATE OF status, sales_rep_id, items, total
      // We update total to itself to re-trigger
      const { error } = await supabase
        .from('orders')
        .update({ total: order.total, updated_at: new Date().toISOString() })
        .eq('id', order.id);

      if (error) {
        alert('Failed to recalculate commission: ' + error.message);
        return;
      }

      // Wait for the trigger to complete, then fetch updated commission
      await new Promise(resolve => setTimeout(resolve, 1500));
      await fetchOrderCommission(order.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to recalculate commission');
    } finally {
      setIsRecalculating(false);
    }
  };

  const fetchPaymentLogs = async (orderId: string) => {
    try {
      const { data, error } = await supabase
        .from('quickbooks_sync_log')
        .select('*')
        .or(`entity_id.eq.${orderId},entity_id.ilike.%${orderId.slice(0, 8)}%`)
        .in('entity_type', ['payment_authorize', 'payment_charge', 'payment_capture', 'payment_refund', 'payment_token', 'payment_ach', 'payment_void', 'invoice'])
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching payment logs:', error);
        setPaymentLogs([]);
      } else {
        setPaymentLogs(data || []);
      }
    } catch (error) {
      console.error('Error fetching payment logs:', error);
      setPaymentLogs([]);
    }
  };

  const fetchPaymentTransactions = async (orderId: string) => {
    try {
      const { data, error } = await supabase
        .from('payment_transactions')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching payment transactions:', error);
        setPaymentTransactions([]);
      } else {
        setPaymentTransactions(data || []);
      }
    } catch (error) {
      console.error('Error fetching payment transactions:', error);
      setPaymentTransactions([]);
    }
  };

  const checkManagementPermissions = async () => {
    if (!user) {
      setCanManageOrders(false);
      return;
    }

    if (profile?.role === 'admin') {
      setCanManageOrders(true);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('user_organization_roles')
        .select('role')
        .eq('user_id', user.id)
        .in('role', ['admin', 'manager']);

      if (error) throw error;

      setCanManageOrders(data && data.length > 0);
    } catch (error) {
      console.error('Error checking permissions:', error);
      setCanManageOrders(false);
    }
  };

  const fetchOrders = async () => {
    try {
      setLoading(true);

      let query = supabase
        .from('orders')
        .select('*')
        .is('deleted_at', null);

      // Use effective profile/user for data display (supports impersonation)
      const viewRole = effectiveProfile?.role ?? profile?.role;
      const viewUserId = effectiveUserId ?? user?.id;

      if (viewRole === 'customer' && viewUserId) {
        query = query.eq('user_id', viewUserId);
      } else if (viewRole === 'sales_rep' && viewUserId) {
        query = query.eq('sales_rep_id', viewUserId);
      } else if (viewRole === 'distributor' && viewUserId) {
        // Get the distributor record for the effective user
        const { data: distributorData } = await supabase
          .from('distributors')
          .select('id')
          .eq('profile_id', viewUserId)
          .maybeSingle();

        if (distributorData) {
          // Get the distributor's assigned customer organizations
          const { data: customers } = await supabase
            .from('distributor_customers')
            .select('organization_id')
            .eq('distributor_id', distributorData.id)
            .eq('is_active', true);

          if (customers && customers.length > 0) {
            const orgIds = customers.map(c => c.organization_id);
            query = query.in('organization_id', orgIds);
          } else {
            // No assigned customers — show nothing
            query = query.eq('organization_id', 'no-match');
          }
        } else {
          // If distributor record not found, show nothing
          query = query.eq('organization_id', 'no-match');
        }
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;
      setOrders(data || []);

      const organizationIds = [...new Set(data?.map(o => o.organization_id).filter(Boolean))];
      if (organizationIds.length > 0) {
        const { data: organizations, error: orgErr } = await supabase
          .from('organizations')
          .select('id, name')
          .in('id', organizationIds);

        if (orgErr) {
          console.error('Failed to fetch organization names:', orgErr);
        } else if (organizations) {
          const names: Record<string, string> = {};
          organizations.forEach(org => { names[org.id] = org.name; });
          setOrganizationNames(names);
        }
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const canCancelOrder = (order: Order): boolean => {
    if (canManageOrders) return true; // Admins can always cancel
    return order.status === 'pending'; // Non-admins can only cancel pending orders
  };

  const handleCancelOrder = async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    if (!canManageOrders && order.status !== 'pending') {
      alert('Only pending orders can be cancelled.');
      return;
    }

    const hasAuthorizedPayment = order.payment_status === 'authorized';
    const confirmMsg = hasAuthorizedPayment
      ? `This order has an authorized payment of $${order.total?.toFixed(2)}. The authorization will be voided. Cancel this order?`
      : 'Are you sure you want to cancel this order? This action cannot be undone.';

    if (!confirm(confirmMsg)) {
      return;
    }

    try {
      const result = await orderService.cancelOrder(orderId, canManageOrders);
      if (!result.success) {
        alert(`Failed to cancel order: ${result.error}`);
        return;
      }

      if (user) {
        activityLogService.logAction({
          userId: user.id,
          action: 'order_cancelled',
          resourceType: 'order',
          resourceId: orderId,
          details: {
            old_status: order.status,
            new_status: 'cancelled',
            customer_email: order.customer_email,
            organization_id: order.organization_id,
            payment_voided: hasAuthorizedPayment,
          },
        });
      }

      await fetchOrders();
      if (selectedOrder?.id === orderId) {
        setSelectedOrder({ ...selectedOrder, status: 'cancelled' });
        fetchPaymentLogs(orderId);
      }
    } catch (error) {
      console.error('Error cancelling order:', error);
      alert('Failed to cancel order. Please try again.');
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      const order = orders.find(o => o.id === orderId);

      if (newStatus === 'completed') {
        if (!order?.payment_status || order.payment_status === 'pending') {
          alert('Cannot complete order: No payment information available. Please ensure a valid payment method is on file.');
          return;
        }

        if (order.payment_status !== 'captured') {
          const captureResult = await orderService.capturePaymentOnShipment(orderId);
          if (!captureResult.success) {
            alert(`Cannot complete order: Payment capture failed: ${captureResult.error}\n\nPlease ensure the payment method is valid before completing the order.`);
            return;
          }
        }
      }

      const updateData: any = {
        status: newStatus,
        updated_at: new Date().toISOString()
      };

      if (newStatus === 'completed') {
        updateData.completed_at = new Date().toISOString();
      }

      if (newStatus === 'shipped') {
        const captureResult = await orderService.capturePaymentOnShipment(orderId);
        if (!captureResult.success) {
          alert(`Warning: Payment capture failed: ${captureResult.error}`);
        }
      }

      if (newStatus === 'cancelled' && order?.payment_status === 'authorized') {
        const voidResult = await orderService.voidPayment(orderId);
        if (!voidResult.success) {
          alert(`Warning: Auto-void failed: ${voidResult.error}. The authorization hold will expire on its own.`);
        }
      }

      const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', orderId);

      if (error) throw error;

      // Log the status change as a payment event for visibility
      await orderService.logPaymentEvent(orderId, {
        event: `status_changed_to_${newStatus}`,
        status: newStatus,
        method: 'Admin action',
        lastFour: '----',
        transactionId: `status_${order?.status || 'unknown'}_to_${newStatus}`,
        amount: order?.total || 0,
      });

      // Log the status change to activity log
      if (user) {
        const order2 = orders.find(o => o.id === orderId);
        activityLogService.logAction({
          userId: user.id,
          action: 'order_status_changed',
          resourceType: 'order',
          resourceId: orderId,
          details: {
            old_status: order2?.status,
            new_status: newStatus,
            customer_email: order2?.customer_email,
            organization_id: order2?.organization_id,
          },
        });
      }

      await fetchOrders();
      if (selectedOrder?.id === orderId) {
        setSelectedOrder({ ...selectedOrder, status: newStatus });
        // Refresh commission and payment logs after status change
        fetchOrderCommission(orderId);
        fetchPaymentLogs(orderId);
        fetchPaymentTransactions(orderId);
      }
    } catch (error) {
      console.error('Error updating order status:', error);
      alert('Failed to update order status. Please try again.');
    }
  };

  const handleOpenBackorderModal = async (order: Order) => {
    setSelectedOrder(order);
    setSelectedBackorderItems(new Set());
    setBackorderQuantities({});
    setBackorderReason('');

    await loadRelatedOrders(order.id);

    setShowBackorderModal(true);
  };

  const getSplitQuantitiesForItem = (productId: number): number => {
    let totalSplitQty = 0;

    relatedOrders.forEach(relatedOrder => {
      if (relatedOrder.split_from_order_id === selectedOrder?.id) {
        const splitItem = relatedOrder.items.find((item: OrderItem) => item.productId === productId);
        if (splitItem) {
          totalSplitQty += splitItem.quantity;
        }
      }
    });

    return totalSplitQty;
  };

  const getAvailableQuantityForItem = (item: OrderItem): number => {
    const splitQty = getSplitQuantitiesForItem(item.productId);
    return Math.max(0, item.quantity - splitQty);
  };

  const toggleBackorderItem = (productId: number, maxQuantity: number) => {
    const newSet = new Set(selectedBackorderItems);
    const newQuantities = { ...backorderQuantities };

    if (newSet.has(productId)) {
      newSet.delete(productId);
      delete newQuantities[productId];
    } else {
      newSet.add(productId);
      newQuantities[productId] = maxQuantity;
    }

    setSelectedBackorderItems(newSet);
    setBackorderQuantities(newQuantities);
  };

  const updateBackorderQuantity = (productId: number, quantity: number, maxQuantity: number) => {
    const clampedQuantity = Math.min(Math.max(1, quantity), maxQuantity);
    setBackorderQuantities(prev => ({
      ...prev,
      [productId]: clampedQuantity
    }));
  };

  const handleSplitBackorder = async () => {
    if (!selectedOrder || selectedBackorderItems.size === 0) {
      alert('Please select at least one item to backorder');
      return;
    }

    if (!backorderReason.trim()) {
      alert('Please provide a reason for the backorder');
      return;
    }

    setProcessingBackorder(true);
    try {
      const backorderItemsData = Array.from(selectedBackorderItems).map(productId => ({
        productId,
        quantity: backorderQuantities[productId] || 0
      }));

      const result = await orderService.splitOrderByBackorderWithQuantities(
        selectedOrder.id,
        backorderItemsData
      );

      if (result.error) {
        alert(`Error splitting order: ${result.error}`);
        return;
      }

      if (result.backorder) {
        await supabase
          .from('orders')
          .update({ backorder_reason: backorderReason })
          .eq('id', result.backorder.id);
      }

      alert('Order successfully split! Back-ordered items moved to a new order.');
      setShowBackorderModal(false);
      setSelectedBackorderItems(new Set());
      setBackorderQuantities({});
      setBackorderReason('');
      await fetchOrders();
      setSelectedOrder(null);
    } catch (error) {
      console.error('Error processing backorder:', error);
      alert('Failed to process backorder');
    } finally {
      setProcessingBackorder(false);
    }
  };

  const loadRelatedOrders = async (orderId: string) => {
    try {
      const result = await orderService.getRelatedOrders(orderId);
      if (!result.error) {
        setRelatedOrders(result.orders);
      }
    } catch (error) {
      console.error('Error loading related orders:', error);
    }
  };

  const loadSubOrders = async (orderId: string) => {
    try {
      const result = await orderService.getSubOrders(orderId);
      if (!result.error) {
        setSubOrders(result.subOrders);
        setShowSubOrders(result.subOrders.length > 0);
      }
    } catch (error) {
      console.error('Error loading sub-orders:', error);
    }
  };

  const handleSplitByVendor = async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (order) {
      setDebugOrder(order);
      setShowDebugModal(true);
    }
  };

  const confirmSplitByVendor = async () => {
    if (!debugOrder) return;

    setShowDebugModal(false);

    try {
      const result = await orderService.splitOrderByVendor(debugOrder.id);

      if (result.error) {
        alert(result.error);
        return;
      }

      alert(`Order split successfully into ${result.subOrders.length} vendor orders`);
      await fetchOrders();

      if (selectedOrder?.id === debugOrder.id) {
        await loadSubOrders(debugOrder.id);
      }
    } catch (error) {
      console.error('Error splitting order by vendor:', error);
      alert('Failed to split order by vendor');
    }
  };

  const addShipment = async (orderId: string) => {
    if (!newShipment.carrier || !newShipment.tracking_number) {
      alert('Carrier and tracking number are required');
      return;
    }

    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      const existingShipments = order.shipments || [];
      const updatedShipments = [...existingShipments, newShipment];

      const { error } = await supabase
        .from('orders')
        .update({
          shipments: updatedShipments,
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId);

      if (error) throw error;

      await fetchOrders();
      if (selectedOrder?.id === orderId) {
        setSelectedOrder({ ...selectedOrder, shipments: updatedShipments });
      }

      setNewShipment({
        carrier: '',
        tracking_number: '',
        shipped_date: '',
        estimated_delivery: '',
        status: 'in_transit',
        notes: ''
      });
      setShowAddShipment(false);
    } catch (error) {
      console.error('Error adding shipment:', error);
      alert('Failed to add shipment tracking');
    }
  };

  const removeShipment = async (orderId: string, trackingNumber: string) => {
    if (!confirm('Are you sure you want to remove this shipment tracking?')) {
      return;
    }

    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      const updatedShipments = (order.shipments || []).filter(
        s => s.tracking_number !== trackingNumber
      );

      const { error } = await supabase
        .from('orders')
        .update({
          shipments: updatedShipments,
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId);

      if (error) throw error;

      await fetchOrders();
      if (selectedOrder?.id === orderId) {
        setSelectedOrder({ ...selectedOrder, shipments: updatedShipments });
      }
    } catch (error) {
      console.error('Error removing shipment:', error);
      alert('Failed to remove shipment tracking');
    }
  };

  const filteredOrders = React.useMemo(() => {
    let filtered = orders.filter(order => {
      const lowerSearch = searchTerm.toLowerCase();
      const matchesSearch =
        order.customer_email.toLowerCase().includes(lowerSearch) ||
        order.id.toLowerCase().includes(lowerSearch) ||
        order.order_number?.toLowerCase().includes(lowerSearch) ||
        (order.organization_id && organizationNames[order.organization_id]?.toLowerCase().includes(lowerSearch));

      const matchesStatus = statusFilter === 'all' || order.status === statusFilter;

      let matchesDate = true;
      const orderDate = new Date(order.created_at);

      if (dateFilter === 'today') {
        const today = new Date();
        matchesDate = orderDate.toDateString() === today.toDateString();
      } else if (dateFilter === 'yesterday') {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        matchesDate = orderDate.toDateString() === yesterday.toDateString();
      } else if (dateFilter === 'last7days') {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        matchesDate = orderDate >= sevenDaysAgo;
      } else if (dateFilter === 'last30days') {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        matchesDate = orderDate >= thirtyDaysAgo;
      } else if (dateFilter === 'custom' && startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        matchesDate = orderDate >= start && orderDate <= end;
      }

      return matchesSearch && matchesStatus && matchesDate;
    });

    filtered.sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'date') {
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      } else if (sortBy === 'customer') {
        comparison = a.customer_email.localeCompare(b.customer_email);
      } else if (sortBy === 'total') {
        comparison = a.total - b.total;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [orders, searchTerm, statusFilter, dateFilter, startDate, endDate, sortBy, sortOrder]);

  // Group orders: parent orders with their sub-orders
  const groupedOrders = React.useMemo(() => {
    const groups: Array<{ parent: Order; subOrders: Order[] }> = [];
    const processedIds = new Set<string>();

    filteredOrders.forEach(order => {
      if (processedIds.has(order.id)) return;

      // If this is a parent order (has split children)
      if (order.order_type === 'split_parent' || order.parent_order_id === null &&
          filteredOrders.some(o => o.parent_order_id === order.id)) {
        const subOrders = filteredOrders.filter(o => o.parent_order_id === order.id);
        groups.push({ parent: order, subOrders });
        processedIds.add(order.id);
        subOrders.forEach(sub => processedIds.add(sub.id));
      }
      // If this is a standalone order (not a parent, not a sub-order)
      else if (!order.is_sub_order && !order.parent_order_id) {
        groups.push({ parent: order, subOrders: [] });
        processedIds.add(order.id);
      }
      // If this is an orphaned sub-order (parent not in filtered list)
      else if (order.is_sub_order && !filteredOrders.some(o => o.id === order.parent_order_id)) {
        groups.push({ parent: order, subOrders: [] });
        processedIds.add(order.id);
      }
    });

    return groups;
  }, [filteredOrders]);

  const toggleRowExpansion = (orderId: string) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  };

  const getPaymentStatusColor = (paymentStatus?: string) => {
    switch (paymentStatus?.toLowerCase()) {
      case 'authorized':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'captured':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'processing':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'cancelled':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'refunded':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getShipmentStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'delivered':
        return 'bg-green-100 text-green-800';
      case 'in_transit':
        return 'bg-blue-100 text-blue-800';
      case 'out_for_delivery':
        return 'bg-yellow-100 text-yellow-800';
      case 'exception':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleDeleteOrder = (order: Order) => {
    setDeleteTargetOrder(order);
    setShowDeleteOrderModal(true);
  };

  const confirmDeleteOrder = async () => {
    if (!deleteTargetOrder || !user) return;
    setIsDeletingOrder(true);
    try {
      const result = await softDeleteService.deleteOrder(deleteTargetOrder.id, user.id);
      if (!result.success) {
        alert(result.error || 'Failed to delete order');
        return;
      }
      setOrders(prev => prev.filter(o => o.id !== deleteTargetOrder.id));
      setSelectedOrder(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete order');
    } finally {
      setIsDeletingOrder(false);
      setShowDeleteOrderModal(false);
      setDeleteTargetOrder(null);
    }
  };

  const startEditAddress = async (type: 'shipping_address' | 'billing_address', order: Order) => {
    const raw = type === 'shipping_address' ? order.shipping_address : order.billing_address;
    const addr = normalizeAddress(raw);
    setEditAddress(addr || { firstName: '', lastName: '', company: '', address1: '', address2: '', city: '', state: '', postalCode: '', country: 'US', phone: '', email: '' });
    setEditingSection(type);
    setShowAddressPicker(true);

    // Fetch saved addresses for this customer's organization or user
    setLoadingSavedAddresses(true);
    try {
      let addresses: CustomerAddress[] = [];
      if (order.organization_id) {
        addresses = await customerAddressService.getOrganizationAddresses(order.organization_id);
      } else if (order.user_id) {
        addresses = await customerAddressService.getUserAddresses(order.user_id);
      }
      // Filter to the relevant type (shipping/billing) or show all
      const addrType = type === 'shipping_address' ? 'shipping' : 'billing';
      const filtered = addresses.filter(a => a.address_type === addrType);
      // If no addresses of that type, show all
      setSavedAddresses(filtered.length > 0 ? filtered : addresses);
    } catch (err) {
      console.error('Failed to fetch saved addresses:', err);
      setSavedAddresses([]);
    } finally {
      setLoadingSavedAddresses(false);
    }
  };

  const selectSavedAddress = (addr: CustomerAddress) => {
    setEditAddress({
      firstName: addr.first_name || '',
      lastName: addr.last_name || '',
      company: addr.company || '',
      address1: addr.address1 || '',
      address2: addr.address2 || '',
      city: addr.city || '',
      state: addr.state_or_province || '',
      postalCode: addr.postal_code || '',
      country: addr.country_code || 'US',
      phone: addr.phone || '',
      email: addr.email || '',
    });
    setShowAddressPicker(false);
  };

  const startEditSummary = (order: Order) => {
    setEditShipping(Number(order.shipping) || 0);
    setEditTax(Number(order.tax) || 0);
    setEditPaymentStatus(order.payment_status || 'pending');
    setEditingSection('order_summary');
  };

  const startEditNotes = (order: Order) => {
    setEditNotes(order.notes || '');
    setEditingSection('notes');
  };

  const cancelEdit = () => {
    setEditingSection(null);
    setSavingEdit(false);
  };

  const saveEdit = async (order: Order) => {
    if (!editingSection) return;
    setSavingEdit(true);
    try {
      let updates: Record<string, any> = {};

      if (editingSection === 'shipping_address' || editingSection === 'billing_address') {
        updates[editingSection] = {
          firstName: editAddress.firstName,
          lastName: editAddress.lastName,
          company: editAddress.company,
          address1: editAddress.address1,
          address2: editAddress.address2,
          city: editAddress.city,
          state: editAddress.state,
          postalCode: editAddress.postalCode,
          country: editAddress.country,
          phone: editAddress.phone,
          email: editAddress.email,
        };
      } else if (editingSection === 'order_summary') {
        updates.shipping = editShipping;
        updates.tax = editTax;
        updates.payment_status = editPaymentStatus;
      } else if (editingSection === 'notes') {
        updates.notes = editNotes;
      }

      const result = await orderService.adminUpdateOrder(order.id, updates);
      if (result.success) {
        // Refresh the order in state
        const { order: refreshed } = await orderService.getOrderById(order.id);
        if (refreshed) {
          setSelectedOrder(refreshed);
          setOrders(prev => prev.map(o => o.id === refreshed.id ? refreshed : o));
        }
        setEditingSection(null);
      } else {
        alert('Failed to save: ' + (result.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error saving changes: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSavingEdit(false);
    }
  };

  const renderAddressPicker = (order: Order) => (
    <div className="space-y-2">
      {loadingSavedAddresses ? (
        <div className="flex items-center justify-center py-4">
          <Loader className="h-4 w-4 animate-spin text-gray-400 mr-2" />
          <span className="text-sm text-gray-500">Loading saved addresses...</span>
        </div>
      ) : savedAddresses.length > 0 ? (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {savedAddresses.map((addr) => (
            <button
              key={addr.id}
              onClick={() => selectSavedAddress(addr)}
              className="w-full text-left p-3 border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">{addr.label}</span>
                <div className="flex items-center gap-1.5">
                  {addr.is_default && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Default</span>
                  )}
                  <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{addr.address_type}</span>
                </div>
              </div>
              <p className="text-xs text-gray-600 mt-1">
                {addr.first_name} {addr.last_name}{addr.company ? ` — ${addr.company}` : ''}
              </p>
              <p className="text-xs text-gray-500">
                {addr.address1}{addr.address2 ? `, ${addr.address2}` : ''}, {addr.city}, {addr.state_or_province} {addr.postal_code}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic py-2">No saved addresses found for this customer.</p>
      )}
      <button
        onClick={() => setShowAddressPicker(false)}
        className="w-full flex items-center justify-center gap-1.5 p-2.5 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
      >
        <Pencil className="h-3.5 w-3.5" />
        Enter address manually
      </button>
      <div className="flex justify-end">
        <button onClick={cancelEdit} className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 transition-colors">
          <XCircle className="h-3 w-3" />
          Cancel
        </button>
      </div>
    </div>
  );

  const renderAddressForm = () => (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">First Name</label>
        <input type="text" value={editAddress.firstName} onChange={e => setEditAddress(p => ({ ...p, firstName: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label>
        <input type="text" value={editAddress.lastName} onChange={e => setEditAddress(p => ({ ...p, lastName: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
      </div>
      <div className="col-span-2">
        <label className="block text-xs font-medium text-gray-600 mb-1">Company</label>
        <input type="text" value={editAddress.company} onChange={e => setEditAddress(p => ({ ...p, company: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
      </div>
      <div className="col-span-2">
        <label className="block text-xs font-medium text-gray-600 mb-1">Address Line 1</label>
        <input type="text" value={editAddress.address1} onChange={e => setEditAddress(p => ({ ...p, address1: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
      </div>
      <div className="col-span-2">
        <label className="block text-xs font-medium text-gray-600 mb-1">Address Line 2</label>
        <input type="text" value={editAddress.address2} onChange={e => setEditAddress(p => ({ ...p, address2: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">City</label>
        <input type="text" value={editAddress.city} onChange={e => setEditAddress(p => ({ ...p, city: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
        <input type="text" value={editAddress.state} onChange={e => setEditAddress(p => ({ ...p, state: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Postal Code</label>
        <input type="text" value={editAddress.postalCode} onChange={e => setEditAddress(p => ({ ...p, postalCode: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Country</label>
        <input type="text" value={editAddress.country} onChange={e => setEditAddress(p => ({ ...p, country: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
        <input type="text" value={editAddress.phone} onChange={e => setEditAddress(p => ({ ...p, phone: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
        <input type="text" value={editAddress.email} onChange={e => setEditAddress(p => ({ ...p, email: e.target.value }))} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
      </div>
    </div>
  );

  const renderEditButtons = (order: Order) => (
    <div className="flex items-center gap-2 mt-3">
      <button onClick={() => saveEdit(order)} disabled={savingEdit} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 transition-colors">
        {savingEdit ? <Loader className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        Save
      </button>
      <button onClick={cancelEdit} disabled={savingEdit} className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 disabled:opacity-50 transition-colors">
        <XCircle className="h-3 w-3" />
        Cancel
      </button>
    </div>
  );

  const renderOrderDetailsModal = (order: Order) => (
    <div className="fixed inset-0 z-50 overflow-y-auto" onClick={e => e.stopPropagation()}>
      <div className="flex items-start justify-center min-h-screen pt-4 px-4 pb-20">
        <div className="fixed inset-0 bg-black bg-opacity-50"></div>

        <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto mt-8">
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
            <div>
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-bold text-gray-900">Order Details</h3>
                {order.is_test_order && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-100 border border-amber-300 rounded-full text-xs font-semibold text-amber-900">
                    <AlertTriangle className="h-3 w-3" />
                    TEST ORDER
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500">ID: {order.id.slice(0, 8)}...</p>
            </div>
            <div className="flex items-center gap-2">
              {canManageOrders && (
                <button
                  onClick={() => handleDeleteOrder(order)}
                  className="p-2 text-red-600 hover:bg-red-50 rounded-full transition-colors"
                  title="Delete Order"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              )}
              <button
                onClick={() => { setSelectedOrder(null); setEditingSection(null); }}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                  <Mail className="h-4 w-4 mr-2" />
                  Customer Information
                </h4>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-gray-600">Email:</span>
                    <p className="font-medium">{order.customer_email}</p>
                  </div>
                  <div>
                    <span className="text-gray-600">Order Date:</span>
                    <p className="font-medium">
                      {new Date(order.created_at).toLocaleDateString()} at {new Date(order.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-600">Status:</span>
                    <div className="mt-1">
                      {canManageOrders ? (
                        <select
                          value={order.status}
                          onChange={(e) => updateOrderStatus(order.id, e.target.value)}
                          className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(order.status)}`}
                        >
                          <option value="pending">Pending</option>
                          <option value="processing">Processing</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                          <option value="refunded">Refunded</option>
                        </select>
                      ) : (
                        <div className="flex items-center space-x-2">
                          <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${getStatusColor(order.status)}`}>
                            {order.status}
                          </span>
                          {canCancelOrder(order) && order.status === 'pending' && (
                            <button
                              onClick={() => handleCancelOrder(order.id)}
                              className="px-3 py-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-full hover:bg-red-100 transition-colors"
                            >
                              Cancel Order
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {order.organization_id && (
                    <div>
                      <span className="text-gray-600">Customer:</span>
                      <p className="font-medium flex items-center mt-1">
                        <Building2 className="h-3 w-3 mr-1 text-green-600" />
                        {selectedOrderOrgName || organizationNames[order.organization_id] || (
                          <span className="text-gray-400 italic text-xs">Loading…</span>
                        )}
                      </p>
                    </div>
                  )}
                  {canManageOrders && (effectiveProfile?.role ?? profile?.role) !== 'customer' && (
                    <div>
                      <span className="text-gray-600">Sales Rep:</span>
                      <div className="mt-1">
                        {availableSalesReps.length > 0 ? (
                          <select
                            value={order.sales_rep_id || ''}
                            onChange={(e) => handleChangeSalesRep(order.id, e.target.value || null)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          >
                            <option value="">No Sales Rep</option>
                            {availableSalesReps.map((rep) => {
                              const roleLabel = rep.role === 'distributor' ? 'Distributor' : 'Rep';
                              const distInfo = rep.role === 'sales_rep' && rep.distributor_name
                                ? ` — ${rep.distributor_name}`
                                : '';
                              return (
                                <option key={rep.id} value={rep.id}>
                                  [{roleLabel}] {rep.full_name || rep.email}{distInfo}
                                </option>
                              );
                            })}
                          </select>
                        ) : (
                          <p className="font-medium flex items-center">
                            <UserCheck className="h-3 w-3 mr-1 text-purple-600" />
                            {orderSalesRepName || (order.sales_rep_id ? 'Loading...' : 'None')}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center justify-between">
                  <span className="flex items-center">
                    <CreditCard className="h-4 w-4 mr-2" />
                    Order Summary
                  </span>
                  {isAdmin && editingSection !== 'order_summary' && (
                    <button onClick={() => startEditSummary(order)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="Edit order summary">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </h4>
                {editingSection === 'order_summary' ? (
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Subtotal:</span>
                      <span className="font-medium">${Number(order.subtotal).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <label className="text-gray-600">Tax:</label>
                      <input type="number" step="0.01" min="0" value={editTax} onChange={e => setEditTax(parseFloat(e.target.value) || 0)} className="w-28 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                    </div>
                    <div className="flex justify-between items-center">
                      <label className="text-gray-600">Shipping:</label>
                      <input type="number" step="0.01" min="0" value={editShipping} onChange={e => setEditShipping(parseFloat(e.target.value) || 0)} className="w-28 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                    </div>
                    <div className="border-t border-gray-300 pt-2 flex justify-between font-semibold text-base">
                      <span>Total:</span>
                      <span>${(Number(order.subtotal) + editTax + editShipping).toFixed(2)}</span>
                    </div>
                    <div className="border-t border-gray-300 pt-2 mt-2">
                      <div className="flex justify-between items-center">
                        <label className="text-gray-600">Payment Status:</label>
                        <select value={editPaymentStatus} onChange={e => setEditPaymentStatus(e.target.value)} className="px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                          <option value="pending">pending</option>
                          <option value="authorized">authorized</option>
                          <option value="captured">captured</option>
                          <option value="refunded">refunded</option>
                          <option value="failed">failed</option>
                          <option value="cancelled">cancelled</option>
                        </select>
                      </div>
                    </div>
                    {renderEditButtons(order)}
                  </div>
                ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Subtotal:</span>
                    <span className="font-medium">${Number(order.subtotal).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tax:</span>
                    <span className="font-medium">${Number(order.tax).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Shipping:</span>
                    <span className="font-medium">${Number(order.shipping).toFixed(2)}</span>
                  </div>
                  <div className="border-t border-gray-300 pt-2 flex justify-between font-semibold text-base">
                    <span>Total:</span>
                    <span>${Number(order.total).toFixed(2)}</span>
                  </div>
                  <div className="border-t border-gray-300 pt-2 mt-2">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Payment Status:</span>
                      {order.payment_status ? (
                        <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${getPaymentStatusColor(order.payment_status)}`}>
                          {order.payment_status}
                        </span>
                      ) : (
                        <span className="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border bg-gray-100 text-gray-500">
                          No Payment Info
                        </span>
                      )}
                    </div>
                    {order.payment_captured_at && (
                      <div className="mt-2 text-xs text-gray-500">
                        Captured: {new Date(order.payment_captured_at).toLocaleString()}
                      </div>
                    )}
                    {isAdmin && order.payment_status === 'authorized' && (
                      <div className="mt-3">
                        <button
                          onClick={async () => {
                            if (!confirm(`Void the $${Number(order.total).toFixed(2)} authorization on this order? The hold will be released.`)) return;
                            const result = await orderService.voidPayment(order.id);
                            if (result.success) {
                              alert('Authorization voided successfully.');
                              await fetchOrders();
                              const { order: refreshed } = await orderService.getOrderById(order.id);
                              if (refreshed) setSelectedOrder(refreshed);
                              fetchPaymentLogs(order.id);
                              fetchPaymentTransactions(order.id);
                            } else {
                              alert(`Void failed: ${result.error}`);
                            }
                          }}
                          className="w-full px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100"
                        >
                          Void Authorization
                        </button>
                      </div>
                    )}
                    {canManageOrders && (order.payment_status === 'captured' || order.payment_status === 'partially_refunded') && (
                      <div className="mt-3">
                        <button
                          onClick={() => setShowRefundModal(true)}
                          className="w-full px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100"
                        >
                          Refund Payment
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                )}
              </div>
            </div>

            {/* Order Notes */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="font-semibold text-gray-900 mb-3 flex items-center justify-between">
                <span className="flex items-center">
                  <FileText className="h-4 w-4 mr-2" />
                  Order Notes
                </span>
                {isAdmin && editingSection !== 'notes' && (
                  <button onClick={() => startEditNotes(order)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="Edit notes">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </h4>
              {editingSection === 'notes' ? (
                <div>
                  <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={4} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="Add notes about this order..." />
                  {renderEditButtons(order)}
                </div>
              ) : (
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{order.notes || <span className="text-gray-400 italic">No notes</span>}</p>
              )}
            </div>

            {/* Payment Processing Log */}
            {canManageOrders && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                  <Activity className="h-4 w-4 mr-2 text-indigo-600" />
                  Payment Processing Log
                </h4>
                {order.notes && order.notes.includes('[') ? (
                  <div className="space-y-2">
                    {order.notes.split('\n').filter((line: string) => line.trim()).map((line: string, idx: number) => {
                      const isSuccess = line.includes('captured') || line.includes('authorized') || line.includes('success');
                      const isFailed = line.includes('failed') || line.includes('error');
                      const isSkipped = line.includes('skipped');
                      return (
                        <div key={idx} className={`flex items-start space-x-2 p-2 rounded text-xs font-mono ${
                          isFailed ? 'bg-red-50 border border-red-200' :
                          isSkipped ? 'bg-yellow-50 border border-yellow-200' :
                          isSuccess ? 'bg-green-50 border border-green-200' :
                          'bg-white border border-gray-200'
                        }`}>
                          <span className={`mt-0.5 flex-shrink-0 h-2 w-2 rounded-full ${
                            isFailed ? 'bg-red-500' :
                            isSkipped ? 'bg-yellow-500' :
                            isSuccess ? 'bg-green-500' :
                            'bg-blue-500'
                          }`} />
                          <span className="break-all">{line}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic">No payment events logged yet</p>
                )}

                {/* QuickBooks API Logs */}
                {paymentLogs.length > 0 && (
                  <div className="mt-4">
                    <h5 className="text-sm font-semibold text-gray-700 mb-2 flex items-center">
                      <FileText className="h-3.5 w-3.5 mr-1.5 text-gray-500" />
                      QuickBooks API Activity
                    </h5>
                    <div className="space-y-1.5">
                      {paymentLogs.map((log: any) => (
                        <div key={log.id} className={`flex items-center justify-between p-2 rounded text-xs border ${
                          log.status === 'success' ? 'bg-green-50 border-green-200' :
                          log.status === 'failed' ? 'bg-red-50 border-red-200' :
                          log.status === 'pending' ? 'bg-yellow-50 border-yellow-200' :
                          'bg-gray-50 border-gray-200'
                        }`}>
                          <div className="flex items-center space-x-2">
                            <span className={`h-2 w-2 rounded-full flex-shrink-0 ${
                              log.status === 'success' ? 'bg-green-500' :
                              log.status === 'failed' ? 'bg-red-500' :
                              log.status === 'pending' ? 'bg-yellow-500' :
                              'bg-gray-500'
                            }`} />
                            <span className="font-medium">{log.entity_type?.replace('payment_', '').replace('_', ' ').toUpperCase()}</span>
                            <span className="text-gray-500">{log.operation}</span>
                            {log.quickbooks_id && <span className="text-gray-400 font-mono">QB: {log.quickbooks_id}</span>}
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className={`px-1.5 py-0.5 rounded font-medium ${
                              log.status === 'success' ? 'text-green-700' :
                              log.status === 'failed' ? 'text-red-700' :
                              'text-gray-700'
                            }`}>{log.status}</span>
                            <span className="text-gray-400">{new Date(log.created_at).toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {paymentLogs.some((log: any) => log.error_message) && (
                      <div className="mt-2 space-y-1">
                        {paymentLogs.filter((log: any) => log.error_message).map((log: any) => (
                          <div key={`err-${log.id}`} className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
                            <span className="font-medium">Error ({log.entity_type}):</span> {log.error_message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {paymentLogs.length === 0 && !order.notes && (
                  <p className="text-sm text-gray-500 italic mt-2">No QuickBooks API activity for this order</p>
                )}
              </div>
            )}

            {/* Payment Transaction History */}
            {canManageOrders && paymentTransactions.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                  <DollarSign className="h-4 w-4 mr-2 text-green-600" />
                  Payment Transaction History
                </h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="py-2 pr-3 text-left font-medium text-gray-500">Date</th>
                        <th className="py-2 pr-3 text-left font-medium text-gray-500">Type</th>
                        <th className="py-2 pr-3 text-left font-medium text-gray-500">Amount</th>
                        <th className="py-2 pr-3 text-left font-medium text-gray-500">Status</th>
                        <th className="py-2 pr-3 text-left font-medium text-gray-500">Last 4</th>
                        <th className="py-2 text-left font-medium text-gray-500">Transaction ID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {paymentTransactions.map((txn: any) => (
                        <tr key={txn.id}>
                          <td className="py-2 pr-3 text-gray-600">{new Date(txn.created_at).toLocaleString()}</td>
                          <td className="py-2 pr-3">
                            <span className={`px-2 py-0.5 rounded-full font-medium ${
                              txn.transaction_type === 'authorization' ? 'bg-blue-100 text-blue-700' :
                              txn.transaction_type === 'capture' ? 'bg-green-100 text-green-700' :
                              txn.transaction_type === 'void' ? 'bg-orange-100 text-orange-700' :
                              txn.transaction_type === 'refund' ? 'bg-red-100 text-red-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>
                              {txn.transaction_type}
                            </span>
                          </td>
                          <td className="py-2 pr-3 font-mono">${Number(txn.amount).toFixed(2)}</td>
                          <td className="py-2 pr-3">
                            <span className={`font-medium ${
                              txn.status === 'success' ? 'text-green-600' :
                              txn.status === 'failed' ? 'text-red-600' :
                              txn.status === 'declined' ? 'text-red-600' :
                              'text-yellow-600'
                            }`}>
                              {txn.status}
                            </span>
                          </td>
                          <td className="py-2 pr-3 font-mono text-gray-500">{txn.last_four ? `****${txn.last_four}` : '—'}</td>
                          <td className="py-2 font-mono text-gray-400 truncate max-w-[120px]">{txn.gateway_transaction_id || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {paymentTransactions.some((txn: any) => txn.error_message) && (
                  <div className="mt-2 space-y-1">
                    {paymentTransactions.filter((txn: any) => txn.error_message).map((txn: any) => (
                      <div key={`txn-err-${txn.id}`} className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
                        <span className="font-medium">{txn.transaction_type} error:</span> {txn.error_message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Notes (non-payment) */}
            {order.notes && !order.notes.includes('[') && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-blue-900 mb-2">Notes</h4>
                <p className="text-sm text-blue-800">{order.notes}</p>
              </div>
            )}

            {/* Commission Status — never visible to customer users */}
            {canManageOrders && (effectiveProfile?.role ?? profile?.role) !== 'customer' && (() => {
              const orderViewRole = effectiveProfile?.role ?? profile?.role;
              const isOrderSalesRep = orderViewRole === 'sales_rep';
              const isOrderAdmin = orderViewRole === 'admin' || orderViewRole === 'company_rep';
              return (
              <div className={`border rounded-lg p-4 ${
                orderCommission ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-gray-900 flex items-center">
                    <DollarSign className="h-4 w-4 mr-2 text-green-600" />
                    Commission Status
                  </h4>
                  {isOrderAdmin && order.status === 'completed' && (
                    <button
                      onClick={() => recalculateCommission(order)}
                      disabled={isRecalculating}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-100 hover:bg-green-200 border border-green-300 rounded-lg transition-colors disabled:opacity-50"
                      title="Re-run commission calculation for this order"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isRecalculating ? 'animate-spin' : ''}`} />
                      {isRecalculating ? 'Recalculating...' : 'Recalculate'}
                    </button>
                  )}
                </div>
                {orderCommission ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div>
                        <span className="text-gray-600 block text-xs">Status</span>
                        <span className={`px-2 py-0.5 inline-flex text-xs font-semibold rounded-full ${
                          orderCommission.status === 'paid' ? 'bg-green-100 text-green-800' :
                          orderCommission.status === 'approved' ? 'bg-blue-100 text-blue-800' :
                          orderCommission.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {orderCommission.status}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600 block text-xs">
                          {isOrderSalesRep ? 'Your Commission' : 'Commission Amount'}
                        </span>
                        <span className="font-semibold text-green-700">
                          ${isOrderSalesRep
                            ? Number(orderCommission.sales_rep_commission || 0).toFixed(2)
                            : Number(orderCommission.commission_amount).toFixed(2)
                          }
                        </span>
                      </div>
                      {!isOrderSalesRep && (
                        <div>
                          <span className="text-gray-600 block text-xs">Sales Rep</span>
                          <span className="font-medium">
                            {orderCommission.profiles?.full_name || orderCommission.profiles?.email || 'Unknown'}
                          </span>
                        </div>
                      )}
                    </div>
                    {!isOrderSalesRep && orderCommission.product_margin != null && (
                      <div className="text-sm">
                        <span className="text-gray-600">Product Margin:</span>
                        <span className="font-medium ml-1">${Number(orderCommission.product_margin).toFixed(2)}</span>
                      </div>
                    )}
                    {!isOrderSalesRep && orderCommission.sales_rep_commission != null && orderCommission.distributor_commission != null && (
                      <div className="grid grid-cols-2 gap-3 text-sm bg-white rounded p-2 border border-green-200">
                        <div>
                          <span className="text-gray-600 text-xs block">Sales Rep Share</span>
                          <span className="font-semibold">${Number(orderCommission.sales_rep_commission).toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-gray-600 text-xs block">Distributor Share</span>
                          <span className="font-semibold">${Number(orderCommission.distributor_commission).toFixed(2)}</span>
                        </div>
                      </div>
                    )}
                    {!isOrderSalesRep && orderCommission.margin_details && orderCommission.margin_details.length > 0 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-gray-600 hover:text-gray-900 font-medium">
                          View margin breakdown ({orderCommission.margin_details.length} items)
                        </summary>
                        <div className="mt-2 bg-white rounded border border-green-200 overflow-hidden">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-1.5 text-left text-xs font-medium text-gray-500">Product</th>
                                <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">Price</th>
                                <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">Cost</th>
                                <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">Qty</th>
                                <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">Margin</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {orderCommission.margin_details.map((item: any, idx: number) => (
                                <tr key={idx}>
                                  <td className="px-3 py-1.5 text-gray-900">{item.name}</td>
                                  <td className="px-3 py-1.5 text-right">${Number(item.price).toFixed(2)}</td>
                                  <td className="px-3 py-1.5 text-right">${Number(item.cost).toFixed(2)}</td>
                                  <td className="px-3 py-1.5 text-right">{item.quantity}</td>
                                  <td className="px-3 py-1.5 text-right font-medium text-green-700">${Number(item.margin).toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                    {orderCommission.approved_at && (
                      <div className="text-xs text-gray-500">
                        Approved: {new Date(orderCommission.approved_at).toLocaleString()}
                      </div>
                    )}
                    {orderCommission.paid_at && (
                      <div className="text-xs text-gray-500">
                        Paid: {new Date(orderCommission.paid_at).toLocaleString()}
                        {orderCommission.payment_reference && ` (Ref: ${orderCommission.payment_reference})`}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm">
                    {order.status === 'completed' ? (
                      <div className="text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
                        <p className="font-medium">No commission generated for this completed order.</p>
                        <p className="text-xs mt-1">Possible reasons:</p>
                        <ul className="text-xs list-disc list-inside mt-1 space-y-0.5">
                          {!order.organization_id && <li className="text-red-600 font-medium">No customer linked to this order</li>}
                          <li>No active sales rep assigned to this customer</li>
                          <li>Commission trigger may not have fired (check database triggers)</li>
                          <li>Commission rate may be set to 0%</li>
                        </ul>
                        {isOrderAdmin && order.sales_rep_id && (
                          <button
                            onClick={() => recalculateCommission(order)}
                            disabled={isRecalculating}
                            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-200 hover:bg-amber-300 border border-amber-400 rounded-lg transition-colors disabled:opacity-50"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${isRecalculating ? 'animate-spin' : ''}`} />
                            {isRecalculating ? 'Recalculating...' : 'Recalculate Commission'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-gray-500 italic">
                        Commission will be generated when the order is marked as completed
                        {!order.organization_id && <span className="text-amber-600 font-medium"> (Warning: No organization linked)</span>}
                      </p>
                    )}
                  </div>
                )}
              </div>
              );
            })()}

            {(effectiveProfile?.role ?? profile?.role) === 'admin' && order.status !== 'completed' && order.status !== 'cancelled' && order.order_type !== 'backorder' && (
              <div className="space-y-3">
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <AlertTriangle className="h-5 w-5 text-orange-600" />
                      <div>
                        <h4 className="font-semibold text-orange-900">Back-Order Management</h4>
                        <p className="text-sm text-orange-700">Split items that are out of stock into a separate back-order</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleOpenBackorderModal(order)}
                      className="flex items-center space-x-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
                    >
                      <Split className="h-4 w-4" />
                      <span>Split Back-Order</span>
                    </button>
                  </div>
                </div>

                {!order.is_sub_order && order.order_type !== 'split_parent' && (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <Package className="h-5 w-5 text-purple-600" />
                        <div>
                          <h4 className="font-semibold text-purple-900">Vendor Fulfillment</h4>
                          <p className="text-sm text-purple-700">Split order by vendor/brand for separate fulfillment</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleSplitByVendor(order.id)}
                        className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                      >
                        <Split className="h-4 w-4" />
                        <span>Split by Vendor</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {showSubOrders && subOrders.length > 0 && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                <h4 className="font-semibold text-indigo-900 mb-3 flex items-center">
                  <Package className="h-4 w-4 mr-2" />
                  Vendor Sub-Orders ({subOrders.length})
                </h4>
                <div className="space-y-2">
                  {subOrders.map((subOrder) => (
                    <div key={subOrder.id} className="bg-white border border-indigo-200 rounded p-3">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-semibold text-gray-900">{subOrder.vendor_brand || 'Unknown Vendor'}</p>
                          <p className="text-xs text-gray-500">ID: {subOrder.id.slice(0, 8)}...</p>
                        </div>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          subOrder.status === 'completed' ? 'bg-green-100 text-green-800' :
                          subOrder.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                          subOrder.status === 'shipped' ? 'bg-purple-100 text-purple-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {subOrder.status}
                        </span>
                      </div>
                      <div className="text-sm space-y-1">
                        <p className="text-gray-600">{subOrder.items.length} items - ${Number(subOrder.total).toFixed(2)}</p>
                        {subOrder.items.map((item, idx) => (
                          <p key={idx} className="text-xs text-gray-500 pl-2">
                            • {item.name} (x{item.quantity})
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-gray-900">Order Items</h4>
                {order.payment_status && (
                  <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                    order.payment_status === 'captured' ? 'bg-green-100 text-green-800' :
                    order.payment_status === 'authorized' ? 'bg-yellow-100 text-yellow-800' :
                    order.payment_status === 'pending' ? 'bg-gray-100 text-gray-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    Payment: {order.payment_status}
                  </span>
                )}
              </div>
              <div className="bg-gray-50 rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Quantity</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Price</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {order.items.map((item, index) => (
                      <tr key={index}>
                        <td className="px-4 py-3 text-sm text-gray-900">{item.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-900 text-center">{item.quantity}</td>
                        <td className="px-4 py-3 text-sm text-gray-900 text-right">${Number(item.price).toFixed(2)}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 text-right">
                          ${(item.quantity * Number(item.price)).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Shipping Address */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center justify-between">
                  <span className="flex items-center">
                    <MapPin className="h-4 w-4 mr-2" />
                    Shipping Address
                  </span>
                  {isAdmin && editingSection !== 'shipping_address' && (
                    <button onClick={() => startEditAddress('shipping_address', order)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="Edit shipping address">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </h4>
                {editingSection === 'shipping_address' ? (
                  <div>
                    {showAddressPicker ? renderAddressPicker(order) : (
                      <>
                        {renderAddressForm()}
                        {renderEditButtons(order)}
                      </>
                    )}
                  </div>
                ) : (() => {
                  const addr = normalizeAddress(order.shipping_address);
                  if (!addr) return <p className="text-sm text-gray-400 italic">No shipping address</p>;
                  return (
                    <div className="text-sm text-gray-700">
                      <p className="font-medium">{addr.firstName} {addr.lastName}</p>
                      {addr.company && <p>{addr.company}</p>}
                      <p>{addr.address1}</p>
                      {addr.address2 && <p>{addr.address2}</p>}
                      <p>{addr.city}, {addr.state} {addr.postalCode}</p>
                      <p>{addr.country}</p>
                      {addr.phone && <p className="mt-2">Phone: {addr.phone}</p>}
                    </div>
                  );
                })()}
              </div>

              {/* Billing Address */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center justify-between">
                  <span className="flex items-center">
                    <MapPin className="h-4 w-4 mr-2" />
                    Billing Address
                  </span>
                  {isAdmin && editingSection !== 'billing_address' && (
                    <button onClick={() => startEditAddress('billing_address', order)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="Edit billing address">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </h4>
                {editingSection === 'billing_address' ? (
                  <div>
                    {showAddressPicker ? renderAddressPicker(order) : (
                      <>
                        {renderAddressForm()}
                        {renderEditButtons(order)}
                      </>
                    )}
                  </div>
                ) : (() => {
                  const addr = normalizeAddress(order.billing_address);
                  if (!addr) return <p className="text-sm text-gray-400 italic">No billing address</p>;
                  return (
                    <div className="text-sm text-gray-700">
                      <p className="font-medium">{addr.firstName} {addr.lastName}</p>
                      {addr.company && <p>{addr.company}</p>}
                      <p>{addr.address1}</p>
                      {addr.address2 && <p>{addr.address2}</p>}
                      <p>{addr.city}, {addr.state} {addr.postalCode}</p>
                      <p>{addr.country}</p>
                      {addr.phone && <p className="mt-2">Phone: {addr.phone}</p>}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-gray-900 flex items-center">
                  <Truck className="h-4 w-4 mr-2" />
                  Shipment Tracking
                </h4>
                {isAdmin && !showAddShipment && (
                  <button
                    onClick={() => setShowAddShipment(true)}
                    className="flex items-center space-x-1 px-3 py-1 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add Tracking</span>
                  </button>
                )}
              </div>

              {showAddShipment && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Carrier *</label>
                      <input
                        type="text"
                        placeholder="e.g., FedEx, UPS, USPS"
                        value={newShipment.carrier}
                        onChange={(e) => setNewShipment({ ...newShipment, carrier: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Tracking Number *</label>
                      <input
                        type="text"
                        placeholder="Enter tracking number"
                        value={newShipment.tracking_number}
                        onChange={(e) => setNewShipment({ ...newShipment, tracking_number: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Shipped Date</label>
                      <input
                        type="date"
                        value={newShipment.shipped_date}
                        onChange={(e) => setNewShipment({ ...newShipment, shipped_date: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Estimated Delivery</label>
                      <input
                        type="date"
                        value={newShipment.estimated_delivery}
                        onChange={(e) => setNewShipment({ ...newShipment, estimated_delivery: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                      <select
                        value={newShipment.status}
                        onChange={(e) => setNewShipment({ ...newShipment, status: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      >
                        <option value="pending">Pending</option>
                        <option value="in_transit">In Transit</option>
                        <option value="out_for_delivery">Out for Delivery</option>
                        <option value="delivered">Delivered</option>
                        <option value="exception">Exception</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                      <input
                        type="text"
                        placeholder="Optional notes"
                        value={newShipment.notes}
                        onChange={(e) => setNewShipment({ ...newShipment, notes: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <button
                      onClick={() => {
                        setShowAddShipment(false);
                        setNewShipment({
                          carrier: '',
                          tracking_number: '',
                          shipped_date: '',
                          estimated_delivery: '',
                          status: 'in_transit',
                          notes: ''
                        });
                      }}
                      className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => addShipment(order.id)}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                    >
                      Add Tracking
                    </button>
                  </div>
                </div>
              )}

              {(!order.shipments || order.shipments.length === 0) && !showAddShipment ? (
                <div className="text-center py-8 bg-gray-50 rounded-lg">
                  <Truck className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                  <p className="text-gray-500 text-sm">No shipment tracking added yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {order.shipments?.map((shipment, index) => (
                    <div key={index} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3 mb-2">
                            <span className="font-semibold text-gray-900">{shipment.carrier}</span>
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                              shipment.status === 'delivered' ? 'bg-green-100 text-green-800' :
                              shipment.status === 'in_transit' ? 'bg-blue-100 text-blue-800' :
                              shipment.status === 'out_for_delivery' ? 'bg-yellow-100 text-yellow-800' :
                              shipment.status === 'exception' ? 'bg-red-100 text-red-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {shipment.status.replace('_', ' ')}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-gray-700">
                            <div>
                              <span className="text-gray-500">Tracking:</span>
                              <span className="ml-2 font-mono font-medium">{shipment.tracking_number}</span>
                            </div>
                            {shipment.shipped_date && (
                              <div>
                                <span className="text-gray-500">Shipped:</span>
                                <span className="ml-2">{new Date(shipment.shipped_date + 'T00:00:00').toLocaleDateString()}</span>
                              </div>
                            )}
                            {shipment.estimated_delivery && (
                              <div>
                                <span className="text-gray-500">Est. Delivery:</span>
                                <span className="ml-2">{new Date(shipment.estimated_delivery + 'T00:00:00').toLocaleDateString()}</span>
                              </div>
                            )}
                          </div>
                          {shipment.notes && (
                            <p className="text-sm text-gray-600 mt-2 italic">{shipment.notes}</p>
                          )}
                        </div>
                        {isAdmin && (
                          <button
                            onClick={() => removeShipment(order.id, shipment.tracking_number)}
                            className="text-red-600 hover:text-red-800 p-1"
                            title="Remove tracking"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="h-8 w-8 animate-spin text-purple-600" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Orders</h2>
            <p className="text-gray-600 mt-1">Manage and view all customer orders</p>
          </div>
          <button
            onClick={fetchOrders}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            Refresh
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-[300px] relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by email, order ID, or order number..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="refunded">Refunded</option>
            </select>

            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last7days">Last 7 Days</option>
              <option value="last30days">Last 30 Days</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>

          {dateFilter === 'custom' && (
            <div className="flex gap-4 items-center">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-500" />
                <label className="text-sm text-gray-700">From:</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-700">To:</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
            </div>
          )}

          <div className="flex gap-4 items-center">
            <span className="text-sm text-gray-700 font-medium">Sort by:</span>
            <div className="flex gap-2">
              <button
                onClick={() => setSortBy('date')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  sortBy === 'date'
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Date
              </button>
              <button
                onClick={() => setSortBy('customer')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  sortBy === 'customer'
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Customer
              </button>
              <button
                onClick={() => setSortBy('total')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  sortBy === 'total'
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Total
              </button>
            </div>
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-1 text-sm font-medium"
              title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
            >
              {sortOrder === 'asc' ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  Ascending
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  Descending
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {groupedOrders.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Package className="h-16 w-16 mx-auto mb-4 text-gray-400" />
            <p className="text-gray-500 text-lg">No orders found</p>
          </div>
        ) : (
          groupedOrders.map(({ parent, subOrders }) => {
            const isExpanded = expandedRows.has(parent.id);
            const hasSubOrders = subOrders.length > 0;
            const isParentOrder = parent.order_type === 'split_parent';
            const isSubOrder = parent.is_sub_order;

            return (
              <div key={parent.id} className="space-y-2">
                {/* Parent/Main Order */}
                <div className={`rounded-lg shadow-sm border overflow-hidden ${
                  isParentOrder ? 'border-purple-300 bg-purple-50/30' :
                  isSubOrder ? 'border-blue-300 bg-blue-50/30' :
                  'border-gray-200 bg-white'
                }`}>
                  <div className="p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-4">
                      {/* Visual Indicator Badge */}
                      {parent.is_test_order && (
                        <div className="flex-shrink-0">
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-100 border border-amber-300 rounded-full">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
                            <span className="text-xs font-semibold text-amber-900">TEST ORDER</span>
                          </div>
                        </div>
                      )}
                      {isParentOrder && (
                        <div className="flex-shrink-0">
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-100 border border-purple-300 rounded-full">
                            <Split className="h-3.5 w-3.5 text-purple-700" />
                            <span className="text-xs font-semibold text-purple-900">SPLIT ORDER</span>
                            <span className="text-xs font-medium text-purple-700 bg-purple-200 px-1.5 py-0.5 rounded">
                              {subOrders.length} vendors
                            </span>
                          </div>
                        </div>
                      )}
                      {isSubOrder && (
                        <div className="flex-shrink-0">
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-100 border border-blue-300 rounded-full">
                            <Package className="h-3.5 w-3.5 text-blue-700" />
                            <span className="text-xs font-semibold text-blue-900">VENDOR ORDER</span>
                            {parent.vendor_brand && (
                              <span className="text-xs font-medium text-blue-700 bg-blue-200 px-1.5 py-0.5 rounded">
                                {parent.vendor_brand}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={async () => {
                            setSelectedOrder(parent);
                            await orderService.markOrderAsViewed(parent.id);
                            await fetchOrders();
                          }}
                          className="p-2 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                          title="View Full Details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => toggleRowExpansion(parent.id)}
                          className="p-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                          title={isExpanded ? "Collapse" : "Expand"}
                        >
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        {canManageOrders && (
                          <button
                            onClick={() => handleDeleteOrder(parent)}
                            className="p-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                            title="Delete Order"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      <div className="flex-1 grid grid-cols-2 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] gap-x-4 gap-y-2 items-center">
                        <div className="min-w-0">
                          <p className="text-xs text-gray-500 mb-1">Order ID</p>
                          <p className="text-sm font-mono font-medium text-gray-900">{parent.id.slice(0, 8)}...</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-gray-500 mb-1">Customer</p>
                          <p className="text-sm text-gray-900 truncate" title={parent.customer_email}>{parent.customer_email}</p>
                          {parent.organization_id && (
                            <p className="text-xs text-gray-600 truncate flex items-center mt-0.5" title={organizationNames[parent.organization_id] || ''}>
                              <Building2 className="h-3 w-3 mr-1 flex-shrink-0 text-green-600" />
                              {organizationNames[parent.organization_id] || <span className="text-gray-400 italic">Resolving…</span>}
                            </p>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-gray-500 mb-1">Date</p>
                          <p className="text-sm text-gray-900">{new Date(parent.created_at).toLocaleDateString()}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-gray-500 mb-1">Tracking</p>
                          {parent.shipments && parent.shipments.length > 0 ? (
                            <div className="space-y-1">
                              {parent.shipments.slice(0, 2).map((shipment, idx) => (
                                <div key={idx} className="flex items-center space-x-1">
                                  <Truck className="h-3 w-3 flex-shrink-0 text-blue-600" />
                                  <span className="text-xs font-mono text-gray-900 truncate">{shipment.tracking_number}</span>
                                  <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded flex-shrink-0 ${getShipmentStatusColor(shipment.status)}`}>
                                    {shipment.status.replace('_', ' ')}
                                  </span>
                                </div>
                              ))}
                              {parent.shipments.length > 2 && (
                                <p className="text-xs text-gray-500">+{parent.shipments.length - 2} more</p>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-400">No tracking</p>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-gray-500 mb-1">Total</p>
                          <p className="text-sm font-semibold text-gray-900">${Number(parent.total).toFixed(2)}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-gray-500 mb-1">Status</p>
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${getStatusColor(parent.status)}`}>
                            {parent.status}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-gray-500 mb-1">Payment</p>
                          {parent.payment_status ? (
                            <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${getPaymentStatusColor(parent.payment_status)}`}>
                              {parent.payment_status === 'authorized' ? 'Auth' :
                               parent.payment_status === 'captured' ? 'Paid' :
                               parent.payment_status}
                            </span>
                          ) : (
                            <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border bg-gray-100 text-gray-500">
                              None
                            </span>
                          )}
                        </div>
                      </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-200 bg-gray-50 p-4">
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center">
                          <Package className="h-4 w-4 mr-2 text-gray-600" />
                          Order Items ({parent.items.length})
                        </h4>
                        <div className="bg-white rounded-lg overflow-hidden border border-gray-200">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-100">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                                <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Qty</th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Price</th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {parent.items.map((item, index) => (
                                <tr key={index} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 text-sm text-gray-900">{item.name}</td>
                                  <td className="px-4 py-2 text-sm text-gray-900 text-center">{item.quantity}</td>
                                  <td className="px-4 py-2 text-sm text-gray-900 text-right">${Number(item.price).toFixed(2)}</td>
                                  <td className="px-4 py-2 text-sm font-medium text-gray-900 text-right">
                                    ${(item.quantity * Number(item.price)).toFixed(2)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {parent.shipments && parent.shipments.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center">
                            <Truck className="h-4 w-4 mr-2 text-gray-600" />
                            Shipment Tracking ({parent.shipments.length})
                          </h4>
                          <div className="space-y-2">
                            {parent.shipments.map((shipment, index) => (
                              <div key={index} className="bg-white rounded-lg p-3 border border-gray-200">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center space-x-3 mb-2">
                                      <span className="font-semibold text-gray-900 text-sm">{shipment.carrier}</span>
                                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getShipmentStatusColor(shipment.status)}`}>
                                        {shipment.status.replace('_', ' ')}
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-700">
                                      <div>
                                        <span className="text-gray-500">Tracking:</span>
                                        <span className="ml-2 font-mono font-medium">{shipment.tracking_number}</span>
                                      </div>
                                      {shipment.shipped_date && (
                                        <div>
                                          <span className="text-gray-500">Shipped:</span>
                                          <span className="ml-2">{new Date(shipment.shipped_date + 'T00:00:00').toLocaleDateString()}</span>
                                        </div>
                                      )}
                                      {shipment.estimated_delivery && (
                                        <div>
                                          <span className="text-gray-500">Est. Delivery:</span>
                                          <span className="ml-2">{new Date(shipment.estimated_delivery + 'T00:00:00').toLocaleDateString()}</span>
                                        </div>
                                      )}
                                    </div>
                                    {shipment.notes && (
                                      <p className="text-xs text-gray-600 mt-2 italic">{shipment.notes}</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {parent.shipping_address && (() => {
                        const addr = normalizeAddress(parent.shipping_address);
                        if (!addr) return null;
                        return (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center">
                              <MapPin className="h-4 w-4 mr-2 text-gray-600" />
                              Shipping Address
                            </h4>
                            <div className="bg-white rounded-lg p-3 border border-gray-200 text-xs text-gray-700">
                              <p className="font-medium">{addr.firstName} {addr.lastName}</p>
                              {addr.company && <p>{addr.company}</p>}
                              <p>{addr.address1}</p>
                              {addr.address2 && <p>{addr.address2}</p>}
                              <p>{addr.city}, {addr.state} {addr.postalCode}</p>
                              {addr.phone && <p className="mt-1">Phone: {addr.phone}</p>}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {/* Sub-Orders (Vendor Split Orders) */}
              {subOrders.length > 0 && (
                <div className="ml-12 space-y-2">
                  {subOrders.map((subOrder) => (
                    <div key={subOrder.id} className="bg-blue-50/50 border-l-4 border-blue-400 rounded-r-lg shadow-sm overflow-hidden">
                      <div className="p-3 hover:bg-blue-100/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0">
                            <div className="flex items-center gap-2 px-2.5 py-1 bg-blue-200 border border-blue-400 rounded-md">
                              <Package className="h-3 w-3 text-blue-800" />
                              <span className="text-xs font-bold text-blue-900">{subOrder.vendor_brand || 'Unknown Vendor'}</span>
                            </div>
                          </div>
                          <div className="flex-1 grid grid-cols-1 md:grid-cols-5 gap-3 items-center text-xs">
                            <div>
                              <p className="text-[10px] text-gray-500 mb-0.5">Sub-Order ID</p>
                              <p className="font-mono font-medium text-gray-900">{subOrder.id.slice(0, 8)}...</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-500 mb-0.5">Items</p>
                              <p className="text-gray-900">{subOrder.items.length} item(s)</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-500 mb-0.5">Total</p>
                              <p className="font-semibold text-gray-900">${Number(subOrder.total).toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-500 mb-0.5">Tracking</p>
                              {subOrder.shipments && subOrder.shipments.length > 0 ? (
                                <span className="text-[10px] font-mono text-blue-700">{subOrder.shipments[0].tracking_number}</span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </div>
                            <div>
                              <span className={`px-2 py-0.5 inline-flex text-[10px] font-semibold rounded-full border ${getStatusColor(subOrder.status)}`}>
                                {subOrder.status}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={async () => {
                              setSelectedOrder(subOrder);
                              await orderService.markOrderAsViewed(subOrder.id);
                              await fetchOrders();
                            }}
                            className="p-1.5 text-blue-600 bg-blue-100 hover:bg-blue-200 rounded transition-colors"
                            title="View Sub-Order Details"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            );
          })
        )}
      </div>

      {selectedOrder && renderOrderDetailsModal(selectedOrder)}

      {showBackorderModal && selectedOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={e => e.stopPropagation()}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                <Split className="h-5 w-5 mr-2 text-orange-600" />
                Split Order - Create Back-Order
              </h3>
              <button
                onClick={() => setShowBackorderModal(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <p className="text-sm text-orange-800">
                  Select items that are out of stock or need to be back-ordered. These items will be moved to a new separate order.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Back-Order Reason *
                </label>
                <textarea
                  value={backorderReason}
                  onChange={(e) => setBackorderReason(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  rows={2}
                  placeholder="e.g., Out of stock, Supplier delay, Discontinued item..."
                />
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-3">Select Items to Back-Order</h4>
                <div className="space-y-2">
                  {selectedOrder.items.map((item) => {
                    const availableQty = getAvailableQuantityForItem(item);
                    const splitQty = getSplitQuantitiesForItem(item.productId);
                    const isFullySplit = availableQty === 0;

                    return (
                      <div
                        key={item.productId}
                        className={`p-3 border-2 rounded-lg transition-colors ${
                          isFullySplit
                            ? 'border-gray-200 bg-gray-50 opacity-60'
                            : selectedBackorderItems.has(item.productId)
                            ? 'border-orange-500 bg-orange-50'
                            : 'border-gray-200'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-start space-x-3 flex-1">
                            <input
                              type="checkbox"
                              checked={selectedBackorderItems.has(item.productId)}
                              onChange={() => toggleBackorderItem(item.productId, availableQty)}
                              disabled={isFullySplit}
                              className="h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                            <div className="flex-1">
                              <p className={`font-medium ${isFullySplit ? 'text-gray-500' : 'text-gray-900'}`}>
                                {item.name}
                                {isFullySplit && (
                                  <span className="ml-2 text-xs font-semibold text-red-600 bg-red-100 px-2 py-0.5 rounded">
                                    FULLY SPLIT
                                  </span>
                                )}
                              </p>
                              <div className="text-sm mt-1 space-y-0.5">
                                <p className="text-gray-600">
                                  Original Qty: {item.quantity} × ${item.price.toFixed(2)}
                                </p>
                                {splitQty > 0 && (
                                  <p className="text-red-600">
                                    Already split: {splitQty} units
                                  </p>
                                )}
                                {!isFullySplit && (
                                  <p className="text-green-700 font-medium">
                                    Available to split: {availableQty} units
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>

                          {selectedBackorderItems.has(item.productId) && !isFullySplit && (
                            <div className="ml-3">
                              <label className="block text-xs font-medium text-gray-700 mb-1">
                                Backorder Qty
                              </label>
                              <input
                                type="number"
                                min="1"
                                max={availableQty}
                                value={backorderQuantities[item.productId] || availableQty}
                                onChange={(e) => updateBackorderQuantity(
                                  item.productId,
                                  parseInt(e.target.value) || 1,
                                  availableQty
                                )}
                                onClick={(e) => e.stopPropagation()}
                                className="w-20 px-2 py-1 border border-gray-300 rounded text-center text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                              />
                              <p className="text-xs text-gray-500 mt-1">
                                of {availableQty}
                              </p>
                            </div>
                          )}
                        </div>

                        {selectedBackorderItems.has(item.productId) && !isFullySplit && (
                          <div className="mt-2 pt-2 border-t border-orange-200">
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="bg-white rounded px-2 py-1">
                                <span className="text-gray-600">Backorder:</span>
                                <span className="font-medium text-orange-700 ml-1">
                                  {backorderQuantities[item.productId] || availableQty} units
                                </span>
                              </div>
                              <div className="bg-white rounded px-2 py-1">
                                <span className="text-gray-600">Keep in order:</span>
                                <span className="font-medium text-green-700 ml-1">
                                  {availableQty - (backorderQuantities[item.productId] || availableQty)} units
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-gray-900 mb-2">Summary</h4>
                <div className="text-sm space-y-1">
                  <p className="text-gray-600">
                    Total units to backorder: <span className="font-medium text-orange-700">
                      {Object.values(backorderQuantities).reduce((sum, qty) => sum + qty, 0)} units
                    </span>
                  </p>
                  <p className="text-gray-600">
                    Line items selected: <span className="font-medium text-gray-900">{selectedBackorderItems.size}</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => setShowBackorderModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSplitBackorder}
                disabled={processingBackorder || selectedBackorderItems.size === 0 || !backorderReason.trim()}
                className="flex items-center space-x-2 px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {processingBackorder ? (
                  <>
                    <Loader className="h-4 w-4 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <Split className="h-4 w-4" />
                    <span>Split Order</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debug Modal for Vendor Split */}
      {showDebugModal && debugOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={e => e.stopPropagation()}>
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Split Order by Vendor - Debug Info</h2>
              <button
                onClick={() => setShowDebugModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Order Info */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 mb-2">Order Information</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="font-medium">Order ID:</span> {debugOrder.id}</div>
                  <div><span className="font-medium">Order Number:</span> {debugOrder.order_number || 'N/A'}</div>
                  <div><span className="font-medium">Total Items:</span> {debugOrder.items.length}</div>
                  <div><span className="font-medium">Status:</span> {debugOrder.status}</div>
                </div>
              </div>

              {/* Items Debug */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-4">Line Items with Brand Information</h3>
                <div className="space-y-3">
                  {debugOrder.items.map((item, index) => (
                    <div key={index} className="bg-white border border-gray-300 rounded-lg p-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <div className="font-semibold text-gray-900">{item.name}</div>
                          <div className="text-sm text-gray-600 mt-1">
                            <span className="font-medium">Product ID:</span> {item.productId}
                          </div>
                          <div className="text-sm text-gray-600">
                            <span className="font-medium">Quantity:</span> {item.quantity}
                          </div>
                          <div className="text-sm text-gray-600">
                            <span className="font-medium">Price:</span> ${item.price}
                          </div>
                        </div>
                        <div>
                          <div className={`text-lg font-bold ${item.brand ? 'text-green-600' : 'text-red-600'}`}>
                            Brand: {item.brand || '❌ NO BRAND DATA'}
                          </div>
                          {!item.brand && (
                            <div className="text-xs text-red-500 mt-1">
                              This item has no brand information. It will be grouped as "Unknown".
                            </div>
                          )}
                          {item.brand && (
                            <div className="text-xs text-green-600 mt-1">
                              ✓ Brand data available
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Brand Summary */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h3 className="font-semibold text-yellow-900 mb-2">Brand Analysis</h3>
                <div className="text-sm space-y-2">
                  {(() => {
                    const brandGroups = new Map<string, number>();
                    debugOrder.items.forEach(item => {
                      const brand = item.brand || 'Unknown';
                      brandGroups.set(brand, (brandGroups.get(brand) || 0) + 1);
                    });

                    return (
                      <div>
                        <div className="font-medium mb-2">Brands found in this order:</div>
                        <ul className="list-disc list-inside space-y-1">
                          {Array.from(brandGroups.entries()).map(([brand, count]) => (
                            <li key={brand} className={brand === 'Unknown' ? 'text-red-600' : 'text-green-600'}>
                              <span className="font-semibold">{brand}</span>: {count} item(s)
                            </li>
                          ))}
                        </ul>
                        {brandGroups.size <= 1 && (
                          <div className="mt-3 p-3 bg-red-100 border border-red-300 rounded text-red-800">
                            <strong>⚠️ Cannot split:</strong> This order only contains items from {brandGroups.size === 1 ? 'one brand' : 'no brands'}.
                            You need items from at least 2 different brands to split.
                          </div>
                        )}
                        {brandGroups.size > 1 && (
                          <div className="mt-3 p-3 bg-green-100 border border-green-300 rounded text-green-800">
                            <strong>✓ Can split:</strong> This order will be split into {brandGroups.size} separate orders.
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-3 pt-4 border-t">
                <button
                  onClick={() => setShowDebugModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmSplitByVendor}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                  disabled={(() => {
                    const brandGroups = new Set(debugOrder.items.map(item => item.brand || 'Unknown'));
                    return brandGroups.size <= 1;
                  })()}
                >
                  Proceed with Split
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Refund Modal */}
      {showRefundModal && selectedOrder && (
        <RefundModal
          order={selectedOrder}
          commission={orderCommission}
          onClose={() => setShowRefundModal(false)}
          onSubmit={async ({ amount, includeShipping, cancelCommission, reason }) => {
            const result = await orderService.refundPayment(selectedOrder.id, {
              amount,
              includeShipping,
              cancelCommission,
              reason,
              refundedBy: user?.email || user?.id || 'admin',
            });
            if (result.success) {
              setShowRefundModal(false);
              await fetchOrders();
              const { order: refreshed } = await orderService.getOrderById(selectedOrder.id);
              if (refreshed) setSelectedOrder(refreshed);
              fetchOrderCommission(selectedOrder.id);
              fetchPaymentLogs(selectedOrder.id);
              fetchPaymentTransactions(selectedOrder.id);
            } else {
              throw new Error(result.error || 'Refund failed');
            }
          }}
        />
      )}

      <ConfirmDeleteModal
        isOpen={showDeleteOrderModal}
        title="Delete Order"
        entityName={deleteTargetOrder ? `Order #${deleteTargetOrder.id.slice(0, 8).toUpperCase()}` : ''}
        cascadeWarnings={[
          'Commission records for this order will be archived',
          'Commission line items will be marked as orphaned',
        ]}
        onConfirm={confirmDeleteOrder}
        onCancel={() => { setShowDeleteOrderModal(false); setDeleteTargetOrder(null); }}
        isProcessing={isDeletingOrder}
      />
    </div>
  );
};

export default OrderManagement;
