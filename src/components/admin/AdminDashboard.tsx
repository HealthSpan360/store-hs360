import React, { useState, useEffect, useRef } from 'react';
import {
  Users, Building2, MapPin, Settings, BarChart3, Package, ShoppingCart,
  TrendingUp, CreditCard, Repeat, Building, HelpCircle, PieChart,
  Shield, ChevronLeft, ChevronRight, DollarSign, FolderTree, MessageSquare, UserCheck,
  LayoutDashboard, ArrowLeft, Eye, EyeOff, Menu, X, BookOpen, Mail
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import AdminHome, { type ActiveTab, type PendingUser } from './AdminHome';
import SidebarNav, { type SidebarGroup } from './SidebarNav';
import UserManagement from './UserManagement';
import OrganizationManagement from './OrganizationManagement';
import AddressManagement from './AddressManagement';
import ProductsManagement from './products/ProductsManagement';
import PricingManagement from './PricingManagement';
import OrderManagement from './OrderManagement';
import CommissionManagement from './CommissionManagement';
import SalesRepDashboard from './SalesRepDashboard';
import CustomerPaymentMethods from './CustomerPaymentMethods';
import Analytics from './Analytics';
import RecurringOrderManagement from './RecurringOrderManagement';
import MyRecurringOrders from '../MyRecurringOrders';
import DistributorManagement from './DistributorManagement';
import DistributorPortal from './DistributorPortal';
import HelpSection from './HelpSection';
import ProfitReport from './ProfitReport';
import CostAdminManagement from './CostAdminManagement';
import QuickBooksManagement from './QuickBooksManagement';
import CategoryManagement from './CategoryManagement';
import SiteSettingsManagement from './SiteSettingsManagement';
import EmailTemplateManagement from './EmailTemplateManagement';
import SupportTickets from '../SupportTickets';
import SupportTicketManagement from './SupportTicketManagement';

interface AdminDashboardProps {
  onClose: () => void;
  initialTab?: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Company Admin',
  sales_rep: 'Sales Rep',
  distributor: 'Distributor',
  customer: 'Customer',
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-800',
  sales_rep: 'bg-blue-100 text-blue-800',
  distributor: 'bg-orange-100 text-orange-800',
  customer: 'bg-green-100 text-green-800',
};

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onClose, initialTab }) => {
  const { profile, user, isImpersonating, effectiveProfile, impersonation, stopImpersonation } = useAuth();
  const displayRole = isImpersonating ? effectiveProfile?.role : profile?.role;
  const isAdmin = displayRole === 'admin';
  const isSalesRep = displayRole === 'sales_rep';
  const isDistributor = displayRole === 'distributor';
  const isCustomer = displayRole === 'customer';

  const [userOrgId, setUserOrgId] = useState<string | undefined>();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);

  const resolveInitialTab = (tab?: string): ActiveTab => {
    // If an explicit tab was passed (e.g. from store navigation), use it
    if (tab) {
      if (tab === 'admin-settings') return 'organizations';
      return tab as ActiveTab;
    }

    // Otherwise, restore persisted tab from sessionStorage
    const stored = sessionStorage.getItem('admin_active_tab');
    if (stored) return stored as ActiveTab;

    // Role-based default
    if (isAdmin) return 'home';
    if (isCustomer) return 'orders';
    if (isSalesRep) return 'my-orgs';
    if (isDistributor) return 'my-customers';
    return 'home';
  };

  const [activeTab, setActiveTabRaw] = useState<ActiveTab>(() => resolveInitialTab(initialTab));

  // Persist active tab to sessionStorage so it survives re-renders and tab switches
  const setActiveTab = (tab: ActiveTab) => {
    sessionStorage.setItem('admin_active_tab', tab);
    setActiveTabRaw(tab);
  };

  useEffect(() => {
    if (isCustomer && user?.id) {
      const fetchUserOrg = async () => {
        const { multiTenantService } = await import('@/services/multiTenant');
        const roles = await multiTenantService.getUserOrganizationRoles(user.id);
        if (roles.length > 0) setUserOrgId(roles[0].organization_id);
      };
      fetchUserOrg();
    }
  }, [isCustomer, user?.id]);

  useEffect(() => {
    if (isAdmin) fetchPendingUsers();
  }, [isAdmin]);

  const fetchPendingUsers = async () => {
    try {
      const { data, count, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, created_at', { count: 'exact' })
        .eq('approval_status', 'pending')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setPendingCount(count || 0);
      setPendingUsers((data as PendingUser[]) || []);
    } catch (err) {
      console.error('Error fetching pending users:', err);
    }
  };

  const handleApprove = async (userId: string) => {
    await supabase.from('profiles').update({ approval_status: 'approved', is_approved: true }).eq('id', userId);
    fetchPendingUsers();
  };

  const handleDeny = async (userId: string) => {
    await supabase.from('profiles').update({ approval_status: 'denied', is_approved: false }).eq('id', userId);
    fetchPendingUsers();
  };

  // ── Sidebar groups ────────────────────────────────────────────────────────
  const groups: SidebarGroup[] = [
    // ── Dashboard (standalone) ──
    {
      label: 'Dashboard',
      roles: ['admin'],
      standalone: true,
      items: [
        { id: 'home', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin'] },
      ],
    },
    // ── My Account (customer / sales_rep / distributor) ──
    {
      label: 'My Account',
      roles: ['customer', 'sales_rep', 'distributor'],
      items: [
        { id: 'orders', label: 'My Orders', icon: ShoppingCart, roles: ['customer'] },
        { id: 'my-recurring-orders', label: 'Recurring Orders', icon: Repeat, roles: ['customer'] },
        { id: 'addresses', label: 'Addresses', icon: MapPin, roles: ['customer'] },
        { id: 'payments', label: 'Payment Methods', icon: CreditCard, roles: ['customer'] },
        { id: 'my-orgs', label: 'My Customers', icon: Building2, roles: ['sales_rep'] },
        { id: 'my-customers', label: 'My Customers', icon: Building2, roles: ['distributor'] },
        { id: 'my-sales-reps', label: 'My Sales Reps', icon: Users, roles: ['distributor'] },
        { id: 'my-delegates', label: 'Delegates', icon: UserCheck, roles: ['distributor'] },
        { id: 'orders', label: 'Orders', icon: ShoppingCart, roles: ['distributor'] },
        { id: 'commissions', label: 'Commissions', icon: TrendingUp, roles: ['distributor'] },
      ],
    },
    // ── Operations ──
    {
      label: 'Operations',
      roles: ['admin', 'sales_rep'],
      items: [
        { id: 'organizations', label: 'Customers', icon: Building2, roles: ['admin'] },
        { id: 'orders', label: 'Orders', icon: ShoppingCart, roles: ['admin', 'sales_rep'] },
        { id: 'recurring-orders', label: 'Recurring Orders', icon: Repeat, roles: ['admin'] },
        { id: 'commissions', label: 'Commissions', icon: TrendingUp, roles: ['admin', 'sales_rep'] },
        { id: 'pricing', label: 'Pricing', icon: DollarSign, roles: ['admin'] },
        { id: 'support', label: 'Support', icon: MessageSquare, roles: ['admin'] },
      ],
    },
    // ── Settings ──
    {
      label: 'Settings',
      roles: ['admin'],
      items: [
        { id: 'users', label: 'Users', icon: Users, roles: ['admin'], badge: pendingCount > 0 ? pendingCount : undefined },
        { id: 'products', label: 'Products', icon: Package, roles: ['admin'] },
        { id: 'categories', label: 'Categories', icon: FolderTree, roles: ['admin'] },
        { id: 'distributors', label: 'Distributors', icon: Building, roles: ['admin'] },
        { id: 'cost-admins', label: 'Cost Admins', icon: Shield, roles: ['admin'] },
        { id: 'quickbooks', label: 'QuickBooks', icon: BookOpen, roles: ['admin'] },
        { id: 'site-settings', label: 'Settings', icon: Settings, roles: ['admin'] },
        { id: 'email-templates', label: 'Email Templates', icon: Mail, roles: ['admin'] },
      ],
    },
    // ── Analytics ──
    {
      label: 'Analytics',
      roles: ['admin'],
      items: [
        { id: 'analytics', label: 'Analytics', icon: BarChart3, roles: ['admin'] },
        { id: 'profit-report', label: 'Profit Report', icon: PieChart, roles: ['admin'] },
      ],
    },
    // ── Support (customer) ──
    {
      label: 'Support',
      roles: ['customer'],
      items: [
        { id: 'support', label: 'Support', icon: MessageSquare, roles: ['customer'] },
      ],
    },
    // ── Help (standalone) ──
    {
      label: 'Help',
      roles: ['admin', 'sales_rep', 'distributor', 'customer'],
      standalone: true,
      items: [
        { id: 'help', label: 'Help', icon: HelpCircle, roles: ['admin', 'sales_rep', 'distributor', 'customer'] },
      ],
    },
  ];

  const visibleGroups = groups
    .filter(g => g.roles.includes(displayRole || ''))
    .map(g => ({
      ...g,
      items: g.items.filter(item => item.roles.includes(displayRole || '')),
    }))
    .filter(g => g.items.length > 0);

  // ── Content renderer ────────────────────────────────────────────────────
  const renderContent = () => {
    switch (activeTab) {
      case 'home':
        return (
          <AdminHome
            pendingUsers={pendingUsers}
            pendingCount={pendingCount}
            onNavigate={setActiveTab}
            onApprove={handleApprove}
            onDeny={handleDeny}
          />
        );
      case 'users':
        return <UserManagement onUserApproved={fetchPendingUsers} onClose={onClose} />;
      case 'orders':
        return <OrderManagement />;
      case 'commissions':
        return <CommissionManagement onNavigate={setActiveTab} />;
      case 'quickbooks':
        return <QuickBooksManagement />;
      case 'organizations':
        return <OrganizationManagement />;
      case 'pricing':
        return <PricingManagement />;
      case 'products':
        return <ProductsManagement />;
      case 'categories':
        return <CategoryManagement />;
      case 'recurring-orders':
        return <RecurringOrderManagement />;
      case 'distributors':
        return <DistributorManagement />;
      case 'analytics':
        return <Analytics />;
      case 'profit-report':
        return <ProfitReport />;
      case 'cost-admins':
        return <CostAdminManagement />;
      case 'site-settings':
        return <SiteSettingsManagement />;
      case 'email-templates':
        return <EmailTemplateManagement />;
      case 'my-orgs':
        return <SalesRepDashboard />;
      case 'my-customers':
        return <DistributorPortal view="customers" />;
      case 'my-sales-reps':
        return <DistributorPortal view="sales-reps" />;
      case 'my-delegates':
        return <DistributorPortal view="delegates" />;
      case 'addresses':
        return <AddressManagement organizationId={isCustomer ? userOrgId : undefined} />;
      case 'payments':
        return <CustomerPaymentMethods organizationId={isCustomer ? userOrgId : undefined} />;
      case 'my-recurring-orders':
        return <MyRecurringOrders />;
      case 'support':
        return isAdmin ? <SupportTicketManagement /> : <SupportTickets />;
      case 'help':
        return <HelpSection />;
      default:
        return null;
    }
  };

  const dashboardTitle = isCustomer ? 'My Account' : isSalesRep ? 'Sales Dashboard' : isDistributor ? 'Distributor Portal' : 'Admin Dashboard';
  const impersonatedName = impersonation?.profile?.full_name || impersonation?.profile?.email || 'Unknown User';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-6 py-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile hamburger */}
            <button
              onClick={() => setIsMobileSidebarOpen(true)}
              className="sm:hidden flex-shrink-0 text-white/80 hover:text-white hover:bg-white/10 rounded-full p-1.5 transition-colors mr-1"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="min-w-0">
              <h1 className="text-lg font-bold leading-tight">{dashboardTitle}</h1>
              {isImpersonating && (
                <p className="text-purple-200 text-xs mt-0.5 flex items-center gap-1">
                  <Eye className="h-3 w-3 flex-shrink-0" />
                  Viewing as {impersonatedName}
                </p>
              )}
            </div>
            {displayRole && (
              <span className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${ROLE_COLORS[displayRole] || 'bg-gray-100 text-gray-800'}`}>
                {ROLE_LABELS[displayRole] || displayRole}
              </span>
            )}
            {isImpersonating && (
              <button
                onClick={stopImpersonation}
                className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 bg-amber-400 text-amber-900 rounded-full text-xs font-semibold hover:bg-amber-300 transition-colors"
              >
                <EyeOff className="h-3 w-3" />
                Exit
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 flex items-center gap-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg px-3 py-1.5 transition-colors text-sm font-medium"
            aria-label="Back to store"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back to Store</span>
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Mobile sidebar overlay */}
        {isMobileSidebarOpen && (
          <div
            className="sm:hidden fixed inset-0 z-[55] bg-black/40"
            onClick={() => setIsMobileSidebarOpen(false)}
          >
            <div
              className="w-64 h-full bg-white shadow-xl flex flex-col overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <span className="font-semibold text-gray-800">Menu</span>
                <button
                  onClick={() => setIsMobileSidebarOpen(false)}
                  className="text-gray-500 hover:text-gray-900 rounded-full p-1 hover:bg-gray-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <SidebarNav
                visibleGroups={visibleGroups}
                activeTab={activeTab}
                collapsed={false}
                onSelect={tab => { setActiveTab(tab); setIsMobileSidebarOpen(false); }}
              />
            </div>
          </div>
        )}

        {/* Desktop Sidebar */}
        <div className={`hidden sm:flex ${isSidebarCollapsed ? 'w-16' : 'w-56'} bg-white border-r border-gray-200 transition-all duration-200 relative flex-col flex-shrink-0`}>
          {/* Collapse toggle */}
          <button
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="absolute -right-3 top-4 bg-white border border-gray-300 rounded-full p-1.5 shadow-md hover:bg-gray-100 hover:shadow-lg z-30 flex-shrink-0 transition-all"
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isSidebarCollapsed
              ? <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
              : <ChevronLeft className="h-3.5 w-3.5 text-gray-500" />
            }
          </button>
          <div className="flex-1 overflow-y-auto">
            <SidebarNav
              visibleGroups={visibleGroups}
              activeTab={activeTab}
              collapsed={isSidebarCollapsed}
              onSelect={setActiveTab}
            />
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
