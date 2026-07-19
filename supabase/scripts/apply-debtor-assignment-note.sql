-- نسخة قابلة للتشغيل اليدوي (Supabase SQL Editor) من:
-- supabase/migrations/20260718200000_debtor_assignment_note.sql
-- آمنة وقابلة لإعادة التشغيل (idempotent) — لا تحذف أي بيانات.

ALTER TABLE debtors
  ADD COLUMN IF NOT EXISTS assignment_note text;

COMMENT ON COLUMN debtors.assignment_note IS
  'ملاحظة إدارية تظهر في كارد «الأسماء التي تحت إسناد مهمة» — تعديلها للمدير ومسؤول القانونية فقط';

CREATE INDEX IF NOT EXISTS idx_debtors_awaiting_assignment
  ON debtors (branch_id, created_at)
  WHERE current_task_id IS NULL;

CREATE OR REPLACE FUNCTION public.guard_debtor_assignment_note()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
BEGIN
  IF NEW.assignment_note IS NOT DISTINCT FROM OLD.assignment_note THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role INTO caller_role FROM profiles WHERE id = auth.uid();
  IF caller_role IN ('admin', 'viewer') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'فقط المدير ومسؤول القانونية يمكنهما تعديل ملاحظة إسناد المهمة'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_debtors_assignment_note_guard ON debtors;
CREATE TRIGGER trg_debtors_assignment_note_guard
  BEFORE UPDATE OF assignment_note ON debtors
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_debtor_assignment_note();
