-- Drop any previous version of this function (old profile-based signature)
DROP FUNCTION IF EXISTS public.convert_customer_to_distributor(uuid, text, text, text, text, numeric, text, text, text, text, text, text, text);

-- Migration: convert_customer_to_distributor
-- Converts a customer organization into a distributor. This:
--   1. Flips the org's org_type from 'customer' to 'distributor'
--   2. Picks a primary user from the org to become the distributor owner
--   3. Creates a distributors record
--   4. Updates that user's profile role to 'distributor'
--   5. Removes user_organization_roles for the promoted user
--      (other org members are left as-is since they may still be customers)

CREATE OR REPLACE FUNCTION public.convert_customer_to_distributor(
  p_organization_id uuid,
  p_distributor_name text,
  p_distributor_code text,
  p_owner_profile_id uuid DEFAULT NULL,      -- if NULL, picks the org admin / first member
  p_commission_type  text DEFAULT 'percent_margin',
  p_pricing_model    text DEFAULT 'margin_split',
  p_commission_rate  numeric DEFAULT NULL,
  p_contact_name     text DEFAULT NULL,
  p_address          text DEFAULT NULL,
  p_city             text DEFAULT NULL,
  p_state            text DEFAULT NULL,
  p_zip              text DEFAULT NULL,
  p_phone            text DEFAULT NULL,
  p_notes            text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org              record;
  v_owner_id         uuid;
  v_distributor_id   uuid;
  v_member           record;
BEGIN
  -- ── 1. Validate the organization ──────────────────────────────────────────
  SELECT id, name, org_type, is_active
    INTO v_org
    FROM organizations
   WHERE id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization % not found', p_organization_id;
  END IF;

  IF v_org.org_type = 'distributor' THEN
    RAISE EXCEPTION 'Organization "%" is already a distributor', v_org.name;
  END IF;

  -- ── 2. Validate distributor code uniqueness ───────────────────────────────
  IF EXISTS (SELECT 1 FROM distributors WHERE code = p_distributor_code) THEN
    RAISE EXCEPTION 'Distributor code "%" already exists', p_distributor_code;
  END IF;

  -- ── 3. Resolve the owner profile ─────────────────────────────────────────
  IF p_owner_profile_id IS NOT NULL THEN
    -- Verify the supplied owner is a member of this org
    IF NOT EXISTS (
      SELECT 1 FROM user_organization_roles
       WHERE organization_id = p_organization_id
         AND user_id = p_owner_profile_id
    ) THEN
      RAISE EXCEPTION 'Profile % is not a member of organization %',
        p_owner_profile_id, p_organization_id;
    END IF;
    v_owner_id := p_owner_profile_id;
  ELSE
    -- Auto-pick: prefer org-level admin, then manager, then first member
    SELECT user_id INTO v_owner_id
      FROM user_organization_roles
     WHERE organization_id = p_organization_id
     ORDER BY
       CASE role
         WHEN 'admin'   THEN 1
         WHEN 'manager' THEN 2
         WHEN 'member'  THEN 3
         ELSE 4
       END,
       created_at ASC
     LIMIT 1;

    IF v_owner_id IS NULL THEN
      RAISE EXCEPTION 'Organization "%" has no members to promote', v_org.name;
    END IF;
  END IF;

  -- ── 4. Update the organization type ───────────────────────────────────────
  UPDATE organizations
     SET org_type = 'distributor',
         updated_at = now()
   WHERE id = p_organization_id;

  -- ── 5. Create the distributor record ──────────────────────────────────────
  INSERT INTO distributors (
    id, profile_id, user_id, name, code,
    commission_type, pricing_model, commission_rate,
    contact_name, address, city, state, zip, phone, notes,
    is_active
  ) VALUES (
    gen_random_uuid(), v_owner_id, v_owner_id,
    p_distributor_name, p_distributor_code,
    p_commission_type, p_pricing_model, p_commission_rate,
    p_contact_name, p_address, p_city, p_state, p_zip, p_phone, p_notes,
    true
  )
  RETURNING id INTO v_distributor_id;

  -- ── 6. Update owner profile role ──────────────────────────────────────────
  UPDATE profiles
     SET role = 'distributor',
         updated_at = now()
   WHERE id = v_owner_id
     AND (role IS NULL OR role = 'customer');

  -- ── 7. Remove owner from user_organization_roles ─────────────────────────
  --    (they now access the system as a distributor, not an org member)
  DELETE FROM user_organization_roles
   WHERE user_id = v_owner_id
     AND organization_id = p_organization_id;

  -- ── 8. Return summary ────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'distributor_id', v_distributor_id,
    'owner_profile_id', v_owner_id,
    'organization_id', p_organization_id
  );
END;
$$;

COMMENT ON FUNCTION public.convert_customer_to_distributor IS
  'Atomically converts a customer organization into a distributor, creating the distributor record and promoting the primary user.';
