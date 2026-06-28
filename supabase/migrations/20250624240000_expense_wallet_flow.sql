-- Task-level expense flag + wallet credit tracking + disbursement payout requests

ALTER TABLE task_definitions
  ADD COLUMN IF NOT EXISTS allows_expenses boolean NOT NULL DEFAULT false;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS wallet_credited_at timestamptz;

ALTER TABLE lawyer_payout_requests
  ADD COLUMN IF NOT EXISTS wallet_kind text NOT NULL DEFAULT 'fees';

DO $$
BEGIN
  ALTER TABLE lawyer_payout_requests
    ADD CONSTRAINT lawyer_payout_requests_wallet_kind_check
    CHECK (wallet_kind IN ('fees', 'savings'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
