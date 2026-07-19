-- =============================================================================
-- RESET OPERATIONAL DATA — run in Supabase SQL Editor AFTER taking a backup.
--
-- Backup (run separately in SQL Editor or pg_dump):
--   CREATE TABLE IF NOT EXISTS _backup_debtors AS SELECT * FROM debtors;
--   CREATE TABLE IF NOT EXISTS _backup_tasks AS SELECT * FROM tasks;
--   (repeat for critical tables before reset)
--
-- PRESERVES:
--   - auth.users (including admin login)
--   - profiles WHERE role = 'admin'
--   - branches (11 official branches)
--   - task_definitions, expense_types, courts, etc.
--
-- ALSO: empty storage buckets manually in Supabase Dashboard:
--   debtor-files, lawyer-files, task-files (if used)
-- =============================================================================

-- Step 0: fix triggers that reference missing columns (e.g. expenses.status)
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
  v_total_expenses numeric;
BEGIN
  v_debtor_id := COALESCE(NEW.debtor_id, OLD.debtor_id);
  IF v_debtor_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(e.amount::numeric), 0)
  INTO v_total_expenses
  FROM public.expenses e
  WHERE e.debtor_id = v_debtor_id
    AND COALESCE(e.status, 'approved') NOT IN ('rejected');

  UPDATE public.debtors d
  SET
    total_expenses = v_total_expenses,
    required_amount = CASE
      WHEN d.receipt_amount > 0 THEN LEAST(
        GREATEST(0, d.remaining_amount)
          + GREATEST(0, COALESCE(v_total_expenses, 0))
          + GREATEST(0, COALESCE(d.penalty_amount, 0)),
        d.receipt_amount
      )
      ELSE GREATEST(0, d.remaining_amount)
        + GREATEST(0, COALESCE(v_total_expenses, 0))
        + GREATEST(0, COALESCE(d.penalty_amount, 0))
    END
  WHERE d.id = v_debtor_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

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

BEGIN;

-- Detach debtor pointers before deleting tasks
UPDATE debtors SET current_task_id = NULL, last_task_id = NULL;

-- Wallet & receipts
DELETE FROM lawyer_wallet_transactions;
DELETE FROM lawyer_payout_requests;
DELETE FROM task_payment_receipts;

-- Attachments & notes
DELETE FROM task_attachments;
DELETE FROM debtor_attachments;
DELETE FROM debtor_notes;

-- Financial & activity
DELETE FROM debtor_payments;
DELETE FROM expenses;
DELETE FROM activity_logs;

-- Tasks then debtors
DELETE FROM tasks;
DELETE FROM debtors;

-- Optional: legal cases if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'legal_cases') THEN
    EXECUTE 'DELETE FROM legal_cases';
  END IF;
END $$;

-- Remove non-admin users from profiles (lawyers, employees, trial accounts)
DELETE FROM profiles WHERE role IS DISTINCT FROM 'admin';

-- Official branch names only (11). Disable legacy main + any alias/extra rows.
UPDATE branches SET is_active = false
WHERE name NOT IN (
  'بغداد الكرخ', 'بغداد الرصافة', 'البصرة', 'الديوانية', 'ديالى',
  'كربلاء', 'كركوك', 'الموصل', 'النجف الأشرف', 'الناصرية', 'السماوة'
);

UPDATE branches SET is_active = true
WHERE name IN (
  'بغداد الكرخ', 'بغداد الرصافة', 'البصرة', 'الديوانية', 'ديالى',
  'كربلاء', 'كركوك', 'الموصل', 'النجف الأشرف', 'الناصرية', 'السماوة'
);

COMMIT;

-- After running: delete orphaned auth users for removed lawyers via
-- Supabase Dashboard → Authentication → Users (non-admin accounts).
