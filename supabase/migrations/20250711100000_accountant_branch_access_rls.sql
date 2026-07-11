-- إصلاح صلاحيات المحاسب العام/الفرعي على المدينين + إعدادات الفرع
-- شغّل في Supabase SQL Editor إذا لم تُطبَّق تلقائياً.

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
      AND (
        p.role IN ('admin', 'employee', 'viewer')
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

-- قراءة المدينين: المحاسب العام = كل الفروع / الفرعي = فرعه
DROP POLICY IF EXISTS staff_debtors_select ON public.debtors;
CREATE POLICY staff_debtors_select ON public.debtors
  FOR SELECT TO authenticated
  USING (public.staff_can_read_branch(branch_id));

DROP POLICY IF EXISTS staff_debtors_insert ON public.debtors;
CREATE POLICY staff_debtors_insert ON public.debtors
  FOR INSERT TO authenticated
  WITH CHECK (public.staff_can_write_branch(branch_id));

DROP POLICY IF EXISTS staff_debtors_update ON public.debtors;
CREATE POLICY staff_debtors_update ON public.debtors
  FOR UPDATE TO authenticated
  USING (public.staff_can_write_branch(branch_id))
  WITH CHECK (public.staff_can_write_branch(branch_id));

-- المهام المرتبطة
DROP POLICY IF EXISTS staff_tasks_select ON public.tasks;
CREATE POLICY staff_tasks_select ON public.tasks
  FOR SELECT TO authenticated
  USING (public.staff_can_read_branch(branch_id));

DROP POLICY IF EXISTS staff_tasks_insert ON public.tasks;
CREATE POLICY staff_tasks_insert ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (public.staff_can_write_branch(branch_id));

DROP POLICY IF EXISTS staff_tasks_update_branch ON public.tasks;
CREATE POLICY staff_tasks_update_branch ON public.tasks
  FOR UPDATE TO authenticated
  USING (public.staff_can_write_branch(branch_id))
  WITH CHECK (public.staff_can_write_branch(branch_id));

-- ملاحظات / تسديدات / صرفيات (قراءة حسب الفرع عبر المدين)
DROP POLICY IF EXISTS staff_debtor_notes_select ON public.debtor_notes;
CREATE POLICY staff_debtor_notes_select ON public.debtor_notes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.debtors d
      WHERE d.id = debtor_notes.debtor_id
        AND public.staff_can_read_branch(d.branch_id)
    )
    OR public.is_staff_write_role()
  );

DROP POLICY IF EXISTS staff_debtor_notes_insert ON public.debtor_notes;
CREATE POLICY staff_debtor_notes_insert ON public.debtor_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_staff_write_role()
    AND EXISTS (
      SELECT 1 FROM public.debtors d
      WHERE d.id = debtor_id
        AND public.staff_can_write_branch(d.branch_id)
    )
  );

DROP POLICY IF EXISTS staff_debtor_payments_select ON public.debtor_payments;
CREATE POLICY staff_debtor_payments_select ON public.debtor_payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.debtors d
      WHERE d.id = debtor_payments.debtor_id
        AND public.staff_can_read_branch(d.branch_id)
    )
  );

DROP POLICY IF EXISTS staff_debtor_payments_insert ON public.debtor_payments;
CREATE POLICY staff_debtor_payments_insert ON public.debtor_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_staff_write_role()
    AND EXISTS (
      SELECT 1 FROM public.debtors d
      WHERE d.id = debtor_id
        AND public.staff_can_write_branch(d.branch_id)
    )
  );

-- إعدادات الفرع: تعريفات المهام / الحقول / المحاكم / دوائر التنفيذ / أنواع الصرف
DROP POLICY IF EXISTS staff_task_definitions_insert ON public.task_definitions;
CREATE POLICY staff_task_definitions_insert ON public.task_definitions
  FOR INSERT TO authenticated
  WITH CHECK (public.staff_can_write_branch(branch_id));

DROP POLICY IF EXISTS staff_task_definitions_update ON public.task_definitions;
CREATE POLICY staff_task_definitions_update ON public.task_definitions
  FOR UPDATE TO authenticated
  USING (public.staff_can_write_branch(branch_id))
  WITH CHECK (public.staff_can_write_branch(branch_id));

DROP POLICY IF EXISTS staff_task_definitions_delete ON public.task_definitions;
CREATE POLICY staff_task_definitions_delete ON public.task_definitions
  FOR DELETE TO authenticated
  USING (public.staff_can_write_branch(branch_id));

DROP POLICY IF EXISTS staff_task_required_fields_write ON public.task_required_fields;
CREATE POLICY staff_task_required_fields_write ON public.task_required_fields
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.task_definitions td
      WHERE td.id = task_definition_id
        AND public.staff_can_write_branch(td.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.task_definitions td
      WHERE td.id = task_definition_id
        AND public.staff_can_write_branch(td.branch_id)
    )
  );

DROP POLICY IF EXISTS staff_task_definition_expenses_write ON public.task_definition_expenses;
CREATE POLICY staff_task_definition_expenses_write ON public.task_definition_expenses
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.task_definitions td
      WHERE td.id = task_definition_id
        AND public.staff_can_write_branch(td.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.task_definitions td
      WHERE td.id = task_definition_id
        AND public.staff_can_write_branch(td.branch_id)
    )
  );

DROP POLICY IF EXISTS staff_courts_write ON public.courts;
CREATE POLICY staff_courts_write ON public.courts
  FOR ALL TO authenticated
  USING (public.staff_can_write_branch(branch_id))
  WITH CHECK (public.staff_can_write_branch(branch_id));

DROP POLICY IF EXISTS staff_execution_departments_write ON public.execution_departments;
CREATE POLICY staff_execution_departments_write ON public.execution_departments
  FOR ALL TO authenticated
  USING (public.staff_can_write_branch(branch_id))
  WITH CHECK (public.staff_can_write_branch(branch_id));

DROP POLICY IF EXISTS staff_expense_types_write ON public.expense_types;
CREATE POLICY staff_expense_types_write ON public.expense_types
  FOR ALL TO authenticated
  USING (public.staff_can_write_branch(branch_id))
  WITH CHECK (public.staff_can_write_branch(branch_id));

NOTIFY pgrst, 'reload schema';
