-- تشغيل من Supabase Dashboard → SQL Editor
-- يفعّل: رفض التكليف + كارد «مرفوضة» عند المحامي + إصلاح RLS

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS assignment_rejected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_assignment_rejected_by
  ON public.tasks (assignment_rejected_by)
  WHERE assignment_rejected_by IS NOT NULL;

DROP POLICY IF EXISTS lawyer_tasks_update_assigned ON public.tasks;
CREATE POLICY lawyer_tasks_update_assigned ON public.tasks
  FOR UPDATE TO authenticated
  USING (public.is_lawyer_role() AND assigned_to = auth.uid())
  WITH CHECK (
    public.is_lawyer_role()
    AND (assigned_to = auth.uid() OR assigned_to IS NULL)
  );

DROP POLICY IF EXISTS lawyer_tasks_select_rejected ON public.tasks;
CREATE POLICY lawyer_tasks_select_rejected ON public.tasks
  FOR SELECT TO authenticated
  USING (public.is_lawyer_role() AND assignment_rejected_by = auth.uid());

NOTIFY pgrst, 'reload schema';
