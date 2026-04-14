import React, { useState, useEffect } from 'react';
import { User, Mail, Shield, Clock, CheckCircle, Pencil, Trash2, Search, Filter, Key, AlertCircle, Save, RotateCcw, Plus, XCircle, Eye, Building2, FileText, Info, Send } from 'lucide-react';
import { supabase } from '@/services/supabase';
import type { Profile } from '@/services/supabase';
import { ENV } from '@/config/env';
import { useAuth } from '@/contexts/AuthContext';
import { activityLogService } from '@/services/activityLog';
import { emailService } from '@/services/emailService';
import { softDeleteService } from '@/services/softDeleteService';
import ConfirmDeleteModal from './ConfirmDeleteModal';

interface UserManagementProps {
  onUserApproved?: () => void;
  onClose?: () => void;
}

const UserManagement: React.FC<UserManagementProps> = ({ onUserApproved, onClose }) => {
  const { user: currentUser, startImpersonation } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'sales_rep' | 'customer' | 'distributor'>('customer');
  const [newUserOrganizationId, setNewUserOrganizationId] = useState<string>('');
  const [newUserOrganizationRole, setNewUserOrganizationRole] = useState<string>('member');
  const [createNewOrganization, setCreateNewOrganization] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgCode, setNewOrgCode] = useState('');
  const [newOrgContactName, setNewOrgContactName] = useState('');
  const [newOrgContactEmail, setNewOrgContactEmail] = useState('');
  const [newOrgContactPhone, setNewOrgContactPhone] = useState('');
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  // Role-specific state
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [isHouseAccount, setIsHouseAccount] = useState(false);
  const [selectedSalesRepId, setSelectedSalesRepId] = useState('');
  const [isIndependent, setIsIndependent] = useState(true);
  const [selectedDistributorId, setSelectedDistributorId] = useState('');
  const [salesReps, setSalesReps] = useState<any[]>([]);
  const [distributorsList, setDistributorsList] = useState<any[]>([]);
  // W-9 fields
  const [taxId, setTaxId] = useState('');
  const [taxIdType, setTaxIdType] = useState<'ein' | 'ssn'>('ssn');
  const [legalName, setLegalName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [taxClassification, setTaxClassification] = useState('individual');
  const [w9Consent, setW9Consent] = useState(false);
  const [modalMessage, setModalMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [sendingPasswordReset, setSendingPasswordReset] = useState(false);
  const [sendingInvite, setSendingInvite] = useState<string | null>(null);
  const [userAssociations, setUserAssociations] = useState<Record<string, { type: string; name: string }[]>>({});
  const [pendingChanges, setPendingChanges] = useState<{ [key: string]: Partial<Profile> }>({});
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  useEffect(() => {
    fetchUsers();
    fetchOrganizations();
    fetchSalesReps();
    fetchDistributors();
  }, []);

  // Auto-dismiss success messages after 3 seconds
  useEffect(() => {
    if (saveMessage?.type === 'success') {
      const t = setTimeout(() => setSaveMessage(null), 3000);
      return () => clearTimeout(t);
    }
  }, [saveMessage]);

  useEffect(() => {
    if (modalMessage?.type === 'success') {
      const t = setTimeout(() => setModalMessage(null), 3000);
      return () => clearTimeout(t);
    }
  }, [modalMessage]);

  const fetchOrganizations = async () => {
    try {
      setLoadingOrgs(true);
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, code, org_type, is_house_account')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setOrganizations(data || []);
    } catch (err) {
      console.error('Failed to fetch organizations:', err);
    } finally {
      setLoadingOrgs(false);
    }
  };

  const fetchSalesReps = async () => {
    try {
      const { data: reps } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .eq('role', 'sales_rep')
        .eq('approval_status', 'approved');

      if (!reps) { setSalesReps([]); return; }

      // Fetch distributor info for each rep
      const repIds = reps.map(r => r.id);
      const { data: dsr } = await supabase
        .from('distributor_sales_reps')
        .select('sales_rep_id, distributor_id, distributors(name, distributor_class)')
        .in('sales_rep_id', repIds)
        .eq('is_active', true);

      const distMap = new Map<string, { name: string; class: string }>();
      if (dsr) {
        for (const row of dsr) {
          const dist = (row as any).distributors;
          if (dist) {
            distMap.set(row.sales_rep_id, { name: dist.name, class: dist.distributor_class });
          }
        }
      }

      setSalesReps(reps.map(r => ({
        ...r,
        distributorName: distMap.get(r.id)?.name || null,
        distributorClass: distMap.get(r.id)?.class || null,
      })));
    } catch (err) {
      console.error('Failed to fetch sales reps:', err);
    }
  };

  const fetchDistributors = async () => {
    try {
      const { data } = await supabase
        .from('distributors')
        .select('id, name, code, distributor_class')
        .eq('is_active', true)
        .eq('distributor_class', 'company')
        .order('name');

      setDistributorsList(data || []);
    } catch (err) {
      console.error('Failed to fetch distributors:', err);
    }
  };

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers(data || []);

      // Fetch org/distributor associations for all users
      if (data && data.length > 0) {
        const userIds = data.map(u => u.id);
        const assocMap: Record<string, { type: string; name: string }[]> = {};

        // Fetch organization memberships
        const { data: orgRoles } = await supabase
          .from('user_organization_roles')
          .select('user_id, organizations(name)')
          .in('user_id', userIds);

        if (orgRoles) {
          for (const row of orgRoles) {
            const orgName = (row as any).organizations?.name;
            if (orgName) {
              if (!assocMap[row.user_id]) assocMap[row.user_id] = [];
              assocMap[row.user_id].push({ type: 'org', name: orgName });
            }
          }
        }

        // Fetch distributor associations (for sales reps)
        const { data: distReps } = await supabase
          .from('distributor_sales_reps')
          .select('sales_rep_id, distributors(name)')
          .in('sales_rep_id', userIds)
          .eq('is_active', true);

        if (distReps) {
          for (const row of distReps) {
            const distName = (row as any).distributors?.name;
            if (distName) {
              if (!assocMap[row.sales_rep_id]) assocMap[row.sales_rep_id] = [];
              assocMap[row.sales_rep_id].push({ type: 'distributor', name: distName });
            }
          }
        }

        // Fetch distributor entities (for distributor-role users)
        const distUsers = data.filter(u => u.role === 'distributor');
        if (distUsers.length > 0) {
          const { data: dists } = await supabase
            .from('distributors')
            .select('profile_id, name')
            .in('profile_id', distUsers.map(u => u.id))
            .eq('is_active', true);

          if (dists) {
            for (const row of dists) {
              if (row.profile_id && row.name) {
                if (!assocMap[row.profile_id]) assocMap[row.profile_id] = [];
                assocMap[row.profile_id].push({ type: 'distributor', name: row.name });
              }
            }
          }
        }

        setUserAssociations(assocMap);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const updateUserRole = async (userId: string, newRole: string, isApproved: boolean) => {
    try {
      setModalMessage(null);

      // Check if email was changed
      const originalUser = users.find(u => u.id === userId);
      const emailChanged = originalUser && selectedUser && originalUser.email !== selectedUser.email;

      // Update profile in our database
      const { error } = await supabase
        .from('profiles')
        .update({
          role: newRole,
          approval_status: selectedUser?.approval_status,
          email: selectedUser?.email || originalUser?.email,
          full_name: selectedUser?.full_name || null,
          phone: selectedUser?.phone || null,
          title: selectedUser?.title || null,
          company: selectedUser?.company || null,
          address1: selectedUser?.address1 || null,
          address2: selectedUser?.address2 || null,
          city: selectedUser?.city || null,
          state: selectedUser?.state || null,
          postal_code: selectedUser?.postal_code || null,
        })
        .eq('id', userId);

      if (error) throw error;

      // If email changed, update it in Supabase Auth (admin only operation)
      if (emailChanged && selectedUser?.email) {
        const { error: authError } = await supabase.auth.admin.updateUserById(
          userId,
          { email: selectedUser.email }
        );

        if (authError) {
          console.warn('Could not update email in auth system:', authError.message);
          setModalMessage({
            type: 'error',
            text: 'Role updated but email change failed. User may need to update email manually.'
          });
        } else {
          setModalMessage({
            type: 'success',
            text: 'User updated successfully including email change.'
          });
        }
      } else {
        setModalMessage({
          type: 'success',
          text: 'User updated successfully.'
        });
      }

      // Log the role/status change
      if (currentUser) {
        const originalUser2 = users.find(u => u.id === userId);
        activityLogService.logAction({
          userId: currentUser.id,
          action: 'user_role_changed',
          resourceType: 'user',
          resourceId: userId,
          details: {
            email: selectedUser?.email || originalUser2?.email,
            old_role: originalUser2?.role,
            new_role: newRole,
            approval_status: selectedUser?.approval_status,
          },
        });
      }

      // Update local state
      setUsers(prev => prev.map(user =>
        user.id === userId
          ? {
              ...user,
              role: newRole as any,
              approval_status: selectedUser?.approval_status || user.approval_status,
              approved: selectedUser?.approval_status === 'approved',
              email: selectedUser?.email || user.email
            }
          : user
      ));

      // Refresh the pending users count
      onUserApproved?.();

      // Don't close modal immediately if there was an error, let user see the message
      if (!emailChanged || !authError) {
        setTimeout(() => {
          setIsEditModalOpen(false);
          setSelectedUser(null);
          setModalMessage(null);
        }, 2000);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update user';
      setError(errorMessage);
      setModalMessage({ type: 'error', text: errorMessage });
    }
  };

  const handleSendPasswordReset = async () => {
    if (!selectedUser?.email) return;

    try {
      setSendingPasswordReset(true);
      setModalMessage(null);
      
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/send-password-reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ email: selectedUser.email }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to send password reset email');
      
      setModalMessage({ 
        type: 'success', 
        text: `Password reset email sent to ${selectedUser.email}` 
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send password reset email';
      setModalMessage({ type: 'error', text: errorMessage });
    } finally {
      setSendingPasswordReset(false);
    }
  };

  const handleSendInvite = async (userToInvite: Profile) => {
    try {
      setSendingInvite(userToInvite.id);
      const emailResult = await emailService.sendNotification({
        to: userToInvite.email,
        email_type: 'user_invitation',
        subject: 'You\'re Invited to HealthSpan360',
        template_data: {
          full_name: userToInvite.full_name || '',
          email: userToInvite.email,
          role: userToInvite.role || 'customer',
          login_url: window.location.origin,
        },
        user_id: userToInvite.id,
      });

      // Also send a password reset so they can set their password
      const { data: { session: inviteSession } } = await supabase.auth.getSession();
      await fetch('/api/send-password-reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${inviteSession?.access_token}`,
        },
        body: JSON.stringify({ email: userToInvite.email }),
      });

      if (emailResult.success) {
        setSaveMessage({ type: 'success', text: `Invite sent to ${userToInvite.email}` });
      } else {
        setSaveMessage({ type: 'error', text: `Password reset email sent, but invite email failed: ${emailResult.error}` });
      }
    } catch (err) {
      setSaveMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to send invite' });
    } finally {
      setSendingInvite(null);
    }
  };

  const handleDeleteUser = (user: Profile) => {
    setDeleteTarget(user);
    setShowDeleteModal(true);
  };

  const confirmDeleteUser = async () => {
    if (!deleteTarget || !currentUser) return;
    setIsDeleting(true);
    try {
      const result = await softDeleteService.deleteProfile(deleteTarget.id, currentUser.id);
      if (!result.success) {
        setSaveMessage({ type: 'error', text: result.error || 'Failed to delete user' });
        return;
      }
      setUsers(prev => prev.filter(u => u.id !== deleteTarget.id));
      onUserApproved?.();
      setSaveMessage({ type: 'success', text: `User ${deleteTarget.email} deleted` });
    } catch (err) {
      setSaveMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to delete user' });
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
      setDeleteTarget(null);
    }
  };

  const handleBulkSave = async () => {
    try {
      setIsSaving(true);
      setSaveMessage(null);
      
      const updatePromises = Object.entries(pendingChanges).map(async ([userId, changes]) => {
        const { error } = await supabase
          .from('profiles')
          .update(changes)
          .eq('id', userId);
        
        if (error) throw error;
        
        // Update local state
        setUsers(prev => prev.map(user => 
          user.id === userId ? { ...user, ...changes } : user
        ));
      });
      
      await Promise.all(updatePromises);

      setPendingChanges({});
      onUserApproved?.();
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

  const resetCreateForm = () => {
    setNewUserEmail('');
    setNewUserRole('customer');
    setNewUserOrganizationId('');
    setNewUserOrganizationRole('member');
    setCreateNewOrganization(false);
    setNewOrgName('');
    setNewOrgCode('');
    setNewOrgContactName('');
    setNewOrgContactEmail('');
    setNewOrgContactPhone('');
    setFullName('');
    setPhone('');
    setIsHouseAccount(false);
    setSelectedSalesRepId('');
    setIsIndependent(true);
    setSelectedDistributorId('');
    setTaxId('');
    setTaxIdType('ssn');
    setLegalName('');
    setBusinessName('');
    setTaxClassification('individual');
    setW9Consent(false);
    setModalMessage(null);
  };

  const handleCreateUser = async () => {
    if (!newUserEmail.trim()) {
      setModalMessage({ type: 'error', text: 'Email is required' });
      return;
    }

    // Role-specific validation
    if (newUserRole === 'customer' && !isHouseAccount && !selectedSalesRepId) {
      setModalMessage({ type: 'error', text: 'Sales rep is required unless this is a house account' });
      return;
    }

    if (newUserRole === 'sales_rep' && !isIndependent && !selectedDistributorId) {
      setModalMessage({ type: 'error', text: 'Please select a distributor' });
      return;
    }

    // W-9 information is optional at user creation — the user can submit it
    // through their account later. w9_status defaults to 'pending' until then.

    try {
      setIsCreatingUser(true);
      setModalMessage(null);

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('No active session');
      }

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
            role: newUserRole,
            fullName: fullName || undefined,
            phone: phone || undefined,
            // Customer-specific
            organizationId: newUserOrganizationId || undefined,
            orgRole: newUserOrganizationRole,
            isHouseAccount: newUserRole === 'customer' ? isHouseAccount : undefined,
            salesRepId: newUserRole === 'customer' && !isHouseAccount ? selectedSalesRepId : undefined,
            // Sales rep-specific
            isIndependent: newUserRole === 'sales_rep' ? isIndependent : undefined,
            distributorId: newUserRole === 'sales_rep' && !isIndependent ? selectedDistributorId : undefined,
            // W-9 fields
            taxId: taxId || undefined,
            taxIdType: taxId ? taxIdType : undefined,
            legalName: legalName || undefined,
            businessName: businessName || undefined,
            taxClassification: taxClassification || undefined,
            w9Consent,
            // Org creation
            createOrganization: createNewOrganization,
            newOrgName: createNewOrganization ? newOrgName : undefined,
            newOrgCode: createNewOrganization ? newOrgCode : undefined,
            contactName: createNewOrganization ? (newOrgContactName || undefined) : undefined,
            contactEmail: createNewOrganization ? (newOrgContactEmail || undefined) : undefined,
            contactPhone: createNewOrganization ? (newOrgContactPhone || undefined) : undefined,
            orgType: newUserRole === 'distributor' ? 'distributor' : 'customer',
            siteUrl: window.location.origin,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'User creation failed');
      }

      const reactivatedNote = result.reactivated ? ' (reactivated previous account)' : '';
      const inviteNote = result.inviteEmailSent
        ? ' An invite email has been sent.'
        : ' Note: invite email could not be sent. Use "Send Password Reset" to send manually.';

      setModalMessage({
        type: 'success',
        text: `User ${result.reactivated ? 'reactivated' : 'created'} successfully!${reactivatedNote}${inviteNote}`
      });

      await fetchUsers();

      setTimeout(() => {
        setIsCreateModalOpen(false);
        resetCreateForm();
        fetchOrganizations();
        fetchSalesReps();
      }, 3000);

    } catch (err) {
      console.error('Error creating user:', err);
      let errorMessage = 'Failed to create user';

      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'object' && err !== null && 'message' in err) {
        errorMessage = String((err as any).message);
      }

      setModalMessage({ type: 'error', text: errorMessage });
    } finally {
      setIsCreatingUser(false);
    }
  };

  const hasPendingChanges = Object.keys(pendingChanges).length > 0;

  const getRoleColor = (role: string | null) => {
    switch (role) {
      case 'admin': return 'bg-purple-100 text-purple-800';
      case 'distributor': return 'bg-orange-100 text-orange-800';
      case 'sales_rep': return 'bg-blue-100 text-blue-800';
      case 'customer': return 'bg-green-100 text-green-800';
      case null: return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getRoleIcon = (role: string | null) => {
    switch (role) {
      case 'admin': return Shield;
      case 'distributor': return Mail;
      case 'sales_rep': return Mail;
      case 'customer': return User;
      case null: return Clock;
      default: return User;
    }
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-200 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">User Management</h2>
          <p className="text-gray-600">Manage user accounts, roles, and permissions</p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <Plus className="h-5 w-5" />
          <span>Create User</span>
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
                You have unsaved changes ({Object.keys(pendingChanges).length} user{Object.keys(pendingChanges).length !== 1 ? 's' : ''})
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

      {/* Pending Users Section */}
      {users.filter(u => u.approval_status === 'pending').length > 0 && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <div className="flex items-center space-x-2 mb-4">
            <AlertCircle className="h-5 w-5 text-yellow-600" />
            <h3 className="text-lg font-semibold text-yellow-900">
              Pending Approval ({users.filter(u => u.approval_status === 'pending').length})
            </h3>
          </div>
          <p className="text-sm text-yellow-700 mb-4">
            These users have registered but need to be approved and assigned a role before they can access the system.
          </p>
          <div className="space-y-2">
            {users.filter(u => u.approval_status === 'pending').map((user) => (
              <div key={user.id} className="bg-white rounded-lg p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{user.email}</p>
                  <p className="text-sm text-gray-500">
                    Registered: {new Date(user.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <select
                    onChange={async (e) => {
                      const role = e.target.value;
                      if (role && confirm(`Approve ${user.email} as ${role}?`)) {
                        try {
                          const { error } = await supabase
                            .from('profiles')
                            .update({ role, approval_status: 'approved' })
                            .eq('id', user.id);

                          if (error) throw error;
                          await fetchUsers();
                          onUserApproved?.();
                          setSaveMessage({ type: 'success', text: `User approved as ${role}!` });
                          if (currentUser) {
                            activityLogService.logAction({
                              userId: currentUser.id,
                              action: 'user_approved',
                              resourceType: 'user',
                              resourceId: user.id,
                              details: { email: user.email, assigned_role: role },
                            });
                          }
                          emailService.sendNotification({
                            to: user.email,
                            email_type: 'account_approved',
                            subject: 'Your Account Has Been Approved',
                            template_data: { login_url: window.location.origin },
                            user_id: user.id,
                          }).catch(err => console.warn('Failed to send approval email:', err));
                        } catch (err) {
                          setSaveMessage({ type: 'error', text: 'Failed to approve user' });
                        }
                      }
                      e.target.value = '';
                    }}
                    defaultValue=""
                    className="px-3 py-1 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="" disabled>Approve as...</option>
                    <option value="customer">Customer</option>
                    <option value="sales_rep">Sales Rep</option>
                    <option value="distributor">Distributor</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    onClick={async () => {
                      if (confirm(`Deny access for ${user.email}? They will not be able to log in.`)) {
                        try {
                          const { error } = await supabase
                            .from('profiles')
                            .update({ approval_status: 'denied' })
                            .eq('id', user.id);

                          if (error) throw error;
                          await fetchUsers();
                          onUserApproved?.();
                          setSaveMessage({ type: 'success', text: 'User denied!' });
                          if (currentUser) {
                            activityLogService.logAction({
                              userId: currentUser.id,
                              action: 'user_denied',
                              resourceType: 'user',
                              resourceId: user.id,
                              details: { email: user.email },
                            });
                          }
                          emailService.sendNotification({
                            to: user.email,
                            email_type: 'account_denied',
                            subject: 'Account Update',
                            template_data: {},
                            user_id: user.id,
                          }).catch(err => console.warn('Failed to send denial email:', err));
                        } catch (err) {
                          setSaveMessage({ type: 'error', text: 'Failed to deny user' });
                        }
                      }
                    }}
                    className="p-2 text-orange-600 hover:bg-orange-50 rounded-md"
                    title="Deny user"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteUser(user)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-md"
                    title="Delete user"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Denied Users Section */}
      {users.filter(u => u.approval_status === 'denied').length > 0 && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-center space-x-2 mb-4">
            <XCircle className="h-5 w-5 text-red-600" />
            <h3 className="text-lg font-semibold text-red-900">
              Denied Users ({users.filter(u => u.approval_status === 'denied').length})
            </h3>
          </div>
          <p className="text-sm text-red-700 mb-4">
            These users have been denied access and cannot log in to the system.
          </p>
          <div className="space-y-2">
            {users.filter(u => u.approval_status === 'denied').map((user) => (
              <div key={user.id} className="bg-white rounded-lg p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{user.email}</p>
                  <p className="text-sm text-gray-500">
                    Registered: {new Date(user.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <select
                    onChange={async (e) => {
                      const role = e.target.value;
                      if (role && confirm(`Approve ${user.email} as ${role}?`)) {
                        try {
                          const { error } = await supabase
                            .from('profiles')
                            .update({ role, approval_status: 'approved' })
                            .eq('id', user.id);

                          if (error) throw error;
                          await fetchUsers();
                          onUserApproved?.();
                          setSaveMessage({ type: 'success', text: `User approved as ${role}!` });
                        } catch (err) {
                          setSaveMessage({ type: 'error', text: 'Failed to approve user' });
                        }
                      }
                      e.target.value = '';
                    }}
                    defaultValue=""
                    className="px-3 py-1 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="" disabled>Approve as...</option>
                    <option value="customer">Customer</option>
                    <option value="sales_rep">Sales Rep</option>
                    <option value="distributor">Distributor</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    onClick={() => handleDeleteUser(user)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-md"
                    title="Delete user"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search users by email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="pl-10 pr-8 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          >
            <option value="all">All Roles</option>
            <option value="customer">Customer</option>
            <option value="sales_rep">Sales Rep</option>
            <option value="distributor">Distributor</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Organization / Distributor
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredUsers.map((user) => {
                const RoleIcon = getRoleIcon(user.role);
                return (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center space-x-2">
                        {user.id !== currentUser?.id && user.approval_status === 'approved' && (
                          <button
                            onClick={async () => {
                              await startImpersonation(user.id);
                              onClose?.();
                            }}
                            className="p-2 text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors"
                            title={`View as ${user.email}`}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setSelectedUser(user);
                            setIsEditModalOpen(true);
                          }}
                          className="p-2 text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
                          title="Edit User"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleSendInvite(user)}
                          disabled={sendingInvite === user.id}
                          className="p-2 text-green-600 bg-green-50 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-50"
                          title={`Send invite to ${user.email}`}
                        >
                          <Send className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user)}
                          className="p-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                          title="Delete User"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          <div className="h-10 w-10 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center">
                            <User className="h-5 w-5 text-white" />
                          </div>
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {user.full_name || user.email}
                          </div>
                          {user.full_name && (
                            <div className="text-xs text-gray-500">{user.email}</div>
                          )}
                          {user.phone && (
                            <div className="text-xs text-gray-400">{user.phone}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <RoleIcon className="h-4 w-4 mr-2 text-gray-500" />
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getRoleColor(user.role)}`}>
                          {user.role}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center space-x-1 px-2 py-1 text-xs font-semibold rounded-full ${
                        user.approval_status === 'approved'
                          ? 'bg-green-100 text-green-800'
                          : user.approval_status === 'denied'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {user.approval_status === 'approved' && <CheckCircle className="h-3 w-3" />}
                        {user.approval_status === 'denied' && <XCircle className="h-3 w-3" />}
                        {user.approval_status === 'pending' && <Clock className="h-3 w-3" />}
                        <span className="capitalize">{user.approval_status}</span>
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {userAssociations[user.id]?.length ? (
                        <div className="flex flex-wrap gap-1">
                          {userAssociations[user.id].map((assoc, i) => (
                            <span
                              key={i}
                              className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                                assoc.type === 'org'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-indigo-100 text-indigo-800'
                              }`}
                            >
                              <Building2 className="h-3 w-3 mr-1" />
                              {assoc.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredUsers.length === 0 && (
          <div className="text-center py-12">
            <User className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No users found</h3>
            <p className="mt-1 text-sm text-gray-500">
              {searchTerm || roleFilter !== 'all' 
                ? 'Try adjusting your search or filter criteria.'
                : 'No users have been created yet.'
              }
            </p>
          </div>
        )}
      </div>

      {/* Edit User Modal */}
      {isEditModalOpen && selectedUser && (
        <div className="fixed inset-0 z-50 overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-xl sm:w-full max-h-[90vh] overflow-y-auto">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                      Edit User: {selectedUser.email}
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
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Email Address
                        </label>
                        <input
                          type="email"
                          value={selectedUser.email}
                          onChange={(e) => setSelectedUser({...selectedUser, email: e.target.value})}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          placeholder="user@example.com"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Changing the email will update both the profile and authentication system.
                        </p>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Role
                        </label>
                        <select
                          value={selectedUser.role || ''}
                          onChange={(e) => setSelectedUser({...selectedUser, role: e.target.value as any})}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        >
                          <option value="customer">Customer</option>
                          <option value="sales_rep">Sales Rep</option>
                          <option value="distributor">Distributor</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Approval Status
                        </label>
                        <select
                          value={selectedUser.approval_status}
                          onChange={(e) => setSelectedUser({...selectedUser, approval_status: e.target.value as any})}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        >
                          <option value="pending">Pending</option>
                          <option value="approved">Approved</option>
                          <option value="denied">Denied</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                          Denied users cannot log in to the system.
                        </p>
                      </div>

                      {/* Contact Information */}
                      <div className="pt-4 border-t border-gray-200">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">Contact Information</h4>
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Full Name</label>
                            <input
                              type="text"
                              value={selectedUser.full_name || ''}
                              onChange={(e) => setSelectedUser({...selectedUser, full_name: e.target.value})}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              placeholder="John Doe"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                              <input
                                type="tel"
                                value={selectedUser.phone || ''}
                                onChange={(e) => setSelectedUser({...selectedUser, phone: e.target.value})}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                placeholder="(555) 123-4567"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                              <input
                                type="text"
                                value={selectedUser.title || ''}
                                onChange={(e) => setSelectedUser({...selectedUser, title: e.target.value})}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                placeholder="Manager"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Company</label>
                            <input
                              type="text"
                              value={selectedUser.company || ''}
                              onChange={(e) => setSelectedUser({...selectedUser, company: e.target.value})}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              placeholder="Company name"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
                            <input
                              type="text"
                              value={selectedUser.address1 || ''}
                              onChange={(e) => setSelectedUser({...selectedUser, address1: e.target.value})}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              placeholder="Street address"
                            />
                          </div>
                          <div>
                            <input
                              type="text"
                              value={selectedUser.address2 || ''}
                              onChange={(e) => setSelectedUser({...selectedUser, address2: e.target.value})}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              placeholder="Apt, suite, unit (optional)"
                            />
                          </div>
                          <div className="grid grid-cols-6 gap-3">
                            <div className="col-span-3">
                              <label className="block text-xs font-medium text-gray-600 mb-1">City</label>
                              <input
                                type="text"
                                value={selectedUser.city || ''}
                                onChange={(e) => setSelectedUser({...selectedUser, city: e.target.value})}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              />
                            </div>
                            <div className="col-span-1">
                              <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
                              <input
                                type="text"
                                value={selectedUser.state || ''}
                                onChange={(e) => setSelectedUser({...selectedUser, state: e.target.value})}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                maxLength={2}
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs font-medium text-gray-600 mb-1">ZIP</label>
                              <input
                                type="text"
                                value={selectedUser.postal_code || ''}
                                onChange={(e) => setSelectedUser({...selectedUser, postal_code: e.target.value})}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Password Reset Section */}
                      <div className="pt-4 border-t border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-sm font-medium text-gray-700">
                            Password Reset
                          </label>
                        </div>
                        <button
                          type="button"
                          onClick={handleSendPasswordReset}
                          disabled={sendingPasswordReset || !selectedUser.email}
                          className="w-full flex items-center justify-center space-x-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {sendingPasswordReset ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600"></div>
                          ) : (
                            <Key className="h-4 w-4" />
                          )}
                          <span>
                            {sendingPasswordReset ? 'Sending...' : 'Send Password Reset Email'}
                          </span>
                        </button>
                        <p className="text-xs text-gray-500 mt-1">
                          This will send a password reset link to the user's email address.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={() => updateUserRole(selectedUser.id, selectedUser.role, selectedUser.approval_status === 'approved')}
                  disabled={!selectedUser.email.trim()}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-purple-600 text-base font-medium text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save Changes
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setSelectedUser(null);
                    setModalMessage(null);
                  }}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full max-h-[90vh] overflow-y-auto">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                      Create New User
                    </h3>

                    {modalMessage && (
                      <div className={`mb-4 p-3 rounded-lg flex items-center space-x-2 ${
                        modalMessage.type === 'success'
                          ? 'bg-green-50 border border-green-200'
                          : 'bg-red-50 border border-red-200'
                      }`}>
                        {modalMessage.type === 'success' ? (
                          <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                        ) : (
                          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                        )}
                        <span className={`text-sm ${
                          modalMessage.type === 'success' ? 'text-green-700' : 'text-red-700'
                        }`}>
                          {modalMessage.text}
                        </span>
                      </div>
                    )}

                    <div className="space-y-4">
                      {/* Email */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Email Address *
                        </label>
                        <input
                          type="email"
                          value={newUserEmail}
                          onChange={(e) => setNewUserEmail(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="user@example.com"
                        />
                      </div>

                      {/* Full Name */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Full Name
                        </label>
                        <input
                          type="text"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="John Doe"
                        />
                      </div>

                      {/* Phone */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Phone
                        </label>
                        <input
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="(555) 123-4567"
                        />
                      </div>

                      {/* Role */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Role *
                        </label>
                        <select
                          value={newUserRole}
                          onChange={(e) => {
                            setNewUserRole(e.target.value as any);
                            setCreateNewOrganization(false);
                            setNewUserOrganizationId('');
                          }}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="customer">Customer</option>
                          <option value="sales_rep">Sales Rep</option>
                          <option value="distributor">Distributor</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>

                      {/* Invite notice */}
                      <div className="flex items-start space-x-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-blue-700">
                          An invite email will be sent. The user sets their own password on first login.
                        </p>
                      </div>

                      {/* ═══ CUSTOMER FIELDS ═══ */}
                      {newUserRole === 'customer' && (
                        <div className="pt-4 border-t border-gray-200 space-y-4">
                          <h4 className="text-sm font-medium text-gray-900 flex items-center space-x-2">
                            <Building2 className="h-4 w-4" />
                            <span>Customer Setup</span>
                          </h4>

                          {/* House Account */}
                          <div>
                            <label className="flex items-center">
                              <input
                                type="checkbox"
                                checked={isHouseAccount}
                                onChange={(e) => setIsHouseAccount(e.target.checked)}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="ml-2 text-sm text-gray-700">House Account</span>
                            </label>
                            <p className="text-xs text-gray-500 ml-6">Admin-managed account with no sales rep assignment</p>
                          </div>

                          {/* Sales Rep (required unless house account) */}
                          {!isHouseAccount && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Sales Rep *
                              </label>
                              <select
                                value={selectedSalesRepId}
                                onChange={(e) => setSelectedSalesRepId(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              >
                                <option value="">-- Select Sales Rep --</option>
                                {salesReps.map(rep => (
                                  <option key={rep.id} value={rep.id}>
                                    {rep.full_name || rep.email}
                                    {rep.distributorName
                                      ? ` — ${rep.distributorName}`
                                      : rep.distributorClass === 'independent'
                                        ? ' — Independent'
                                        : ''}
                                  </option>
                                ))}
                              </select>
                              {selectedSalesRepId && salesReps.find(r => r.id === selectedSalesRepId)?.distributorName && (
                                <p className="text-xs text-blue-600 mt-1 flex items-center space-x-1">
                                  <Info className="h-3 w-3" />
                                  <span>Customer will be auto-linked to distributor: {salesReps.find(r => r.id === selectedSalesRepId)?.distributorName}</span>
                                </p>
                              )}
                            </div>
                          )}

                          {/* Organization */}
                          <div>
                            <label className="flex items-center mb-2">
                              <input
                                type="checkbox"
                                checked={createNewOrganization}
                                onChange={(e) => {
                                  setCreateNewOrganization(e.target.checked);
                                  if (e.target.checked) setNewUserOrganizationId('');
                                }}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="ml-2 text-sm text-gray-700">Create New Customer</span>
                            </label>
                          </div>

                          {createNewOrganization ? (
                            <>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Customer Name *
                                </label>
                                <input
                                  type="text"
                                  value={newOrgName}
                                  onChange={(e) => setNewOrgName(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  placeholder="e.g., Acme Corporation"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Customer Code *
                                </label>
                                <input
                                  type="text"
                                  value={newOrgCode}
                                  onChange={(e) => setNewOrgCode(e.target.value.toUpperCase())}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  placeholder="e.g., ACME"
                                  maxLength={10}
                                />
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Contact Name
                                  </label>
                                  <input
                                    type="text"
                                    value={newOrgContactName}
                                    onChange={(e) => setNewOrgContactName(e.target.value)}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder="Primary contact"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Contact Email
                                  </label>
                                  <input
                                    type="email"
                                    value={newOrgContactEmail}
                                    onChange={(e) => setNewOrgContactEmail(e.target.value)}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder="contact@company.com"
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Contact Phone
                                </label>
                                <input
                                  type="tel"
                                  value={newOrgContactPhone}
                                  onChange={(e) => setNewOrgContactPhone(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  placeholder="(555) 123-4567"
                                />
                              </div>
                            </>
                          ) : (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Select Customer
                              </label>
                              <select
                                value={newUserOrganizationId}
                                onChange={(e) => setNewUserOrganizationId(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                disabled={loadingOrgs}
                              >
                                <option value="">-- Optional --</option>
                                {organizations.filter(o => o.org_type === 'customer').map(org => (
                                  <option key={org.id} value={org.id}>
                                    {org.name} ({org.code})
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          {/* Org Role */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Customer Role
                            </label>
                            <select
                              value={newUserOrganizationRole}
                              onChange={(e) => setNewUserOrganizationRole(e.target.value)}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                              <option value="member">Member (place orders)</option>
                              <option value="admin">Admin (manage org)</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {/* ═══ SALES REP FIELDS ═══ */}
                      {newUserRole === 'sales_rep' && (
                        <div className="pt-4 border-t border-gray-200 space-y-4">
                          <h4 className="text-sm font-medium text-gray-900 flex items-center space-x-2">
                            <User className="h-4 w-4" />
                            <span>Sales Rep Setup</span>
                          </h4>

                          {/* Phone */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                            <input
                              type="tel"
                              value={phone}
                              onChange={(e) => setPhone(e.target.value)}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              placeholder="(555) 123-4567"
                            />
                          </div>

                          {/* Distributor Assignment */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Distributor Assignment *
                            </label>
                            <div className="space-y-2">
                              <label className="flex items-center">
                                <input
                                  type="radio"
                                  checked={isIndependent}
                                  onChange={() => setIsIndependent(true)}
                                  className="border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="ml-2 text-sm text-gray-700">Independent</span>
                                <span className="ml-1 text-xs text-gray-500">(solo rep, acts as own distributor)</span>
                              </label>
                              <label className="flex items-center">
                                <input
                                  type="radio"
                                  checked={!isIndependent}
                                  onChange={() => setIsIndependent(false)}
                                  className="border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="ml-2 text-sm text-gray-700">Assign to Company</span>
                              </label>
                            </div>
                          </div>

                          {!isIndependent && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Select Distributor *
                              </label>
                              <select
                                value={selectedDistributorId}
                                onChange={(e) => setSelectedDistributorId(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              >
                                <option value="">-- Select Distributor --</option>
                                {distributorsList.map(d => (
                                  <option key={d.id} value={d.id}>
                                    {d.name} ({d.code})
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          {/* W-9 fields for independent reps */}
                          {isIndependent && (
                            <div className="pt-3 border-t border-gray-100 space-y-3">
                              <h5 className="text-sm font-medium text-gray-900 flex items-center space-x-2">
                                <FileText className="h-4 w-4" />
                                <span>W-9 / 1099 Information</span>
                                <span className="text-xs font-normal text-gray-500">(optional)</span>
                              </h5>
                              <p className="text-xs text-gray-500">
                                Leave blank to collect from the sales rep later. Status will be marked &ldquo;Pending&rdquo; until W-9 is on file.
                              </p>

                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">Tax ID Type</label>
                                  <select
                                    value={taxIdType}
                                    onChange={(e) => setTaxIdType(e.target.value as 'ein' | 'ssn')}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  >
                                    <option value="ssn">SSN</option>
                                    <option value="ein">EIN</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">
                                    {taxIdType === 'ssn' ? 'SSN' : 'EIN'}
                                  </label>
                                  <input
                                    type="text"
                                    value={taxId}
                                    onChange={(e) => setTaxId(e.target.value)}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder={taxIdType === 'ssn' ? 'XXX-XX-XXXX' : 'XX-XXXXXXX'}
                                  />
                                </div>
                              </div>

                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Legal Name</label>
                                <input
                                  type="text"
                                  value={legalName}
                                  onChange={(e) => setLegalName(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  placeholder="Legal name as it appears on W-9"
                                />
                              </div>

                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Business Name (DBA)</label>
                                <input
                                  type="text"
                                  value={businessName}
                                  onChange={(e) => setBusinessName(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  placeholder="Optional DBA name"
                                />
                              </div>

                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Tax Classification</label>
                                <select
                                  value={taxClassification}
                                  onChange={(e) => setTaxClassification(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                >
                                  <option value="individual">Individual / Sole Proprietor</option>
                                  <option value="sole_proprietor">Sole Proprietor</option>
                                  <option value="llc_single">LLC (Single Member)</option>
                                  <option value="llc_partnership">LLC (Partnership)</option>
                                  <option value="llc_corp">LLC (Corp)</option>
                                  <option value="c_corp">C Corporation</option>
                                  <option value="s_corp">S Corporation</option>
                                  <option value="partnership">Partnership</option>
                                  <option value="trust">Trust / Estate</option>
                                  <option value="other">Other</option>
                                </select>
                              </div>

                              <div>
                                <label className="flex items-center">
                                  <input
                                    type="checkbox"
                                    checked={w9Consent}
                                    onChange={(e) => setW9Consent(e.target.checked)}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                  />
                                  <span className="ml-2 text-xs text-gray-700">
                                    I certify that the information provided is correct (W-9 consent)
                                  </span>
                                </label>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ═══ DISTRIBUTOR FIELDS ═══ */}
                      {newUserRole === 'distributor' && (
                        <div className="pt-4 border-t border-gray-200 space-y-4">
                          <h4 className="text-sm font-medium text-gray-900 flex items-center space-x-2">
                            <Building2 className="h-4 w-4" />
                            <span>Distributor Setup</span>
                          </h4>

                          {/* Phone */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                            <input
                              type="tel"
                              value={phone}
                              onChange={(e) => setPhone(e.target.value)}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              placeholder="(555) 123-4567"
                            />
                          </div>

                          {/* Organization */}
                          <div>
                            <label className="flex items-center mb-2">
                              <input
                                type="checkbox"
                                checked={createNewOrganization}
                                onChange={(e) => {
                                  setCreateNewOrganization(e.target.checked);
                                  if (e.target.checked) setNewUserOrganizationId('');
                                }}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="ml-2 text-sm text-gray-700">Create New Distributor</span>
                            </label>
                          </div>

                          {createNewOrganization ? (
                            <>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Distributor Name *
                                </label>
                                <input
                                  type="text"
                                  value={newOrgName}
                                  onChange={(e) => setNewOrgName(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  placeholder="e.g., ABC Distribution"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Distributor Code *
                                </label>
                                <input
                                  type="text"
                                  value={newOrgCode}
                                  onChange={(e) => setNewOrgCode(e.target.value.toUpperCase())}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  placeholder="e.g., ABCD"
                                  maxLength={10}
                                />
                              </div>
                            </>
                          ) : (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Select Distributor
                              </label>
                              <select
                                value={newUserOrganizationId}
                                onChange={(e) => setNewUserOrganizationId(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                disabled={loadingOrgs}
                              >
                                <option value="">-- Optional --</option>
                                {organizations.filter(o => o.org_type === 'distributor').map(org => (
                                  <option key={org.id} value={org.id}>
                                    {org.name} ({org.code})
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          {/* W-9 fields */}
                          <div className="pt-3 border-t border-gray-100 space-y-3">
                            <h5 className="text-sm font-medium text-gray-900 flex items-center space-x-2">
                              <FileText className="h-4 w-4" />
                              <span>W-9 / 1099 Information</span>
                              <span className="text-xs font-normal text-gray-500">(optional)</span>
                            </h5>
                            <p className="text-xs text-gray-500">
                              Leave blank to collect from the distributor later. Status will be marked &ldquo;Pending&rdquo; until W-9 is on file.
                            </p>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Tax ID Type</label>
                                <select
                                  value={taxIdType}
                                  onChange={(e) => setTaxIdType(e.target.value as 'ein' | 'ssn')}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                >
                                  <option value="ssn">SSN</option>
                                  <option value="ein">EIN</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">
                                  {taxIdType === 'ssn' ? 'SSN' : 'EIN'}
                                </label>
                                <input
                                  type="text"
                                  value={taxId}
                                  onChange={(e) => setTaxId(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  placeholder={taxIdType === 'ssn' ? 'XXX-XX-XXXX' : 'XX-XXXXXXX'}
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Legal Name</label>
                              <input
                                type="text"
                                value={legalName}
                                onChange={(e) => setLegalName(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="Legal name as it appears on W-9"
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Business Name (DBA)</label>
                              <input
                                type="text"
                                value={businessName}
                                onChange={(e) => setBusinessName(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="Optional DBA name"
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Tax Classification</label>
                              <select
                                value={taxClassification}
                                onChange={(e) => setTaxClassification(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              >
                                <option value="individual">Individual / Sole Proprietor</option>
                                <option value="sole_proprietor">Sole Proprietor</option>
                                <option value="llc_single">LLC (Single Member)</option>
                                <option value="llc_partnership">LLC (Partnership)</option>
                                <option value="llc_corp">LLC (Corp)</option>
                                <option value="c_corp">C Corporation</option>
                                <option value="s_corp">S Corporation</option>
                                <option value="partnership">Partnership</option>
                                <option value="trust">Trust / Estate</option>
                                <option value="other">Other</option>
                              </select>
                            </div>

                            <div>
                              <label className="flex items-center">
                                <input
                                  type="checkbox"
                                  checked={w9Consent}
                                  onChange={(e) => setW9Consent(e.target.checked)}
                                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="ml-2 text-xs text-gray-700">
                                  I certify that the information provided is correct (W-9 consent)
                                </span>
                              </label>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ═══ ADMIN FIELDS ═══ */}
                      {newUserRole === 'admin' && (
                        <div className="flex items-start space-x-2 bg-purple-50 border border-purple-200 rounded-lg p-3">
                          <Shield className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-purple-700">
                            Admin users have full access to all system features. Only email is required.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={handleCreateUser}
                  disabled={isCreatingUser || !newUserEmail.trim()}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreatingUser ? (
                    <div className="flex items-center space-x-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      <span>Creating...</span>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2">
                      <Mail className="h-4 w-4" />
                      <span>Create & Send Invite</span>
                    </div>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateModalOpen(false);
                    resetCreateForm();
                  }}
                  disabled={isCreatingUser}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDeleteModal
        isOpen={showDeleteModal}
        title="Delete User"
        entityName={deleteTarget?.email || ''}
        cascadeWarnings={[
          'Orders placed by this user will be archived',
          'Commission records for this sales rep will be archived',
          'Sales rep assignments will be marked as orphaned',
          'Contract pricing records will be marked as orphaned',
          'The user will no longer be able to log in',
        ]}
        onConfirm={confirmDeleteUser}
        onCancel={() => { setShowDeleteModal(false); setDeleteTarget(null); }}
        isProcessing={isDeleting}
      />
    </div>
  );
};

export default UserManagement;