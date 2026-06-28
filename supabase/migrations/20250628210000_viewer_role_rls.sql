-- Step 2 of 2: مراقب عام (viewer) read-only on staff SELECT policies.
-- Prerequisite: 20250628209000_user_role_viewer_enum.sql must be applied first.

DROP POLICY IF EXISTS lawyer_payout_requests_select_staff ON lawyer_payout_requests;
CREATE POLICY lawyer_payout_requests_select_staff ON lawyer_payout_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'employee', 'accountant', 'viewer')
        AND (
          p.role IN ('admin', 'viewer')
          OR lawyer_payout_requests.branch_id = p.branch_id
        )
    )
  );

DROP POLICY IF EXISTS lawyer_wallet_tx_select_staff ON lawyer_wallet_transactions;
CREATE POLICY lawyer_wallet_tx_select_staff ON lawyer_wallet_transactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'accountant', 'employee', 'viewer')
    )
  );

NOTIFY pgrst, 'reload schema';
