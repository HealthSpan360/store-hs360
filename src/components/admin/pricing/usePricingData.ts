import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/services/supabase';
import { contractPricingService, ContractPrice } from '@/services/contractPricing';

export interface EnrichedPricingEntry extends ContractPrice {
  entity_name: string;
  entity_detail?: string;
  product_name?: string;
}

export interface ProductOption {
  id: number;
  name: string;
  sku: string | null;
  price: number;
  cost: number | null;
}

interface OrganizationOption {
  id: string;
  name: string;
  code: string;
}

interface UserOption {
  id: string;
  email: string;
  full_name?: string;
}

export function usePricingData(organizationId?: string) {
  const [entries, setEntries] = useState<EnrichedPricingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchPricingData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = organizationId
        ? await contractPricingService.getOrganizationPricingEntries(organizationId)
        : await contractPricingService.getAllPricingEntries();

      const enriched: EnrichedPricingEntry[] = data.map((entry: any) => {
        let entity_name = 'Unknown';
        let entity_detail: string | undefined;

        if (entry.pricing_type === 'individual' && entry.profiles) {
          entity_name = entry.profiles.email || 'Unknown User';
        } else if (entry.pricing_type === 'organization' && entry.organizations) {
          entity_name = entry.organizations.name || 'Unknown Org';
          entity_detail = entry.organizations.code;
        }

        return {
          ...entry,
          entity_name,
          entity_detail,
        };
      });

      setEntries(enriched);
    } catch (err) {
      console.error('Error fetching pricing data:', err);
      setError('Failed to load pricing data');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  const fetchProducts = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('products')
        .select('id, name, sku, price, cost')
        .eq('is_active', true)
        .order('name');
      if (data) setProducts(data as ProductOption[]);
    } catch (err) {
      console.error('Error fetching products for pricing:', err);
    }
  }, []);

  const fetchEntityOptions = useCallback(async () => {
    try {
      const [orgsRes, usersRes] = await Promise.all([
        supabase
          .from('organizations')
          .select('id, name, code')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('profiles')
          .select('id, email, full_name')
          .eq('approved', true)
          .order('email'),
      ]);

      if (orgsRes.data) setOrganizations(orgsRes.data);
      if (usersRes.data) setUsers(usersRes.data);
    } catch (err) {
      console.error('Error fetching entity options:', err);
    }
  }, []);

  useEffect(() => {
    fetchPricingData();
    fetchEntityOptions();
    fetchProducts();
  }, [fetchPricingData, fetchEntityOptions, fetchProducts]);

  const savePricing = async (params: {
    id?: string;
    entityId: string;
    productId: number;
    pricingType: 'individual' | 'organization';
    contractPrice?: number;
    markupPrice?: number;
    minQuantity: number;
    maxQuantity?: number;
    effectiveDate?: string;
    expiryDate?: string;
  }) => {
    setSaving(true);
    try {
      const result = await contractPricingService.setContractPrice(
        params.entityId,
        params.productId,
        params.contractPrice,
        params.pricingType,
        params.minQuantity,
        params.maxQuantity,
        params.effectiveDate,
        params.expiryDate,
        params.markupPrice,
        params.id
      );

      if (result.success) {
        await fetchPricingData();
      }
      return result;
    } finally {
      setSaving(false);
    }
  };

  const deletePricing = async (id: string) => {
    setSaving(true);
    try {
      const result = await contractPricingService.removeContractPriceById(id);
      if (result.success) {
        await fetchPricingData();
      }
      return result;
    } finally {
      setSaving(false);
    }
  };

  return {
    entries,
    loading,
    error,
    saving,
    organizations,
    users,
    products,
    fetchPricingData,
    savePricing,
    deletePricing,
  };
}
