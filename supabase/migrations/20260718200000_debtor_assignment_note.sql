-- «الأسماء التي تحت إسناد مهمة» — ملاحظة إدارية للمدينين بلا مهمة مطلوبة.
--
-- للتراجع (Down):
--   DROP TRIGGER IF EXISTS trg_debtors_assignment_note_guard ON debtors;
--   DROP FUNCTION IF EXISTS public.guard_debtor_assignment_note();
--   DROP INDEX IF EXISTS idx_debtors_awaiting_assignment;
--   ALTER TABLE debtors DROP COLUMN IF EXISTS assignment_note;

ALTER TABLE debtors
  ADD COLUMN IF NOT EXISTS assignment_note text;

COMMENT ON COLUMN debtors.assignment_note IS
  'ملاحظة إدارية تظهر في كارد «الأسماء التي تحت إسناد مهمة» — تعديلها للمدير ومسؤول القانونية فقط';

-- فهرس جزئي لاستعلام الكارد: مدينون مفتوحون بلا مهمة حالية، الأقدم أولاً
CREATE INDEX IF NOT EXISTS idx_debtors_awaiting_assignment
  ON debtors (branch_id, created_at)
  WHERE current_task_id IS NULL;

-- منع تعديل assignment_note من أدوار غير مصرّح بها عبر العميل المباشر.
-- service_role (auth.uid() IS NULL) مسموح — تستخدمه واجهات API بعد التحقق من الدور.
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

  -- مفتاح service_role / استدعاءات بلا جلسة مستخدم
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
