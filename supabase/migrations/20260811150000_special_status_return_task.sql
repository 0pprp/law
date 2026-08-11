-- حفظ المهمة المرتبطة عند التحويل لتبويب الأسماء التي تحتاج مراقبة
-- للتراجع:
--   DROP INDEX IF EXISTS idx_debtors_special_status_return_task;
--   ALTER TABLE public.debtors DROP COLUMN IF EXISTS special_status_return_task_id;

ALTER TABLE public.debtors
  ADD COLUMN IF NOT EXISTS special_status_return_task_id uuid
    REFERENCES public.tasks(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.debtors.special_status_return_task_id IS
  'المهمة المحفوظة عند التحويل للأسماء التي تحتاج مراقبة — تُستعاد عند الإرجاع للمهام';

CREATE INDEX IF NOT EXISTS idx_debtors_special_status_return_task
  ON public.debtors (special_status_return_task_id)
  WHERE special_status_return_task_id IS NOT NULL;
