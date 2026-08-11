-- انسخ والصق في Supabase SQL Editor إن لم تُطبَّق الـ migration تلقائياً.
ALTER TABLE public.debtors
  ADD COLUMN IF NOT EXISTS special_status_return_task_id uuid
    REFERENCES public.tasks(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.debtors.special_status_return_task_id IS
  'المهمة المحفوظة عند التحويل للأسماء التي تحتاج مراقبة — تُستعاد عند الإرجاع للمهام';

CREATE INDEX IF NOT EXISTS idx_debtors_special_status_return_task
  ON public.debtors (special_status_return_task_id)
  WHERE special_status_return_task_id IS NOT NULL;
