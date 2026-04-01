import React, { useState, useEffect } from 'react';
import { Building2, Plus, Pencil, Trash2, Search, MapPin, Users, Mail, Phone, AlertCircle, CheckCircle, Eye, Archive, ArrowLeft, Settings, DollarSign, Save, RotateCcw, UserCheck, Home, ArrowRightLeft } from 'lucide-react';
import { multiTenantService } from '@/services/multiTenant';
import { supabase } from '@/services/supabase';
import { ENV } from '@/config/env';
import { softDeleteService } from '@/services/softDeleteService';
import { useAuth } from '@/contexts/AuthContext';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import AddressManagement from './AddressManagement';
import PricingManagement from './PricingManagement';
import CustomerUserManagement from './CustomerUserManagement';
import { convertOrgToDistributor, fetchDistributorCodes, fetchOrgMembers } from '@/services/customerConversionService';
import { activityLogService } from '@/services/activityLog';
import type { Organization } from '@/services/supabase';

type SubManagementTab = 'addresses' | 'pricing' | 'users';

interface SalesRep {
  id: string;
  email: string;
  role: string;
}

const OrganizationManagement: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [showDeleteOrgModal, setShowDeleteOrgModal] = useState(false);
  const [deleteTargetOrg, setDeleteTargetOrg] = useState<Organization | null>(null);
  const [isDeletingOrg, setIsDeletingOrg] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [modalMessage, setModalMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [orgStats, setOrgStats] = useState<{ [key: string]: { addresses: number; users: number } }>({});
  const [selectedOrgForSubManagement, setSelectedOrgForSubManagement] = useState<Organization | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<SubManagementTab>('addresses');
  const [pendingChanges, setPendingChanges] = useState<{ [key: string]: Partial<Organization> }>({});
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [createContactUser, setCreateContactUser] = useState(true);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  // Convert to distributor state
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertOrg, setConvertOrg] = useState<Organization | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [convertDistName, setConvertDistName] = useState('');
  const [convertDistCode, setConvertDistCode] = useState('');
  const [convertCodeManual, setConvertCodeManual] = useState(false);
  const [convertCommissionType, setConvertCommissionType] = useState('percent_margin');
  const [convertPricingModel, setConvertPricingModel] = useState('margin_split');
  const [convertCommissionRate, setConvertCommissionRate] = useState('');
  const [convertOwnerProfileId, setConvertOwnerProfileId] = useState('');
  const [convertOrgMembers, setConvertOrgMembers] = useState<{ userId: string; orgRole: string; email: string; fullName: string }[]>([]);
  const [existingDistCodes, setExistingDistCodes] = useState<string[]>([]);
  const [convertMessage, setConvertMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchOrganizations();
    fetchOrgStats();
    fetchSalesReps();
  }, []);

  const fetchOrganizations = async () => {
    try {
      setLoading(true);
      const data = await multiTenantService.getOrganizations();
      setOrganizations(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch organizations');
    } finally {
      setLoading(false);
    }
  };

  const fetchOrgStats = async () => {
    try {
      const userRoles = await multiTenantService.getUserOrganizationRoles();

      const stats: { [key: string]: { addresses: number; users: number } } = {};

      // Count users per organization
      userRoles.forEach(role => {
        if (!stats[role.organization_id]) {
          stats[role.organization_id] = { addresses: 0, users: 0 };
        }
        stats[role.organization_id].users++;
      });

      // Count addresses per organization
      const orgs = Object.keys(stats);
      for (const orgId of orgs) {
        try {
          const addresses = await multiTenantService.getOrganizationAddresses(orgId);
          stats[orgId].addresses = addresses.length;
        } catch {
          // Ignore errors for individual org address counts
        }
      }

      setOrgStats(stats);
    } catch (err) {
      console.error('Failed to fetch organization stats:', err);
    }
  };

  const fetchSalesReps = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, role')
        .in('role', ['sales_rep', 'distributor'])
        .order('email');

      if (error) throw error;
      setSalesReps(data || []);
    } catch (err) {
      console.error('Failed to fetch sales reps:', err);
    }
  };

  // ── Convert to Distributor ─────────────────────────────────────────────
  const generateDistCode = (name: string, codes: string[]): string => {
    if (!name.trim()) return '';
    const words = name.trim().split(/\s+/).filter(Boolean);
    let base: string;
    if (words.length >= 2) {
      base = words.map((w) => w[0]).join('').slice(0, 4).toUpperCase();
    } else {
      base = words[0].replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase();
    }
    if (!base) return '';
    const codesSet = new Set(codes.map((c) => c.toUpperCase()));
    if (!codesSet.has(base)) return base;
    let i = 2;
    while (codesSet.has(`${base}${i}`)) i++;
    return `${base}${i}`;
  };

  const openConvertModal = async (org: Organization) => {
    setConvertOrg(org);
    setConvertDistName(org.name || '');
    setConvertCodeManual(false);
    setConvertCommissionType('percent_margin');
    setConvertPricingModel('margin_split');
    setConvertCommissionRate('');
    setConvertOwnerProfileId('');
    setConvertMessage(null);
    setShowConvertModal(true);

    const [codes, members] = await Promise.all([
      fetchDistributorCodes(),
      fetchOrgMembers(org.id!),
    ]);
    setExistingDistCodes(codes);
    setConvertDistCode(generateDistCode(org.name || '', codes));
    setConvertOrgMembers(members);
    // Auto-select the org admin if there is one
    const admin = members.find((m) => m.orgRole === 'admin');
    if (admin) setConvertOwnerProfileId(admin.userId);
    else if (members.length === 1) setConvertOwnerProfileId(members[0].userId);
  };

  const handleConvertToDistributor = async () => {
    if (!convertOrg?.id) return;
    if (!convertDistName.trim()) {
      setConvertMessage({ type: 'error', text: 'Distributor name is required.' });
      return;
    }
    if (!convertDistCode.trim()) {
      setConvertMessage({ type: 'error', text: 'Distributor code is required.' });
      return;
    }

    try {
      setIsConverting(true);
      setConvertMessage(null);

      const result = await convertOrgToDistributor({
        organizationId: convertOrg.id,
        distributorName: convertDistName.trim(),
        distributorCode: convertDistCode.trim().toUpperCase(),
        ownerProfileId: convertOwnerProfileId || null,
        commissionType: convertCommissionType,
        pricingModel: convertPricingModel,
        commissionRate: convertCommissionRate ? Number(convertCommissionRate) : null,
        contactName: convertOrg.contact_name || null,
        phone: convertOrg.contact_phone || null,
        address: (convertOrg as any).address || null,
        city: (convertOrg as any).city || null,
        state: (convertOrg as any).state || null,
        zip: (convertOrg as any).zip || null,
      });

      if (!result.success) {
        setConvertMessage({ type: 'error', text: result.error || 'Conversion failed.' });
        return;
      }

      if (currentUser) {
        activityLogService.logAction({
          userId: currentUser.id,
          action: 'organization_converted_to_distributor',
          resourceType: 'organization',
          resourceId: convertOrg.id,
          details: {
            org_name: convertOrg.name,
            distributor_id: result.distributorId,
            owner_profile_id: result.ownerProfileId,
          },
        });
      }

      setConvertMessage({ type: 'success', text: `"${convertOrg.name}" has been converted to a distributor.` });
      fetchOrganizations();
      fetchOrgStats();

      setTimeout(() => {
        setShowConvertModal(false);
        setConvertOrg(null);
        setConvertMessage(null);
      }, 2000);
    } catch (err) {
      setConvertMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Conversion failed.',
      });
    } finally {
      setIsConverting(false);
    }
  };

  const handleCreateOrganization = () => {
    setSelectedOrg({
      name: '',
      code: generateOrgCode(''),
      contact_name: '',
      description: '',
      billing_address: null,
      contact_email: '',
      contact_phone: '',
      address: '',
      city: '',
      state: '',
      zip: '',
      org_type: 'customer',
      is_active: true,
      created_at: '',
      updated_at: ''
    });
    setIsEditing(false);
    setCreateContactUser(true);
    setIsModalOpen(true);
  };

  const generateOrgCode = (name: string) => {
    if (!name.trim()) return '';
    
    // Take first 3 letters of each word, uppercase
    const words = name.trim().split(/\s+/);
    let code = '';
    
    if (words.length === 1) {
      // Single word: take first 3-6 characters
      code = words[0].substring(0, Math.min(6, words[0].length)).toUpperCase();
    } else {
      // Multiple words: take first 2-3 characters from each word
      code = words
        .slice(0, 3) // Max 3 words
        .map(word => word.substring(0, word.length >= 4 ? 3 : 2))
        .join('')
        .toUpperCase();
    }
    
    // Ensure minimum length of 3
    if (code.length < 3) {
      code = code.padEnd(3, 'X');
    }
    
    // Check if code already exists and add number suffix if needed
    const existingCodes = organizations.map(org => org.code.toUpperCase());
    let finalCode = code;
    let counter = 1;
    
    while (existingCodes.includes(finalCode)) {
      finalCode = code + counter.toString().padStart(2, '0');
      counter++;
    }
    
    return finalCode;
  };
  const handleEditOrganization = (org: Organization) => {
    setSelectedOrg(org);
    setIsEditing(true);
    setIsModalOpen(true);
  };

  const handleViewOrganization = (org: Organization) => {
    setSelectedOrg(org);
    setIsViewModalOpen(true);
  };

  const handleSaveOrganization = async () => {
    if (!selectedOrg) return;

    try {
      setModalMessage(null);
      
      if (isEditing) {
        await multiTenantService.updateOrganization(selectedOrg.id, selectedOrg);
        setOrganizations(prev => prev.map(org => 
          org.id === selectedOrg.id ? selectedOrg : org
        ));
        setModalMessage({ type: 'success', text: 'Customer updated successfully!' });
      } else {
        // Remove id, created_at, and updated_at properties to let Supabase auto-generate them
        const { id, created_at, updated_at, ...orgData } = selectedOrg;
        const newOrg = await multiTenantService.createOrganization(orgData);
        setOrganizations(prev => [newOrg, ...prev]);

        // Auto-create user account for the contact if email provided and checkbox is checked
        if (createContactUser && selectedOrg.contact_email?.trim()) {
          try {
            setIsCreatingUser(true);
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
              const response = await fetch(
                `${ENV.SUPABASE_URL}/functions/v1/create-admin-user`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    email: selectedOrg.contact_email.trim(),
                    role: 'customer',
                    fullName: selectedOrg.contact_name || undefined,
                    phone: selectedOrg.contact_phone || undefined,
                    organizationId: newOrg.id,
                    orgRole: 'admin',
                    isHouseAccount: (selectedOrg as any).is_house_account || false,
                    salesRepId: (selectedOrg as any).default_sales_rep_id || undefined,
                    siteUrl: window.location.origin,
                  }),
                }
              );
              const result = await response.json();
              if (result.success) {
                const reactivatedNote = result.reactivated ? ' (reactivated existing account)' : '';
                const inviteNote = result.inviteEmailSent ? ' An invite email has been sent.' : '';
                setModalMessage({ type: 'success', text: `Customer created and user account set up for ${selectedOrg.contact_email}!${reactivatedNote}${inviteNote}` });
              } else {
                setModalMessage({ type: 'success', text: `Customer created, but user account creation failed: ${result.error}. You can create the user manually from User Management.` });
              }
            }
          } catch (userErr) {
            console.error('Auto-create user failed:', userErr);
            setModalMessage({ type: 'success', text: 'Customer created, but user account creation failed. You can create the user manually from User Management.' });
          } finally {
            setIsCreatingUser(false);
          }
        } else {
          setModalMessage({ type: 'success', text: 'Customer created successfully!' });
        }
      }
      
      // Refresh stats
      fetchOrgStats();
      
      // Auto-close modal after success
      setTimeout(() => {
        setIsModalOpen(false);
        setSelectedOrg(null);
        setModalMessage(null);
      }, 2000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save organization';
      setModalMessage({ type: 'error', text: errorMessage });
    }
  };

  const handleArchiveOrganization = async (orgId: string, isActive: boolean) => {
    const action = isActive ? 'archive' : 'restore';
    if (!confirm(`Are you sure you want to ${action} this customer?`)) {
      return;
    }

    try {
      await multiTenantService.updateOrganization(orgId, { is_active: !isActive });
      setOrganizations(prev => prev.map(org => 
        org.id === orgId ? { ...org, is_active: !isActive } : org
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} organization`);
    }
  };

  const handleDeleteOrganization = (org: Organization) => {
    setDeleteTargetOrg(org);
    setShowDeleteOrgModal(true);
  };

  const confirmDeleteOrganization = async () => {
    if (!deleteTargetOrg || !currentUser) return;
    setIsDeletingOrg(true);
    try {
      const result = await softDeleteService.deleteOrganization(deleteTargetOrg.id, currentUser.id);
      if (!result.success) {
        setError(result.error || 'Failed to delete organization');
        return;
      }
      setOrganizations(prev => prev.filter(o => o.id !== deleteTargetOrg.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete organization');
    } finally {
      setIsDeletingOrg(false);
      setShowDeleteOrgModal(false);
      setDeleteTargetOrg(null);
    }
  };

  const handleBulkSave = async () => {
    try {
      setIsSaving(true);
      setSaveMessage(null);
      
      const updatePromises = Object.entries(pendingChanges).map(async ([orgId, changes]) => {
        await multiTenantService.updateOrganization(orgId, changes);
        
        // Update local state
        setOrganizations(prev => prev.map(org => 
          org.id === orgId ? { ...org, ...changes } : org
        ));
      });
      
      await Promise.all(updatePromises);
      
      setPendingChanges({});
      setSaveMessage({ type: 'success', text: 'All changes saved successfully!' });
      
      setTimeout(() => {
        setSaveMessage(null);
      }, 3000);
    } catch (err) {
      setSaveMessage({ 
        type: 'error', 
        text: err instanceof Error ? err.message : 'Failed to save changes' 
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscardChanges = () => {
    setPendingChanges({});
    setSaveMessage({ type: 'success', text: 'Changes discarded successfully!' });
    
    setTimeout(() => {
      setSaveMessage(null);
    }, 2000);
  };

  const hasPendingChanges = Object.keys(pendingChanges).length > 0;

  const filteredOrganizations = organizations.filter(org => {
    const matchesSearch = 
      org.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      org.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (org.description && org.description.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesStatus = 
      statusFilter === 'all' || 
      (statusFilter === 'active' && org.is_active) ||
      (statusFilter === 'inactive' && !org.is_active);
    
    return matchesSearch && matchesStatus;
  });

  // If we're in sub-management mode, render that instead
  if (selectedOrgForSubManagement) {
    const subTabs = [
      { id: 'addresses' as SubManagementTab, label: 'Addresses', icon: MapPin },
      { id: 'pricing' as SubManagementTab, label: 'Contract Pricing', icon: DollarSign },
      { id: 'users' as SubManagementTab, label: 'Users', icon: Users },
    ];

    return (
      <div className="p-6">
        {/* Sub-management header */}
        <div className="mb-6">
          <div className="flex items-center space-x-4 mb-4">
            <button
              onClick={() => {
                setSelectedOrgForSubManagement(null);
                setActiveSubTab('addresses');
              }}
              className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
              <span>Back to Customers</span>
            </button>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="p-3 bg-purple-100 rounded-lg">
              <Building2 className="h-8 w-8 text-purple-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{selectedOrgForSubManagement.name}</h2>
              <p className="text-gray-600">Code: {selectedOrgForSubManagement.code}</p>
              <p className="text-gray-600">Manage addresses and pricing for this customer</p>
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
                      ? 'border-purple-500 text-purple-600'
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
          {activeSubTab === 'addresses' && (
            <AddressManagement organizationId={selectedOrgForSubManagement.id} />
          )}
          {activeSubTab === 'pricing' && (
            <PricingManagement organizationId={selectedOrgForSubManagement.id} />
          )}
          {activeSubTab === 'users' && (
            <CustomerUserManagement organizationId={selectedOrgForSubManagement.id} />
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 bg-gray-200 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Customer Management</h2>
          <p className="text-gray-600">Manage customers and their settings</p>
        </div>
        <button
          onClick={handleCreateOrganization}
          className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors flex items-center space-x-2"
        >
          <Plus className="h-5 w-5" />
          <span>Add Customer</span>
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Save Message */}
      {saveMessage && (
        <div className={`mb-4 p-4 rounded-lg flex items-center space-x-2 ${
          saveMessage.type === 'success' 
            ? 'bg-green-50 border border-green-200' 
            : 'bg-red-50 border border-red-200'
        }`}>
          {saveMessage.type === 'success' ? (
            <CheckCircle className="h-5 w-5 text-green-600" />
          ) : (
            <AlertCircle className="h-5 w-5 text-red-600" />
          )}
          <span className={`text-sm ${
            saveMessage.type === 'success' ? 'text-green-700' : 'text-red-700'
          }`}>
            {saveMessage.text}
          </span>
        </div>
      )}

      {/* Save/Discard Actions */}
      {hasPendingChanges && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-5 w-5 text-yellow-600" />
              <span className="text-sm font-medium text-yellow-800">
                You have unsaved changes ({Object.keys(pendingChanges).length} customer{Object.keys(pendingChanges).length !== 1 ? 's' : ''})
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleDiscardChanges}
                disabled={isSaving}
                className="flex items-center space-x-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Discard Changes</span>
              </button>
              <button
                onClick={handleBulkSave}
                disabled={isSaving}
                className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 border border-transparent rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span>{isSaving ? 'Saving...' : 'Save All Changes'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search customers by name, code, or description..."
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
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <Building2 className="h-8 w-8 text-purple-600" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Total Customers</p>
              <p className="text-2xl font-semibold text-gray-900">{organizations.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <CheckCircle className="h-8 w-8 text-green-600" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Active</p>
              <p className="text-2xl font-semibold text-gray-900">
                {organizations.filter(org => org.is_active).length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <Archive className="h-8 w-8 text-gray-600" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Inactive</p>
              <p className="text-2xl font-semibold text-gray-900">
                {organizations.filter(org => !org.is_active).length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <MapPin className="h-8 w-8 text-blue-600" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Total Addresses</p>
              <p className="text-2xl font-semibold text-gray-900">
                {Object.values(orgStats).reduce((sum, stat) => sum + stat.addresses, 0)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Organizations List */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Customer
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Contact
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Stats
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredOrganizations.map((org) => (
                <tr key={org.id} className={org.is_active ? 'hover:bg-gray-50' : 'bg-gray-50'}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleViewOrganization(org)}
                        className="p-2 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                        title="View Details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleEditOrganization(org)}
                        className="p-2 text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
                        title="Edit Customer"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setSelectedOrgForSubManagement(org)}
                        className="p-2 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
                        title="Manage Addresses & Pricing"
                      >
                        <Settings className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleArchiveOrganization(org.id, org.is_active)}
                        className={`p-2 rounded-lg transition-colors ${
                          org.is_active
                            ? 'text-orange-600 bg-orange-50 hover:bg-orange-100'
                            : 'text-green-600 bg-green-50 hover:bg-green-100'
                        }`}
                        title={org.is_active ? 'Archive Customer' : 'Restore Customer'}
                      >
                        <Archive className="h-4 w-4" />
                      </button>
                      {(!org.org_type || org.org_type === 'customer') && (
                        <button
                          onClick={() => openConvertModal(org)}
                          className="p-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                          title="Convert to Distributor"
                        >
                          <ArrowRightLeft className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteOrganization(org)}
                        className="p-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                        title="Delete Customer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <div className={`p-2 rounded-lg ${
                        org.is_active ? 'bg-purple-100' : 'bg-gray-200'
                      }`}>
                        <Building2 className={`h-5 w-5 ${
                          org.is_active ? 'text-purple-600' : 'text-gray-500'
                        }`} />
                      </div>
                      <div className="ml-3">
                        <div className={`text-sm font-semibold ${
                          org.is_active ? 'text-gray-900' : 'text-gray-600'
                        }`}>
                          {org.name}
                        </div>
                        <div className="text-sm text-gray-500">
                          Code: {org.code}
                        </div>
                        {org.description && (
                          <div className="text-xs text-gray-500 mt-1 max-w-xs truncate">
                            {org.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      {org.contact_name && (
                        <div className="text-sm font-medium text-gray-900">{org.contact_name}</div>
                      )}
                      {org.contact_email && (
                        <div className="flex items-center space-x-2 text-sm text-gray-600">
                          <Mail className="h-3 w-3 text-gray-400" />
                          <span className="truncate max-w-xs">{org.contact_email}</span>
                        </div>
                      )}
                      {org.contact_phone && (
                        <div className="flex items-center space-x-2 text-sm text-gray-600">
                          <Phone className="h-3 w-3 text-gray-400" />
                          <span>{org.contact_phone}</span>
                        </div>
                      )}
                      {(org.city || org.state) && (
                        <div className="flex items-center space-x-2 text-sm text-gray-500">
                          <MapPin className="h-3 w-3 text-gray-400" />
                          <span>{[org.city, org.state].filter(Boolean).join(', ')}</span>
                        </div>
                      )}
                      {!org.contact_name && !org.contact_email && !org.contact_phone && (
                        <span className="text-sm text-gray-400">No contact info</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-1">
                        <MapPin className="h-4 w-4 text-blue-600" />
                        <span className="text-sm font-medium text-gray-900">
                          {orgStats[org.id]?.addresses || 0}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Users className="h-4 w-4 text-green-600" />
                        <span className="text-sm font-medium text-gray-900">
                          {orgStats[org.id]?.users || 0}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex flex-col space-y-1">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                        org.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {org.is_active ? 'Active' : 'Inactive'}
                      </span>
                      {(org as any).org_type === 'distributor' && (
                        <span className="inline-flex px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                          Distributor
                        </span>
                      )}
                      {(org as any).is_house_account && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          <Home className="h-3 w-3 mr-1" />
                          House
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filteredOrganizations.length === 0 && (
        <div className="text-center py-12">
          <Building2 className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No customers found</h3>
          <p className="mt-1 text-sm text-gray-500">
            {searchTerm 
              ? 'Try adjusting your search criteria.'
              : 'Get started by creating your first customer.'
            }
          </p>
        </div>
      )}

      {/* Organization Modal */}
      {isModalOpen && selectedOrg && (
        <div className="fixed inset-0 z-50 overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>
            
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                      {isEditing ? 'Edit Customer' : 'Create Customer'}
                    </h3>

                    {/* Modal Message */}
                    {modalMessage && (
                      <div className={`mb-4 p-3 rounded-lg flex items-center space-x-2 ${
                        modalMessage.type === 'success' 
                          ? 'bg-green-50 border border-green-200' 
                          : 'bg-red-50 border border-red-200'
                      }`}>
                        {modalMessage.type === 'success' ? (
                          <CheckCircle className="h-5 w-5 text-green-600" />
                        ) : (
                          <AlertCircle className="h-5 w-5 text-red-600" />
                        )}
                        <span className={`text-sm ${
                          modalMessage.type === 'success' ? 'text-green-700' : 'text-red-700'
                        }`}>
                          {modalMessage.text}
                        </span>
                      </div>
                    )}
                    
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Customer Name *
                        </label>
                        <input
                          type="text"
                          value={selectedOrg.name}
                          onChange={(e) => {
                            const newName = e.target.value;
                            setSelectedOrg({
                              ...selectedOrg, 
                              name: newName,
                              code: isEditing ? selectedOrg.code : generateOrgCode(newName)
                            });
                          }}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          placeholder="Enter customer name"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Customer Code * {!isEditing && <span className="text-xs text-gray-500">(Auto-generated)</span>}
                        </label>
                        <input
                          type="text"
                          value={selectedOrg.code}
                          onChange={(e) => setSelectedOrg({...selectedOrg, code: e.target.value.toUpperCase()})}
                          readOnly={!isEditing}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          placeholder="ORG001"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          {isEditing 
                            ? 'You can modify the code when editing existing customers'
                            : 'Code is automatically generated from the customer name'
                          }
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Customer Type *
                        </label>
                        <select
                          value={selectedOrg.org_type || 'customer'}
                          onChange={(e) => setSelectedOrg({...selectedOrg, org_type: e.target.value as 'customer' | 'distributor'})}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        >
                          <option value="customer">Customer</option>
                          <option value="distributor">Distributor</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Contact Name
                        </label>
                        <input
                          type="text"
                          value={selectedOrg.contact_name || ''}
                          onChange={(e) => setSelectedOrg({...selectedOrg, contact_name: e.target.value})}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          placeholder="Primary contact person"
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Contact Email
                          </label>
                          <input
                            type="email"
                            value={selectedOrg.contact_email || ''}
                            onChange={(e) => setSelectedOrg({...selectedOrg, contact_email: e.target.value})}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            placeholder="contact@organization.com"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Contact Phone
                          </label>
                          <input
                            type="tel"
                            value={selectedOrg.contact_phone || ''}
                            onChange={(e) => setSelectedOrg({...selectedOrg, contact_phone: e.target.value})}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            placeholder="(555) 123-4567"
                          />
                        </div>
                      </div>

                      {/* Auto-create user account checkbox (only for new orgs with contact email) */}
                      {!isEditing && selectedOrg.contact_email?.trim() && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                          <label className="flex items-center">
                            <input
                              type="checkbox"
                              checked={createContactUser}
                              onChange={(e) => setCreateContactUser(e.target.checked)}
                              className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                            />
                            <span className="ml-2 text-sm text-gray-700">
                              Create user account for <strong>{selectedOrg.contact_email}</strong>
                            </span>
                          </label>
                          <p className="text-xs text-gray-500 ml-6 mt-1">
                            An invite email will be sent so they can set their password and log in as a customer admin.
                          </p>
                        </div>
                      )}

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Address
                        </label>
                        <input
                          type="text"
                          value={selectedOrg.address || ''}
                          onChange={(e) => setSelectedOrg({...selectedOrg, address: e.target.value})}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          placeholder="Street address"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            City
                          </label>
                          <input
                            type="text"
                            value={selectedOrg.city || ''}
                            onChange={(e) => setSelectedOrg({...selectedOrg, city: e.target.value})}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            placeholder="City"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            State
                          </label>
                          <input
                            type="text"
                            value={selectedOrg.state || ''}
                            onChange={(e) => setSelectedOrg({...selectedOrg, state: e.target.value})}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            placeholder="State"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Zip
                          </label>
                          <input
                            type="text"
                            value={selectedOrg.zip || ''}
                            onChange={(e) => setSelectedOrg({...selectedOrg, zip: e.target.value})}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            placeholder="Zip"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Description
                        </label>
                        <textarea
                          value={selectedOrg.description || ''}
                          onChange={(e) => setSelectedOrg({...selectedOrg, description: e.target.value})}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          rows={2}
                          placeholder="Customer description"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          <span className="flex items-center">
                            <UserCheck className="h-4 w-4 mr-1" />
                            Default Sales Rep
                          </span>
                        </label>
                        <select
                          value={(selectedOrg as any).default_sales_rep_id || ''}
                          onChange={(e) => setSelectedOrg({...selectedOrg, default_sales_rep_id: e.target.value || null} as any)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          disabled={(selectedOrg as any).is_house_account}
                        >
                          <option value="">No Default Sales Rep</option>
                          {salesReps.map(rep => (
                            <option key={rep.id} value={rep.id}>
                              {rep.email}{rep.role === 'distributor' ? ' (Distributor)' : ''}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                          Sales rep assigned to orders from this customer
                        </p>
                      </div>

                      <div className="space-y-3">
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={(selectedOrg as any).is_house_account || false}
                            onChange={(e) => {
                              const isHouseAccount = e.target.checked;
                              setSelectedOrg({
                                ...selectedOrg,
                                is_house_account: isHouseAccount,
                                default_sales_rep_id: isHouseAccount ? null : (selectedOrg as any).default_sales_rep_id
                              } as any);
                            }}
                            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                          />
                          <span className="ml-2 text-sm text-gray-700 flex items-center">
                            <Home className="h-4 w-4 mr-1" />
                            House Account (No Commission)
                          </span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={selectedOrg.is_active}
                            onChange={(e) => setSelectedOrg({...selectedOrg, is_active: e.target.checked})}
                            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                          />
                          <span className="ml-2 text-sm text-gray-700">Active Customer</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={handleSaveOrganization}
                  disabled={!selectedOrg.name || !selectedOrg.code || isCreatingUser}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-purple-600 text-base font-medium text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreatingUser ? 'Creating User...' : isEditing ? 'Update' : 'Create'} Customer
                </button>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View Organization Modal */}
      {isViewModalOpen && selectedOrg && (
        <div className="fixed inset-0 z-50 overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>
            
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-xl leading-6 font-medium text-gray-900">
                        Customer Details
                      </h3>
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                        selectedOrg.is_active 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {selectedOrg.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-500 mb-1">
                            Customer Name
                          </label>
                          <p className="text-lg font-semibold text-gray-900">{selectedOrg.name}</p>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-500 mb-1">
                            Customer Code
                          </label>
                          <p className="text-lg font-mono text-gray-900">{selectedOrg.code}</p>
                        </div>

                        {selectedOrg.contact_name && (
                          <div>
                            <label className="block text-sm font-medium text-gray-500 mb-1">
                              Contact Name
                            </label>
                            <p className="text-gray-900">{selectedOrg.contact_name}</p>
                          </div>
                        )}

                        {selectedOrg.description && (
                          <div>
                            <label className="block text-sm font-medium text-gray-500 mb-1">
                              Description
                            </label>
                            <p className="text-gray-900">{selectedOrg.description}</p>
                          </div>
                        )}
                      </div>

                      <div className="space-y-4">
                        {selectedOrg.contact_email && (
                          <div>
                            <label className="block text-sm font-medium text-gray-500 mb-1">
                              Contact Email
                            </label>
                            <div className="flex items-center space-x-2">
                              <Mail className="h-4 w-4 text-gray-400" />
                              <p className="text-gray-900">{selectedOrg.contact_email}</p>
                            </div>
                          </div>
                        )}

                        {selectedOrg.contact_phone && (
                          <div>
                            <label className="block text-sm font-medium text-gray-500 mb-1">
                              Contact Phone
                            </label>
                            <div className="flex items-center space-x-2">
                              <Phone className="h-4 w-4 text-gray-400" />
                              <p className="text-gray-900">{selectedOrg.contact_phone}</p>
                            </div>
                          </div>
                        )}

                        {(selectedOrg.address || selectedOrg.city || selectedOrg.state || selectedOrg.zip) && (
                          <div>
                            <label className="block text-sm font-medium text-gray-500 mb-1">
                              Address
                            </label>
                            <div className="flex items-start space-x-2">
                              <MapPin className="h-4 w-4 text-gray-400 mt-0.5" />
                              <div>
                                {selectedOrg.address && <p className="text-gray-900">{selectedOrg.address}</p>}
                                {(selectedOrg.city || selectedOrg.state || selectedOrg.zip) && (
                                  <p className="text-gray-900">
                                    {[selectedOrg.city, selectedOrg.state].filter(Boolean).join(', ')}
                                    {selectedOrg.zip ? ` ${selectedOrg.zip}` : ''}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        <div>
                          <label className="block text-sm font-medium text-gray-500 mb-1">
                            Created
                          </label>
                          <p className="text-gray-900">
                            {new Date(selectedOrg.created_at).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    {/* Statistics */}
                    <div className="mt-6 pt-6 border-t border-gray-200">
                      <h4 className="text-lg font-medium text-gray-900 mb-4">Statistics</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gray-50 p-4 rounded-lg text-center">
                          <div className="flex items-center justify-center space-x-2 mb-2">
                            <MapPin className="h-5 w-5 text-blue-600" />
                            <span className="text-2xl font-bold text-gray-900">
                              {orgStats[selectedOrg.id]?.addresses || 0}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600">Addresses</p>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-lg text-center">
                          <div className="flex items-center justify-center space-x-2 mb-2">
                            <Users className="h-5 w-5 text-green-600" />
                            <span className="text-2xl font-bold text-gray-900">
                              {orgStats[selectedOrg.id]?.users || 0}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600">Users</p>
                        </div>
                      </div>
                    </div>
                    
                    {/* Contract Pricing */}
                    <div className="mt-6 pt-6 border-t border-gray-200">
                      <h4 className="text-lg font-medium text-gray-900 mb-4">All Contract Pricing</h4>
                      <div className="bg-gray-50 rounded-lg p-4">
                        <div className="text-center text-gray-500">
                          <DollarSign className="h-8 w-8 mx-auto mb-2" />
                          <p className="text-sm">Contract pricing data will be displayed here</p>
                          <p className="text-xs text-gray-400 mt-1">Feature coming soon</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={() => {
                    setIsViewModalOpen(false);
                    handleEditOrganization(selectedOrg);
                  }}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-purple-600 text-base font-medium text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Edit Customer
                </button>
                <button
                  type="button"
                  onClick={() => setIsViewModalOpen(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDeleteModal
        isOpen={showDeleteOrgModal}
        title="Delete Organization"
        entityName={deleteTargetOrg?.name || ''}
        cascadeWarnings={[
          'Organization pricing records will be marked as orphaned',
          'Sales rep assignments will be marked as orphaned',
        ]}
        onConfirm={confirmDeleteOrganization}
        onCancel={() => { setShowDeleteOrgModal(false); setDeleteTargetOrg(null); }}
        isProcessing={isDeletingOrg}
      />

      {/* Convert to Distributor Modal */}
      {showConvertModal && convertOrg && (
        <div className="fixed inset-0 z-50 overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-indigo-100 sm:mx-0 sm:h-10 sm:w-10">
                    <ArrowRightLeft className="h-6 w-6 text-indigo-600" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900">
                      Convert to Distributor
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Convert <strong>{convertOrg.name}</strong> from a customer organization to a distributor.
                    </p>

                    {convertMessage && (
                      <div className={`mt-3 p-3 rounded-lg flex items-center space-x-2 ${
                        convertMessage.type === 'success'
                          ? 'bg-green-50 border border-green-200'
                          : 'bg-red-50 border border-red-200'
                      }`}>
                        {convertMessage.type === 'success' ? (
                          <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                        ) : (
                          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                        )}
                        <span className={`text-sm ${
                          convertMessage.type === 'success' ? 'text-green-700' : 'text-red-700'
                        }`}>
                          {convertMessage.text}
                        </span>
                      </div>
                    )}

                    <div className="mt-4 space-y-4">
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <p className="text-xs text-amber-800">
                          This will change the organization type to distributor, create a distributor entity,
                          and promote the selected owner's role from customer to distributor.
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Distributor Name *</label>
                        <input
                          type="text"
                          value={convertDistName}
                          onChange={(e) => {
                            setConvertDistName(e.target.value);
                            if (!convertCodeManual) {
                              setConvertDistCode(generateDistCode(e.target.value, existingDistCodes));
                            }
                          }}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          placeholder="Distributor business name"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Distributor Code *</label>
                        <input
                          type="text"
                          value={convertDistCode}
                          onChange={(e) => {
                            setConvertDistCode(e.target.value.toUpperCase());
                            setConvertCodeManual(true);
                          }}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          placeholder="AUTO"
                        />
                        <p className="text-xs text-gray-500 mt-0.5">Auto-generated from name. Edit to override.</p>
                      </div>

                      {convertOrgMembers.length > 0 && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Distributor Owner *
                          </label>
                          <select
                            value={convertOwnerProfileId}
                            onChange={(e) => setConvertOwnerProfileId(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          >
                            <option value="">Auto-select (org admin)</option>
                            {convertOrgMembers.map((m) => (
                              <option key={m.userId} value={m.userId}>
                                {m.fullName || m.email} ({m.orgRole})
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-gray-500 mt-0.5">
                            This user's role will be changed from customer to distributor.
                          </p>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Commission Type</label>
                          <select
                            value={convertCommissionType}
                            onChange={(e) => setConvertCommissionType(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          >
                            <option value="percent_margin">% of Margin</option>
                            <option value="percent_gross_sales">% of Gross Sales</option>
                            <option value="percent_net_sales">% of Net Sales</option>
                            <option value="flat_per_order">Flat per Order</option>
                            <option value="flat_per_unit">Flat per Unit</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Pricing Model</label>
                          <select
                            value={convertPricingModel}
                            onChange={(e) => setConvertPricingModel(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          >
                            <option value="margin_split">Margin Split</option>
                            <option value="wholesale">Wholesale</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Commission Rate {convertCommissionType.startsWith('flat') ? '($)' : '(%)'}
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={convertCommissionRate}
                          onChange={(e) => setConvertCommissionRate(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          placeholder="Leave blank to set later"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={handleConvertToDistributor}
                  disabled={isConverting || !convertDistName.trim() || !convertDistCode.trim()}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConverting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Converting...
                    </>
                  ) : (
                    'Convert to Distributor'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowConvertModal(false); setConvertOrg(null); setConvertMessage(null); }}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrganizationManagement;