-- Migration: convert_customer_to_distributor
-- Creates a SECURITY DEFINER function that atomically converts a customer
-- profile into a distributor, creating the distributors record and migrating
-- organization relationships to distributor_customers.

CREATE OR REPLACE FUNCTION public.convert_customer_to_distributor(
  p_profile_id    uuid,
  p_name          text,
  p_code          text,
  p_commission_type text DEFAULT 'percent_margin',
  p_pricing_model   text DEFAULT 'margin_split',
  p_commission_rate numeric DEFAULT NULL,
  p_contact_name  text DEFAULT NULL,
  p_address       text DEFAULT NULL,
  p_city          text DEFAULT NULL,
  p_state         text DEFAULT NULL,
  p_zip           text DEFAULT NULL,
  p_phone         text DEFAULT NULL,
  p_notes         text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_role  text;
  v_distributor_id uuid;
  v_org_record    record;
BEGIN
  -- 1. Verify user exists and is currently a customer
  SELECT role INTO v_current_role
    FROM profiles
   WHERE id = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile % not found', p_profile_id;
  END IF;

  IF v_current_role IS DISTINCT FROM 'customer' THEN
    RAISE EXCEPTION 'Profile % has role "%" — only customers can be converted',
      p_profile_id, COALESCE(v_current_role, 'NULL');
  END IF;

  -- 2. Verify code is unique
  IF EXISTS (SELECT 1 FROM distributors WHERE code = p_code) THEN
    RAISE EXCEPTION 'Distributor code "%" already exists', p_code;
  END IF;

  -- 3. Update profile role
  UPDATE profiles
     SET role = 'distributor',
         updated_at = now()
   WHERE id = p_profile_id;

  -- 4. Create distributor record
  INSERT INTO distributors (
    id, profile_id, user_id, name, code,
    commission_type, pricing_model, commission_rate,
    contact_name, address, city, state, zip, phone, notes,
    is_active
  ) VALUES (
    gen_random_uuid(), p_profile_id, p_profile_id, p_name, p_code,
    p_commission_type, p_pricing_model, p_commission_rate,
    p_contact_name, p_address, p_city, p_state, p_zip, p_phone, p_notes,
    true
  )
  RETURNING id INTO v_distributor_id;

  -- 5. Migrate organization memberships → distributor_customers
  FOR v_org_record IN
    SELECT DISTINCT uor.organization_id
      FROM user_organization_roles uor
     WHERE uor.user_id = p_profile_id
  LOOP
    INSERT INTO distributor_customers (distributor_id, organization_id, is_active, notes)
    VALUES (v_distributor_id, v_org_record.organization_id, true,
            'Auto-created during customer-to-distributor conversion')
    ON CONFLICT (distributor_id, organization_id) DO NOTHING;
  END LOOP;

  -- 6. Remove old customer org memberships
  DELETE FROM user_organization_roles
   WHERE user_id = p_profile_id;

  RETURN v_distributor_id;
END;
$$;

-- Only admins should call this function (enforced at the app layer as well)
COMMENT ON FUNCTION public.convert_customer_to_distributor IS
  'Atomically converts a customer profile to a distributor, creating the distributor record and migrating org relationships.';
