-- طلب إرسال بدون إنجاز (مراجعة منفصلة ثم إلغاء تكليف عند الاعتماد)
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS incomplete_request boolean NOT NULL DEFAULT false;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS incomplete_reason text;

CREATE INDEX IF NOT EXISTS idx_tasks_incomplete_review
  ON public.tasks (branch_id, task_status)
  WHERE incomplete_request = true;

COMMENT ON COLUMN public.tasks.incomplete_request IS
  'طلب محامٍ: إرسال بدون إنجاز — يُراجع في غير منجزة';
COMMENT ON COLUMN public.tasks.incomplete_reason IS
  'سبب طلب الإرسال بدون إنجاز';
