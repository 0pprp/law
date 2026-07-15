-- ================================================================
-- Migration: 20260715110000_criminal_cases_rls.sql
-- تفعيل RLS على نظام الدعاوى الجزائية — 6 جداول
-- Roles: admin (full r/w), lawyer (restricted), everyone else (blocked)
-- ملاحظة: لا DELETE لأي دور — الأرشفة عبر status فقط
-- Backup taken: backup-2026-07-15T14-47-02/ (11 tables)
-- ================================================================


-- ────────────────────────────────────────────────────────────────
-- §0. تفعيل RLS — يحجب كل شيء افتراضياً حتى تُفتح بـ Policy صريحة
-- ────────────────────────────────────────────────────────────────
ALTER TABLE criminal_cases                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE criminal_case_task_definitions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE criminal_case_required_fields     ENABLE ROW LEVEL SECURITY;
ALTER TABLE criminal_case_task_expense_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE criminal_case_tasks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE criminal_case_expenses            ENABLE ROW LEVEL SECURITY;


-- ================================================================
-- §1. criminal_cases
-- ================================================================

-- المدير: يقرأ كل الدعاوى بدون قيد
DROP POLICY IF EXISTS cc_admin_select ON criminal_cases;
CREATE POLICY cc_admin_select ON criminal_cases
  FOR SELECT TO authenticated
  USING (public.auth_profile_role() = 'admin');

-- المدير: ينشئ دعاوى جديدة (الوحيد المخوَّل بالإنشاء)
DROP POLICY IF EXISTS cc_admin_insert ON criminal_cases;
CREATE POLICY cc_admin_insert ON criminal_cases
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_profile_role() = 'admin');

-- المدير: يعدّل أي دعوى (تغيير الحالة، إغلاق، تعيين محامٍ...)
DROP POLICY IF EXISTS cc_admin_update ON criminal_cases;
CREATE POLICY cc_admin_update ON criminal_cases
  FOR UPDATE TO authenticated
  USING  (public.auth_profile_role() = 'admin')
  WITH CHECK (public.auth_profile_role() = 'admin');

-- المحامي: يقرأ الدعوى فقط إذا كان مكلفاً بمهمة تابعة لها
DROP POLICY IF EXISTS cc_lawyer_select ON criminal_cases;
CREATE POLICY cc_lawyer_select ON criminal_cases
  FOR SELECT TO authenticated
  USING (
    public.is_lawyer_role()
    AND EXISTS (
      SELECT 1 FROM criminal_case_tasks cct
      WHERE cct.criminal_case_id = criminal_cases.id
        AND cct.assigned_to    = auth.uid()
    )
  );


-- ================================================================
-- §2. criminal_case_task_definitions
-- ================================================================

-- المدير: يدير تعريفات أنواع المهام كاملاً (قراءة + إنشاء + تعديل)
DROP POLICY IF EXISTS cc_task_defs_admin_select ON criminal_case_task_definitions;
CREATE POLICY cc_task_defs_admin_select ON criminal_case_task_definitions
  FOR SELECT TO authenticated
  USING (public.auth_profile_role() = 'admin');

DROP POLICY IF EXISTS cc_task_defs_admin_insert ON criminal_case_task_definitions;
CREATE POLICY cc_task_defs_admin_insert ON criminal_case_task_definitions
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_profile_role() = 'admin');

DROP POLICY IF EXISTS cc_task_defs_admin_update ON criminal_case_task_definitions;
CREATE POLICY cc_task_defs_admin_update ON criminal_case_task_definitions
  FOR UPDATE TO authenticated
  USING  (public.auth_profile_role() = 'admin')
  WITH CHECK (public.auth_profile_role() = 'admin');

-- المحامي: يقرأ التعريف فقط إذا كانت إحدى مهامه المكلَّف بها تستخدم هذا التعريف
DROP POLICY IF EXISTS cc_task_defs_lawyer_select ON criminal_case_task_definitions;
CREATE POLICY cc_task_defs_lawyer_select ON criminal_case_task_definitions
  FOR SELECT TO authenticated
  USING (
    public.is_lawyer_role()
    AND EXISTS (
      SELECT 1 FROM criminal_case_tasks cct
      WHERE cct.task_definition_id = criminal_case_task_definitions.id
        AND cct.assigned_to        = auth.uid()
    )
  );


-- ================================================================
-- §3. criminal_case_required_fields
-- ================================================================

-- المدير: يدير الحقول الإلزامية كاملاً
DROP POLICY IF EXISTS cc_req_fields_admin_select ON criminal_case_required_fields;
CREATE POLICY cc_req_fields_admin_select ON criminal_case_required_fields
  FOR SELECT TO authenticated
  USING (public.auth_profile_role() = 'admin');

DROP POLICY IF EXISTS cc_req_fields_admin_insert ON criminal_case_required_fields;
CREATE POLICY cc_req_fields_admin_insert ON criminal_case_required_fields
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_profile_role() = 'admin');

DROP POLICY IF EXISTS cc_req_fields_admin_update ON criminal_case_required_fields;
CREATE POLICY cc_req_fields_admin_update ON criminal_case_required_fields
  FOR UPDATE TO authenticated
  USING  (public.auth_profile_role() = 'admin')
  WITH CHECK (public.auth_profile_role() = 'admin');

-- المحامي: يقرأ الحقول الإلزامية فقط إذا كانت مهمته تستخدم هذا التعريف
-- (نفس منطق §2 — عبر task_definition_id المشترك)
DROP POLICY IF EXISTS cc_req_fields_lawyer_select ON criminal_case_required_fields;
CREATE POLICY cc_req_fields_lawyer_select ON criminal_case_required_fields
  FOR SELECT TO authenticated
  USING (
    public.is_lawyer_role()
    AND EXISTS (
      SELECT 1 FROM criminal_case_tasks cct
      WHERE cct.task_definition_id = criminal_case_required_fields.task_definition_id
        AND cct.assigned_to        = auth.uid()
    )
  );


-- ================================================================
-- §4. criminal_case_task_expense_limits
-- ================================================================

-- المدير: يدير سقوف الصرفيات كاملاً
DROP POLICY IF EXISTS cc_expense_limits_admin_select ON criminal_case_task_expense_limits;
CREATE POLICY cc_expense_limits_admin_select ON criminal_case_task_expense_limits
  FOR SELECT TO authenticated
  USING (public.auth_profile_role() = 'admin');

DROP POLICY IF EXISTS cc_expense_limits_admin_insert ON criminal_case_task_expense_limits;
CREATE POLICY cc_expense_limits_admin_insert ON criminal_case_task_expense_limits
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_profile_role() = 'admin');

DROP POLICY IF EXISTS cc_expense_limits_admin_update ON criminal_case_task_expense_limits;
CREATE POLICY cc_expense_limits_admin_update ON criminal_case_task_expense_limits
  FOR UPDATE TO authenticated
  USING  (public.auth_profile_role() = 'admin')
  WITH CHECK (public.auth_profile_role() = 'admin');

-- المحامي: يقرأ السقوف المرتبطة فقط بمهامه المكلَّف بها
DROP POLICY IF EXISTS cc_expense_limits_lawyer_select ON criminal_case_task_expense_limits;
CREATE POLICY cc_expense_limits_lawyer_select ON criminal_case_task_expense_limits
  FOR SELECT TO authenticated
  USING (
    public.is_lawyer_role()
    AND EXISTS (
      SELECT 1 FROM criminal_case_tasks cct
      WHERE cct.task_definition_id = criminal_case_task_expense_limits.task_definition_id
        AND cct.assigned_to        = auth.uid()
    )
  );


-- ================================================================
-- §5. criminal_case_tasks
-- ================================================================

-- المدير: يدير كل المهام الجزائية (قراءة + إنشاء + تعديل)
DROP POLICY IF EXISTS cc_tasks_admin_select ON criminal_case_tasks;
CREATE POLICY cc_tasks_admin_select ON criminal_case_tasks
  FOR SELECT TO authenticated
  USING (public.auth_profile_role() = 'admin');

DROP POLICY IF EXISTS cc_tasks_admin_insert ON criminal_case_tasks;
CREATE POLICY cc_tasks_admin_insert ON criminal_case_tasks
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_profile_role() = 'admin');

DROP POLICY IF EXISTS cc_tasks_admin_update ON criminal_case_tasks;
CREATE POLICY cc_tasks_admin_update ON criminal_case_tasks
  FOR UPDATE TO authenticated
  USING  (public.auth_profile_role() = 'admin')
  WITH CHECK (public.auth_profile_role() = 'admin');

-- المحامي: يقرأ المهام المكلَّف بها فقط
DROP POLICY IF EXISTS cc_tasks_lawyer_select ON criminal_case_tasks;
CREATE POLICY cc_tasks_lawyer_select ON criminal_case_tasks
  FOR SELECT TO authenticated
  USING (
    public.is_lawyer_role()
    AND assigned_to = auth.uid()
  );

-- المحامي: يحدّث مهامه المكلَّف بها (تغيير الحالة، رفع الإنجاز...)
-- WITH CHECK يمنع تغيير assigned_to لمحامٍ آخر
DROP POLICY IF EXISTS cc_tasks_lawyer_update ON criminal_case_tasks;
CREATE POLICY cc_tasks_lawyer_update ON criminal_case_tasks
  FOR UPDATE TO authenticated
  USING     (public.is_lawyer_role() AND assigned_to = auth.uid())
  WITH CHECK (public.is_lawyer_role() AND assigned_to = auth.uid());


-- ================================================================
-- §6. criminal_case_expenses
-- ================================================================

-- المدير: يدير كل الصرفيات (قراءة + إنشاء + تعديل)
DROP POLICY IF EXISTS cc_expenses_admin_select ON criminal_case_expenses;
CREATE POLICY cc_expenses_admin_select ON criminal_case_expenses
  FOR SELECT TO authenticated
  USING (public.auth_profile_role() = 'admin');

DROP POLICY IF EXISTS cc_expenses_admin_insert ON criminal_case_expenses;
CREATE POLICY cc_expenses_admin_insert ON criminal_case_expenses
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_profile_role() = 'admin');

DROP POLICY IF EXISTS cc_expenses_admin_update ON criminal_case_expenses;
CREATE POLICY cc_expenses_admin_update ON criminal_case_expenses
  FOR UPDATE TO authenticated
  USING  (public.auth_profile_role() = 'admin')
  WITH CHECK (public.auth_profile_role() = 'admin');

-- المحامي: يقرأ صرفياته المرتبطة بمهامه فقط
DROP POLICY IF EXISTS cc_expenses_lawyer_select ON criminal_case_expenses;
CREATE POLICY cc_expenses_lawyer_select ON criminal_case_expenses
  FOR SELECT TO authenticated
  USING (
    public.is_lawyer_role()
    AND criminal_case_task_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM criminal_case_tasks cct
      WHERE cct.id          = criminal_case_expenses.criminal_case_task_id
        AND cct.assigned_to = auth.uid()
    )
  );

-- المحامي: يدخل صرفيات فقط على مهامه المكلَّف بها، ويُلزَم بتسجيل نفسه كصاحب الصرفية
DROP POLICY IF EXISTS cc_expenses_lawyer_insert ON criminal_case_expenses;
CREATE POLICY cc_expenses_lawyer_insert ON criminal_case_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_lawyer_role()
    AND criminal_case_task_id IS NOT NULL
    AND lawyer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM criminal_case_tasks cct
      WHERE cct.id          = criminal_case_task_id
        AND cct.assigned_to = auth.uid()
    )
  );


NOTIFY pgrst, 'reload schema';
