-- Fix expense sync trigger: expenses.status may be missing in older schemas.
-- Safe to re-run.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS status text DEFAULT 'approved';
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS rejection_reason text;

UPDATE expenses SET status = 'approved' WHERE status IS NULL;

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
      AND COALESCE(e.status, 'approved') NOT IN ('rejected')
  ), 0)
  WHERE d.id = v_debtor_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Payments sync — resilient version (no status column dependency)
CREATE OR REPLACE FUNCTION public.sync_debtor_total_payments()
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
  SET total_payments = COALESCE((
    SELECT SUM(p.amount::numeric)
    FROM public.debtor_payments p
    WHERE p.debtor_id = v_debtor_id
  ), 0)
  WHERE d.id = v_debtor_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;
