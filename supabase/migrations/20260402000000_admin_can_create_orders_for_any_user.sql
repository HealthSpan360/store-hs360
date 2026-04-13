/*
  # Ensure admins can create orders for any user (for impersonation)

  When an admin is impersonating a customer and places an order on their behalf,
  the INSERT has user_id = <impersonated customer>, but auth.uid() is the admin.
  The existing "Users can create own orders" policy fails (auth.uid() != user_id),
  and the existing admin policies may not be live on all environments.

  This migration re-declares a simple admin-bypass INSERT policy so admins can
  create orders on behalf of any user.
*/

DROP POLICY IF EXISTS "Admins can create orders for any user" ON orders;

CREATE POLICY "Admins can create orders for any user"
  ON orders FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());
