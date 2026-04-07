import { supabase } from '@/services/supabase';

export interface ConvertOrgToDistributorParams {
  organizationId: string;
  distributorName: string;
  distributorCode: string;
  ownerProfileId?: string | null;
  commissionType?: string;
  pricingModel?: string;
  commissionRate?: number | null;
  contactName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export interface ConvertOrgToDistributorResult {
  success: boolean;
  distributorId?: string;
  ownerProfileId?: string;
  error?: string;
}

/**
 * Converts a customer organization to a distributor by calling the database
 * function that atomically:
 *  1. Flips org_type from 'customer' to 'distributor'
 *  2. Creates a distributors record
 *  3. Promotes the primary user's profile role to 'distributor'
 *  4. Cleans up user_organization_roles for the promoted user
 */
export async function convertOrgToDistributor(
  params: ConvertOrgToDistributorParams
): Promise<ConvertOrgToDistributorResult> {
  try {
    const { data, error } = await supabase.rpc('convert_customer_to_distributor', {
      p_organization_id: params.organizationId,
      p_distributor_name: params.distributorName,
      p_distributor_code: params.distributorCode,
      p_owner_profile_id: params.ownerProfileId || null,
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

    const result = data as { distributor_id: string; owner_profile_id: string };
    return {
      success: true,
      distributorId: result.distributor_id,
      ownerProfileId: result.owner_profile_id,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to convert organization to distributor',
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

/**
 * Fetches the members of an organization (for owner selection dropdown).
 * If the org has no user_organization_roles entries, falls back to
 * looking up a profile matching the org's contact_email.
 */
export async function fetchOrgMembers(organizationId: string) {
  const { data, error } = await supabase
    .from('user_organization_roles')
    .select('user_id, role, profiles(id, email, full_name)')
    .eq('organization_id', organizationId);

  if (error) return [];

  const members = (data || []).map((row: any) => ({
    userId: row.user_id,
    orgRole: row.role,
    email: row.profiles?.email || '',
    fullName: row.profiles?.full_name || '',
  }));

  // If no org members found, try matching by the org's contact_email
  if (members.length === 0) {
    const { data: orgData } = await supabase
      .from('organizations')
      .select('contact_email')
      .eq('id', organizationId)
      .single();

    if (orgData?.contact_email) {
      const { data: profileMatch } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .eq('email', orgData.contact_email)
        .is('deleted_at', null)
        .limit(1);

      if (profileMatch && profileMatch.length > 0) {
        const p = profileMatch[0];
        members.push({
          userId: p.id,
          orgRole: 'contact',
          email: p.email,
          fullName: p.full_name || '',
        });
      }
    }
  }

  return members;
}
