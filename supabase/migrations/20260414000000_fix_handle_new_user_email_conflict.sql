-- ═══════════════════════════════════════════════════════════════
-- Fix: handle_new_user trigger blows up on orphan profiles
-- Date: 2026-04-14
--
-- Background:
--   profiles.email has a UNIQUE constraint. The handle_new_user
--   trigger fires on INSERT INTO auth.users and inserts a matching
--   profile row. It uses ON CONFLICT (id) DO NOTHING — which only
--   handles the case where a profile already exists with the same
--   id. If a profile exists with the same EMAIL but a different id
--   (e.g. an admin-created profile whose auth.users row was lost or
--   never existed), the email UNIQUE constraint is violated, the
--   trigger raises, and the auth.users INSERT rolls back. Supabase
--   surfaces this to the client as the generic "Database error
--   creating new user" 400, blocking admins from re-provisioning
--   users like John Lomax.
--
-- Fix:
--   Drop the column-targeted ON CONFLICT and use the bare
--   ON CONFLICT DO NOTHING form, which silently absorbs any unique
--   violation (id or email). The application layer (create-admin-user)
--   is responsible for reconciling the profile afterwards via upsert.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, approved)
  VALUES (
    NEW.id,
    NEW.email,
    NULL,  -- No role until approved
    false  -- Not approved by default
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
