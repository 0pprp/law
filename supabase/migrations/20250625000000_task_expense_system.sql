-- Task-linked expense system: definitions per task, deduction from lawyer disbursement wallet

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
  ADD COLUMN IF NOT EXISTS task_definition_expense_id uuid REFERENCES task_definition_expenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wallet_deducted_at timestamptz;

-- wallet_credited_at from prior migration — rename if present
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

-- Seed expense lines per task_type (all branches)
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

-- Debtor total_expenses: only approved expenses count
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

NOTIFY pgrst, 'reload schema';
