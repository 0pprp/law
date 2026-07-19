-- فصل اعتماد الإنجاز عن الاعتماد المالي النهائي.
-- القيم المستخدمة في fee_status:
--   pending                 = قبل اعتماد الإنجاز
--   approved_pending_next   = اعتماد إنجاز تمّ — بانتظار إنشاء المهمة التالية (لا أتعاب بعد)
--   payable                 = الاعتماد النهائي تمّ واحتُسبت الأتعاب
--
-- آمن: لا يغيّر بيانات المهام القائمة. يوسّع القيد فقط إن لزم.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS fee_status text;

-- تأكيد القيم المسموحة (بدون كسر البيانات الحالية)
DO $$
BEGIN
  ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_fee_status_check;
  ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_fee_status_check
    CHECK (
      fee_status IS NULL
      OR fee_status IN ('pending', 'approved_pending_next', 'payable')
    );
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'tasks_fee_status_check: %', SQLERRM;
END $$;

-- عند اعتماد الإنجاز: اضبط fee_status إلى approved_pending_next إن كان pending/null
CREATE OR REPLACE FUNCTION public.tasks_set_approved_pending_next()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.task_status IN ('approved', 'completed')
     AND (OLD.task_status IS DISTINCT FROM NEW.task_status)
     AND (NEW.fee_status IS NULL OR NEW.fee_status = 'pending')
  THEN
    NEW.fee_status := 'approved_pending_next';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_approved_pending_next ON public.tasks;
CREATE TRIGGER trg_tasks_approved_pending_next
  BEFORE UPDATE OF task_status ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.tasks_set_approved_pending_next();

COMMENT ON COLUMN public.tasks.fee_status IS
  'pending | approved_pending_next (بانتظار المهمة التالية) | payable (احتُسبت الأتعاب)';
