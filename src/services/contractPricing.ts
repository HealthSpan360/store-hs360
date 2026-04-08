import { supabase, ContractPricing } from './supabase';
import { cacheService, CacheKeys, CacheTTL } from './cache';

type PricingType = 'individual' | 'organization';

export interface ContractPrice {
  id: string;
  pricing_type: PricingType;
  entity_id: string;
  user_id?: string; // Legacy field for backward compatibility
  product_id: number;
  contract_price: number;
  min_quantity?: number;
  max_quantity?: number;
  effective_date?: string;
  expiry_date?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

class ContractPricingService {
  private pendingOrgPricingRequests = new Map<string, Promise<ContractPrice[]>>();

  /**
   * Get contract price for a specific entity and product
   */
  async getContractPrice(
    entityId: string, 
    productId: number, 
    pricingType: PricingType = 'individual'
  ): Promise<ContractPrice | null> {
    // Try cache first
    const cacheKey = `contract_price_${pricingType}_${entityId}_${productId}`;
    const cached = cacheService.get<ContractPrice | null>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    try {
      const { data, error } = await supabase
        .from('contract_pricing')
        .select('*')
        .eq('pricing_type', pricingType)
        .eq('entity_id', entityId)
        .eq('product_id', productId)
        .lte('effective_date', new Date().toISOString())
        .or('expiry_date.is.null,expiry_date.gte.' + new Date().toISOString())
        .order('effective_date', { ascending: false })
        .maybeSingle();

      if (error) {
        throw error;
      }

      // Cache the result (including null results)
      cacheService.set(cacheKey, data, CacheTTL.pricing);

      return data;
    } catch (error) {
      console.error('Error fetching contract price:', error);
      return null;
    }
  }

  /**
   * Get all contract prices for an entity
   */
  async getEntityContractPrices(
    entityId: string, 
    pricingType: PricingType = 'individual'
  ): Promise<ContractPrice[]> {
    // Try cache first
    const cacheKey = `entity_prices_${pricingType}_${entityId}`;
    const cached = cacheService.get<ContractPrice[]>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const { data, error } = await supabase
        .from('contract_pricing')
        .select('*')
        .eq('pricing_type', pricingType)
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      const result = data || [];
      
      // Cache the result
      cacheService.set(cacheKey, result, CacheTTL.pricing);
      
      return result;
    } catch (error) {
      console.error('Error fetching user contract prices:', error);
      return [];
    }
  }

  /**
   * Get organization-specific pricing for sales rep orders
   * Returns all tiers, caller should filter by quantity
   */
  async getOrganizationPricing(organizationId: string): Promise<ContractPrice[]> {
    const cacheKey = `org_pricing_all_${organizationId}`;

    // Return from cache if available
    const cached = cacheService.get<ContractPrice[]>(cacheKey);
    if (cached) return cached;

    // Deduplicate concurrent requests for the same org
    const pending = this.pendingOrgPricingRequests.get(cacheKey);
    if (pending) return pending;

    const request = (async () => {
      try {
        const { data, error } = await supabase
          .from('contract_pricing')
          .select('*')
          .eq('pricing_type', 'organization')
          .eq('entity_id', organizationId)
          .lte('effective_date', new Date().toISOString())
          .or('expiry_date.is.null,expiry_date.gte.' + new Date().toISOString())
          .order('min_quantity', { ascending: true });

        if (error) throw error;

        const result = data || [];
        cacheService.set(cacheKey, result, CacheTTL.pricing);
        return result;
      } catch (error) {
        console.error('Error fetching organization pricing:', error);
        return [];
      } finally {
        this.pendingOrgPricingRequests.delete(cacheKey);
      }
    })();

    this.pendingOrgPricingRequests.set(cacheKey, request);
    return request;
  }

  /**
   * Set contract price for any entity and product (Admin only)
   */
  async setContractPrice(
    entityId: string,
    productId: number,
    contractPrice: number | undefined,
    pricingType: PricingType = 'individual',
    minQuantity: number = 1,
    maxQuantity?: number,
    effectiveDate?: string,
    expiryDate?: string,
    markupPrice?: number,
    id?: string,
    allowBelowCost?: boolean,
    overrideReason?: string
  ): Promise<{ success: boolean; error?: string; data?: any }> {
    try {
      // Enforce cost floor: contract price must not be below product cost
      if (contractPrice != null) {
        const { data: product } = await supabase
          .from('products')
          .select('cost')
          .eq('id', productId)
          .single();

        if (product?.cost != null && contractPrice < product.cost) {
          return {
            success: false,
            error: `Price $${contractPrice.toFixed(2)} is below product cost $${product.cost.toFixed(2)}. Cost is the absolute floor.`,
          };
        }
      }

      const { data, error } = await supabase
        .from('contract_pricing')
        .upsert({
          ...(id && { id }), // Include ID if editing existing record
          pricing_type: pricingType,
          entity_id: entityId,
          // Keep user_id for backward compatibility with individual pricing
          ...(pricingType === 'individual' && { user_id: entityId }),
          product_id: productId,
          contract_price: contractPrice || null,
          markup_price: markupPrice || null,
          min_quantity: minQuantity,
          max_quantity: maxQuantity,
          effective_date: effectiveDate || new Date().toISOString(),
          expiry_date: expiryDate,
          allow_below_cost: allowBelowCost || false,
          override_reason: overrideReason || null,
        })
        .select()
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      // Invalidate related cache entries
      this.invalidatePricingCache(entityId, productId, pricingType);
      return { success: true, data };
    } catch (error) {
      console.error('Error setting contract price:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Remove contract price by ID (Admin only)
   */
  async removeContractPriceById(
    id: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('contract_pricing')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Error removing contract price:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Remove contract price for an entity and product (Admin only)
   * @deprecated Use removeContractPriceById instead to avoid deleting multiple records
   */
  async removeContractPrice(
    entityId: string,
    productId: number,
    pricingType: PricingType = 'individual',
    effectiveDate?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      let query = supabase
        .from('contract_pricing')
        .delete()
        .eq('pricing_type', pricingType)
        .eq('entity_id', entityId)
        .eq('product_id', productId);

      if (effectiveDate) {
        query = query.eq('effective_date', effectiveDate);
      }

      const { error } = await query;

      if (error) {
        return { success: false, error: error.message };
      }

      // Invalidate related cache entries
      this.invalidatePricingCache(entityId, productId, pricingType);
      return { success: true };
    } catch (error) {
      console.error('Error removing contract price:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Get all contract prices for a product across all entities (Admin only)
   */
  async getProductContractPrices(productId: number): Promise<ContractPrice[]> {
    try {
      const { data, error } = await supabase
        .from('contract_pricing')
        .select('*')
        .eq('product_id', productId)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        return [];
      }

      const profileIds = data.filter(p => p.pricing_type === 'individual').map(p => p.entity_id);
      const orgIds = data.filter(p => p.pricing_type === 'organization').map(p => p.entity_id);

      const [profiles, organizations] = await Promise.all([
        profileIds.length > 0
          ? supabase.from('profiles').select('id, email, role').in('id', profileIds)
          : Promise.resolve({ data: [] }),
        orgIds.length > 0
          ? supabase.from('organizations').select('id, name, code').in('id', orgIds)
          : Promise.resolve({ data: [] }),
      ]);

      const profileMap = new Map((profiles.data || []).map(p => [p.id, p]));
      const orgMap = new Map((organizations.data || []).map(o => [o.id, o]));

      return data.map(pricing => ({
        ...pricing,
        profiles: pricing.pricing_type === 'individual' ? profileMap.get(pricing.entity_id) : undefined,
        organizations: pricing.pricing_type === 'organization' ? orgMap.get(pricing.entity_id) : undefined,
      }));
    } catch (error) {
      console.error('Error fetching product contract prices:', error);
      return [];
    }
  }

  /**
   * Calculate the effective price for a user considering all pricing levels
   */
  async getEffectivePrice(
    userId: string,
    productId: number,
    userRole?: string,
    quantity?: number
  ): Promise<{ price: number; source: 'regular' | 'individual' | 'organization' } | null> {
    // Try cache first
    const cacheKey = CacheKeys.effectivePrice(userId, productId, quantity);
    const cached = cacheService.get<{ price: number; source: 'regular' | 'individual' | 'organization' } | null>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // If user is not logged in or not approved, return regular price
    if (!userId || (userRole && !['approved', 'admin'].includes(userRole))) {
      return null;
    }

    try {
      // Check for organization-level pricing first (higher priority)
      const organizationPrice = await this.getOrganizationPrice(userId, productId, quantity);
      if (organizationPrice) {
        const finalPrice = organizationPrice.markup_price || organizationPrice.contract_price;
        if (finalPrice !== null && finalPrice !== undefined) {
          const result = {
            price: finalPrice,
            source: 'organization' as const
          };
          cacheService.set(cacheKey, result, CacheTTL.effectivePrice);
          return result;
        }
      }

      // Check for individual contract pricing
      const contractPrice = await this.getContractPrice(userId, productId, 'individual');

      if (contractPrice) {
        const finalPrice = contractPrice.markup_price || contractPrice.contract_price;
        if (finalPrice !== null && finalPrice !== undefined) {
          const result = {
            price: finalPrice,
            source: 'individual' as const
          };
          cacheService.set(cacheKey, result, CacheTTL.effectivePrice);
          return result;
        }
      }

      // Cache null result too
      cacheService.set(cacheKey, null, CacheTTL.effectivePrice);
      return null;
    } catch (error) {
      console.error('Error calculating effective price:', error);
      return null;
    }
  }

  /**
   * Invalidate pricing cache entries for a specific entity/product
   */
  private invalidatePricingCache(entityId: string, productId: number, pricingType: PricingType): void {
    // Clear specific cache entries
    const contractPriceKey = `contract_price_${pricingType}_${entityId}_${productId}`;
    const entityPricesKey = `entity_prices_${pricingType}_${entityId}`;
    const orgPricingAllKey = `org_pricing_all_${entityId}`;

    cacheService.delete(contractPriceKey);
    cacheService.delete(entityPricesKey);
    cacheService.delete(orgPricingAllKey);
    
    // Clear effective price cache for this user/product combination
    // Note: We can't easily clear all quantity variations, so we'll let them expire naturally
    const effectivePriceKey = CacheKeys.effectivePrice(entityId, productId);
    cacheService.delete(effectivePriceKey);
    
  }

  /**
   * Clear all pricing cache (useful for admin operations)
   */
  clearPricingCache(): void {
    // This is a simple implementation - in a more sophisticated system,
    // we might track cache keys by category
    cacheService.clear();
  }

  /**
   * Get organization-level pricing for a user and product (now uses unified table)
   */
  async getOrganizationPrice(userId: string, productId: number, quantity?: number): Promise<any | null> {
    // Try cache first
    const cacheKey = `org_price_${userId}_${productId}_${quantity || 1}`;
    const cached = cacheService.get<any | null>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    try {
      // Get user's organizations through organization roles
      const { data: userRoles, error: rolesError } = await supabase
        .from('user_organization_roles')
        .select(`
          organization_id,
          organizations(id, name)
        `)
        .eq('user_id', userId);

      if (rolesError || !userRoles?.length) {
        cacheService.set(cacheKey, null, CacheTTL.pricing);
        return null;
      }

      const organizationIds = userRoles.map(role => role.organization_id).filter(Boolean);
      
      // Return null immediately if no organization IDs found
      if (organizationIds.length === 0) {
        cacheService.set(cacheKey, null, CacheTTL.pricing);
        return null;
      }

      let query = supabase
        .from('contract_pricing')
        .select('*')
        .eq('pricing_type', 'organization')
        .in('entity_id', organizationIds)
        .eq('product_id', productId)
        .lte('effective_date', new Date().toISOString())
        .or('expiry_date.is.null,expiry_date.gte.' + new Date().toISOString());
      
      // Add quantity filtering if provided
      if (quantity !== undefined) {
        query = query
          .lte('min_quantity', quantity)
          .or('max_quantity.is.null,max_quantity.gte.' + quantity);
      }
      
      const { data, error } = await query
        .order('contract_price', { ascending: true }) // Get lowest price first
        .order('effective_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw error;
      }

      // Cache the result
      cacheService.set(cacheKey, data, CacheTTL.pricing);
      return data;
    } catch (error) {
      console.error('Error fetching organization price:', error);
      return null;
    }
  }

  /**
   * Legacy method - now uses unified setContractPrice
   */
  async setOrganizationPrice(
    organizationId: string,
    productId: number,
    contractPrice: number,
    minQuantity?: number,
    maxQuantity?: number,
    effectiveDate?: string,
    expiryDate?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      return await this.setContractPrice(
        organizationId,
        productId,
        contractPrice,
        'organization',
        minQuantity,
        maxQuantity,
        effectiveDate,
        expiryDate
      );
    } catch (error) {
      console.error('Error setting organization price:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      };
    }
  }

  /**
   * Legacy method - now uses unified removeContractPrice
   */
  async removeOrganizationPrice(
    organizationId: string,
    productId: number,
    effectiveDate?: string
  ): Promise<{ success: boolean; error?: string }> {
    return await this.removeContractPrice(organizationId, productId, 'organization', effectiveDate);
  }

  /**
   * Get all pricing entries for admin management
   */
  async getAllPricingEntries(): Promise<ContractPrice[]> {
    try {
      const { data, error } = await supabase
        .from('contract_pricing')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        return [];
      }

      const profileIds = data.filter(p => p.pricing_type === 'individual').map(p => p.entity_id);
      const orgIds = data.filter(p => p.pricing_type === 'organization').map(p => p.entity_id);

      const [profiles, organizations] = await Promise.all([
        profileIds.length > 0
          ? supabase.from('profiles').select('id, email').in('id', profileIds)
          : Promise.resolve({ data: [] }),
        orgIds.length > 0
          ? supabase.from('organizations').select('id, name, code').in('id', orgIds)
          : Promise.resolve({ data: [] }),
      ]);

      const profileMap = new Map((profiles.data || []).map(p => [p.id, p]));
      const orgMap = new Map((organizations.data || []).map(o => [o.id, o]));

      return data.map(pricing => ({
        ...pricing,
        profiles: pricing.pricing_type === 'individual' ? profileMap.get(pricing.entity_id) : undefined,
        organizations: pricing.pricing_type === 'organization' ? orgMap.get(pricing.entity_id) : undefined,
      }));
    } catch (error) {
      console.error('Error fetching all pricing entries:', error);
      return [];
    }
  }

  /**
   * Get pricing entries for a specific organization
   */
  async getOrganizationPricingEntries(organizationId: string): Promise<ContractPrice[]> {
    try {
      const { data: orgPricing, error: orgError } = await supabase
        .from('contract_pricing')
        .select('*')
        .eq('pricing_type', 'organization')
        .eq('entity_id', organizationId);

      if (orgError) throw orgError;

      if (!orgPricing || orgPricing.length === 0) {
        return [];
      }

      const orgData = await supabase
        .from('organizations')
        .select('id, name, code')
        .eq('id', organizationId)
        .maybeSingle();

      return orgPricing.map(pricing => ({
        ...pricing,
        organizations: orgData.data || undefined,
      }));
    } catch (error) {
      console.error('Error fetching organization pricing entries:', error);
      return [];
    }
  }

  /**
   * Get list of product IDs that have contract pricing available
   * Can filter by user, organization, or get all products with any contract pricing
   */
  async getProductsWithContractPricing(userId?: string, organizationId?: string): Promise<number[]> {
    try {
      let query = supabase
        .from('contract_pricing')
        .select('product_id');

      if (userId) {
        query = query.eq('pricing_type', 'individual').eq('entity_id', userId);
      } else if (organizationId) {
        query = query.eq('pricing_type', 'organization').eq('entity_id', organizationId);
      }

      const { data, error } = await query;

      if (error) throw error;

      const uniqueProductIds = [...new Set(data?.map(p => p.product_id) || [])];
      return uniqueProductIds;
    } catch (error) {
      console.error('Error fetching products with contract pricing:', error);
      return [];
    }
  }
}

export const contractPricingService = new ContractPricingService();