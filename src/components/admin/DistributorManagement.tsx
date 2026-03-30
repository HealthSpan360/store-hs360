import React, { useState, useEffect } from 'react';
import {
  Users, Building, Plus, Trash2, X, Save,
  TrendingUp, DollarSign, Building2, Percent, Package,
  ChevronDown, ChevronRight, UserPlus, Pencil, Upload,
  Search, Eye, ArrowLeft, Settings, Archive, CheckCircle, AlertCircle,
} from 'lucide-react';
import { supabase } from '@/services/supabase';
import { softDeleteService } from '@/services/softDeleteService';
import { useAuth } from '@/contexts/AuthContext';
import { ENV } from '@/config/env';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import DistributorPricingImport from './DistributorPricingImport';
import WholesalePricingGrid from './WholesalePricingGrid';

// ── Commission type config ───────────────────────────────────────────────────

export type CommissionType =
  | 'percent_gross_sales'
  | 'percent_margin'
  | 'percent_net_sales'
  | 'flat_per_order'
  | 'flat_per_unit';

const COMMISSION_TYPES: {
  value: CommissionType;
  label: string;
  description: string;
  rateLabel: string;
  rateUnit: string;
  isFlat: boolean;
}[] = [
  {
    value: 'percent_margin',
    label: '% of Margin',
    description: 'Percentage of (contracted price − product cost)',
    rateLabel: 'Rate',
    rateUnit: '%',
    isFlat: false,
  },
  {
    value: 'percent_gross_sales',
    label: '% of Gross Sales',
    description: 'Percentage of the total order value before any deductions',
    rateLabel: 'Rate',
    rateUnit: '%',
    isFlat: false,
  },
  {
    value: 'percent_net_sales',
    label: '% of Net Sales',
    description: 'Percentage of order value after discounts / credits',
    rateLabel: 'Rate',
    rateUnit: '%',
    isFlat: false,
  },
  {
    value: 'flat_per_order',
    label: 'Flat per Order',
    description: 'Fixed dollar amount earned for each order placed',
    rateLabel: 'Amount',
    rateUnit: '$',
    isFlat: true,
  },
  {
    value: 'flat_per_unit',
    label: 'Flat per Unit',
    description: 'Fixed dollar amount earned for each unit sold',
    rateLabel: 'Amount',
    rateUnit: '$',
    isFlat: true,
  },
];

function getCommissionTypeConfig(value: CommissionType) {
  return COMMISSION_TYPES.find((t) => t.value === value) ?? COMMISSION_TYPES[0];
}

function commissionRateLabel(type: CommissionType, rate: number) {
  const cfg = getCommissionTypeConfig(type);
  return cfg.isFlat ? `$${Number(rate).toFixed(2)}` : `${rate}%`;
}

function generateDistributorCode(name: string, existingCodes: string[]): string {
  if (!name.trim()) return '';
  const words = name.trim().split(/\s+/).filter(Boolean);
  let base: string;
  if (words.length >= 2) {
    base = words.map((w) => w[0]).join('').slice(0, 4).toUpperCase();
  } else {
    base = words[0].replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase();
  }
  if (!base) return '';
  const codesSet = new Set(existingCodes.map((c) => c.toUpperCase()));
  if (!codesSet.has(base)) return base;
  let i = 2;
  while (codesSet.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

// ── Interfaces ───────────────────────────────────────────────────────────────

interface Organization {
  id: string;
  name: string;
  code: string;
}

interface SimpleProduct {
  id: number;
  name: string;
  sku: string | null;
  category_id: string | null;
  price: number;
}

interface SimpleCategory {
  id: string;
  name: string;
}

interface CommissionRule {
  id: string;
  distributor_id: string;
  organization_id: string | null;
  scope: 'product' | 'category';
  product_id: number | null;
  category_id: string | null;
  commission_type: CommissionType;
  commission_rate: number;
  use_customer_price: boolean;
  is_active: boolean;
  notes: string | null;
}

interface Distributor {
  id: string;
  profile_id: string;
  name: string;
  code: string;
  commission_rate: number;
  commission_type: CommissionType;
  pricing_model: 'margin_split' | 'wholesale';
  use_customer_price: boolean;
  is_active: boolean;
  notes?: string;
  company_rep_id?: string | null;
  company_rep_rate: number;
  contact_name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  created_at: string;
  profiles?: { email: string };
  distributor_class: 'independent' | 'company';
  tax_id?: string;
  tax_id_type?: 'ein' | 'ssn';
  legal_name?: string;
  business_name?: string;
  tax_classification?: string;
  w9_consent?: boolean;
  w9_consent_date?: string;
  w9_status: 'pending' | 'received' | 'verified';
}

interface DistributorProductPrice {
  id: string;
  distributor_id: string;
  product_id: number;
  wholesale_price: number;
  is_active: boolean;
  notes?: string;
}

interface DistributorCustomer {
  id: string;
  distributor_id: string;
  organization_id: string;
  is_active: boolean;
  notes?: string;
  organizations: { name: string; code: string };
}

interface SalesRep {
  id: string;
  email: string;
  full_name?: string;
  role: string;
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

interface RepCustomerLink {
  id: string;
  distributor_id: string;
  sales_rep_id: string;
  organization_id: string;
  is_active: boolean;
}

type DistSubTab = 'sales_reps' | 'commission_rules' | 'wholesale_pricing' | 'customers';

/** Extract a human-readable message from Supabase PostgrestError or standard Error */
function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: string }).message);
  return fallback;
}

// ── Component ────────────────────────────────────────────────────────────────

const DistributorManagement: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [deleteTargetDistributor, setDeleteTargetDistributor] = useState<Distributor | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<SalesRep[]>([]);
  // New UI state for table layout
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedDistForSub, setSelectedDistForSub] = useState<Distributor | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<DistSubTab>('sales_reps');
  const [viewingDistributor, setViewingDistributor] = useState<Distributor | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [distributorCustomers, setDistributorCustomers] = useState<DistributorCustomer[]>([]);
  const [distributorSalesReps, setDistributorSalesReps] = useState<DistributorSalesRep[]>([]);
  const [repCustomerLinks, setRepCustomerLinks] = useState<RepCustomerLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDistributor, setShowAddDistributor] = useState(false);
  const [showAddSalesRep, setShowAddSalesRep] = useState(false);
  const [selectedDistributor, setSelectedDistributor] = useState<string | null>(null);
  const [editingDistributor, setEditingDistributor] = useState<Distributor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [products, setProducts] = useState<SimpleProduct[]>([]);
  const [categories, setCategories] = useState<SimpleCategory[]>([]);
  const [commissionRules, setCommissionRules] = useState<CommissionRule[]>([]);
  const [showAddRule, setShowAddRule] = useState<string | null>(null); // distributor id
  const [newRule, setNewRule] = useState({
    scope: 'product' as 'product' | 'category',
    organization_id: '' as string, // empty = all customers
    product_id: '' as string,
    category_id: '' as string,
    commission_type: 'percent_margin' as CommissionType,
    commission_rate: 0,
    use_customer_price: false,
    notes: '',
  });

  const [newDistributor, setNewDistributor] = useState({
    profile_id: '',
    name: '',
    code: '',
    commission_rate: '' as number | '',
    commission_type: 'percent_margin' as CommissionType,
    pricing_model: 'margin_split' as 'margin_split' | 'wholesale',
    notes: '',
    contact_name: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    phone: '',
  });

  // Wholesale product pricing state
  const [distributorProductPricing, setDistributorProductPricing] = useState<DistributorProductPrice[]>([]);
  const [showAddPricing, setShowAddPricing] = useState<string | null>(null); // distributor id
  const [showPricingImport, setShowPricingImport] = useState<{ distributorId: string; distributorName: string } | null>(null);
  const [newPricing, setNewPricing] = useState({ product_id: '', wholesale_price: 0, notes: '' });
  const [expandedPricing, setExpandedPricing] = useState<Set<string>>(new Set());

  // Inline user creation state
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // Auto-code and commission collapse
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false);
  const [showCommissionFields, setShowCommissionFields] = useState(false);

  // Inline sales rep user creation state
  const [showCreateSalesRepUser, setShowCreateSalesRepUser] = useState(false);
  const [newSalesRepEmail, setNewSalesRepEmail] = useState('');
  const [isCreatingSalesRepUser, setIsCreatingSalesRepUser] = useState(false);

  const [newDistributorSalesRep, setNewDistributorSalesRep] = useState({
    sales_rep_id: '',
    commission_split_type: 'percentage_of_distributor' as 'percentage_of_distributor' | 'fixed_with_override',
    sales_rep_rate: '' as number | '',
    distributor_override_rate: 0,
    notes: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      const [distributorsRes, orgsRes, allUsersRes, salesRepsRes, distSalesRepsRes, distCustomersRes, productsRes, categoriesRes, rulesRes, pricingRes, repCustRes] = await Promise.all([
        supabase
          .from('distributors')
          .select('*, profiles!distributors_profile_id_fkey(email)')
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
        supabase
          .from('organizations')
          .select('id, name, code')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('profiles')
          .select('id, email, role')
          .eq('approved', true)
          .neq('role', 'admin')
          .order('email'),
        supabase
          .from('profiles')
          .select('id, email, full_name, role')
          .in('role', ['sales_rep', 'distributor'])
          .order('email'),
        supabase
          .from('distributor_sales_reps')
          .select('*, profiles!distributor_sales_reps_sales_rep_id_fkey(email, full_name, phone)')
          .order('created_at', { ascending: false }),
        supabase
          .from('distributor_customers')
          .select('*, organizations(name, code)')
          .eq('is_active', true),
        supabase
          .from('products')
          .select('id, name, sku, category_id, price')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('categories')
          .select('id, name')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('distributor_commission_rules')
          .select('*')
          .eq('is_active', true)
          .order('created_at', { ascending: false }),
        supabase
          .from('distributor_product_pricing')
          .select('*')
          .eq('is_active', true)
          .order('created_at', { ascending: false }),
        supabase
          .from('distributor_rep_customers')
          .select('*')
          .eq('is_active', true),
      ]);

      if (distributorsRes.error) throw distributorsRes.error;
      if (orgsRes.error) throw orgsRes.error;
      if (allUsersRes.error) throw allUsersRes.error;
      if (salesRepsRes.error) throw salesRepsRes.error;
      if (distSalesRepsRes.error) throw distSalesRepsRes.error;
      if (distCustomersRes.error) throw distCustomersRes.error;
      // Products/categories/rules/pricing may not exist yet — non-fatal
      if (!productsRes.error) setProducts(productsRes.data || []);
      if (!categoriesRes.error) setCategories(categoriesRes.data || []);
      if (!rulesRes.error) setCommissionRules((rulesRes.data as CommissionRule[]) || []);
      if (!pricingRes.error) setDistributorProductPricing((pricingRes.data as DistributorProductPrice[]) || []);
      if (!repCustRes.error) setRepCustomerLinks((repCustRes.data as RepCustomerLink[]) || []);

      const distData = (distributorsRes.data as Distributor[]) || [];
      setDistributors(distData);
      setOrganizations(orgsRes.data || []);
      setDistributorCustomers((distCustomersRes.data as DistributorCustomer[]) || []);

      // Filter out users who already have a distributor record
      const existingProfileIds = new Set(distData.map(d => d.profile_id));
      setAvailableUsers((allUsersRes.data || []).filter(u => !existingProfileIds.has(u.id)));

      setSalesReps(salesRepsRes.data || []);
      setDistributorSalesReps(distSalesRepsRes.data || []);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load data'));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDistributor = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);

      // If creating a new user inline, create the user first
      let profileId = newDistributor.profile_id;
      if (showCreateUser && newUserEmail.trim()) {
        if (!newUserEmail.trim()) {
          setError('Email is required for new user');
          return;
        }
        setIsCreatingUser(true);
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('No active session');

        const response = await fetch(
          `${ENV.SUPABASE_URL}/functions/v1/create-admin-user`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: newUserEmail,
              role: 'distributor',
              fullName: newDistributor.name || undefined,
              skipEntityCreation: true,
              siteUrl: window.location.origin,
            }),
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Request failed with status ${response.status}`);
        }

        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'User creation failed');
        profileId = result.userId;
        setIsCreatingUser(false);
      }

      if (!profileId) {
        setError('Please select or create a user');
        return;
      }

      const hasCommissionRate = newDistributor.commission_rate !== '' && !isNaN(Number(newDistributor.commission_rate));
      const payload: Record<string, unknown> = {
        profile_id: profileId,
        user_id: profileId,
        name: newDistributor.name,
        code: newDistributor.code,
        commission_type: newDistributor.commission_type,
        pricing_model: newDistributor.pricing_model,
        notes: newDistributor.notes || null,
        contact_name: newDistributor.contact_name || null,
        address: newDistributor.address || null,
        city: newDistributor.city || null,
        state: newDistributor.state || null,
        zip: newDistributor.zip || null,
        phone: newDistributor.phone || null,
      };
      if (hasCommissionRate) {
        payload.commission_rate = Number(newDistributor.commission_rate);
      }
      const { error: insertError } = await supabase.from('distributors').insert([payload]);
      if (insertError) throw insertError;

      setSuccess(showCreateUser && newUserEmail ? 'User and distributor created successfully. An invite email has been sent.' : 'Distributor created successfully');
      setShowAddDistributor(false);
      setNewDistributor({
        profile_id: '',
        name: '',
        code: '',
        commission_rate: '',
        commission_type: 'percent_margin',
        pricing_model: 'margin_split',
        notes: '',
        contact_name: '',
        address: '',
        city: '',
        state: '',
        zip: '',
        phone: '',
      });
      setCodeManuallyEdited(false);
      setShowCommissionFields(false);
      setShowCreateUser(false);
      setNewUserEmail('');
      fetchData();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create distributor'));
    } finally {
      setIsCreatingUser(false);
    }
  };

  // Legacy handler kept for reference — user creation is now merged into handleCreateDistributor
  const handleCreateDistributorUser = async () => {
    if (!newUserEmail.trim()) {
      setError('Email is required');
      return;
    }
    try {
      setIsCreatingUser(true);
      setError(null);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No active session');

      const response = await fetch(
        `${ENV.SUPABASE_URL}/functions/v1/create-admin-user`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: newUserEmail,
            role: 'distributor',
            fullName: newDistributor.name || undefined,
            siteUrl: window.location.origin,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }

      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'User creation failed');

      // Refresh data and auto-select the new user
      const createdEmail = newUserEmail.trim().toLowerCase();
      setNewUserEmail('');
      setShowCreateUser(false);

      // Re-fetch to get the new user in availableUsers
      const [distributorsRes, allUsersRes] = await Promise.all([
        supabase
          .from('distributors')
          .select('*, profiles!distributors_profile_id_fkey(email)')
          .order('created_at', { ascending: false }),
        supabase
          .from('profiles')
          .select('id, email, role')
          .eq('approved', true)
          .neq('role', 'admin')
          .order('email'),
      ]);

      if (!distributorsRes.error && !allUsersRes.error) {
        const distData = (distributorsRes.data as Distributor[]) || [];
        setDistributors(distData);
        const existingProfileIds = new Set(distData.map(d => d.profile_id));
        const freshUsers = (allUsersRes.data || []).filter(u => !existingProfileIds.has(u.id));
        setAvailableUsers(freshUsers);

        const newUser = freshUsers.find(u => u.email.toLowerCase() === createdEmail);
        if (newUser) {
          setNewDistributor(prev => ({ ...prev, profile_id: newUser.id }));
        }
      }

      setSuccess('User created and selected');
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create user'));
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleCreateSalesRepUser = async () => {
    if (!newSalesRepEmail.trim()) {
      setError('Email is required');
      return;
    }
    try {
      setIsCreatingSalesRepUser(true);
      setError(null);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No active session');

      const createdEmail = newSalesRepEmail.trim().toLowerCase();
      let userAlreadyExisted = false;

      const response = await fetch(
        `${ENV.SUPABASE_URL}/functions/v1/create-admin-user`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: newSalesRepEmail,
            role: 'sales_rep',
            siteUrl: window.location.origin,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || errorData.message || '';
        // If user already exists, try to find and select them instead of failing
        if (errorMsg.toLowerCase().includes('already') || errorMsg.toLowerCase().includes('exists') || errorMsg.toLowerCase().includes('duplicate') || response.status === 400) {
          userAlreadyExisted = true;
        } else {
          throw new Error(errorMsg || `Request failed with status ${response.status}`);
        }
      } else {
        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'User creation failed');
      }

      setNewSalesRepEmail('');
      setShowCreateSalesRepUser(false);

      // Re-fetch sales reps to include the new or existing user
      const salesRepsRes = await supabase
        .from('profiles')
        .select('id, email, role')
        .in('role', ['sales_rep', 'distributor'])
        .order('email');

      if (!salesRepsRes.error) {
        setSalesReps(salesRepsRes.data || []);
        const matchedUser = (salesRepsRes.data || []).find(u => u.email.toLowerCase() === createdEmail);
        if (matchedUser) {
          setNewDistributorSalesRep(prev => ({ ...prev, sales_rep_id: matchedUser.id }));
          setSuccess(userAlreadyExisted ? 'Existing user found and selected' : 'Sales rep user created and selected');
        } else {
          // User might exist with a different role — search all profiles
          const { data: allProfiles } = await supabase
            .from('profiles')
            .select('id, email, role')
            .ilike('email', createdEmail)
            .limit(1);
          if (allProfiles && allProfiles.length > 0) {
            // Update their role to sales_rep if needed
            const existingUser = allProfiles[0];
            if (existingUser.role !== 'sales_rep' && existingUser.role !== 'distributor') {
              await supabase.from('profiles').update({ role: 'sales_rep' }).eq('id', existingUser.id);
            }
            setSalesReps(prev => [...prev.filter(r => r.id !== existingUser.id), existingUser]);
            setNewDistributorSalesRep(prev => ({ ...prev, sales_rep_id: existingUser.id }));
            setSuccess('Existing user found and selected');
          } else {
            throw new Error('User could not be found after creation. Please try again.');
          }
        }
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create user'));
    } finally {
      setIsCreatingSalesRepUser(false);
    }
  };

  const handleUpdateDistributor = async () => {
    if (!editingDistributor) return;
    try {
      setError(null);
      const { error: updateError } = await supabase
        .from('distributors')
        .update({
          name: editingDistributor.name,
          code: editingDistributor.code,
          commission_rate: editingDistributor.commission_rate,
          commission_type: editingDistributor.commission_type,
          pricing_model: editingDistributor.pricing_model,
          use_customer_price: editingDistributor.use_customer_price,
          is_active: editingDistributor.is_active,
          notes: editingDistributor.notes,
          company_rep_id: editingDistributor.company_rep_id || null,
          company_rep_rate: editingDistributor.company_rep_rate || 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingDistributor.id);

      if (updateError) throw updateError;

      setSuccess('Distributor updated successfully');
      setEditingDistributor(null);
      fetchData();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to update distributor'));
    }
  };

  const handleDeleteDistributor = (distributor: Distributor) => {
    setDeleteTargetDistributor(distributor);
    setShowDeleteModal(true);
  };

  const confirmDeleteDistributor = async () => {
    if (!deleteTargetDistributor || !currentUser) return;
    setIsDeleting(true);
    try {
      setError(null);
      const result = await softDeleteService.deleteDistributor(deleteTargetDistributor.id, currentUser.id);
      if (!result.success) {
        setError(result.error || 'Failed to delete distributor');
        return;
      }
      setSuccess('Distributor deleted');
      fetchData();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete distributor'));
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
      setDeleteTargetDistributor(null);
    }
  };

  const handleAddSalesRepToDistributor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDistributor) return;
    if (!newDistributorSalesRep.sales_rep_id) {
      setError('Please select a sales representative first');
      return;
    }
    if (newDistributorSalesRep.sales_rep_rate === '' || isNaN(Number(newDistributorSalesRep.sales_rep_rate))) {
      setError('Sales rep rate is required');
      return;
    }
    try {
      setError(null);
      const payload = {
        distributor_id: selectedDistributor,
        sales_rep_id: newDistributorSalesRep.sales_rep_id,
        commission_split_type: newDistributorSalesRep.commission_split_type,
        sales_rep_rate: Number(newDistributorSalesRep.sales_rep_rate),
        distributor_override_rate:
          newDistributorSalesRep.commission_split_type === 'fixed_with_override'
            ? newDistributorSalesRep.distributor_override_rate
            : null,
        notes: newDistributorSalesRep.notes || null,
      };
      const { error: insertError } = await supabase.from('distributor_sales_reps').insert(payload);

      if (insertError) {
        if (insertError.code === '23505') {
          // Record exists (likely soft-deleted with is_active=false) — reactivate it
          const { error: updateError } = await supabase
            .from('distributor_sales_reps')
            .update({
              is_active: true,
              commission_split_type: payload.commission_split_type,
              sales_rep_rate: payload.sales_rep_rate,
              distributor_override_rate: payload.distributor_override_rate,
              notes: payload.notes,
            })
            .eq('distributor_id', payload.distributor_id)
            .eq('sales_rep_id', payload.sales_rep_id);
          if (updateError) throw updateError;
        } else {
          throw insertError;
        }
      }

      setSuccess('Sales rep added to distributor');
      setShowAddSalesRep(false);
      setNewDistributorSalesRep({
        sales_rep_id: '',
        commission_split_type: 'percentage_of_distributor',
        sales_rep_rate: '',
        distributor_override_rate: 0,
        notes: '',
      });
      fetchData();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to add sales rep'));
    }
  };

  const handleRemoveSalesRepFromDistributor = async (id: string) => {
    if (!confirm('Remove this sales rep from the distributor?')) return;
    try {
      setError(null);
      const { error: deleteError } = await supabase.from('distributor_sales_reps').delete().eq('id', id);
      if (deleteError) throw deleteError;
      setSuccess('Sales rep removed');
      fetchData();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to remove sales rep'));
    }
  };

  // ── Commission rules handlers ──────────────────────────────────────────────

  const getDistributorRules = (distributorId: string) =>
    commissionRules.filter((r) => r.distributor_id === distributorId);

  const handleAddCommissionRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAddRule) return;
    try {
      setError(null);
      const payload: Record<string, unknown> = {
        distributor_id: showAddRule,
        organization_id: newRule.organization_id || null,
        scope: newRule.scope,
        commission_type: newRule.commission_type,
        commission_rate: newRule.commission_rate,
        use_customer_price: newRule.use_customer_price,
        notes: newRule.notes || null,
      };
      if (newRule.scope === 'product') {
        payload.product_id = parseInt(newRule.product_id, 10);
        payload.category_id = null;
      } else {
        payload.category_id = newRule.category_id;
        payload.product_id = null;
      }

      const { error: insertError } = await supabase.from('distributor_commission_rules').insert([payload]);
      if (insertError) throw insertError;

      setSuccess('Commission rule added');
      setShowAddRule(null);
      setNewRule({
        scope: 'product',
        organization_id: '',
        product_id: '',
        category_id: '',
        commission_type: 'percent_margin',
        commission_rate: 0,
        use_customer_price: false,
        notes: '',
      });
      fetchData();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to add commission rule'));
    }
  };

  const handleDeleteCommissionRule = async (id: string) => {
    if (!confirm('Remove this commission rule?')) return;
    try {
      setError(null);
      const { error: deleteError } = await supabase.from('distributor_commission_rules').delete().eq('id', id);
      if (deleteError) throw deleteError;
      setSuccess('Commission rule removed');
      fetchData();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to remove commission rule'));
    }
  };

  // ── Wholesale product pricing handlers ────────────────────────────────────
  const getDistributorPricing = (distributorId: string) =>
    distributorProductPricing.filter((p) => p.distributor_id === distributorId);

  const handleAddProductPricing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAddPricing) return;
    try {
      setError(null);
      const { error: insertError } = await supabase.from('distributor_product_pricing').insert([{
        distributor_id: showAddPricing,
        product_id: parseInt(newPricing.product_id, 10),
        wholesale_price: newPricing.wholesale_price,
        notes: newPricing.notes || null,
      }]);
      if (insertError) throw insertError;
      setSuccess('Wholesale price added');
      setShowAddPricing(null);
      setNewPricing({ product_id: '', wholesale_price: 0, notes: '' });
      fetchData();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to add wholesale price'));
    }
  };

  const handleCsvUploadPricing = async (distributorId: string, file: File) => {
    try {
      setError(null);
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) {
        setError('CSV must have a header row and at least one data row');
        return;
      }

      // Parse header — look for product_id/sku and wholesale_price columns
      const header = lines[0].toLowerCase().split(',').map((h) => h.trim().replace(/"/g, ''));
      const skuIdx = header.findIndex((h) => ['sku', 'product_sku'].includes(h));
      const idIdx = header.findIndex((h) => ['product_id', 'id', 'productid'].includes(h));
      const priceIdx = header.findIndex((h) => ['wholesale_price', 'price', 'cost', 'wholesale_cost', 'wholesale'].includes(h));
      const notesIdx = header.findIndex((h) => ['notes', 'note'].includes(h));

      if (priceIdx === -1) {
        setError('CSV must have a "wholesale_price" (or "price"/"cost") column');
        return;
      }
      if (skuIdx === -1 && idIdx === -1) {
        setError('CSV must have a "sku" or "product_id" column to identify products');
        return;
      }

      const rows: { product_id: number; wholesale_price: number; notes: string | null }[] = [];
      const errors: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        const price = parseFloat(cols[priceIdx]);
        if (isNaN(price) || price < 0) {
          errors.push(`Row ${i + 1}: invalid price "${cols[priceIdx]}"`);
          continue;
        }

        let productId: number | null = null;

        if (idIdx !== -1 && cols[idIdx]) {
          productId = parseInt(cols[idIdx], 10);
          if (isNaN(productId)) {
            errors.push(`Row ${i + 1}: invalid product_id "${cols[idIdx]}"`);
            continue;
          }
        } else if (skuIdx !== -1 && cols[skuIdx]) {
          const sku = cols[skuIdx];
          const product = products.find((p) => p.sku === sku);
          if (!product) {
            errors.push(`Row ${i + 1}: SKU "${sku}" not found`);
            continue;
          }
          productId = product.id;
        }

        if (productId === null) {
          errors.push(`Row ${i + 1}: no product identifier`);
          continue;
        }

        rows.push({
          product_id: productId,
          wholesale_price: price,
          notes: notesIdx !== -1 ? cols[notesIdx] || null : null,
        });
      }

      if (rows.length === 0) {
        setError(`No valid rows found. ${errors.join('; ')}`);
        return;
      }

      // Upsert rows (on conflict update wholesale_price)
      const payload = rows.map((r) => ({
        distributor_id: distributorId,
        product_id: r.product_id,
        wholesale_price: r.wholesale_price,
        notes: r.notes,
        is_active: true,
      }));

      const { error: upsertError } = await supabase
        .from('distributor_product_pricing')
        .upsert(payload, { onConflict: 'distributor_id,product_id' });

      if (upsertError) throw upsertError;

      const msg = `Uploaded ${rows.length} wholesale price(s)`;
      setSuccess(errors.length > 0 ? `${msg}. Skipped: ${errors.join('; ')}` : msg);
      fetchData();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to upload CSV'));
    }
  };

  const handleDeleteProductPricing = async (id: string) => {
    if (!confirm('Remove this wholesale price?')) return;
    try {
      setError(null);
      const { error: deleteError } = await supabase.from('distributor_product_pricing').delete().eq('id', id);
      if (deleteError) throw deleteError;
      setSuccess('Wholesale price removed');
      fetchData();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to remove wholesale price'));
    }
  };

  const getDistributorSalesReps = (distributorId: string) =>
    distributorSalesReps.filter((dsr) => dsr.distributor_id === distributorId && dsr.is_active);

  const getDistributorCustomerOrgs = (distributorId: string) =>
    distributorCustomers.filter((dc) => dc.distributor_id === distributorId);

  const handleAddCustomerOrg = async (distributorId: string, organizationId: string) => {
    try {
      setError(null);
      const { error: insertError } = await supabase.from('distributor_customers').insert([{
        distributor_id: distributorId,
        organization_id: organizationId,
      }]);
      if (insertError) throw insertError;
      setSuccess('Customer organization added');
      fetchData();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to add customer organization'));
    }
  };

  const getRepCustomerLinks = (distributorId: string, salesRepId: string) =>
    repCustomerLinks.filter((rc) => rc.distributor_id === distributorId && rc.sales_rep_id === salesRepId);

  const handleAddRepCustomer = async (distributorId: string, salesRepId: string, organizationId: string) => {
    try {
      setError(null);
      const { error: insertError } = await supabase.from('distributor_rep_customers').insert([{
        distributor_id: distributorId,
        sales_rep_id: salesRepId,
        organization_id: organizationId,
      }]);
      if (insertError) throw insertError;
      setSuccess('Customer assigned to rep');
      fetchData();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to assign customer to rep'));
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
      setError(getErrorMessage(err, 'Failed to remove customer from rep'));
    }
  };

  const handleRemoveCustomerOrg = async (id: string) => {
    if (!confirm('Remove this customer organization from the distributor?')) return;
    try {
      setError(null);
      const { error: deleteError } = await supabase.from('distributor_customers').delete().eq('id', id);
      if (deleteError) throw deleteError;
      setSuccess('Customer organization removed');
      fetchData();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to remove customer organization'));
    }
  };

  const filteredDistributors = distributors.filter(d => {
    const matchesSearch =
      d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (d.profiles?.email && d.profiles.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (d.contact_name && d.contact_name.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && d.is_active) ||
      (statusFilter === 'inactive' && !d.is_active);
    return matchesSearch && matchesStatus;
  });

  // ── Sub-management view ──────────────────────────────────────────────────
  if (selectedDistForSub) {
    const dist = selectedDistForSub;
    const typeConfig = getCommissionTypeConfig(dist.commission_type ?? 'percent_margin');
    const rateDisplay = commissionRateLabel(dist.commission_type ?? 'percent_margin', dist.commission_rate);
    const reps = getDistributorSalesReps(dist.id);
    const custOrgs = getDistributorCustomerOrgs(dist.id);

    const subTabs: { id: DistSubTab; label: string; icon: typeof Users; count: number }[] = [
      { id: 'sales_reps', label: 'Sales Reps', icon: Users, count: reps.length },
      { id: 'commission_rules', label: 'Commission Rules', icon: DollarSign, count: getDistributorRules(dist.id).length },
      { id: 'wholesale_pricing', label: 'Wholesale Pricing', icon: Package, count: getDistributorPricing(dist.id).length },
      { id: 'customers', label: 'Customers', icon: Building2, count: custOrgs.length },
    ];

    return (
      <div className="p-6">
        {/* Alerts */}
        {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
        {success && <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{success}</div>}

        {/* Sub-management header */}
        <div className="mb-6">
          <div className="flex items-center space-x-4 mb-4">
            <button
              onClick={() => { setSelectedDistForSub(null); setActiveSubTab('sales_reps'); }}
              className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
              <span>Back to Distributors</span>
            </button>
          </div>

          <div className="flex items-center space-x-4">
            <div className="p-3 bg-gradient-to-br from-pink-500 to-orange-500 rounded-lg">
              <Building className="h-8 w-8 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{dist.name}</h2>
              <p className="text-gray-600">Code: {dist.code} · {dist.profiles?.email ?? 'N/A'}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  dist.distributor_class === 'independent' ? 'bg-sky-100 text-sky-700' : 'bg-indigo-100 text-indigo-700'
                }`}>
                  {dist.distributor_class === 'independent' ? 'Independent' : 'Company'}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  dist.pricing_model === 'wholesale' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {dist.pricing_model === 'wholesale' ? 'Wholesale' : 'Margin Split'}
                </span>
                {dist.pricing_model !== 'wholesale' && (
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                    {rateDisplay} {typeConfig.label}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            {subTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveSubTab(tab.id)}
                  className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeSubTab === tab.id
                      ? 'border-pink-500 text-pink-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span>{tab.label} ({tab.count})</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sub-tab content */}
        <div>
          {/* ── Sales Reps Tab ── */}
          {activeSubTab === 'sales_reps' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Sales Representatives</h3>
                <button
                  onClick={() => { setSelectedDistributor(dist.id); setShowAddSalesRep(true); }}
                  className="flex items-center gap-2 px-3 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 text-sm"
                >
                  <Plus className="h-4 w-4" />
                  Add Sales Rep
                </button>
              </div>
              {reps.length === 0 ? (
                <div className="bg-white border border-dashed border-gray-300 rounded-lg py-12 text-center">
                  <Users className="mx-auto h-8 w-8 text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500">No sales representatives assigned</p>
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rep</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Split Type</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assigned Customers</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {reps.map((dsr) => {
                        const splitLabel =
                          dsr.commission_split_type === 'percentage_of_distributor'
                            ? `${dsr.sales_rep_rate}% of dist. commission`
                            : `Fixed ${dsr.sales_rep_rate}${typeConfig.isFlat ? '$' : '%'} + ${dsr.distributor_override_rate ?? 0}${typeConfig.isFlat ? '$' : '%'} override`;
                        const repCustLinks = getRepCustomerLinks(dist.id, dsr.sales_rep_id);
                        const assignedOrgIds = new Set(repCustLinks.map(rc => rc.organization_id));
                        const availableCustOrgs = custOrgs.filter(dc => !assignedOrgIds.has(dc.organization_id));
                        return (
                          <tr key={dsr.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4">
                              <p className="text-sm font-medium text-gray-900">{dsr.profiles?.full_name || dsr.profiles?.email}</p>
                              {dsr.profiles?.full_name && <p className="text-xs text-gray-500">{dsr.profiles.email}</p>}
                              {dsr.profiles?.phone && <p className="text-xs text-gray-400">{dsr.profiles.phone}</p>}
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-xs px-2 py-1 rounded-full bg-violet-50 text-violet-700">
                                {dsr.commission_split_type === 'percentage_of_distributor' ? '% of Distributor' : 'Fixed + Override'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-700">{splitLabel}</td>
                            <td className="px-6 py-4">
                              <div className="flex flex-wrap gap-1.5">
                                {repCustLinks.map((rc) => {
                                  const org = organizations.find(o => o.id === rc.organization_id);
                                  return (
                                    <span key={rc.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-700 rounded-full text-xs">
                                      {org?.name ?? 'Unknown'}
                                      <button onClick={() => handleRemoveRepCustomer(rc.id)} className="ml-0.5 hover:bg-green-200 rounded-full p-0.5" title="Remove">
                                        <X className="h-3 w-3" />
                                      </button>
                                    </span>
                                  );
                                })}
                                {availableCustOrgs.length > 0 && (
                                  <select
                                    className="text-xs px-2 py-1 border border-gray-200 rounded-lg text-gray-600 bg-white"
                                    value=""
                                    onChange={(e) => { if (e.target.value) handleAddRepCustomer(dist.id, dsr.sales_rep_id, e.target.value); }}
                                  >
                                    <option value="">+ Assign...</option>
                                    {availableCustOrgs.map((dc) => (
                                      <option key={dc.organization_id} value={dc.organization_id}>{dc.organizations.name}</option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button onClick={() => handleRemoveSalesRepFromDistributor(dsr.id)} className="p-1.5 hover:bg-red-50 rounded-lg" title="Remove">
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Commission Rules Tab ── */}
          {activeSubTab === 'commission_rules' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Commission Rules</h3>
                {dist.pricing_model !== 'wholesale' && (
                  <button
                    onClick={() => setShowAddRule(dist.id)}
                    className="flex items-center gap-2 px-3 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 text-sm"
                  >
                    <Plus className="h-4 w-4" />
                    Add Rule
                  </button>
                )}
              </div>
              {dist.pricing_model === 'wholesale' ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
                  Wholesale distributors don't use commission rules. They earn the spread between wholesale and customer price.
                </div>
              ) : getDistributorRules(dist.id).length === 0 ? (
                <div className="bg-white border border-dashed border-gray-300 rounded-lg py-12 text-center">
                  <DollarSign className="mx-auto h-8 w-8 text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500">No per-product or per-category rules</p>
                  <p className="text-xs text-gray-400 mt-1">All items use the distributor default: {rateDisplay} {typeConfig.label}</p>
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scope</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Target</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Commission</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {getDistributorRules(dist.id).map((rule) => {
                        const rCfg = getCommissionTypeConfig(rule.commission_type);
                        const productName = rule.product_id ? products.find((p) => p.id === rule.product_id)?.name ?? `#${rule.product_id}` : null;
                        const categoryName = rule.category_id ? categories.find((c) => c.id === rule.category_id)?.name ?? 'Unknown' : null;
                        const customerName = rule.organization_id ? organizations.find((o) => o.id === rule.organization_id)?.name ?? 'Unknown' : null;
                        return (
                          <tr key={rule.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4">
                              <span className={`text-xs px-2 py-1 rounded-full ${rule.scope === 'product' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
                                {rule.scope === 'product' ? 'Product' : 'Category'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900">{productName || categoryName}</td>
                            <td className="px-6 py-4">
                              <span className={`text-xs px-2 py-1 rounded-full ${customerName ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>
                                {customerName || 'All customers'}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-sm font-medium text-gray-900">{commissionRateLabel(rule.commission_type, rule.commission_rate)}</p>
                              <p className="text-xs text-gray-500">{rCfg.label}{rule.use_customer_price ? ' · uses customer price' : ''}</p>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button onClick={() => handleDeleteCommissionRule(rule.id)} className="p-1.5 hover:bg-red-50 rounded-lg" title="Remove">
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Wholesale Pricing Tab ── */}
          {activeSubTab === 'wholesale_pricing' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Wholesale Product Pricing</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowPricingImport({ distributorId: dist.id, distributorName: dist.name })}
                    className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 text-sm"
                  >
                    <Upload className="h-4 w-4" />
                    Import CSV
                  </button>
                </div>
              </div>
              {dist.pricing_model !== 'wholesale' ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
                  This distributor uses the Margin Split model. Wholesale pricing only applies to Wholesale distributors.
                </div>
              ) : (
                <WholesalePricingGrid
                  products={products}
                  pricing={getDistributorPricing(dist.id)}
                  distributorId={dist.id}
                  onRefresh={fetchData}
                />
              )}
            </div>
          )}

          {/* ── Customers Tab ── */}
          {activeSubTab === 'customers' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Customer Organizations</h3>
              </div>
              {(() => {
                const linkedOrgIds = new Set(custOrgs.map(dc => dc.organization_id));
                const availableOrgs = organizations.filter(o => !linkedOrgIds.has(o.id));
                return (
                  <>
                    {availableOrgs.length > 0 && (
                      <div className="mb-4">
                        <select
                          className="text-sm px-3 py-2 border border-gray-300 rounded-lg text-gray-600 bg-white"
                          value=""
                          onChange={(e) => { if (e.target.value) handleAddCustomerOrg(dist.id, e.target.value); }}
                        >
                          <option value="">+ Add customer organization...</option>
                          {availableOrgs.map((org) => (
                            <option key={org.id} value={org.id}>{org.name} ({org.code})</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {custOrgs.length === 0 ? (
                      <div className="bg-white border border-dashed border-gray-300 rounded-lg py-12 text-center">
                        <Building2 className="mx-auto h-8 w-8 text-gray-300 mb-2" />
                        <p className="text-sm text-gray-500">No customer organizations linked</p>
                      </div>
                    ) : (
                      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {custOrgs.map((dc) => (
                              <tr key={dc.id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 text-sm font-medium text-gray-900">{dc.organizations.name}</td>
                                <td className="px-6 py-4 text-sm text-gray-500">{dc.organizations.code}</td>
                                <td className="px-6 py-4 text-right">
                                  <button onClick={() => handleRemoveCustomerOrg(dc.id)} className="p-1.5 hover:bg-red-50 rounded-lg" title="Remove">
                                    <Trash2 className="h-4 w-4 text-red-500" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* Modals that work inside sub-management view */}
        {renderModals()}
      </div>
    );
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  // ── Main list view ─────────────────────────────────────────────────────────
  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Distributor Management</h2>
          <p className="text-gray-600">Manage distributors, commission structures, and sales rep hierarchies</p>
        </div>
        <button
          onClick={() => setShowAddDistributor(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-orange-500 text-white rounded-lg hover:shadow-lg transition-all"
        >
          <Plus className="h-5 w-5" />
          Add Distributor
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center space-x-2">
          <AlertCircle className="h-5 w-5 text-red-600" />
          <span className="text-sm text-red-700">{error}</span>
        </div>
      )}
      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center space-x-2">
          <CheckCircle className="h-5 w-5 text-green-600" />
          <span className="text-sm text-green-700">{success}</span>
        </div>
      )}

      {/* Search + Filter */}
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, code, email, or contact..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <Building className="h-8 w-8 text-pink-600" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Total</p>
              <p className="text-2xl font-semibold text-gray-900">{distributors.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <CheckCircle className="h-8 w-8 text-green-600" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Active</p>
              <p className="text-2xl font-semibold text-gray-900">{distributors.filter(d => d.is_active).length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <Archive className="h-8 w-8 text-gray-600" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Inactive</p>
              <p className="text-2xl font-semibold text-gray-900">{distributors.filter(d => !d.is_active).length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <Users className="h-8 w-8 text-sky-600" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Independent</p>
              <p className="text-2xl font-semibold text-gray-900">{distributors.filter(d => d.distributor_class === 'independent').length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <Building2 className="h-8 w-8 text-indigo-600" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Company</p>
              <p className="text-2xl font-semibold text-gray-900">{distributors.filter(d => d.distributor_class === 'company').length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Distributors Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Distributor</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contact</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type / Model</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Stats</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredDistributors.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-500">
                    {distributors.length === 0 ? 'No distributors yet. Click "Add Distributor" to create one.' : 'No distributors match your search.'}
                  </td>
                </tr>
              ) : filteredDistributors.map((distributor) => {
                const reps = getDistributorSalesReps(distributor.id);
                const rules = getDistributorRules(distributor.id);
                const custOrgs = getDistributorCustomerOrgs(distributor.id);
                const pricing = getDistributorPricing(distributor.id);
                return (
                  <tr key={distributor.id} className={distributor.is_active ? 'hover:bg-gray-50' : 'bg-gray-50'}>
                    {/* Actions */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => { setViewingDistributor(distributor); setIsViewModalOpen(true); }}
                          className="p-2 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                          title="View Details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => { setEditingDistributor(distributor); setIsEditModalOpen(true); }}
                          className="p-2 text-pink-600 bg-pink-50 hover:bg-pink-100 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => { setSelectedDistForSub(distributor); setActiveSubTab('sales_reps'); }}
                          className="p-2 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
                          title="Manage Sales Reps, Rules & Pricing"
                        >
                          <Settings className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteDistributor(distributor)}
                          className="p-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>

                    {/* Distributor */}
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{distributor.name}</p>
                        <p className="text-xs text-gray-500">Code: {distributor.code}</p>
                        <p className="text-xs text-gray-500">{distributor.profiles?.email ?? 'No user'}</p>
                      </div>
                    </td>

                    {/* Contact */}
                    <td className="px-6 py-4">
                      <div>
                        {distributor.contact_name && <p className="text-sm text-gray-900">{distributor.contact_name}</p>}
                        {distributor.phone && <p className="text-xs text-gray-500">{distributor.phone}</p>}
                        {distributor.address && (
                          <p className="text-xs text-gray-400">
                            {distributor.address}{distributor.city ? `, ${distributor.city}` : ''}{distributor.state ? `, ${distributor.state}` : ''}{distributor.zip ? ` ${distributor.zip}` : ''}
                          </p>
                        )}
                        {!distributor.contact_name && !distributor.phone && !distributor.address && (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </div>
                    </td>

                    {/* Type / Model */}
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          distributor.distributor_class === 'independent' ? 'bg-sky-100 text-sky-700' : 'bg-indigo-100 text-indigo-700'
                        }`}>
                          {distributor.distributor_class === 'independent' ? 'Independent' : 'Company'}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          distributor.pricing_model === 'wholesale' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {distributor.pricing_model === 'wholesale' ? 'Wholesale' : 'Margin Split'}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          distributor.w9_status === 'verified' ? 'bg-green-100 text-green-700' : distributor.w9_status === 'received' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                        }`}>
                          W-9: {distributor.w9_status === 'verified' ? 'Verified' : distributor.w9_status === 'received' ? 'Received' : 'Pending'}
                        </span>
                      </div>
                    </td>

                    {/* Stats */}
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3 text-xs text-gray-600">
                        <span className="flex items-center gap-1" title="Sales Reps">
                          <Users className="h-3.5 w-3.5" /> {reps.length}
                        </span>
                        <span className="flex items-center gap-1" title="Commission Rules">
                          <DollarSign className="h-3.5 w-3.5" /> {rules.length}
                        </span>
                        <span className="flex items-center gap-1" title="Customers">
                          <Building2 className="h-3.5 w-3.5" /> {custOrgs.length}
                        </span>
                        {distributor.pricing_model === 'wholesale' && (
                          <span className="flex items-center gap-1" title="Wholesale Prices">
                            <Package className="h-3.5 w-3.5" /> {pricing.length}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        distributor.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {distributor.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* View Modal */}
      {isViewModalOpen && viewingDistributor && (
        <Modal title="Distributor Details" onClose={() => { setIsViewModalOpen(false); setViewingDistributor(null); }}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-gray-500">Name</p><p className="text-sm font-medium">{viewingDistributor.name}</p></div>
              <div><p className="text-xs text-gray-500">Code</p><p className="text-sm font-medium">{viewingDistributor.code}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-gray-500">User</p><p className="text-sm">{viewingDistributor.profiles?.email ?? 'N/A'}</p></div>
              <div><p className="text-xs text-gray-500">Class</p><p className="text-sm">{viewingDistributor.distributor_class === 'independent' ? 'Independent' : 'Company'}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-gray-500">Pricing Model</p><p className="text-sm">{viewingDistributor.pricing_model === 'wholesale' ? 'Wholesale' : 'Margin Split'}</p></div>
              <div><p className="text-xs text-gray-500">Status</p><p className="text-sm">{viewingDistributor.is_active ? 'Active' : 'Inactive'}</p></div>
            </div>
            {viewingDistributor.pricing_model !== 'wholesale' && (
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-xs text-gray-500">Commission Type</p><p className="text-sm">{getCommissionTypeConfig(viewingDistributor.commission_type).label}</p></div>
                <div><p className="text-xs text-gray-500">Rate</p><p className="text-sm">{commissionRateLabel(viewingDistributor.commission_type, viewingDistributor.commission_rate)}</p></div>
              </div>
            )}
            {(viewingDistributor.contact_name || viewingDistributor.phone) && (
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-xs text-gray-500">Contact</p><p className="text-sm">{viewingDistributor.contact_name || '—'}</p></div>
                <div><p className="text-xs text-gray-500">Phone</p><p className="text-sm">{viewingDistributor.phone || '—'}</p></div>
              </div>
            )}
            {viewingDistributor.address && (
              <div><p className="text-xs text-gray-500">Address</p><p className="text-sm">{viewingDistributor.address}{viewingDistributor.city ? `, ${viewingDistributor.city}` : ''}{viewingDistributor.state ? `, ${viewingDistributor.state}` : ''}{viewingDistributor.zip ? ` ${viewingDistributor.zip}` : ''}</p></div>
            )}
            {viewingDistributor.notes && (
              <div><p className="text-xs text-gray-500">Notes</p><p className="text-sm">{viewingDistributor.notes}</p></div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-gray-500">W-9 Status</p><p className="text-sm">{viewingDistributor.w9_status}</p></div>
              <div><p className="text-xs text-gray-500">Created</p><p className="text-sm">{new Date(viewingDistributor.created_at).toLocaleDateString()}</p></div>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Modal */}
      {isEditModalOpen && editingDistributor && (
        <Modal title="Edit Distributor" onClose={() => { setIsEditModalOpen(false); setEditingDistributor(null); }}>
          <EditDistributorForm
            distributor={editingDistributor}
            onChange={setEditingDistributor}
            onSave={() => { handleUpdateDistributor(); setIsEditModalOpen(false); }}
            onCancel={() => { setIsEditModalOpen(false); setEditingDistributor(null); }}
            salesReps={salesReps}
          />
        </Modal>
      )}

      {renderModals()}
    </div>
  );

  // ── Shared modals (extracted so they work in both list and sub-management views) ──
  function renderModals() {
    return (
      <>
      {/* ── Add Distributor Modal ────────────────────────────────────────────── */}
      {showAddDistributor && (
        <Modal title="Add New Distributor" onClose={() => {
          setShowAddDistributor(false);
          setShowCreateUser(false);
          setNewUserEmail('');
          setCodeManuallyEdited(false);
          setShowCommissionFields(false);
        }}>
          <form onSubmit={handleCreateDistributor}>
            <div className="space-y-4">
              {/* ── Distributor User: select or create inline ── */}
              <Field label="Distributor User *">
                {!showCreateUser ? (
                  <div className="flex gap-2">
                    <select
                      required={!showCreateUser}
                      value={newDistributor.profile_id}
                      onChange={(e) => setNewDistributor({ ...newDistributor, profile_id: e.target.value })}
                      className={`${selectCls} flex-1`}
                    >
                      <option value="">Select a user</option>
                      {availableUsers.map((u) => (
                        <option key={u.id} value={u.id}>{u.email} ({u.role || 'no role'})</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowCreateUser(true)}
                      className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg whitespace-nowrap"
                    >
                      <UserPlus className="h-4 w-4" />
                      New User
                    </button>
                  </div>
                ) : (
                  <div className="border border-purple-200 bg-purple-50 rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-purple-700">Create New User</span>
                      <button
                        type="button"
                        onClick={() => { setShowCreateUser(false); setNewUserEmail(''); }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <input
                      type="email"
                      required
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      className={inputCls}
                      placeholder="Email address"
                    />
                    <p className="text-xs text-gray-500">
                      A new user will be created and an invite email sent when you save the distributor.
                    </p>
                  </div>
                )}
              </Field>

              {/* ── Distributor Name ── */}
              <Field label="Distributor Name *">
                <input
                  type="text"
                  required
                  value={newDistributor.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    const updates: { name: string; code?: string } = { name };
                    if (!codeManuallyEdited) {
                      updates.code = generateDistributorCode(name, distributors.map(d => d.code));
                    }
                    setNewDistributor({ ...newDistributor, ...updates });
                  }}
                  className={inputCls}
                  placeholder="ABC Distribution"
                />
              </Field>

              {/* ── Auto-generated Code ── */}
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">Code:</span>
                  {codeManuallyEdited ? (
                    <input
                      type="text"
                      required
                      value={newDistributor.code}
                      onChange={(e) => setNewDistributor({ ...newDistributor, code: e.target.value.toUpperCase() })}
                      className="px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 uppercase w-32"
                    />
                  ) : (
                    <span className="text-sm font-mono font-semibold text-indigo-600">
                      {newDistributor.code || '—'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (codeManuallyEdited) {
                        // Reset to auto-generated
                        const autoCode = generateDistributorCode(newDistributor.name, distributors.map(d => d.code));
                        setNewDistributor({ ...newDistributor, code: autoCode });
                      }
                      setCodeManuallyEdited(!codeManuallyEdited);
                    }}
                    className="text-gray-400 hover:text-gray-600"
                    title={codeManuallyEdited ? 'Use auto-generated code' : 'Edit code manually'}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {codeManuallyEdited ? 'Manually editing code' : 'Auto-generated from name'}
                </p>
              </div>

              {/* ── Contact Name & Address ── */}
              <Field label="Contact Name">
                <input
                  type="text"
                  value={newDistributor.contact_name}
                  onChange={(e) => setNewDistributor({ ...newDistributor, contact_name: e.target.value })}
                  className={inputCls}
                  placeholder="Primary contact name"
                />
              </Field>
              <Field label="Phone">
                <input
                  type="tel"
                  value={newDistributor.phone}
                  onChange={(e) => setNewDistributor({ ...newDistributor, phone: e.target.value })}
                  className={inputCls}
                  placeholder="(555) 555-1234"
                />
              </Field>
              <Field label="Address">
                <input
                  type="text"
                  value={newDistributor.address}
                  onChange={(e) => setNewDistributor({ ...newDistributor, address: e.target.value })}
                  className={inputCls}
                  placeholder="Street address"
                />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="City">
                  <input
                    type="text"
                    value={newDistributor.city}
                    onChange={(e) => setNewDistributor({ ...newDistributor, city: e.target.value })}
                    className={inputCls}
                    placeholder="City"
                  />
                </Field>
                <Field label="State">
                  <input
                    type="text"
                    value={newDistributor.state}
                    onChange={(e) => setNewDistributor({ ...newDistributor, state: e.target.value })}
                    className={inputCls}
                    placeholder="TX"
                  />
                </Field>
                <Field label="ZIP">
                  <input
                    type="text"
                    value={newDistributor.zip}
                    onChange={(e) => setNewDistributor({ ...newDistributor, zip: e.target.value })}
                    className={inputCls}
                    placeholder="75001"
                  />
                </Field>
              </div>

              {/* ── Pricing Model ── */}
              <Field label="Pricing Model *">
                <div className="flex gap-3">
                  <label className={`flex-1 flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                    newDistributor.pricing_model === 'margin_split'
                      ? 'border-pink-500 bg-pink-50 text-pink-700'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}>
                    <input
                      type="radio"
                      name="pricing_model"
                      value="margin_split"
                      checked={newDistributor.pricing_model === 'margin_split'}
                      onChange={() => setNewDistributor({ ...newDistributor, pricing_model: 'margin_split' })}
                      className="text-pink-600 focus:ring-pink-500"
                    />
                    <div>
                      <div className="text-sm font-medium">Margin Split</div>
                      <div className="text-xs text-gray-500">Earns % of margin</div>
                    </div>
                  </label>
                  <label className={`flex-1 flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                    newDistributor.pricing_model === 'wholesale'
                      ? 'border-pink-500 bg-pink-50 text-pink-700'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}>
                    <input
                      type="radio"
                      name="pricing_model"
                      value="wholesale"
                      checked={newDistributor.pricing_model === 'wholesale'}
                      onChange={() => setNewDistributor({ ...newDistributor, pricing_model: 'wholesale' })}
                      className="text-pink-600 focus:ring-pink-500"
                    />
                    <div>
                      <div className="text-sm font-medium">Wholesale</div>
                      <div className="text-xs text-gray-500">Buys at wholesale, keeps spread</div>
                    </div>
                  </label>
                </div>
              </Field>

              {/* ── Notes ── */}
              <Field label="Notes">
                <textarea
                  value={newDistributor.notes}
                  onChange={(e) => setNewDistributor({ ...newDistributor, notes: e.target.value })}
                  className={inputCls}
                  rows={3}
                  placeholder="Optional notes..."
                />
              </Field>

              {/* ── Commission Settings (collapsible, hidden for wholesale) ── */}
              {newDistributor.pricing_model === 'margin_split' && (
              <div className="border border-gray-200 rounded-lg">
                <button
                  type="button"
                  onClick={() => setShowCommissionFields(!showCommissionFields)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-600 hover:bg-gray-50 rounded-lg"
                >
                  <span>
                    <span className="font-medium">Commission Settings</span>
                    {newDistributor.commission_rate !== '' && newDistributor.commission_rate !== undefined && (
                      <span className="text-gray-400 ml-2">
                        {commissionRateLabel(newDistributor.commission_type, newDistributor.commission_rate)} {getCommissionTypeConfig(newDistributor.commission_type).label}
                      </span>
                    )}
                  </span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${showCommissionFields ? 'rotate-180' : ''}`} />
                </button>
                {showCommissionFields && (
                  <div className="px-4 pb-4 space-y-4 border-t border-gray-100">
                    <Field label="Commission Basis">
                      <select
                        value={newDistributor.commission_type}
                        onChange={(e) =>
                          setNewDistributor({ ...newDistributor, commission_type: e.target.value as CommissionType })
                        }
                        className={selectCls}
                      >
                        {COMMISSION_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-400 mt-1">
                        {getCommissionTypeConfig(newDistributor.commission_type).description}
                      </p>
                    </Field>

                    <Field
                      label={`${getCommissionTypeConfig(newDistributor.commission_type).rateLabel} (${getCommissionTypeConfig(newDistributor.commission_type).rateUnit})`}
                    >
                      <input
                        type="number"
                        min="0"
                        max={getCommissionTypeConfig(newDistributor.commission_type).isFlat ? undefined : 100}
                        step="0.01"
                        value={newDistributor.commission_rate}
                        onChange={(e) =>
                          setNewDistributor({ ...newDistributor, commission_rate: parseFloat(e.target.value) })
                        }
                        className={inputCls}
                      />
                    </Field>
                  </div>
                )}
              </div>
              )}
            </div>

            <div className="mt-6 flex gap-3 justify-end border-t border-gray-100 pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowAddDistributor(false);
                  setShowCreateUser(false);
                  setNewUserEmail('');
                  setCodeManuallyEdited(false);
                  setShowCommissionFields(false);
                }}
                className={cancelBtnCls}
              >
                Cancel
              </button>
              <button type="submit" disabled={isCreatingUser} className={primaryBtnCls}>
                {isCreatingUser ? 'Creating User & Distributor...' : showCreateUser && newUserEmail ? 'Create User & Distributor' : 'Create Distributor'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Add Sales Rep Modal ──────────────────────────────────────────────── */}
      {/* ── Add Commission Rule Modal ──────────────────────────────────────── */}
      {showAddRule && (() => {
        const dist = distributors.find((d) => d.id === showAddRule);
        const ruleCfg = getCommissionTypeConfig(newRule.commission_type);
        const distCustOrgs = getDistributorCustomerOrgs(showAddRule);
        return (
          <Modal
            title={`Add Commission Rule — ${dist?.name ?? ''}`}
            onClose={() => setShowAddRule(null)}
          >
            <form onSubmit={handleAddCommissionRule}>
              <div className="space-y-4">
                <Field label="Customer (optional)">
                  <select
                    value={newRule.organization_id}
                    onChange={(e) => setNewRule({ ...newRule, organization_id: e.target.value })}
                    className={selectCls}
                  >
                    <option value="">All customers (global rule)</option>
                    {distCustOrgs.map((dc) => (
                      <option key={dc.organization_id} value={dc.organization_id}>
                        {dc.organizations.name} ({dc.organizations.code})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">
                    Leave blank to apply to all customers; select one to create a customer-specific override.
                  </p>
                </Field>

                <Field label="Applies To *">
                  <select
                    required
                    value={newRule.scope}
                    onChange={(e) =>
                      setNewRule({ ...newRule, scope: e.target.value as 'product' | 'category', product_id: '', category_id: '' })
                    }
                    className={selectCls}
                  >
                    <option value="product">Specific Product</option>
                    <option value="category">Product Category</option>
                  </select>
                </Field>

                {newRule.scope === 'product' ? (
                  <Field label="Product *">
                    <select
                      required
                      value={newRule.product_id}
                      onChange={(e) => setNewRule({ ...newRule, product_id: e.target.value })}
                      className={selectCls}
                    >
                      <option value="">Select a product</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.sku ? ` (${p.sku})` : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field label="Category *">
                    <select
                      required
                      value={newRule.category_id}
                      onChange={(e) => setNewRule({ ...newRule, category_id: e.target.value })}
                      className={selectCls}
                    >
                      <option value="">Select a category</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </Field>
                )}

                <Field label="Commission Basis *">
                  <select
                    required
                    value={newRule.commission_type}
                    onChange={(e) =>
                      setNewRule({ ...newRule, commission_type: e.target.value as CommissionType })
                    }
                    className={selectCls}
                  >
                    {COMMISSION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">{ruleCfg.description}</p>
                </Field>

                <Field label={`${ruleCfg.rateLabel} (${ruleCfg.rateUnit}) *`}>
                  <input
                    type="number"
                    required
                    min="0"
                    max={ruleCfg.isFlat ? undefined : 100}
                    step="0.01"
                    value={newRule.commission_rate}
                    onChange={(e) =>
                      setNewRule({ ...newRule, commission_rate: parseFloat(e.target.value) || 0 })
                    }
                    className={inputCls}
                  />
                </Field>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="use_customer_price"
                    checked={newRule.use_customer_price}
                    onChange={(e) =>
                      setNewRule({ ...newRule, use_customer_price: e.target.checked })
                    }
                    className="rounded border-gray-300 text-pink-600 focus:ring-pink-500"
                  />
                  <label htmlFor="use_customer_price" className="text-sm text-gray-700">
                    Use customer's actual price for margin calculation
                  </label>
                </div>
                <p className="text-xs text-gray-400 -mt-2 ml-6">
                  When checked, if a customer has a special/discounted price, the commission is
                  calculated on that lower price instead of retail — reducing the commission proportionally.
                </p>

                <Field label="Notes">
                  <textarea
                    value={newRule.notes}
                    onChange={(e) => setNewRule({ ...newRule, notes: e.target.value })}
                    className={inputCls}
                    rows={2}
                    placeholder="e.g. Genetics test: cost $199, sell $249, keep $50"
                  />
                </Field>
              </div>

              <div className="mt-6 flex gap-3 justify-end border-t border-gray-100 pt-4">
                <button type="button" onClick={() => setShowAddRule(null)} className={cancelBtnCls}>
                  Cancel
                </button>
                <button type="submit" className={primaryBtnCls}>
                  Add Rule
                </button>
              </div>
            </form>
          </Modal>
        );
      })()}

      {/* ── Add Wholesale Product Pricing Modal ───────────────────────────── */}
      {showAddPricing && (() => {
        const dist = distributors.find((d) => d.id === showAddPricing);
        const existingProductIds = new Set(
          getDistributorPricing(showAddPricing).map((p) => p.product_id)
        );
        const availableProducts = products.filter((p) => !existingProductIds.has(p.id));
        return (
          <Modal
            title={`Add Wholesale Price — ${dist?.name ?? ''}`}
            onClose={() => setShowAddPricing(null)}
          >
            <form onSubmit={handleAddProductPricing}>
              <div className="space-y-4">
                <Field label="Product *">
                  <select
                    required
                    value={newPricing.product_id}
                    onChange={(e) => setNewPricing({ ...newPricing, product_id: e.target.value })}
                    className={selectCls}
                  >
                    <option value="">Select a product</option>
                    {availableProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.sku ? ` (${p.sku})` : ''}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Wholesale Price ($) *">
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={newPricing.wholesale_price}
                    onChange={(e) =>
                      setNewPricing({ ...newPricing, wholesale_price: parseFloat(e.target.value) || 0 })
                    }
                    className={inputCls}
                    placeholder="0.00"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    The price the distributor pays you for this product
                  </p>
                </Field>

                <Field label="Notes">
                  <textarea
                    value={newPricing.notes}
                    onChange={(e) => setNewPricing({ ...newPricing, notes: e.target.value })}
                    className={inputCls}
                    rows={2}
                    placeholder="Optional notes..."
                  />
                </Field>
              </div>

              <div className="mt-6 flex gap-3 justify-end border-t border-gray-100 pt-4">
                <button type="button" onClick={() => setShowAddPricing(null)} className={cancelBtnCls}>
                  Cancel
                </button>
                <button type="submit" className={primaryBtnCls}>
                  Add Price
                </button>
              </div>
            </form>
          </Modal>
        );
      })()}

      {showAddSalesRep && selectedDistributor && (() => {
        const dist = distributors.find((d) => d.id === selectedDistributor);
        const typeConfig = dist ? getCommissionTypeConfig(dist.commission_type ?? 'percent_margin') : COMMISSION_TYPES[0];
        return (
          <Modal
            title={`Add Sales Rep — ${dist?.name ?? ''}`}
            onClose={() => { setShowAddSalesRep(false); setShowCreateSalesRepUser(false); setNewSalesRepEmail(''); }}
          >
            {dist && (
              <div className="mb-4 px-3 py-2 bg-violet-50 border border-violet-100 rounded-lg text-xs text-violet-700">
                <strong>Distributor commission:</strong> {commissionRateLabel(dist.commission_type, dist.commission_rate)}
                {' · '}
                <strong>Basis:</strong> {typeConfig.label}
              </div>
            )}
            <form onSubmit={handleAddSalesRepToDistributor}>
              <div className="space-y-4">
                <Field label="Sales Representative *">
                  {!showCreateSalesRepUser ? (
                    <div className="flex gap-2">
                      <select
                        required
                        value={newDistributorSalesRep.sales_rep_id}
                        onChange={(e) =>
                          setNewDistributorSalesRep({ ...newDistributorSalesRep, sales_rep_id: e.target.value })
                        }
                        className={`${selectCls} flex-1`}
                      >
                        <option value="">Select a sales rep</option>
                        {salesReps
                          .filter(
                            (rep) =>
                              !getDistributorSalesReps(selectedDistributor).find(
                                (dsr) => dsr.sales_rep_id === rep.id,
                              ),
                          )
                          .map((rep) => (
                            <option key={rep.id} value={rep.id}>{rep.email}</option>
                          ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setShowCreateSalesRepUser(true)}
                        className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg whitespace-nowrap"
                      >
                        <UserPlus className="h-4 w-4" />
                        New User
                      </button>
                    </div>
                  ) : (
                    <div className="border border-purple-200 bg-purple-50 rounded-lg p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-purple-700">Create New Sales Rep</span>
                        <button
                          type="button"
                          onClick={() => { setShowCreateSalesRepUser(false); setNewSalesRepEmail(''); }}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <input
                        type="email"
                        value={newSalesRepEmail}
                        onChange={(e) => setNewSalesRepEmail(e.target.value)}
                        className={inputCls}
                        placeholder="Email address"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleCreateSalesRepUser}
                          disabled={isCreatingSalesRepUser}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50"
                        >
                          {isCreatingSalesRepUser ? 'Creating...' : 'Create & Select'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowCreateSalesRepUser(false); setNewSalesRepEmail(''); }}
                          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                        >
                          Cancel
                        </button>
                      </div>
                      <p className="text-xs text-gray-500">
                        An invite email will be sent so the user can set their own password.
                      </p>
                    </div>
                  )}
                </Field>

                <Field label="Commission Split Type *">
                  <select
                    required
                    value={newDistributorSalesRep.commission_split_type}
                    onChange={(e) =>
                      setNewDistributorSalesRep({
                        ...newDistributorSalesRep,
                        commission_split_type: e.target.value as 'percentage_of_distributor' | 'fixed_with_override',
                      })
                    }
                    className={selectCls}
                  >
                    <option value="percentage_of_distributor">% of Distributor Commission</option>
                    <option value="fixed_with_override">Fixed Rate with Distributor Override</option>
                  </select>
                  <p className="text-xs text-gray-400 mt-1">
                    {newDistributorSalesRep.commission_split_type === 'percentage_of_distributor'
                      ? "Sales rep receives a percentage of the distributor's earned commission amount"
                      : "Sales rep earns their own fixed rate; distributor earns an additional override rate"}
                  </p>
                </Field>

                <Field
                  label={
                    newDistributorSalesRep.commission_split_type === 'percentage_of_distributor'
                      ? "Rep's Share of Distributor Commission (%)"
                      : `Rep's Fixed ${typeConfig.rateLabel} (${typeConfig.rateUnit}) *`
                  }
                >
                  <input
                    type="number"
                    required
                    min="0"
                    max={
                      newDistributorSalesRep.commission_split_type === 'percentage_of_distributor' || !typeConfig.isFlat
                        ? 100
                        : undefined
                    }
                    step="0.01"
                    value={newDistributorSalesRep.sales_rep_rate}
                    onChange={(e) =>
                      setNewDistributorSalesRep({
                        ...newDistributorSalesRep,
                        sales_rep_rate: parseFloat(e.target.value),
                      })
                    }
                    className={inputCls}
                  />
                  {newDistributorSalesRep.commission_split_type === 'percentage_of_distributor' && dist && (
                    <p className="text-xs text-gray-400 mt-1">
                      At {newDistributorSalesRep.sales_rep_rate}%: rep gets{' '}
                      {typeConfig.isFlat
                        ? `$${((dist.commission_rate * newDistributorSalesRep.sales_rep_rate) / 100).toFixed(2)}`
                        : `${((dist.commission_rate * newDistributorSalesRep.sales_rep_rate) / 100).toFixed(2)}%`}
                      {' '}of {typeConfig.label.toLowerCase()}
                    </p>
                  )}
                </Field>

                {newDistributorSalesRep.commission_split_type === 'fixed_with_override' && (
                  <Field label={`Distributor Override ${typeConfig.rateLabel} (${typeConfig.rateUnit})`}>
                    <input
                      type="number"
                      required
                      min="0"
                      max={typeConfig.isFlat ? undefined : 100}
                      step="0.01"
                      value={newDistributorSalesRep.distributor_override_rate}
                      onChange={(e) =>
                        setNewDistributorSalesRep({
                          ...newDistributorSalesRep,
                          distributor_override_rate: parseFloat(e.target.value),
                        })
                      }
                      className={inputCls}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Additional commission the distributor earns on top of the rep's rate
                    </p>
                  </Field>
                )}

                <Field label="Notes">
                  <textarea
                    value={newDistributorSalesRep.notes}
                    onChange={(e) =>
                      setNewDistributorSalesRep({ ...newDistributorSalesRep, notes: e.target.value })
                    }
                    className={inputCls}
                    rows={2}
                    placeholder="Optional notes..."
                  />
                </Field>
              </div>

              <div className="mt-6 flex gap-3 justify-end border-t border-gray-100 pt-4">
                <button
                  type="button"
                  onClick={() => { setShowAddSalesRep(false); setShowCreateSalesRepUser(false); setNewSalesRepEmail(''); }}
                  className={cancelBtnCls}
                >
                  Cancel
                </button>
                <button type="submit" className={primaryBtnCls}>
                  Add Sales Rep
                </button>
              </div>
            </form>
          </Modal>
        );
      })()}

      {showPricingImport && (
        <DistributorPricingImport
          isOpen={true}
          onClose={() => setShowPricingImport(null)}
          onImportComplete={() => fetchData()}
          distributorId={showPricingImport.distributorId}
          distributorName={showPricingImport.distributorName}
          products={products}
          existingPricing={distributorProductPricing
            .filter((p) => p.distributor_id === showPricingImport.distributorId)
            .map((p) => ({
              id: p.id,
              product_id: p.product_id,
              wholesale_price: p.wholesale_price,
              notes: p.notes ?? null,
            }))
          }
        />
      )}

      <ConfirmDeleteModal
        isOpen={showDeleteModal}
        title="Delete Distributor"
        entityName={deleteTargetDistributor?.name || ''}
        cascadeWarnings={[
          'Sales rep relationships will be marked as orphaned',
          'Commission rules will be marked as orphaned',
          'Wholesale pricing records will be marked as orphaned',
        ]}
        onConfirm={confirmDeleteDistributor}
        onCancel={() => { setShowDeleteModal(false); setDeleteTargetDistributor(null); }}
        isProcessing={isDeleting}
      />
      </>
    );
  }
};

// ── Sub-components ────────────────────────────────────────────────────────────

interface EditDistributorFormProps {
  distributor: Distributor;
  onChange: (d: Distributor) => void;
  onSave: () => void;
  onCancel: () => void;
  salesReps: SalesRep[];
}

const EditDistributorForm: React.FC<EditDistributorFormProps> = ({
  distributor, onChange, onSave, onCancel, salesReps,
}) => {
  const typeConfig = getCommissionTypeConfig(distributor.commission_type);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name">
          <input
            type="text"
            value={distributor.name}
            onChange={(e) => onChange({ ...distributor, name: e.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label="Code">
          <input
            type="text"
            value={distributor.code}
            onChange={(e) => onChange({ ...distributor, code: e.target.value })}
            className={inputCls}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Contact Name">
          <input
            type="text"
            value={distributor.contact_name ?? ''}
            onChange={(e) => onChange({ ...distributor, contact_name: e.target.value })}
            className={inputCls}
            placeholder="Primary contact"
          />
        </Field>
        <Field label="Phone">
          <input
            type="tel"
            value={distributor.phone ?? ''}
            onChange={(e) => onChange({ ...distributor, phone: e.target.value })}
            className={inputCls}
            placeholder="(555) 555-1234"
          />
        </Field>
      </div>

      <Field label="Address">
        <input
          type="text"
          value={distributor.address ?? ''}
          onChange={(e) => onChange({ ...distributor, address: e.target.value })}
          className={inputCls}
          placeholder="Street address"
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="City">
          <input
            type="text"
            value={distributor.city ?? ''}
            onChange={(e) => onChange({ ...distributor, city: e.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label="State">
          <input
            type="text"
            value={distributor.state ?? ''}
            onChange={(e) => onChange({ ...distributor, state: e.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label="ZIP">
          <input
            type="text"
            value={distributor.zip ?? ''}
            onChange={(e) => onChange({ ...distributor, zip: e.target.value })}
            className={inputCls}
          />
        </Field>
      </div>

      <Field label="Pricing Model">
        <div className="flex gap-3">
          <label className={`flex-1 flex items-center gap-2 p-2.5 border rounded-lg cursor-pointer text-sm transition-colors ${
            distributor.pricing_model === 'margin_split'
              ? 'border-pink-500 bg-pink-50 text-pink-700'
              : 'border-gray-200 hover:bg-gray-50'
          }`}>
            <input
              type="radio"
              name={`edit_pricing_model_${distributor.id}`}
              value="margin_split"
              checked={distributor.pricing_model === 'margin_split'}
              onChange={() => onChange({ ...distributor, pricing_model: 'margin_split' })}
              className="text-pink-600 focus:ring-pink-500"
            />
            Margin Split
          </label>
          <label className={`flex-1 flex items-center gap-2 p-2.5 border rounded-lg cursor-pointer text-sm transition-colors ${
            distributor.pricing_model === 'wholesale'
              ? 'border-pink-500 bg-pink-50 text-pink-700'
              : 'border-gray-200 hover:bg-gray-50'
          }`}>
            <input
              type="radio"
              name={`edit_pricing_model_${distributor.id}`}
              value="wholesale"
              checked={distributor.pricing_model === 'wholesale'}
              onChange={() => onChange({ ...distributor, pricing_model: 'wholesale' })}
              className="text-pink-600 focus:ring-pink-500"
            />
            Wholesale
          </label>
        </div>
      </Field>

      {distributor.pricing_model === 'margin_split' && (
      <div className="grid grid-cols-2 gap-4">
        <Field label="Commission Basis">
          <select
            value={distributor.commission_type}
            onChange={(e) => onChange({ ...distributor, commission_type: e.target.value as CommissionType })}
            className={selectCls}
          >
            {COMMISSION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>
        <Field label={`${typeConfig.rateLabel} (${typeConfig.rateUnit})`}>
          <input
            type="number"
            min="0"
            max={typeConfig.isFlat ? undefined : 100}
            step="0.01"
            value={distributor.commission_rate}
            onChange={(e) => onChange({ ...distributor, commission_rate: parseFloat(e.target.value) })}
            className={inputCls}
          />
        </Field>
      </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Status">
          <select
            value={distributor.is_active ? 'active' : 'inactive'}
            onChange={(e) => onChange({ ...distributor, is_active: e.target.value === 'active' })}
            className={selectCls}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
        <Field label="Notes">
          <input
            type="text"
            value={distributor.notes ?? ''}
            onChange={(e) => onChange({ ...distributor, notes: e.target.value })}
            className={inputCls}
          />
        </Field>
      </div>

      {distributor.pricing_model === 'margin_split' && (
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`edit_use_cust_price_${distributor.id}`}
          checked={distributor.use_customer_price ?? false}
          onChange={(e) => onChange({ ...distributor, use_customer_price: e.target.checked })}
          className="rounded border-gray-300 text-pink-600 focus:ring-pink-500"
        />
        <label htmlFor={`edit_use_cust_price_${distributor.id}`} className="text-sm text-gray-700">
          Default: use customer's actual price for margin calculation
        </label>
      </div>
      )}

      {/* Company Rep — your sales person who oversees this distributor */}
      <div className="border border-gray-200 rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-semibold text-gray-700">Company Rep (Your Sales Person)</h4>
        <p className="text-xs text-gray-400">
          Assign one of your reps to oversee this distributor. They earn a % of your margin on every order.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Company Rep">
            <select
              value={distributor.company_rep_id ?? ''}
              onChange={(e) => onChange({ ...distributor, company_rep_id: e.target.value || null })}
              className={selectCls}
            >
              <option value="">None</option>
              {salesReps.map((rep) => (
                <option key={rep.id} value={rep.id}>{rep.email}</option>
              ))}
            </select>
          </Field>
          <Field label="% of Your Margin">
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={distributor.company_rep_rate ?? 0}
              onChange={(e) => onChange({ ...distributor, company_rep_rate: parseFloat(e.target.value) || 0 })}
              className={inputCls}
              disabled={!distributor.company_rep_id}
            />
          </Field>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button onClick={onSave} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
          <Save className="h-4 w-4" /> Save
        </button>
        <button onClick={onCancel} className={cancelBtnCls}>Cancel</button>
      </div>
    </div>
  );
};

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title, onClose, children,
}) => (
  <div className="fixed inset-0 z-50 overflow-y-auto" onClick={e => e.stopPropagation()}>
    <div className="flex items-center justify-center min-h-screen px-4 py-8">
      <div className="fixed inset-0 bg-black/50" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg">
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

// Shared Tailwind class strings
const inputCls =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-pink-500 focus:border-transparent';
const selectCls = inputCls;
const primaryBtnCls =
  'px-4 py-2 bg-gradient-to-r from-pink-500 to-orange-500 text-white rounded-lg hover:shadow-lg text-sm font-medium transition-all';
const cancelBtnCls =
  'px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors';

export default DistributorManagement;
