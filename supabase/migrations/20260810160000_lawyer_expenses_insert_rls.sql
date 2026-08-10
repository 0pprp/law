-- صرفيات المحامي: إدراج/حذف/تحديث للصرفيات المرتبطة بمهمة مكلّف بها
-- يصلح فشل المحامي العام عند إرسال الإنجاز (RLS على expenses)

DROP POLICY IF EXISTS lawyer_expenses_insert_assigned ON public.expenses;
CREATE POLICY lawyer_expenses_insert_assigned ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_lawyer_role()
    AND created_by = auth.uid()
    AND (lawyer_id IS NULL OR lawyer_id = auth.uid())
    AND task_id IS NOT NULL
    AND public.lawyer_assigned_to_task(task_id)
  );

DROP POLICY IF EXISTS lawyer_expenses_delete_assigned_pending ON public.expenses;
CREATE POLICY lawyer_expenses_delete_assigned_pending ON public.expenses
  FOR DELETE TO authenticated
  USING (
    public.is_lawyer_role()
    AND task_id IS NOT NULL
    AND public.lawyer_assigned_to_task(task_id)
    AND COALESCE(status, '') IN ('pending_review', 'pending_approval', 'pending')
    AND wallet_deducted_at IS NULL
  );

DROP POLICY IF EXISTS lawyer_expenses_update_assigned_pending ON public.expenses;
CREATE POLICY lawyer_expenses_update_assigned_pending ON public.expenses
  FOR UPDATE TO authenticated
  USING (
    public.is_lawyer_role()
    AND task_id IS NOT NULL
    AND public.lawyer_assigned_to_task(task_id)
    AND COALESCE(status, '') IN ('pending_review', 'pending_approval', 'pending')
    AND wallet_deducted_at IS NULL
  )
  WITH CHECK (
    public.is_lawyer_role()
    AND task_id IS NOT NULL
    AND public.lawyer_assigned_to_task(task_id)
    AND (lawyer_id IS NULL OR lawyer_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
