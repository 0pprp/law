-- صلاحيات الكتابة للمحاسب/الموظف: مدينون + مرفقات + تخزين debtor-files
-- يشمل المحاسب العام (كل الفروع) والمحاسب الفرعي (فرعه فقط).

CREATE OR REPLACE FUNCTION public.is_staff_write_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.auth_profile_role(), '') IN ('admin', 'employee', 'accountant')
$$;

CREATE OR REPLACE FUNCTION public.staff_can_write_branch(target_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.role IN ('admin', 'employee')
        OR (
          p.role = 'accountant'
          AND (
            public.is_general_accountant_profile(p.id)
            OR p.branch_id = target_branch_id
          )
        )
      )
  )
$$;

-- debtors: إدراج/تحديث للمحاسب (العام = كل الفروع)
DROP POLICY IF EXISTS staff_debtors_insert ON public.debtors;
CREATE POLICY staff_debtors_insert ON public.debtors
  FOR INSERT TO authenticated
  WITH CHECK (public.staff_can_write_branch(branch_id));

DROP POLICY IF EXISTS staff_debtors_update ON public.debtors;
CREATE POLICY staff_debtors_update ON public.debtors
  FOR UPDATE TO authenticated
  USING (public.staff_can_write_branch(branch_id))
  WITH CHECK (public.staff_can_write_branch(branch_id));

-- tasks: إنشاء مهمة أولية مع المدين
DROP POLICY IF EXISTS staff_tasks_insert ON public.tasks;
CREATE POLICY staff_tasks_insert ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (public.staff_can_write_branch(branch_id));

DROP POLICY IF EXISTS staff_tasks_update_branch ON public.tasks;
CREATE POLICY staff_tasks_update_branch ON public.tasks
  FOR UPDATE TO authenticated
  USING (public.staff_can_write_branch(branch_id))
  WITH CHECK (public.staff_can_write_branch(branch_id));

-- debtor_attachments
ALTER TABLE public.debtor_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_debtor_attachments_insert ON public.debtor_attachments;
CREATE POLICY staff_debtor_attachments_insert ON public.debtor_attachments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff_write_role());

DROP POLICY IF EXISTS staff_debtor_attachments_select ON public.debtor_attachments;
CREATE POLICY staff_debtor_attachments_select ON public.debtor_attachments
  FOR SELECT TO authenticated
  USING (
    public.is_staff_write_role()
    OR public.is_viewer_role()
    OR public.is_lawyer_role()
    OR public.auth_profile_role() = 'delegate'
  );

-- Storage: debtor-files
DROP POLICY IF EXISTS debtor_files_insert_staff ON storage.objects;
CREATE POLICY debtor_files_insert_staff ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'debtor-files'
    AND public.is_staff_write_role()
  );

DROP POLICY IF EXISTS debtor_files_select_staff ON storage.objects;
CREATE POLICY debtor_files_select_staff ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'debtor-files'
    AND (
      public.is_staff_write_role()
      OR public.is_viewer_role()
      OR public.is_lawyer_role()
      OR public.auth_profile_role() = 'delegate'
    )
  );

DROP POLICY IF EXISTS debtor_files_delete_staff ON storage.objects;
CREATE POLICY debtor_files_delete_staff ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'debtor-files'
    AND public.auth_profile_role() IN ('admin', 'employee')
  );

NOTIFY pgrst, 'reload schema';
