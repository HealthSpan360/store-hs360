import React, { useState, useEffect, useRef } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { AuthProvider } from '@/contexts/AuthContext';
import { FavoritesProvider } from '@/contexts/FavoritesContext';
import Header from '@/components/Header';
import AuthModal from '@/components/AuthModal';
import UserProfile from '@/components/UserProfile';
import ResetPassword from '@/components/ResetPassword';
import AdminDashboard from '@/components/admin/AdminDashboard';
import ProductGrid, { ViewMode } from '@/components/ProductGrid';
import ProductFilter from '@/components/ProductFilter';
import FavoritesList from '@/components/FavoritesList';
import ProductModal from '@/components/ProductModal';
import Cart from '@/components/Cart';
import Footer from '@/components/Footer';
import OrganizationSelector from '@/components/OrganizationSelector';
import FirstTimeSetup from '@/components/FirstTimeSetup';
import ErrorDebugPanel from '@/components/ErrorDebugPanel';
import Toast from '@/components/Toast';
import ImpersonationBanner from '@/components/ImpersonationBanner';
import QuickBooksCallback from '@/components/QuickBooksCallback';
import EULAPage from '@/components/legal/EULAPage';
import PrivacyPolicyPage from '@/components/legal/PrivacyPolicyPage';
import { productService, Product, Category } from '@/services/productService';
import { useErrorLogger } from '@/hooks/useErrorLogger';
import { cacheService } from '@/services/cache';
import { useAuth } from '@/contexts/AuthContext';
import { useFavorites } from '@/contexts/FavoritesContext';
import { contractPricingService } from '@/services/contractPricing';
import { supabase } from '@/services/supabase';
import { cartService } from '@/services/cartService';

interface CartItem {
  id: number;
  name: string;
  price: number;
  retailPrice?: number;
  cost?: number;
  quantity: number;
  image: string;
  hasMarkup?: boolean;
  brand?: string;
}

function AppContent() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [adminInitialTab, setAdminInitialTab] = useState<string | undefined>(undefined);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [categoryTree, setCategoryTree] = useState<Category[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 10000]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const { errors, logError, clearErrors } = useErrorLogger();
  const { user, profile, loading: authLoading, isPasswordRecovery, isImpersonating, effectiveUserId, effectiveProfile, stopImpersonation } = useAuth();
  const { toastMessage, toastType, clearToast } = useFavorites();

  const [activeLegalPage, setActiveLegalPage] = useState<'eula' | 'privacy' | null>(null);
  const [isOrgSelectorOpen, setIsOrgSelectorOpen] = useState(false);
  const [selectedOrganization, setSelectedOrganization] = useState<{id: string; name: string} | null>(null);
  const [userHasMultipleOrgs, setUserHasMultipleOrgs] = useState(false);
  const [showOnlyContractPricing, setShowOnlyContractPricing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem('productViewMode') as ViewMode) || 'grid';
  });
  const [productsWithContractPricing, setProductsWithContractPricing] = useState<number[]>([]);
  const [needsOrganizationSetup, setNeedsOrganizationSetup] = useState(false);
  const [checkingOrganization, setCheckingOrganization] = useState(true);
  const prevEffectiveUserIdRef = useRef<string | undefined>();

  const isQuickBooksCallback = window.location.pathname.includes('/quickbooks/callback') ||
    window.location.search.includes('realmId=');

  useEffect(() => {
    if (authLoading) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);


        const [fetchedProducts, fetchedCategories] = await Promise.all([
          productService.getProducts(),
          productService.getCategories(),
        ]);
        setProducts(fetchedProducts);
        setCategoryTree(fetchedCategories);

      } catch (err) {
        const errorMessage = err instanceof Error && err.message === 'Request timeout'
          ? 'Request timed out. Please check your connection and try again.'
          : 'Failed to load product data. Please try again later.';
        setError(errorMessage);
        logError(err, 'fetchData');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [logError, authLoading]);

  // Reset org selection when impersonation changes
  useEffect(() => {
    setSelectedOrganization(null);
    setCartItems([]);
  }, [isImpersonating, effectiveUserId]);

  // Auto-load user's organization and check if setup is needed
  useEffect(() => {
    const loadUserOrganization = async () => {
      if (!effectiveUserId) {
        setCheckingOrganization(false);
        prevEffectiveUserIdRef.current = undefined;
        return;
      }

      if (selectedOrganization && !isImpersonating) {
        setCheckingOrganization(false);
        prevEffectiveUserIdRef.current = effectiveUserId;
        return;
      }

      // Only show the loading spinner when the user actually changes,
      // not on re-renders caused by token refresh (which keep the same userId).
      const userChanged = prevEffectiveUserIdRef.current !== effectiveUserId;
      prevEffectiveUserIdRef.current = effectiveUserId;

      try {
        if (userChanged) {
          setCheckingOrganization(true);
        }
        const { data, error } = await supabase
          .from('user_organization_roles')
          .select(`
            organization_id,
            organizations!inner(id, name, code, is_active)
          `)
          .eq('user_id', effectiveUserId)
          .eq('organizations.is_active', true);

        if (!error && data && data.length > 0) {
          setUserHasMultipleOrgs(data.length > 1);
          setNeedsOrganizationSetup(false);

          if (data.length === 1) {
            setSelectedOrganization(data[0].organizations);
          } else if (isImpersonating) {
            setSelectedOrganization(data[0].organizations);
          }
        } else {
          setNeedsOrganizationSetup(true);
          if (isImpersonating) {
            setSelectedOrganization(null);
          }
        }
      } catch (error) {
        console.error('Error loading user organization:', error);
      } finally {
        setCheckingOrganization(false);
      }
    };

    loadUserOrganization();
  }, [effectiveUserId, isImpersonating]);

  // Load cart from database when user or organization changes
  useEffect(() => {
    const loadCart = async () => {
      if (!user?.id || isImpersonating) {
        setCartItems([]);
        return;
      }

      try {
        const items = await cartService.getCart(user.id, selectedOrganization?.id);
        setCartItems(items);
      } catch (error) {
        console.error('Error loading cart:', error);
      }
    };

    loadCart();
  }, [user?.id, selectedOrganization?.id, isImpersonating]);

  // Save cart to database whenever it changes
  useEffect(() => {
    const saveCart = async () => {
      if (!user?.id || isImpersonating) return;

      try {
        await cartService.saveCart(user.id, cartItems, selectedOrganization?.id);
      } catch (error) {
        console.error('Error saving cart:', error);
      }
    };

    const timeoutId = setTimeout(saveCart, 500);
    return () => clearTimeout(timeoutId);
  }, [cartItems, user?.id, selectedOrganization?.id, isImpersonating]);

  // Fetch products with contract pricing when organization or user changes
  useEffect(() => {
    const fetchContractPricingProducts = async () => {
      if (!effectiveUserId) {
        setProductsWithContractPricing([]);
        return;
      }

      try {
        const productIds = await contractPricingService.getProductsWithContractPricing(
          selectedOrganization ? undefined : effectiveUserId,
          selectedOrganization?.id
        );
        setProductsWithContractPricing(productIds);
      } catch (error) {
        console.error('Error fetching contract pricing products:', error);
        setProductsWithContractPricing([]);
      }
    };

    fetchContractPricingProducts();

    if (!selectedOrganization) {
      setShowOnlyContractPricing(false);
    }
  }, [effectiveUserId, selectedOrganization]);
  const addToCart = async (productId: number, quantity: number = 1) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    // Require organization selection unless user only has one organization
    if (!selectedOrganization && userHasMultipleOrgs) {
      alert('Please select an organization before adding items to cart');
      setIsOrgSelectorOpen(true);
      return;
    }

    // Fetch the effective price (contract or regular)
    let effectivePrice = product.price;
    let retailPrice = product.price;
    let hasMarkup = false;

    if (effectiveUserId && (effectiveProfile || selectedOrganization)) {
      try {
        let priceResult;

        if (selectedOrganization) {
          const orgPricing = await contractPricingService.getOrganizationPricing(selectedOrganization.id);
          const productPricing = orgPricing.find(p => p.product_id === productId);

          if (productPricing &&
              quantity >= (productPricing.min_quantity || 1) &&
              (!productPricing.max_quantity || quantity <= productPricing.max_quantity)) {

            if (productPricing.markup_price !== null && productPricing.markup_price !== undefined) {
              effectivePrice = productPricing.markup_price;
              retailPrice = productPricing.contract_price || product.price;
              hasMarkup = true;
            } else if (productPricing.contract_price !== null && productPricing.contract_price !== undefined) {
              effectivePrice = productPricing.contract_price;
              retailPrice = effectivePrice;
              hasMarkup = false;
            }

            priceResult = {
              price: effectivePrice,
              source: 'organization' as const
            };
          }
        } else if (effectiveProfile) {
          priceResult = await contractPricingService.getEffectivePrice(
            effectiveUserId,
            productId,
            effectiveProfile.role,
            quantity
          );

          if (priceResult) {
            effectivePrice = priceResult.price;
            retailPrice = effectivePrice;
            hasMarkup = false;
          }
        }
      } catch (error) {
        console.error('Error fetching contract price for cart:', error);
      }
    }

    setCartItems(prev => {
      const existingItem = prev.find(item => item.id === productId);
      if (existingItem) {
        return prev.map(item =>
          item.id === productId
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      } else {
        const newItem = {
          id: product.id,
          name: product.name,
          price: effectivePrice,
          retailPrice: retailPrice,
          cost: product.cost,
          quantity: quantity,
          image: product.image,
          hasMarkup: hasMarkup,
          brand: product.brand
        };
        return [...prev, newItem];
      }
    });
  };

  const handleProductClick = (product: Product) => {
    setSelectedProduct(product);
    setIsProductModalOpen(true);
  };

  const handleCloseProductModal = () => {
    setIsProductModalOpen(false);
    setSelectedProduct(null);
  };


  const updateCartQuantity = (id: number, quantity: number) => {
    if (quantity === 0) {
      removeFromCart(id);
      return;
    }
    setCartItems(prev =>
      prev.map(item =>
        item.id === id ? { ...item, quantity } : item
      )
    );
  };

  const removeFromCart = (id: number) => {
    setCartItems(prev => prev.filter(item => item.id !== id));
  };

  const clearCart = () => {
    setCartItems([]);
    if (user?.id) {
      cartService.clearCart(user.id, selectedOrganization?.id).catch(error => {
        console.error('Error clearing cart from database:', error);
      });
    }
  };

  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  // Group products by category
  const productsByCategory = products.reduce((acc, product) => {
    const category = product.category;
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(product);
    return acc;
  }, {} as { [key: string]: Product[] });
  

  // Filter products based on search and filters
  const filteredProducts = products
    .filter(product => {
      const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           product.benefits.some(benefit => benefit.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesCategory = selectedCategory === 'all' || product.category === selectedCategory ||
        categoryTree.some(parent => parent.name === selectedCategory && parent.children?.some(child => child.name === product.category));
      const matchesPrice = product.price >= priceRange[0] && product.price <= priceRange[1];
      const matchesContractPricing = !showOnlyContractPricing || productsWithContractPricing.includes(product.id);
      return matchesSearch && matchesCategory && matchesPrice && matchesContractPricing;
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  if (isQuickBooksCallback) {
    return <QuickBooksCallback />;
  }

  if (activeLegalPage === 'eula') {
    return <EULAPage onBack={() => setActiveLegalPage(null)} />;
  }

  if (activeLegalPage === 'privacy') {
    return <PrivacyPolicyPage onBack={() => setActiveLegalPage(null)} />;
  }

  // Show loading or auth gate
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Password recovery must be checked BEFORE the !user gate — the session
  // may not be established yet when the user arrives via the recovery link.
  if (isPasswordRecovery) {
    return <ResetPassword onComplete={() => window.location.reload()} />;
  }

  // Show auth modal if user is not logged in
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header
          cartCount={0}
          onCartClick={() => {}}
          onAuthClick={() => setIsAuthModalOpen(true)}
          onProfileClick={() => {}}
          onAdminClick={() => {}}
          onOrdersClick={() => {}}
          onUsersClick={() => {}}
          onSalesRepClick={() => {}}
          onOrderHistoryClick={() => setIsAdminOpen(true)}
        />

        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="max-w-md w-full text-center">
            <div className="bg-white rounded-lg shadow-lg p-8">
              <div className="mb-6">
                <div className="w-16 h-16 bg-gradient-to-r from-pink-500 to-orange-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Required</h2>
                <p className="text-gray-600">
                  Please sign in to access our premium health products and personalized pricing.
                </p>
              </div>

              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="w-full bg-gradient-to-r from-pink-500 to-orange-500 text-white py-3 px-6 rounded-lg hover:from-pink-600 hover:to-orange-600 transition-all duration-200 font-semibold"
              >
                Sign In to Continue
              </button>

              <p className="text-sm text-gray-500 mt-4">
                New to HealthSpan360? Create an account to get started.
              </p>
            </div>
          </div>
        </div>

        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
        />
      </div>
    );
  }

  // When impersonating, skip all approval/setup gates for the impersonated user
  // The admin is already authenticated and authorized

  // Check if user is denied
  if (!isImpersonating && user && profile && profile.approval_status === 'denied') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="mb-6">
            <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h2>
          <p className="text-gray-600 mb-6">
            Your account access has been denied by an administrator. Please contact support if you believe this is an error.
          </p>
          <div className="space-y-3">
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.reload();
              }}
              className="w-full px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Check if user is pending approval
  if (!isImpersonating && user && profile && profile.approval_status === 'pending') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="mb-6">
            <div className="mx-auto w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Account Pending Approval</h2>
          <p className="text-gray-600 mb-6">
            Your account has been created successfully! An administrator will review and approve your account shortly.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            You will receive an email notification once your account has been approved.
          </p>
          <div className="space-y-3">
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.reload();
              }}
              className="w-full px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isImpersonating && user && profile && profile.approval_status === 'approved' && needsOrganizationSetup && !checkingOrganization) {
    const skipSetupRoles = ['admin', 'sales_rep', 'distributor'];

    if (!skipSetupRoles.includes(profile.role)) {
      return (
        <FirstTimeSetup
          onComplete={() => {
            setNeedsOrganizationSetup(false);
            window.location.reload();
          }}
        />
      );
    }
  }

  if (!isImpersonating && user && profile && profile.approval_status === 'approved' && checkingOrganization) {
    const skipSetupRoles = ['admin', 'sales_rep', 'distributor'];

    if (!skipSetupRoles.includes(profile.role)) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Setting up your account...</p>
          </div>
        </div>
      );
    }
  }

  // ── Admin page (static, full-page) ──────────────────────────────────────
  if (isAdminOpen) {
    return (
      <AdminDashboard
        onClose={() => {
          sessionStorage.removeItem('admin_active_tab');
          setIsAdminOpen(false);
          setAdminInitialTab(undefined);
        }}
        initialTab={adminInitialTab}
      />
    );
  }

  return (
      <div className="min-h-screen bg-gray-50">
        <ImpersonationBanner />
        <Header
          cartCount={cartCount}
          onCartClick={() => setIsCartOpen(true)}
          onAuthClick={() => setIsAuthModalOpen(true)}
          onProfileClick={() => setIsProfileOpen(true)}
          onAdminClick={() => {
            setAdminInitialTab(undefined);
            setIsAdminOpen(true);
          }}
          onOrdersClick={() => {
            setAdminInitialTab('orders');
            setIsAdminOpen(true);
          }}
          onUsersClick={() => {
            setAdminInitialTab('users');
            setIsAdminOpen(true);
          }}
          onSalesRepClick={() => setIsOrgSelectorOpen(true)}
          onOrderHistoryClick={() => {
            setAdminInitialTab('orders');
            setIsAdminOpen(true);
          }}
        />

        {/* Products Section */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="text-center mb-8">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Our Products</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto mb-6">
              Discover our comprehensive range of health and wellness solutions
            </p>

            {/* Organization Selector Button */}
            {(() => {
              const viewRole = effectiveProfile?.role ?? profile?.role;
              const isSalesRepOrDistributor = viewRole === 'sales_rep' || viewRole === 'distributor';
              const showSelectorButton = userHasMultipleOrgs || isSalesRepOrDistributor;

              if (showSelectorButton) {
                return (
                  <div className="flex justify-center">
                    <button
                      onClick={() => setIsOrgSelectorOpen(true)}
                      className="inline-flex items-center space-x-2 bg-gradient-to-r from-purple-500 to-blue-500 text-white px-6 py-3 rounded-lg hover:from-purple-600 hover:to-blue-600 transition-all duration-200 shadow-md hover:shadow-lg"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                      <span className="font-medium">
                        {selectedOrganization ? `Change Customer (${selectedOrganization.name})` : 'Select Customer'}
                      </span>
                    </button>
                  </div>
                );
              }

              if (selectedOrganization) {
                return (
                  <div className="flex justify-center">
                    <div className="inline-flex items-center space-x-2 bg-blue-50 text-blue-700 px-6 py-3 rounded-lg">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                      <span className="font-medium">Ordering for: {selectedOrganization.name}</span>
                    </div>
                  </div>
                );
              }

              return null;
            })()}
          </div>
          
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {[...Array(12)].map((_, i) => (
                <div key={i} className="animate-pulse bg-gray-200 rounded-lg h-96"></div>
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <div className="max-w-md mx-auto">
                <div className="bg-red-50 border border-red-200 rounded-lg p-6">
                  <div className="flex items-center space-x-2 mb-3">
                    <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <h3 className="text-lg font-semibold text-red-800">Configuration Required</h3>
                  </div>
                  <p className="text-red-700 mb-4">{error}</p>
                  <p className="text-sm text-gray-600 mt-2">
                    If this problem persists, please contact your administrator.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div>
              {/* Filters and Search */}
              <div className="flex flex-col lg:flex-row gap-8 mb-8">
                <div className="lg:w-64 flex-shrink-0 space-y-6">
                  <ProductFilter
                    categories={Object.keys(productsByCategory)}
                    categoryTree={categoryTree}
                    selectedCategory={selectedCategory}
                    onCategoryChange={setSelectedCategory}
                    priceRange={priceRange}
                    onPriceRangeChange={setPriceRange}
                    maxPrice={Math.ceil(Math.max(...products.map(p => p.price), 100))}
                    isOpen={isFilterOpen}
                    onToggle={() => setIsFilterOpen(!isFilterOpen)}
                  />
                  <FavoritesList
                    products={products.map(p => ({
                      id: p.id,
                      name: p.name,
                      image: p.image,
                      price: p.price
                    }))}
                    onProductClick={(productId) => {
                      const product = products.find(p => p.id === productId);
                      if (product) handleProductClick(product);
                    }}
                  />
                </div>
                
                <div className="flex-1">
                  {/* Search Bar */}
                  <div className="mb-6">
                    <div className="relative">
                      <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <input
                        id="main-product-search"
                        name="main-product-search"
                        type="text"
                        placeholder="Search products..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-lg"
                      />
                    </div>
                  </div>

                  {/* Results Summary and Filters */}
                  <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
                    <p className="text-gray-600">
                      Showing {filteredProducts.length} of {products.length} products
                      {selectedCategory !== 'all' && ` in ${selectedCategory}`}
                      {searchTerm && ` matching "${searchTerm}"`}
                    </p>

                    <div className="flex items-center space-x-4">
                      <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
                        <button
                          onClick={() => { setViewMode('grid'); localStorage.setItem('productViewMode', 'grid'); }}
                          className={`p-2 transition-colors ${
                            viewMode === 'grid'
                              ? 'bg-pink-500 text-white'
                              : 'bg-white text-gray-500 hover:bg-gray-100'
                          }`}
                          title="Grid view"
                        >
                          <LayoutGrid className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => { setViewMode('list'); localStorage.setItem('productViewMode', 'list'); }}
                          className={`p-2 transition-colors ${
                            viewMode === 'list'
                              ? 'bg-pink-500 text-white'
                              : 'bg-white text-gray-500 hover:bg-gray-100'
                          }`}
                          title="List view"
                        >
                          <List className="h-4 w-4" />
                        </button>
                      </div>

                      {selectedOrganization && (
                        <div className="flex items-center space-x-2 bg-blue-50 text-blue-700 px-3 py-2 rounded-lg text-sm">
                          <span className="font-medium">{selectedOrganization.name}</span>
                          <button
                            onClick={() => setSelectedOrganization(null)}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            ×
                          </button>
                        </div>
                      )}

                      <label className={`flex items-center space-x-2 ${selectedOrganization ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                        <input
                          type="checkbox"
                          checked={showOnlyContractPricing}
                          onChange={(e) => setShowOnlyContractPricing(e.target.checked)}
                          disabled={!selectedOrganization}
                          className="rounded border-gray-300 text-pink-600 focus:ring-pink-500 disabled:cursor-not-allowed"
                        />
                        <span className="text-sm text-gray-700">
                          Only show contract pricing
                          {!selectedOrganization && ' (select customer first)'}
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Product Grid */}
                  <ProductGrid
                    products={filteredProducts}
                    onAddToCart={addToCart}
                    onProductClick={handleProductClick}
                    organizationId={selectedOrganization?.id}
                    viewMode={viewMode}
                  />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Featured Benefits Section */}
        <section className="bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">Why Choose HealthSpan360?</h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Experience the difference with our science-backed approach to health optimization
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-16 h-16 bg-gradient-to-r from-pink-500 to-orange-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Science-Based</h3>
                <p className="text-gray-600">All our products are backed by rigorous scientific research and clinical studies.</p>
              </div>
              
              <div className="text-center">
                <div className="w-16 h-16 bg-gradient-to-r from-pink-500 to-orange-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Personalized</h3>
                <p className="text-gray-600">Tailored solutions based on your unique genetic profile and health goals.</p>
              </div>
              
              <div className="text-center">
                <div className="w-16 h-16 bg-gradient-to-r from-pink-500 to-orange-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Expert Support</h3>
                <p className="text-gray-600">Access to healthcare professionals and personalized guidance throughout your journey.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Newsletter Section */}
        <section className="bg-gradient-to-r from-pink-600 to-orange-600 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <div className="text-center">
              <h2 className="text-3xl font-bold mb-4">Stay Connected with HealthSpan360</h2>
              <p className="text-pink-100 mb-8 max-w-2xl mx-auto">
                Get the latest insights on peptide therapy, genetic testing, and personalized healthcare delivered to your inbox.
              </p>
              <div className="max-w-md mx-auto flex">
                <input
                  type="email"
                  placeholder="Enter your email"
                  className="flex-1 px-4 py-2 rounded-l-lg text-gray-900"
                />
                <button className="px-6 py-2 bg-white text-pink-600 rounded-r-lg hover:bg-gray-100 transition-colors">
                  Subscribe
                </button>
              </div>
            </div>
          </div>
        </section>

        <Footer onNavigateToLegal={setActiveLegalPage} />

        <Cart
          isOpen={isCartOpen}
          onClose={() => setIsCartOpen(false)}
          items={cartItems}
          onUpdateQuantity={updateCartQuantity}
          onRemoveItem={removeFromCart}
          onClearCart={clearCart}
          organizationId={selectedOrganization?.id}
        />

        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
        />

        <ProductModal
          product={selectedProduct}
          isOpen={isProductModalOpen}
          onClose={handleCloseProductModal}
          onAddToCart={addToCart}
          organizationId={selectedOrganization?.id}
        />
        <UserProfile
          isOpen={isProfileOpen}
          onClose={() => setIsProfileOpen(false)}
        />


        <OrganizationSelector
          isOpen={isOrgSelectorOpen}
          onClose={() => setIsOrgSelectorOpen(false)}
          onSelectOrganization={setSelectedOrganization}
          selectedOrganization={selectedOrganization}
        />

        <ErrorDebugPanel errors={errors} onClearErrors={clearErrors} />

        <Toast
          message={toastMessage || ''}
          type={toastType || 'success'}
          isVisible={!!toastMessage}
          onClose={clearToast}
        />
      </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <FavoritesProvider>
        <AppContent />
      </FavoritesProvider>
    </AuthProvider>
  );
}

export default App;