-- Run once in Supabase Dashboard → SQL Editor
-- Fixes: "Could not find the 'wallet' column of 'lawyer_wallet_transactions'"

DO $$
BEGIN
  CREATE TYPE lawyer_wallet_kind AS ENUM ('fees', 'savings');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE lawyer_wallet_transactions
  ADD COLUMN IF NOT EXISTS wallet lawyer_wallet_kind NOT NULL DEFAULT 'fees';

UPDATE lawyer_wallet_transactions
SET wallet = 'savings'
WHERE type = 'accountant_transfer';

DO $$
BEGIN
  ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'transfer_from_savings';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'savings_withdrawal';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_lawyer_wallet_tx_lawyer_wallet
  ON lawyer_wallet_transactions (lawyer_id, wallet);

-- Task expenses → disbursement wallet flow
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

-- Refresh PostgREST schema cache (first batch)
NOTIFY pgrst, 'reload schema';

-- === Task expense system ===
CREATE TABLE IF NOT EXISTS task_definition_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_definition_id uuid NOT NULL REFERENCES task_definitions(id) ON DELETE CASCADE,
  name text NOT NULL,
  max_amount numeric NOT NULL DEFAULT 0 CHECK (max_amount > 0),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_def_expenses_def
  ON task_definition_expenses (task_definition_id, sort_order);

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS max_allowed_amount numeric,
  ADD COLUMN IF NOT EXISTS task_definition_expense_id uuid,
  ADD COLUMN IF NOT EXISTS wallet_deducted_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expenses' AND column_name = 'wallet_credited_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expenses' AND column_name = 'wallet_deducted_at'
  ) THEN
    ALTER TABLE expenses RENAME COLUMN wallet_credited_at TO wallet_deducted_at;
  END IF;
END $$;

DO $$
BEGIN
  ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'task_expense_deduction';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

INSERT INTO task_definition_expenses (task_definition_id, name, max_amount, sort_order)
SELECT td.id, v.name, v.max_amount, v.sort_order
FROM task_definitions td
JOIN (VALUES
  ('file_lawsuit', 'رسم دعوى', 51000::numeric, 0),
  ('file_lawsuit', 'صرفيات تبليغ', 10000::numeric, 1),
  ('open_file', 'صرفيات فتح اضبارة', 10000::numeric, 0),
  ('summons', 'صرفيات تكليف بالحضور', 10000::numeric, 0),
  ('forced_appearance', 'صرفيات احضار جبري', 25000::numeric, 0),
  ('newspaper_publication', 'صرفيات نشر جريدة', 30000::numeric, 0)
) AS v(task_type, name, max_amount, sort_order) ON td.task_type::text = v.task_type
WHERE NOT EXISTS (
  SELECT 1 FROM task_definition_expenses tde WHERE tde.task_definition_id = td.id
);

CREATE OR REPLACE FUNCTION public.sync_debtor_total_expenses()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debtor_id uuid;
BEGIN
  v_debtor_id := COALESCE(NEW.debtor_id, OLD.debtor_id);
  IF v_debtor_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.debtors d
  SET total_expenses = COALESCE((
    SELECT SUM(e.amount::numeric)
    FROM public.expenses e
    WHERE e.debtor_id = v_debtor_id
      AND COALESCE(e.status, 'approved') = 'approved'
  ), 0)
  WHERE d.id = v_debtor_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- === Task fee status + wallet RLS ===
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS fee_status text;

DO $$
BEGIN
  ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'approved_task_payment';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE lawyer_wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lawyer_wallet_tx_select_own ON lawyer_wallet_transactions;
CREATE POLICY lawyer_wallet_tx_select_own ON lawyer_wallet_transactions
  FOR SELECT TO authenticated
  USING (lawyer_id = auth.uid());

DROP POLICY IF EXISTS lawyer_wallet_tx_select_staff ON lawyer_wallet_transactions;
CREATE POLICY lawyer_wallet_tx_select_staff ON lawyer_wallet_transactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'accountant', 'employee')
    )
  );

DROP POLICY IF EXISTS lawyer_wallet_tx_insert_staff ON lawyer_wallet_transactions;
CREATE POLICY lawyer_wallet_tx_insert_staff ON lawyer_wallet_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'accountant', 'employee')
    )
  );

NOTIFY pgrst, 'reload schema';
