-- Lawyer-initiated fee payout requests (admin approves → balance deducted)
CREATE TABLE IF NOT EXISTS lawyer_payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lawyer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  title text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  notes text,
  review_notes text,
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lawyer_payout_requests_lawyer ON lawyer_payout_requests(lawyer_id);
CREATE INDEX IF NOT EXISTS idx_lawyer_payout_requests_branch_status ON lawyer_payout_requests(branch_id, status);
