import React, { useState, useEffect } from 'react';
import {
  Building2, Users, Plus, Trash2, X, UserPlus, UserCheck,
  Search, MapPin, Mail, Phone, Eye, ArrowLeft, Settings, DollarSign, Pencil, CheckCircle, Archive,
} from 'lucide-react';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { ENV } from '@/config/env';
import AddressManagement from './AddressManagement';
import PricingManagement from './PricingManagement';
import CustomerUserManagement from './CustomerUserManagement';

// ── Interfaces ───────────────────────────────────────────────────────────────

interface Distributor {
  id: string;
  profile_id: string;
  name: string;
  code: string;
}

type CustomerSubTab = 'addresses' | 'pricing' | 'users';

interface DistributorCustomer {
  id: string;
  distributor_id: string;
  organization_id: string;
  is_active: boolean;
  notes?: string;
  organizations: { id: string; name: string; code: string; description?: string; contact_name?: string; contact_email?: string; contact_phone?: string; city?: string; state?: string; is_active: boolean };
}

interface DistributorSalesRep {
  id: string;
  distributor_id: string;
  sales_rep_id: string;
  commission_split_type: 'percentage_of_distributor' | 'fixed_with_override';
  sales_rep_rate: number;
  distributor_override_rate?: number;
  is_active: boolean;
  notes?: string;
  profiles?: { email: string; full_name?: string; phone?: string };
}

interface DistributorDelegate {
  id: string;
  distributor_id: string;
  user_id: string;
  is_active: boolean;
  notes?: string;
  profiles?: { email: string; full_name?: string };
}

interface RepCustomerLink {
  id: string;
  distributor_id: string;
  sales_rep_id: string;
  organization_id: string;
  is_active: boolean;
}

interface DistributorPortalProps {
  view: 'customers' | 'sales-reps' | 'delegates';
}

// ── Shared Tailwind classes ──────────────────────────────────────────────────

const inputCls =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-pink-500 focus:border-transparent';
const selectCls = inputCls;
const primaryBtnCls =
  'px-4 py-2 bg-gradient-to-r from-pink-500 to-orange-500 text-white rounded-lg hover:shadow-lg text-sm font-medium transition-all';
const cancelBtnCls =
  'px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors';

// ── Auto-generate org code from name ─────────────────────────────────────────

function generateOrgCode(name: string, existingCodes: string[]): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6) || 'ORG';
  let code = base;
  let i = 1;
  while (existingCodes.includes(code)) {
    code = `${base}${i}`;
    i++;
  }
  return code;
}

// ── Component ────────────────────────────────────────────────────────────────

const DistributorPortal: React.FC<DistributorPortalProps> = ({ view }) => {
  const { user, profile, isImpersonating, effectiveProfile } = useAuth();
  const activeUserId = isImpersonating ? effectiveProfile?.id : user?.id;

  const [distributor, setDistributor] = useState<Distributor | null>(null);
  const [customers, setCustomers] = useState<DistributorCustomer[]>([]);
  const [salesReps, setSalesReps] = useState<DistributorSalesRep[]>([]);
  const [delegates, setDelegates] = useState<DistributorDelegate[]>([]);
  const [repCustomerLinks, setRepCustomerLinks] = useState<RepCustomerLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ── Customer search & sub-management ──────────────────────────────────────
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [selectedCustomerOrg, setSelectedCustomerOrg] = useState<DistributorCustomer | null>(null);
  const [activeCustomerSubTab, setActiveCustomerSubTab] = useState<CustomerSubTab>('users');
  const [customerOrgStats, setCustomerOrgStats] = useState<{ [key: string]: { addresses: number; users: number } }>({});

  // ── Add Customer (create new org) ──────────────────────────────────────────
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: '', code: '', contact_name: '', contact_email: '', contact_phone: '',
    address: '', city: '', state: '', zip: '', description: '',
  });
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false);

  // ── Add Sales Rep ──────────────────────────────────────────────────────────
  const [showAddSalesRep, setShowAddSalesRep] = useState(false);
  const [showCreateRepUser, setShowCreateRepUser] = useState(false);
  const [newRepEmail, setNewRepEmail] = useState('');
  const [newRepFullName, setNewRepFullName] = useState('');
  const [newRepPhone, setNewRepPhone] = useState('');
  const [isCreatingRepUser, setIsCreatingRepUser] = useState(false);
  const [newSalesRep, setNewSalesRep] = useState({
    sales_rep_id: '',
    commission_split_type: 'percentage_of_distributor' as 'percentage_of_distributor' | 'fixed_with_override',
    sales_rep_rate: 50,
    distributor_override_rate: 0,
    notes: '',
  });

  // ── Add Delegate ───────────────────────────────────────────────────────────
  const [showAddDelegate, setShowAddDelegate] = useState(false);
  const [showCreateDelegateUser, setShowCreateDelegateUser] = useState(false);
  const [newDelegateEmail, setNewDelegateEmail] = useState('');
  const [newDelegateFullName, setNewDelegateFullName] = useState('');
  const [isCreatingDelegateUser, setIsCreatingDelegateUser] = useState(false);
  const [selectedDelegateUserId, setSelectedDelegateUserId] = useState('');
  const [delegateNotes, setDelegateNotes] = useState('');

  useEffect(() => { fetchData(); }, [activeUserId]);

  const fetchData = async () => {
    if (!activeUserId) return;
    try {
      setLoading(true);
      setError(null);

      const { data: distData, error: distError } = await supabase
        .from('distributors')
        .select('id, profile_id, name, code')
        .eq('profile_id', activeUserId)
        .eq('is_active', true)
        .single();

      if (distError || !distData) {
        setError('No active distributor record found for your account.');
        setLoading(false);
        return;
      }

      setDistributor(distData);

      const [custRes, repsRes, delegatesRes, repCustRes] = await Promise.all([
        supabase
          .from('distributor_customers')
          .select('*, organizations(id, name, code, description, contact_name, contact_email, contact_phone, city, state, is_active)')
          .eq('distributor_id', distData.id)
          .eq('is_active', true),
        supabase
          .from('distributor_sales_reps')
          .select('*, profiles!distributor_sales_reps_sales_rep_id_fkey(email, full_name, phone)')
          .eq('distributor_id', distData.id)
          .eq('is_active', true)
          .order('created_at', { ascending: false }),
        supabase
          .from('distributor_delegates')
          .select('*, profiles!distributor_delegates_user_id_fkey(email, full_name)')
          .eq('distributor_id', distData.id)
          .eq('is_active', true)
          .order('created_at', { ascending: false }),
        supabase
          .from('distributor_rep_customers')
          .select('*')
          .eq('distributor_id', distData.id)
          .eq('is_active', true),
      ]);

      const custData = (custRes.data as DistributorCustomer[]) || [];
      if (!custRes.error) setCustomers(custData);
      if (!repsRes.error) setSalesReps((repsRes.data as DistributorSalesRep[]) || []);
      if (!delegatesRes.error) setDelegates((delegatesRes.data as DistributorDelegate[]) || []);
      if (!repCustRes.error) setRepCustomerLinks((repCustRes.data as RepCustomerLink[]) || []);

      // Fetch org stats for customer orgs
      if (custData.length > 0) {
        const orgIds = custData.map(c => c.organization_id);
        const [userRolesRes, addressesRes] = await Promise.all([
          supabase
            .from('user_organization_roles')
            .select('organization_id')
            .in('organization_id', orgIds),
          supabase
            .from('customer_addresses')
            .select('organization_id')
            .in('organization_id', orgIds),
        ]);
        const stats: { [key: string]: { addresses: number; users: number } } = {};
        orgIds.forEach(id => { stats[id] = { addresses: 0, users: 0 }; });
        userRolesRes.data?.forEach((r: any) => {
          if (stats[r.organization_id]) stats[r.organization_id].users++;
        });
        addressesRes.data?.forEach((a: any) => {
          if (stats[a.organization_id]) stats[a.organization_id].addresses++;
        });
        setCustomerOrgStats(stats);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // ── Customer handlers ──────────────────────────────────────────────────────

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!distributor) return;
    try {
      setError(null);
      // 1. Create the organization via RPC to bypass PostgREST's `columns`
      //    parameter which causes 400 errors with quoted column names.
      const { data: orgId, error: orgError } = await supabase.rpc('create_organization', {
        p_name: newCustomer.name,
        p_code: newCustomer.code,
        p_org_type: 'customer',
        p_contact_name: newCustomer.contact_name || null,
        p_contact_email: newCustomer.contact_email || null,
        p_contact_phone: newCustomer.contact_phone || null,
        p_address: newCustomer.address || null,
        p_city: newCustomer.city || null,
        p_state: newCustomer.state || null,
        p_zip: newCustomer.zip || null,
        p_description: newCustomer.description || null,
      });
      if (orgError) throw orgError;

      // 2. Link it as a distributor customer
      const { error: linkError } = await supabase
        .from('distributor_customers')
        .insert([{ distributor_id: distributor.id, organization_id: orgId, is_active: true }]);
      if (linkError) throw linkError;

      // 2b. Assign the distributor as the default sales rep for the new org
      const { error: repError } = await supabase
        .from('organization_sales_reps')
        .upsert([{
          organization_id: orgId,
          sales_rep_id: distributor.profile_id,
          distributor_id: distributor.id,
          is_active: true,
        }], { onConflict: 'organization_id,sales_rep_id', ignoreDuplicates: true });
      if (repError) {
        console.error('Failed to assign distributor as default sales rep (non-fatal):', repError);
      }

      // 3. Create a user account + send invite email if contact email was provided
      let inviteWarning = '';
      if (newCustomer.contact_email) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            const nameParts = (newCustomer.contact_name || '').trim().split(/\s+/);
            const response = await fetch(
              `${ENV.SUPABASE_URL}/functions/v1/create-admin-user`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${session.access_token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  email: newCustomer.contact_email,
                  role: 'customer',
                  fullName: newCustomer.contact_name || undefined,
                  phone: newCustomer.contact_phone || undefined,
                  organizationId: orgId,
                  siteUrl: window.location.origin,
                }),
              }
            );
            const result = await response.json();
            if (!result.success) {
              inviteWarning = ` (Note: could not create user account — ${result.error})`;
            } else {
              // 4. Seed a customer_addresses record so the address is available at checkout
              if (newCustomer.address && result.userId) {
                await supabase.rpc('create_customer_address', {
                  p_user_id: result.userId,
                  p_organization_id: orgId,
                  p_address_type: 'shipping',
                  p_label: newCustomer.name,
                  p_first_name: nameParts[0] || '',
                  p_last_name: nameParts.slice(1).join(' ') || '',
                  p_company: newCustomer.name,
                  p_address1: newCustomer.address,
                  p_city: newCustomer.city,
                  p_state_or_province: newCustomer.state,
                  p_postal_code: newCustomer.zip,
                  p_country_code: 'US',
                  p_phone: newCustomer.contact_phone || null,
                  p_email: newCustomer.contact_email || null,
                  p_is_default: true,
                });
              }
            }
          }
        } catch (inviteErr) {
          console.error('Invite email failed (non-fatal):', inviteErr);
          inviteWarning = ' (Note: invite email could not be sent)';
        }
      }

      setSuccess(`Customer created and added${inviteWarning}`);
      setShowAddCustomer(false);
      resetNewCustomer();
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create customer');
    }
  };

  const resetNewCustomer = () => {
    setNewCustomer({ name: '', code: '', contact_name: '', contact_email: '', contact_phone: '', address: '', city: '', state: '', zip: '', description: '' });
    setCodeManuallyEdited(false);
  };

  const handleRemoveCustomer = async (id: string) => {
    if (!confirm('Remove this customer?')) return;
    try {
      setError(null);
      await supabase.from('distributor_customers').update({ is_active: false }).eq('id', id);
      setSuccess('Customer removed');
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove customer');
    }
  };

  // ── Sales Rep handlers ─────────────────────────────────────────────────────

  const handleAddSalesRep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!distributor || !newSalesRep.sales_rep_id) return;
    try {
      setError(null);
      const { error: insertError } = await supabase
        .from('distributor_sales_reps')
        .insert([{
          distributor_id: distributor.id,
          sales_rep_id: newSalesRep.sales_rep_id,
          commission_split_type: newSalesRep.commission_split_type,
          sales_rep_rate: newSalesRep.sales_rep_rate,
          distributor_override_rate: newSalesRep.commission_split_type === 'fixed_with_override'
            ? newSalesRep.distributor_override_rate : null,
          is_active: true,
          notes: newSalesRep.notes || null,
        }]);
      if (insertError) {
        if (insertError.code === '23505') {
          // Record exists (likely soft-deleted with is_active=false) — reactivate it
          const { error: updateError } = await supabase
            .from('distributor_sales_reps')
            .update({
              is_active: true,
              commission_split_type: newSalesRep.commission_split_type,
              sales_rep_rate: newSalesRep.sales_rep_rate,
              distributor_override_rate: newSalesRep.commission_split_type === 'fixed_with_override'
                ? newSalesRep.distributor_override_rate : null,
              notes: newSalesRep.notes || null,
            })
            .eq('distributor_id', distributor.id)
            .eq('sales_rep_id', newSalesRep.sales_rep_id);
          if (updateError) throw updateError;
        } else {
          throw insertError;
        }
      }
      setSuccess('Sales rep added');
      setShowAddSalesRep(false);
      setNewSalesRep({
        sales_rep_id: '', commission_split_type: 'percentage_of_distributor',
        sales_rep_rate: 50, distributor_override_rate: 0, notes: '',
      });
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add sales rep');
    }
  };

  const handleRemoveSalesRep = async (id: string) => {
    if (!confirm('Remove this sales rep?')) return;
    try {
      setError(null);
      await supabase.from('distributor_sales_reps').update({ is_active: false }).eq('id', id);
      setSuccess('Sales rep removed');
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove sales rep');
    }
  };

  const handleCreateSalesRepUser = async () => {
    if (!newRepEmail.trim()) {
      setError('Email is required');
      return;
    }
    if (!newRepFullName.trim()) {
      setError('Full name is required');
      return;
    }
    if (!distributor) return;
    try {
      setIsCreatingRepUser(true);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `${ENV.SUPABASE_URL}/functions/v1/create-admin-user`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: newRepEmail,
            role: 'sales_rep',
            fullName: newRepFullName,
            phone: newRepPhone || null,
            isIndependent: false,
            distributorId: distributor.id,
            commissionSplitType: newSalesRep.commission_split_type,
            salesRepRate: newSalesRep.sales_rep_rate,
            siteUrl: window.location.origin,
            distributorOverrideRate: newSalesRep.commission_split_type === 'fixed_with_override'
              ? newSalesRep.distributor_override_rate : undefined,
          }),
        }
      );

      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to create sales rep');

      setNewRepEmail('');
      setNewRepFullName('');
      setNewRepPhone('');
      setShowCreateRepUser(false);
      setShowAddSalesRep(false);
      setNewSalesRep({
        sales_rep_id: '', commission_split_type: 'percentage_of_distributor',
        sales_rep_rate: 50, distributor_override_rate: 0, notes: '',
      });
      setSuccess('Sales rep created — invite email sent');
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setIsCreatingRepUser(false);
    }
  };

  // ── Rep-customer assignment handlers ────────────────────────────────────────

  const getRepCustomerLinks = (salesRepId: string) =>
    repCustomerLinks.filter((rc) => rc.sales_rep_id === salesRepId);

  const handleAddRepCustomer = async (salesRepId: string, organizationId: string) => {
    if (!distributor) return;
    try {
      setError(null);
      const { error: insertError } = await supabase.from('distributor_rep_customers').insert([{
        distributor_id: distributor.id,
        sales_rep_id: salesRepId,
        organization_id: organizationId,
      }]);
      if (insertError) throw insertError;
      setSuccess('Customer assigned to rep');
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign customer to rep');
    }
  };

  const handleRemoveRepCustomer = async (id: string) => {
    if (!confirm('Remove this customer assignment from the rep?')) return;
    try {
      setError(null);
      const { error: deleteError } = await supabase.from('distributor_rep_customers').delete().eq('id', id);
      if (deleteError) throw deleteError;
      setSuccess('Customer removed from rep');
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove customer from rep');
    }
  };

  // ── Delegate handlers ──────────────────────────────────────────────────────

  const handleAddDelegate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!distributor || !selectedDelegateUserId) return;
    try {
      setError(null);
      const { error: insertError } = await supabase
        .from('distributor_delegates')
        .insert([{
          distributor_id: distributor.id,
          user_id: selectedDelegateUserId,
          is_active: true,
          notes: delegateNotes || null,
        }]);
      if (insertError) throw insertError;
      setSuccess('Delegate added');
      setShowAddDelegate(false);
      setSelectedDelegateUserId('');
      setDelegateNotes('');
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add delegate');
    }
  };

  const handleRemoveDelegate = async (id: string) => {
    if (!confirm('Remove this delegate?')) return;
    try {
      setError(null);
      await supabase.from('distributor_delegates').update({ is_active: false }).eq('id', id);
      setSuccess('Delegate removed');
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove delegate');
    }
  };

  const handleCreateDelegateUser = async () => {
    if (!newDelegateEmail.trim()) {
      setError('Email is required');
      return;
    }
    if (!newDelegateFullName.trim()) {
      setError('Full name is required');
      return;
    }
    if (!distributor) return;
    try {
      setIsCreatingDelegateUser(true);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `${ENV.SUPABASE_URL}/functions/v1/create-admin-user`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: newDelegateEmail,
            role: 'distributor',
            fullName: newDelegateFullName,
            delegateForDistributorId: distributor.id,
            delegateNotes: delegateNotes || null,
            siteUrl: window.location.origin,
          }),
        }
      );

      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to create delegate');

      setNewDelegateEmail('');
      setNewDelegateFullName('');
      setShowCreateDelegateUser(false);
      setShowAddDelegate(false);
      setDelegateNotes('');
      setSelectedDelegateUserId('');
      setSuccess('Delegate created — invite email sent');
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create delegate user');
    } finally {
      setIsCreatingDelegateUser(false);
    }
  };

  // Clear success message
  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(t);
    }
  }, [success]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 rounded-full border-2 border-pink-600 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!distributor) {
    return (
      <div className="text-center py-16 text-gray-500">
        <Building2 className="mx-auto h-10 w-10 text-gray-300 mb-2" />
        <p>No distributor record found for your account.</p>
        <p className="text-sm text-gray-400 mt-1">Contact your administrator to set up your distributor account.</p>
      </div>
    );
  }

  // For the sales rep selector, only show reps already in this distributorship
  const existingRepIds = new Set(salesReps.map((r) => r.sales_rep_id));
  // For delegate selector, show reps from this distributorship who aren't already delegates
  const existingDelegateIds = new Set(delegates.map((d) => d.user_id));
  // Build list of existing org codes for auto-code generation
  const existingOrgCodes = customers.map((c) => c.organizations?.code).filter(Boolean);

  return (
    <div className="p-6 space-y-6">
      {/* Status messages */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          {success}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* CUSTOMERS VIEW                                                        */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {view === 'customers' && selectedCustomerOrg && (
        <div>
          {/* Sub-management header */}
          <div className="mb-6">
            <button
              onClick={() => setSelectedCustomerOrg(null)}
              className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors mb-4"
            >
              <ArrowLeft className="h-5 w-5" />
              <span className="text-sm font-medium">Back to Customers</span>
            </button>

            <div className="flex items-center space-x-4">
              <div className="p-3 bg-orange-100 rounded-lg">
                <Building2 className="h-8 w-8 text-orange-600" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{selectedCustomerOrg.organizations?.name}</h2>
                <p className="text-gray-600">Code: {selectedCustomerOrg.organizations?.code}</p>
                <p className="text-gray-600">Manage addresses, pricing, and users for this organization</p>
              </div>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="-mb-px flex space-x-8">
              {([
                { id: 'users' as CustomerSubTab, label: 'Customer Users', icon: Users },
                { id: 'addresses' as CustomerSubTab, label: 'Addresses', icon: MapPin },
                { id: 'pricing' as CustomerSubTab, label: 'Contract Pricing', icon: DollarSign },
              ]).map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveCustomerSubTab(tab.id)}
                    className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                      activeCustomerSubTab === tab.id
                        ? 'border-orange-500 text-orange-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Sub-tab content */}
          <div>
            {activeCustomerSubTab === 'users' && (
              <CustomerUserManagement organizationId={selectedCustomerOrg.organization_id} />
            )}
            {activeCustomerSubTab === 'addresses' && (
              <AddressManagement organizationId={selectedCustomerOrg.organization_id} />
            )}
            {activeCustomerSubTab === 'pricing' && (
              <PricingManagement organizationId={selectedCustomerOrg.organization_id} />
            )}
          </div>
        </div>
      )}

      {view === 'customers' && !selectedCustomerOrg && (() => {
        const filteredCustomers = customers.filter((cust) => {
          if (!customerSearchTerm) return true;
          const term = customerSearchTerm.toLowerCase();
          const org = cust.organizations;
          return (
            org?.name?.toLowerCase().includes(term) ||
            org?.code?.toLowerCase().includes(term) ||
            org?.description?.toLowerCase().includes(term) ||
            org?.contact_name?.toLowerCase().includes(term) ||
            org?.contact_email?.toLowerCase().includes(term)
          );
        });

        const activeCount = customers.filter(c => c.organizations?.is_active).length;
        const inactiveCount = customers.length - activeCount;
        const totalAddresses = Object.values(customerOrgStats).reduce((sum, s) => sum + s.addresses, 0);

        return (
        <div>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">My Customers</h2>
              <p className="text-gray-600 mt-1">Manage your customer organizations</p>
            </div>
            <button
              onClick={() => setShowAddCustomer(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              New Customer
            </button>
          </div>

          {/* Search */}
          <div className="mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search customers by name, code, or contact..."
                value={customerSearchTerm}
                onChange={(e) => setCustomerSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Stats */}
          <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center">
                <Building2 className="h-8 w-8 text-orange-600" />
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-500">Total Customers</p>
                  <p className="text-2xl font-semibold text-gray-900">{customers.length}</p>
                </div>
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center">
                <CheckCircle className="h-8 w-8 text-green-600" />
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-500">Active</p>
                  <p className="text-2xl font-semibold text-gray-900">{activeCount}</p>
                </div>
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center">
                <Archive className="h-8 w-8 text-gray-600" />
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-500">Inactive</p>
                  <p className="text-2xl font-semibold text-gray-900">{inactiveCount}</p>
                </div>
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center">
                <MapPin className="h-8 w-8 text-blue-600" />
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-500">Total Addresses</p>
                  <p className="text-2xl font-semibold text-gray-900">{totalAddresses}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Customers Table */}
          {filteredCustomers.length === 0 && customers.length === 0 ? (
            <div className="text-center py-12 text-gray-400 bg-white rounded-lg border border-gray-200">
              <Building2 className="mx-auto h-10 w-10 text-gray-300 mb-2" />
              <p className="text-sm">No customers yet.</p>
              <p className="text-xs text-gray-400 mt-1">Create new customer organizations to start tracking orders and commissions.</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Organization</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stats</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredCustomers.map((cust) => (
                      <tr key={cust.id} className={cust.organizations?.is_active ? 'hover:bg-gray-50' : 'bg-gray-50'}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => { setSelectedCustomerOrg(cust); setActiveCustomerSubTab('users'); }}
                              className="p-2 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                              title="View Details"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => { setSelectedCustomerOrg(cust); setActiveCustomerSubTab('addresses'); }}
                              className="p-2 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
                              title="Manage Addresses & Pricing"
                            >
                              <Settings className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleRemoveCustomer(cust.id)}
                              className="p-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                              title="Remove Customer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center">
                            <div className={`p-2 rounded-lg ${cust.organizations?.is_active ? 'bg-orange-100' : 'bg-gray-200'}`}>
                              <Building2 className={`h-5 w-5 ${cust.organizations?.is_active ? 'text-orange-600' : 'text-gray-500'}`} />
                            </div>
                            <div className="ml-3">
                              <div className={`text-sm font-semibold ${cust.organizations?.is_active ? 'text-gray-900' : 'text-gray-600'}`}>
                                {cust.organizations?.name}
                              </div>
                              <div className="text-sm text-gray-500">Code: {cust.organizations?.code}</div>
                              {cust.organizations?.description && (
                                <div className="text-xs text-gray-500 mt-1 max-w-xs truncate">{cust.organizations.description}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="space-y-1">
                            {cust.organizations?.contact_name && (
                              <div className="text-sm font-medium text-gray-900">{cust.organizations.contact_name}</div>
                            )}
                            {cust.organizations?.contact_email && (
                              <div className="flex items-center space-x-2 text-sm text-gray-600">
                                <Mail className="h-3 w-3 text-gray-400" />
                                <span className="truncate max-w-xs">{cust.organizations.contact_email}</span>
                              </div>
                            )}
                            {cust.organizations?.contact_phone && (
                              <div className="flex items-center space-x-2 text-sm text-gray-600">
                                <Phone className="h-3 w-3 text-gray-400" />
                                <span>{cust.organizations.contact_phone}</span>
                              </div>
                            )}
                            {(cust.organizations?.city || cust.organizations?.state) && (
                              <div className="flex items-center space-x-2 text-sm text-gray-500">
                                <MapPin className="h-3 w-3 text-gray-400" />
                                <span>{[cust.organizations?.city, cust.organizations?.state].filter(Boolean).join(', ')}</span>
                              </div>
                            )}
                            {!cust.organizations?.contact_name && !cust.organizations?.contact_email && !cust.organizations?.contact_phone && (
                              <span className="text-sm text-gray-400">No contact info</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center space-x-4">
                            <div className="flex items-center space-x-1">
                              <MapPin className="h-4 w-4 text-blue-600" />
                              <span className="text-sm font-medium text-gray-900">
                                {customerOrgStats[cust.organization_id]?.addresses || 0}
                              </span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <Users className="h-4 w-4 text-green-600" />
                              <span className="text-sm font-medium text-gray-900">
                                {customerOrgStats[cust.organization_id]?.users || 0}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                            cust.organizations?.is_active
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {cust.organizations?.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {filteredCustomers.length === 0 && customers.length > 0 && (
            <div className="text-center py-12">
              <Building2 className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No customers found</h3>
              <p className="mt-1 text-sm text-gray-500">Try adjusting your search criteria.</p>
            </div>
          )}

          {/* Create New Customer Modal */}
          {showAddCustomer && (
            <Modal title="New Customer" onClose={() => { setShowAddCustomer(false); resetNewCustomer(); }}>
              <form onSubmit={handleCreateCustomer}>
                <div className="space-y-4">
                  <Field label="Customer Name *">
                    <input
                      type="text"
                      required
                      value={newCustomer.name}
                      onChange={(e) => {
                        const name = e.target.value;
                        const updates: { name: string; code?: string } = { name };
                        if (!codeManuallyEdited) {
                          updates.code = generateOrgCode(name, existingOrgCodes);
                        }
                        setNewCustomer({ ...newCustomer, ...updates });
                      }}
                      className={inputCls}
                      placeholder="e.g. Smith Medical Clinic"
                    />
                  </Field>

                  <Field label="Code *">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        required
                        value={newCustomer.code}
                        onChange={(e) => {
                          setNewCustomer({ ...newCustomer, code: e.target.value.toUpperCase() });
                          setCodeManuallyEdited(true);
                        }}
                        className={`${inputCls} font-mono uppercase`}
                        placeholder="SMITH"
                      />
                      {codeManuallyEdited && (
                        <button
                          type="button"
                          onClick={() => {
                            setCodeManuallyEdited(false);
                            setNewCustomer({
                              ...newCustomer,
                              code: generateOrgCode(newCustomer.name, existingOrgCodes),
                            });
                          }}
                          className="text-xs text-gray-400 hover:text-gray-600 whitespace-nowrap"
                        >
                          Auto
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {codeManuallyEdited ? 'Manually edited' : 'Auto-generated from name'}
                    </p>
                  </Field>

                  <Field label="Contact Name">
                    <input
                      type="text"
                      value={newCustomer.contact_name}
                      onChange={(e) => setNewCustomer({ ...newCustomer, contact_name: e.target.value })}
                      className={inputCls}
                      placeholder="Primary contact person"
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Contact Email">
                      <input
                        type="email"
                        value={newCustomer.contact_email}
                        onChange={(e) => setNewCustomer({ ...newCustomer, contact_email: e.target.value })}
                        className={inputCls}
                        placeholder="contact@example.com"
                      />
                    </Field>
                    <Field label="Contact Phone">
                      <input
                        type="tel"
                        value={newCustomer.contact_phone}
                        onChange={(e) => setNewCustomer({ ...newCustomer, contact_phone: e.target.value })}
                        className={inputCls}
                        placeholder="(555) 555-1234"
                      />
                    </Field>
                  </div>

                  <Field label="Address">
                    <input
                      type="text"
                      value={newCustomer.address}
                      onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
                      className={inputCls}
                      placeholder="Street address"
                    />
                  </Field>

                  <div className="grid grid-cols-3 gap-4">
                    <Field label="City">
                      <input
                        type="text"
                        value={newCustomer.city}
                        onChange={(e) => setNewCustomer({ ...newCustomer, city: e.target.value })}
                        className={inputCls}
                        placeholder="City"
                      />
                    </Field>
                    <Field label="State">
                      <input
                        type="text"
                        value={newCustomer.state}
                        onChange={(e) => setNewCustomer({ ...newCustomer, state: e.target.value })}
                        className={inputCls}
                        placeholder="State"
                      />
                    </Field>
                    <Field label="Zip">
                      <input
                        type="text"
                        value={newCustomer.zip}
                        onChange={(e) => setNewCustomer({ ...newCustomer, zip: e.target.value })}
                        className={inputCls}
                        placeholder="Zip"
                      />
                    </Field>
                  </div>

                  <Field label="Description">
                    <textarea
                      value={newCustomer.description}
                      onChange={(e) => setNewCustomer({ ...newCustomer, description: e.target.value })}
                      className={inputCls}
                      rows={2}
                      placeholder="Optional description..."
                    />
                  </Field>
                </div>

                <div className="mt-6 flex gap-3 justify-end border-t border-gray-100 pt-4">
                  <button type="button" onClick={() => { setShowAddCustomer(false); resetNewCustomer(); }} className={cancelBtnCls}>
                    Cancel
                  </button>
                  <button type="submit" className={primaryBtnCls} disabled={!newCustomer.name || !newCustomer.code}>
                    Create Customer
                  </button>
                </div>
              </form>
            </Modal>
          )}
        </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SALES REPS VIEW                                                       */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {view === 'sales-reps' && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">My Sales Representatives</h2>
              <p className="text-gray-600 mt-1">Manage sales reps who sell on behalf of your distributorship</p>
            </div>
            <button
              onClick={() => setShowAddSalesRep(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Add Sales Rep
            </button>
          </div>

          {/* Stats */}
          <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center">
                <Users className="h-8 w-8 text-pink-600" />
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-500">Total Reps</p>
                  <p className="text-2xl font-semibold text-gray-900">{salesReps.length}</p>
                </div>
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center">
                <CheckCircle className="h-8 w-8 text-green-600" />
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-500">Active</p>
                  <p className="text-2xl font-semibold text-gray-900">{salesReps.filter(r => r.is_active).length}</p>
                </div>
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center">
                <DollarSign className="h-8 w-8 text-yellow-600" />
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-500">Avg Rep Rate</p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {salesReps.length > 0
                      ? `${(salesReps.reduce((sum, r) => sum + r.sales_rep_rate, 0) / salesReps.length).toFixed(1)}%`
                      : '—'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Table */}
          {salesReps.length === 0 ? (
            <div className="text-center py-12 text-gray-400 bg-white rounded-lg border border-gray-200">
              <Users className="mx-auto h-10 w-10 text-gray-300 mb-2" />
              <p className="text-sm">No sales representatives yet.</p>
              <p className="text-xs text-gray-400 mt-1">Create sales reps who sell on behalf of your distributorship.</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sales Rep</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Commission</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned Customers</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {salesReps.map((dsr) => {
                      const splitLabel =
                        dsr.commission_split_type === 'percentage_of_distributor'
                          ? `${dsr.sales_rep_rate}% of distributor commission`
                          : `Fixed ${dsr.sales_rep_rate}% + ${dsr.distributor_override_rate ?? 0}% override`;
                      const splitType =
                        dsr.commission_split_type === 'percentage_of_distributor'
                          ? '% of Distributor'
                          : 'Fixed + Override';
                      return (
                        <tr key={dsr.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => handleRemoveSalesRep(dsr.id)}
                                className="p-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                                title="Remove Sales Rep"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center">
                              <div className="p-2 bg-pink-100 rounded-lg">
                                <Users className="h-5 w-5 text-pink-600" />
                              </div>
                              <div className="ml-3">
                                <div className="text-sm font-semibold text-gray-900">
                                  {dsr.profiles?.full_name || dsr.profiles?.email}
                                </div>
                                {dsr.profiles?.full_name && (
                                  <div className="text-sm text-gray-500">{dsr.profiles.email}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="space-y-1">
                              {dsr.profiles?.email && (
                                <div className="flex items-center space-x-2 text-sm text-gray-600">
                                  <Mail className="h-3 w-3 text-gray-400" />
                                  <span className="truncate max-w-xs">{dsr.profiles.email}</span>
                                </div>
                              )}
                              {dsr.profiles?.phone && (
                                <div className="flex items-center space-x-2 text-sm text-gray-600">
                                  <Phone className="h-3 w-3 text-gray-400" />
                                  <span>{dsr.profiles.phone}</span>
                                </div>
                              )}
                              {!dsr.profiles?.email && !dsr.profiles?.phone && (
                                <span className="text-sm text-gray-400">No contact info</span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="space-y-1">
                              <span className="inline-flex px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                                {splitType}
                              </span>
                              <div className="text-sm text-gray-700 font-medium">{splitLabel}</div>
                              {dsr.notes && (
                                <div className="text-xs text-gray-400 max-w-xs truncate">{dsr.notes}</div>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                              dsr.is_active
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {dsr.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-wrap gap-1.5">
                              {getRepCustomerLinks(dsr.sales_rep_id).map((rc) => {
                                const cust = customers.find(c => c.organization_id === rc.organization_id);
                                return (
                                  <span key={rc.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-700 rounded-full text-xs">
                                    {cust?.organizations?.name ?? 'Unknown'}
                                    <button
                                      onClick={() => handleRemoveRepCustomer(rc.id)}
                                      className="ml-0.5 hover:bg-green-200 rounded-full p-0.5"
                                      title="Remove assignment"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </span>
                                );
                              })}
                              {(() => {
                                const assignedOrgIds = new Set(getRepCustomerLinks(dsr.sales_rep_id).map(rc => rc.organization_id));
                                const available = customers.filter(c => !assignedOrgIds.has(c.organization_id));
                                return available.length > 0 ? (
                                  <select
                                    className="text-xs px-2 py-1 border border-gray-200 rounded-lg text-gray-600 bg-white"
                                    value=""
                                    onChange={(e) => { if (e.target.value) handleAddRepCustomer(dsr.sales_rep_id, e.target.value); }}
                                  >
                                    <option value="">+ Assign...</option>
                                    {available.map((c) => (
                                      <option key={c.organization_id} value={c.organization_id}>{c.organizations?.name}</option>
                                    ))}
                                  </select>
                                ) : null;
                              })()}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Add Sales Rep Modal — only creates new users for this distributorship */}
          {showAddSalesRep && (
            <Modal title="Add Sales Rep" onClose={() => { setShowAddSalesRep(false); setShowCreateRepUser(false); }}>
              {!showCreateRepUser ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Create a new sales rep user to add to your distributorship.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowCreateRepUser(true)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
                  >
                    <UserPlus className="h-4 w-4" />
                    Create New Sales Rep
                  </button>
                  <div className="mt-4 flex justify-end">
                    <button type="button" onClick={() => setShowAddSalesRep(false)} className={cancelBtnCls}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="border border-purple-200 bg-purple-50 rounded-lg p-4 space-y-3">
                    <h4 className="text-sm font-medium text-purple-700">New Sales Rep Details</h4>
                    <Field label="Full Name *">
                      <input
                        type="text"
                        required
                        value={newRepFullName}
                        onChange={(e) => setNewRepFullName(e.target.value)}
                        className={inputCls}
                        placeholder="John Smith"
                      />
                    </Field>
                    <Field label="Email *">
                      <input
                        type="email"
                        required
                        value={newRepEmail}
                        onChange={(e) => setNewRepEmail(e.target.value)}
                        className={inputCls}
                        placeholder="john@example.com"
                      />
                    </Field>
                    <Field label="Phone">
                      <input
                        type="tel"
                        value={newRepPhone}
                        onChange={(e) => setNewRepPhone(e.target.value)}
                        className={inputCls}
                        placeholder="(555) 555-1234"
                      />
                    </Field>
                  </div>

                  <p className="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
                    An invite email will be sent. The user sets their own password.
                  </p>

                  <Field label="Commission Split Type">
                    <select
                      value={newSalesRep.commission_split_type}
                      onChange={(e) =>
                        setNewSalesRep({
                          ...newSalesRep,
                          commission_split_type: e.target.value as 'percentage_of_distributor' | 'fixed_with_override',
                        })
                      }
                      className={selectCls}
                    >
                      <option value="percentage_of_distributor">% of Distributor Commission</option>
                      <option value="fixed_with_override">Fixed Rate with Override</option>
                    </select>
                  </Field>

                  <Field
                    label={
                      newSalesRep.commission_split_type === 'percentage_of_distributor'
                        ? "Rep's Share (%)" : "Rep's Rate (%)"
                    }
                  >
                    <input
                      type="number" min="0" max="100" step="0.01"
                      value={newSalesRep.sales_rep_rate}
                      onChange={(e) => setNewSalesRep({ ...newSalesRep, sales_rep_rate: parseFloat(e.target.value) })}
                      className={inputCls}
                    />
                  </Field>

                  {newSalesRep.commission_split_type === 'fixed_with_override' && (
                    <Field label="Your Override Rate (%)">
                      <input
                        type="number" min="0" max="100" step="0.01"
                        value={newSalesRep.distributor_override_rate}
                        onChange={(e) => setNewSalesRep({ ...newSalesRep, distributor_override_rate: parseFloat(e.target.value) })}
                        className={inputCls}
                      />
                    </Field>
                  )}

                  <Field label="Notes">
                    <textarea
                      value={newSalesRep.notes}
                      onChange={(e) => setNewSalesRep({ ...newSalesRep, notes: e.target.value })}
                      className={inputCls} rows={2} placeholder="Optional notes..."
                    />
                  </Field>

                  <div className="flex gap-3 justify-end border-t border-gray-100 pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateRepUser(false);
                        setNewRepEmail(''); setNewRepPassword(''); setNewRepFullName(''); setNewRepPhone('');
                      }}
                      className={cancelBtnCls}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateSalesRepUser}
                      disabled={isCreatingRepUser || !newRepEmail || !newRepFullName}
                      className={`${primaryBtnCls} disabled:opacity-50`}
                    >
                      {isCreatingRepUser ? 'Creating...' : 'Create & Send Invite'}
                    </button>
                  </div>
                </div>
              )}
            </Modal>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* DELEGATES VIEW                                                        */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {view === 'delegates' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Delegates</h2>
              <p className="text-xs text-gray-500 mt-1">
                Delegates can manage your customers, sales reps, and orders on your behalf.
              </p>
            </div>
            <button
              onClick={() => setShowAddDelegate(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Add Delegate
            </button>
          </div>

          {delegates.length === 0 ? (
            <div className="text-center py-12 text-gray-400 bg-white rounded-lg border border-gray-200">
              <UserCheck className="mx-auto h-10 w-10 text-gray-300 mb-2" />
              <p className="text-sm">No delegates yet.</p>
              <p className="text-xs text-gray-400 mt-1">Add users who can manage your distributorship on your behalf.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {delegates.map((del) => (
                <div key={del.id} className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg hover:shadow-sm transition-shadow">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {del.profiles?.full_name || del.profiles?.email}
                    </p>
                    {del.profiles?.full_name && (
                      <p className="text-xs text-gray-500">{del.profiles.email}</p>
                    )}
                    {del.notes && (
                      <p className="text-xs text-gray-400 mt-0.5">{del.notes}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemoveDelegate(del.id)}
                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove delegate"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add Delegate Modal */}
          {showAddDelegate && (
            <Modal title="Add Delegate" onClose={() => { setShowAddDelegate(false); setShowCreateDelegateUser(false); }}>
              {!showCreateDelegateUser ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Create a new user who can manage your distributorship — they'll be able to add customers, manage sales reps, and view orders.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowCreateDelegateUser(true)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
                  >
                    <UserPlus className="h-4 w-4" />
                    Create New Delegate User
                  </button>
                  <div className="mt-4 flex justify-end">
                    <button type="button" onClick={() => setShowAddDelegate(false)} className={cancelBtnCls}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); handleCreateDelegateUser(); }}>
                  <div className="space-y-4">
                    <div className="border border-indigo-200 bg-indigo-50 rounded-lg p-4 space-y-3">
                      <h4 className="text-sm font-medium text-indigo-700">New Delegate Details</h4>
                      <Field label="Full Name *">
                        <input
                          type="text"
                          required
                          value={newDelegateFullName}
                          onChange={(e) => setNewDelegateFullName(e.target.value)}
                          className={inputCls}
                          placeholder="Jane Doe"
                        />
                      </Field>
                      <Field label="Email *">
                        <input
                          type="email"
                          required
                          value={newDelegateEmail}
                          onChange={(e) => setNewDelegateEmail(e.target.value)}
                          className={inputCls}
                          placeholder="jane@example.com"
                        />
                      </Field>
                    </div>

                    <p className="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
                      An invite email will be sent. The user sets their own password.
                    </p>

                    <Field label="Notes">
                      <textarea
                        value={delegateNotes}
                        onChange={(e) => setDelegateNotes(e.target.value)}
                        className={inputCls} rows={2} placeholder="e.g. Office manager, handles daily operations"
                      />
                    </Field>
                  </div>

                  <div className="mt-6 flex gap-3 justify-end border-t border-gray-100 pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateDelegateUser(false);
                        setNewDelegateEmail(''); setNewDelegateFullName('');
                      }}
                      className={cancelBtnCls}
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={isCreatingDelegateUser || !newDelegateEmail || !newDelegateFullName}
                      className={`${primaryBtnCls} disabled:opacity-50`}
                    >
                      {isCreatingDelegateUser ? 'Creating...' : 'Create & Send Invite'}
                    </button>
                  </div>
                </form>
              )}
            </Modal>
          )}
        </div>
      )}
    </div>
  );
};

// ── Sub-components ───────────────────────────────────────────────────────────

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title, onClose, children,
}) => (
  <div className="fixed inset-0 z-50 overflow-y-auto" onClick={e => e.stopPropagation()}>
    <div className="flex items-center justify-center min-h-screen px-4 py-8">
      <div className="fixed inset-0 bg-black/50" />
      <div className="relative bg-white rounded-lg shadow-lg w-full max-w-lg">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    {children}
  </div>
);

export default DistributorPortal;
