import { supabase } from '@/services/supabase';

export interface ConvertToDistributorParams {
  profileId: string;
  name: string;
  code: string;
  commissionType?: string;
  pricingModel?: string;
  commissionRate?: number | null;
  contactName?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  notes?: string;
}

export interface ConvertToDistributorResult {
  success: boolean;
  distributorId?: string;
  error?: string;
}

/**
 * Converts a customer profile to a distributor by calling the database function
 * that atomically:
 *  1. Updates the profile role to 'distributor'
 *  2. Creates a distributors record
 *  3. Migrates organization memberships to distributor_customers
 *  4. Removes old user_organization_roles entries
 */
export async function convertCustomerToDistributor(
  params: ConvertToDistributorParams
): Promise<ConvertToDistributorResult> {
  try {
    const { data, error } = await supabase.rpc('convert_customer_to_distributor', {
      p_profile_id: params.profileId,
      p_name: params.name,
      p_code: params.code,
      p_commission_type: params.commissionType || 'percent_margin',
      p_pricing_model: params.pricingModel || 'margin_split',
      p_commission_rate: params.commissionRate ?? null,
      p_contact_name: params.contactName || null,
      p_address: params.address || null,
      p_city: params.city || null,
      p_state: params.state || null,
      p_zip: params.zip || null,
      p_phone: params.phone || null,
      p_notes: params.notes || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, distributorId: data as string };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to convert customer to distributor',
    };
  }
}

/**
 * Fetches existing distributor codes so the UI can auto-generate a unique one.
 */
export async function fetchDistributorCodes(): Promise<string[]> {
  const { data } = await supabase
    .from('distributors')
    .select('code')
    .not('code', 'is', null);

  return (data || []).map((d) => d.code);
}
