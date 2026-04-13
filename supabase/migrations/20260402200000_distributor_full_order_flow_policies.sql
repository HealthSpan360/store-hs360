/*
  # Grant distributors full order-flow access for their assigned customers

  Following the orders INSERT policy (20260402100000), distributors need
  matching permissions on every table touched during the checkout flow
  when acting on behalf of a customer in their distributor_customers list.

  Tables covered:
    - checkout_sessions  (create/update sessions during checkout)
    - payment_transactions (log authorizations / captures / voids / refunds)
    - user_activity_log  (audit log entries written under customer's user_id)
    - commissions        (refund flow updates via cancelCommission)

  All policies check membership in distributor_customers for an active
  distributor whose profile matches auth.uid().
*/

-- ──────────────────────────────────────────────────────────────────
-- checkout_sessions: allow distributor to CREATE + UPDATE sessions
-- for organizations they serve
-- ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Distributors can manage customer checkout sessions" ON checkout_sessions;

CREATE POLICY "Distributors can manage customer checkout sessions"
  ON checkout_sessions FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT dc.organization_id
      FROM distributor_customers dc
      JOIN distributors d ON d.id = dc.distributor_id
      WHERE (d.profile_id = (select auth.uid()) OR d.user_id = (select auth.uid()))
        AND dc.is_active = true
        AND d.is_active = true
    )
  )
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

-- ──────────────────────────────────────────────────────────────────
-- payment_transactions: allow distributor to log transactions for
-- orders belonging to customer orgs they serve
-- ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Distributors can log transactions for customer orders" ON payment_transactions;

CREATE POLICY "Distributors can log transactions for customer orders"
  ON payment_transactions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM orders o
      JOIN distributor_customers dc ON dc.organization_id = o.organization_id
      JOIN distributors d ON d.id = dc.distributor_id
      WHERE o.id = payment_transactions.order_id
        AND (d.profile_id = (select auth.uid()) OR d.user_id = (select auth.uid()))
        AND dc.is_active = true
        AND d.is_active = true
    )
  );

DROP POLICY IF EXISTS "Distributors can view transactions for customer orders" ON payment_transactions;

CREATE POLICY "Distributors can view transactions for customer orders"
  ON payment_transactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM orders o
      JOIN distributor_customers dc ON dc.organization_id = o.organization_id
      JOIN distributors d ON d.id = dc.distributor_id
      WHERE o.id = payment_transactions.order_id
        AND (d.profile_id = (select auth.uid()) OR d.user_id = (select auth.uid()))
        AND dc.is_active = true
        AND d.is_active = true
    )
  );

-- ──────────────────────────────────────────────────────────────────
-- user_activity_log: allow distributor to write activity entries
-- for customers in their distributor_customers list
-- ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Distributors can log activity for their customers" ON user_activity_log;

CREATE POLICY "Distributors can log activity for their customers"
  ON user_activity_log FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    OR EXISTS (
      SELECT 1
      FROM user_organization_roles uor
      JOIN distributor_customers dc ON dc.organization_id = uor.organization_id
      JOIN distributors d ON d.id = dc.distributor_id
      WHERE uor.user_id = user_activity_log.user_id
        AND (d.profile_id = (select auth.uid()) OR d.user_id = (select auth.uid()))
        AND dc.is_active = true
        AND d.is_active = true
    )
  );

-- ──────────────────────────────────────────────────────────────────
-- commissions: allow distributors to update their own commissions
-- (refund / cancellation flow)
-- ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Distributors can update own commissions" ON commissions;

CREATE POLICY "Distributors can update own commissions"
  ON commissions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM distributors d
      WHERE d.id = commissions.distributor_id
        AND (d.profile_id = (select auth.uid()) OR d.user_id = (select auth.uid()))
        AND d.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM distributors d
      WHERE d.id = commissions.distributor_id
        AND (d.profile_id = (select auth.uid()) OR d.user_id = (select auth.uid()))
        AND d.is_active = true
    )
  );
