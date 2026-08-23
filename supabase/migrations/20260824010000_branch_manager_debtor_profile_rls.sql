-- مدير الفرع: قراءة مديني فرعه + إضافة ملاحظات
-- يحدّث دوال الوصول المستخدمة في RLS دون فتح الكتابة العامة

CREATE OR REPLACE FUNCTION public.staff_can_read_branch(target_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND COALESCE(p.is_active, true)
      AND (
        p.role IN ('admin', 'employee', 'viewer', 'criminal_legal_manager')
        OR (
          p.role = 'accountant'
          AND (
            public.is_general_accountant_profile(p.id)
            OR p.branch_id = target_branch_id
          )
        )
        OR (
          p.role = 'branch_manager'
          AND p.branch_id IS NOT NULL
          AND p.branch_id = target_branch_id
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_access_branch(target_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND COALESCE(p.is_active, true)
      AND (
        p.role IN ('admin', 'employee', 'viewer', 'criminal_legal_manager', 'payment_follow_up', 'delegate')
        OR (
          p.role = 'accountant'
          AND (
            public.is_general_accountant_profile(p.id)
            OR target_branch_id IS NULL
            OR p.branch_id = target_branch_id
          )
        )
        OR (
          p.role = 'lawyer'
          AND (
            p.branch_id IS NULL
            OR target_branch_id IS NULL
            OR p.branch_id = target_branch_id
          )
        )
        OR (
          p.role = 'branch_manager'
          AND p.branch_id IS NOT NULL
          AND p.branch_id = target_branch_id
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_access_debtor(p_debtor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.debtors d
    WHERE d.id = p_debtor_id
      AND public.current_user_can_access_case_type(COALESCE(d.case_type, 'civil'))
      AND public.current_user_can_access_branch(d.branch_id)
      AND (
        public.current_app_role() IN (
          'admin', 'accountant', 'employee', 'viewer',
          'criminal_legal_manager', 'payment_follow_up', 'branch_manager'
        )
        OR (
          public.current_app_role() = 'lawyer'
          AND EXISTS (
            SELECT 1 FROM public.tasks t
            WHERE t.debtor_id = d.id AND t.assigned_to = auth.uid()
          )
        )
        OR (
          public.current_app_role() = 'delegate'
          AND EXISTS (
            SELECT 1 FROM public.tasks t
            WHERE t.debtor_id = d.id AND t.assigned_to = auth.uid()
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_access_task(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    LEFT JOIN public.debtors d ON d.id = t.debtor_id
    WHERE t.id = p_task_id
      AND public.current_user_can_access_case_type(COALESCE(d.case_type, 'civil'))
      AND public.current_user_can_access_branch(COALESCE(t.branch_id, d.branch_id))
      AND (
        public.current_app_role() IN (
          'admin', 'accountant', 'employee', 'viewer',
          'criminal_legal_manager', 'branch_manager'
        )
        OR (
          public.current_app_role() = 'payment_follow_up'
          AND d.case_status = 'payment_in_progress'
        )
        OR (
          public.current_app_role() IN ('lawyer', 'delegate')
          AND t.assigned_to = auth.uid()
        )
      )
  )
$$;

-- سياسات SELECT للمدينين/التسديدات تتضمن الأدوار صراحة في بعض السياسات القديمة
DROP POLICY IF EXISTS branch_manager_debtors_select ON public.debtors;
CREATE POLICY branch_manager_debtors_select ON public.debtors
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'branch_manager'
    AND public.current_user_can_access_debtor(id)
  );

DROP POLICY IF EXISTS branch_manager_debtor_notes_select ON public.debtor_notes;
CREATE POLICY branch_manager_debtor_notes_select ON public.debtor_notes
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'branch_manager'
    AND public.current_user_can_access_debtor(debtor_id)
  );

DROP POLICY IF EXISTS branch_manager_debtor_notes_insert ON public.debtor_notes;
CREATE POLICY branch_manager_debtor_notes_insert ON public.debtor_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.current_app_role() = 'branch_manager'
    AND public.current_user_can_access_debtor(debtor_id)
  );

DROP POLICY IF EXISTS branch_manager_payments_select ON public.debtor_payments;
CREATE POLICY branch_manager_payments_select ON public.debtor_payments
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'branch_manager'
    AND public.current_user_can_access_debtor(debtor_id)
  );

DROP POLICY IF EXISTS branch_manager_expenses_select ON public.expenses;
CREATE POLICY branch_manager_expenses_select ON public.expenses
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'branch_manager'
    AND public.current_user_can_access_debtor(debtor_id)
  );

DROP POLICY IF EXISTS branch_manager_attachments_select ON public.debtor_attachments;
CREATE POLICY branch_manager_attachments_select ON public.debtor_attachments
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'branch_manager'
    AND public.current_user_can_access_debtor(debtor_id)
  );

NOTIFY pgrst, 'reload schema';
