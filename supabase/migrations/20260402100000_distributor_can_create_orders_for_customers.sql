/*
  # Allow distributors to create orders for their assigned customers

  Distributors can currently only SELECT orders belonging to organizations
  in distributor_customers. They also need to be able to INSERT (create)
  orders for those same customer organizations — e.g. when an admin or
  the distributor themselves places an order on behalf of a customer
  (impersonation or self-checkout flow in the distributor portal).

  This policy allows INSERT when the order's organization_id is in
  distributor_customers for the distributor whose profile matches auth.uid().
*/

DROP POLICY IF EXISTS "Distributors can create orders for their customers" ON orders;

CREATE POLICY "Distributors can create orders for their customers"
  ON orders FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT dc.organization_id
      FROM distributor_customers dc
      JOIN distributors d ON d.id = dc.distributor_id
      WHERE (d.profile_id = (select auth.uid()) OR d.user_id = (select auth.uid()))
        AND dc.is_active = true
        AND d.is_active = true
    )
  );
