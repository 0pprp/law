-- طبّق يدوياً إن لزم
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS incomplete_request boolean NOT NULL DEFAULT false;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS incomplete_reason text;

CREATE INDEX IF NOT EXISTS idx_tasks_incomplete_review
  ON public.tasks (branch_id, task_status)
  WHERE incomplete_request = true;
