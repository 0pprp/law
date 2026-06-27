-- RLS for lawyer_payout_requests
ALTER TABLE lawyer_payout_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lawyer_payout_requests_insert_own ON lawyer_payout_requests;
DROP POLICY IF EXISTS lawyer_payout_requests_select_own ON lawyer_payout_requests;
DROP POLICY IF EXISTS lawyer_payout_requests_select_staff ON lawyer_payout_requests;
DROP POLICY IF EXISTS lawyer_payout_requests_update_staff ON lawyer_payout_requests;

-- Lawyers: submit own pending requests
CREATE POLICY lawyer_payout_requests_insert_own ON lawyer_payout_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    lawyer_id = auth.uid()
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'lawyer'
        AND p.is_active = true
    )
  );

-- Lawyers: view own requests
CREATE POLICY lawyer_payout_requests_select_own ON lawyer_payout_requests
  FOR SELECT TO authenticated
  USING (lawyer_id = auth.uid());

-- Admin / staff: view branch requests
CREATE POLICY lawyer_payout_requests_select_staff ON lawyer_payout_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'employee', 'accountant')
        AND (
          p.role = 'admin'
          OR lawyer_payout_requests.branch_id = p.branch_id
        )
    )
  );

-- Admin / staff: approve or reject pending requests
CREATE POLICY lawyer_payout_requests_update_staff ON lawyer_payout_requests
  FOR UPDATE TO authenticated
  USING (
    status = 'pending'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'employee', 'accountant')
        AND (
          p.role = 'admin'
          OR lawyer_payout_requests.branch_id = p.branch_id
        )
    )
  )
  WITH CHECK (status IN ('approved', 'rejected'));
