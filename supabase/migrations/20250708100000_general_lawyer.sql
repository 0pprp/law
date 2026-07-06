-- محامي عام: نفس دور lawyer مع lawyer_type = 'general' — يُكلف من أي فرع ويرى مهامه المكلف بها فقط.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS lawyer_type text NOT NULL DEFAULT 'normal';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_lawyer_type_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_lawyer_type_check
  CHECK (lawyer_type IN ('normal', 'general'));

COMMENT ON COLUMN public.profiles.lawyer_type IS
  'نوع المحامي: normal = محامي عادي (مقيّد بفرعه)، general = محامي عام (تكليف من أي فرع)';

CREATE INDEX IF NOT EXISTS idx_profiles_lawyer_type
  ON public.profiles (lawyer_type)
  WHERE role = 'lawyer';

-- Helper functions for RLS
CREATE OR REPLACE FUNCTION public.is_lawyer_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.auth_profile_role(), '') = 'lawyer'
$$;

CREATE OR REPLACE FUNCTION public.is_general_lawyer_profile(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id
      AND p.role = 'lawyer'
      AND p.lawyer_type = 'general'
  )
$$;

CREATE OR REPLACE FUNCTION public.lawyer_assigned_to_task(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = p_task_id
      AND t.assigned_to = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.lawyer_assigned_to_debtor(p_debtor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.debtor_id = p_debtor_id
      AND t.assigned_to = auth.uid()
  )
$$;

-- tasks: المحامي يرى ويحدّث مهامه المكلف بها فقط (من أي فرع للمحامي العام)
DROP POLICY IF EXISTS lawyer_tasks_select_assigned ON public.tasks;
CREATE POLICY lawyer_tasks_select_assigned ON public.tasks
  FOR SELECT TO authenticated
  USING (public.is_lawyer_role() AND assigned_to = auth.uid());

DROP POLICY IF EXISTS lawyer_tasks_update_assigned ON public.tasks;
CREATE POLICY lawyer_tasks_update_assigned ON public.tasks
  FOR UPDATE TO authenticated
  USING (public.is_lawyer_role() AND assigned_to = auth.uid())
  WITH CHECK (public.is_lawyer_role() AND assigned_to = auth.uid());

-- debtors: عبر المهام المكلف بها فقط
DROP POLICY IF EXISTS lawyer_debtors_select_assigned ON public.debtors;
CREATE POLICY lawyer_debtors_select_assigned ON public.debtors
  FOR SELECT TO authenticated
  USING (public.is_lawyer_role() AND public.lawyer_assigned_to_debtor(id));

-- جداول مرتبطة بالمهمة المكلف بها
DROP POLICY IF EXISTS lawyer_task_attachments_select ON public.task_attachments;
CREATE POLICY lawyer_task_attachments_select ON public.task_attachments
  FOR SELECT TO authenticated
  USING (public.is_lawyer_role() AND public.lawyer_assigned_to_task(task_id));

DROP POLICY IF EXISTS lawyer_debtor_attachments_select ON public.debtor_attachments;
CREATE POLICY lawyer_debtor_attachments_select ON public.debtor_attachments
  FOR SELECT TO authenticated
  USING (public.is_lawyer_role() AND public.lawyer_assigned_to_debtor(debtor_id));

DROP POLICY IF EXISTS lawyer_expenses_select_assigned ON public.expenses;
CREATE POLICY lawyer_expenses_select_assigned ON public.expenses
  FOR SELECT TO authenticated
  USING (
    public.is_lawyer_role()
    AND task_id IS NOT NULL
    AND public.lawyer_assigned_to_task(task_id)
  );

DROP POLICY IF EXISTS lawyer_task_definitions_select ON public.task_definitions;
CREATE POLICY lawyer_task_definitions_select ON public.task_definitions
  FOR SELECT TO authenticated
  USING (public.is_lawyer_role());

DROP POLICY IF EXISTS lawyer_task_required_fields_select ON public.task_required_fields;
CREATE POLICY lawyer_task_required_fields_select ON public.task_required_fields
  FOR SELECT TO authenticated
  USING (public.is_lawyer_role());

DROP POLICY IF EXISTS lawyer_task_definition_expenses_select ON public.task_definition_expenses;
CREATE POLICY lawyer_task_definition_expenses_select ON public.task_definition_expenses
  FOR SELECT TO authenticated
  USING (public.is_lawyer_role());

DROP POLICY IF EXISTS lawyer_branches_select ON public.branches;
CREATE POLICY lawyer_branches_select ON public.branches
  FOR SELECT TO authenticated
  USING (public.is_lawyer_role());

NOTIFY pgrst, 'reload schema';
