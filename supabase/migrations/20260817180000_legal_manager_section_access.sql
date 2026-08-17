-- صلاحيات قسم مسؤول القانونية (مدني/جزائي) عبر أعمدة على الملف الشخصي
-- الدور يبقى viewer حتى تُحسب نسبة المحفظة 5%

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_access_civil boolean,
  ADD COLUMN IF NOT EXISTS can_access_criminal boolean;

-- تعبئة افتراضية حسب الدور الحالي
UPDATE public.profiles
SET
  can_access_civil = COALESCE(can_access_civil, true),
  can_access_criminal = COALESCE(can_access_criminal, false)
WHERE role = 'viewer';

UPDATE public.profiles
SET
  can_access_civil = COALESCE(can_access_civil, false),
  can_access_criminal = COALESCE(can_access_criminal, true)
WHERE role = 'criminal_legal_manager';

UPDATE public.profiles
SET
  can_access_civil = COALESCE(can_access_civil, true),
  can_access_criminal = COALESCE(can_access_criminal, true)
WHERE role IN ('admin', 'accountant', 'employee', 'payment_follow_up', 'chief_accountant');

UPDATE public.profiles
SET
  can_access_civil = COALESCE(can_access_civil, COALESCE(case_type, 'civil') = 'civil'),
  can_access_criminal = COALESCE(can_access_criminal, COALESCE(case_type, 'civil') = 'criminal')
WHERE role = 'lawyer';

UPDATE public.profiles
SET
  can_access_civil = COALESCE(can_access_civil, true),
  can_access_criminal = COALESCE(can_access_criminal, false)
WHERE role = 'delegate';

-- أي صف متبقٍ
UPDATE public.profiles
SET
  can_access_civil = COALESCE(can_access_civil, true),
  can_access_criminal = COALESCE(can_access_criminal, false)
WHERE can_access_civil IS NULL OR can_access_criminal IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN can_access_civil SET DEFAULT true,
  ALTER COLUMN can_access_criminal SET DEFAULT false,
  ALTER COLUMN can_access_civil SET NOT NULL,
  ALTER COLUMN can_access_criminal SET NOT NULL;

COMMENT ON COLUMN public.profiles.can_access_civil IS
  'صلاحية رؤية/إدارة القسم المدني — لمسؤول القانونية (viewer) وغيره';
COMMENT ON COLUMN public.profiles.can_access_criminal IS
  'صلاحية رؤية/إدارة القسم الجزائي — تُفعَّل بجانب can_access_civil لمسؤول المدنية عند الحاجة';

CREATE OR REPLACE FUNCTION public.current_user_can_access_case_type(target_case_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN target_case_type IS NULL OR target_case_type NOT IN ('civil', 'criminal') THEN false
    WHEN public.current_app_role() IN (
      'admin', 'accountant', 'employee', 'payment_follow_up', 'chief_accountant'
    ) THEN true
    WHEN public.current_app_role() IN ('viewer', 'criminal_legal_manager') THEN
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND COALESCE(p.is_active, true)
          AND (
            (target_case_type = 'civil' AND COALESCE(p.can_access_civil, true))
            OR (target_case_type = 'criminal' AND COALESCE(p.can_access_criminal, false))
          )
      )
    WHEN public.current_app_role() = 'lawyer' THEN
      COALESCE(public.current_profile_case_type(), 'civil') = target_case_type
    WHEN public.current_app_role() = 'delegate' THEN target_case_type = 'civil'
    ELSE false
  END
$$;

-- إدراج/تحديث المدينين: لا تقيّد viewer بالمدني فقط — اعتمد أعلام القسم
DROP POLICY IF EXISTS section_debtors_insert ON public.debtors;
CREATE POLICY section_debtors_insert ON public.debtors
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_can_access_case_type(COALESCE(case_type, 'civil'))
    AND (case_type IS DISTINCT FROM 'criminal' OR branch_list_id IS NULL)
    AND (
      (
        public.current_app_role() = 'viewer'
        AND public.current_user_can_access_branch(branch_id)
      )
      OR (
        public.current_app_role() = 'criminal_legal_manager'
        AND public.staff_can_write_branch(branch_id)
      )
      OR (
        public.current_app_role() IN ('admin', 'accountant', 'employee')
        AND public.staff_can_write_branch(branch_id)
      )
    )
  );

DROP POLICY IF EXISTS section_debtors_update ON public.debtors;
CREATE POLICY section_debtors_update ON public.debtors
  FOR UPDATE TO authenticated
  USING (
    public.current_user_can_access_case_type(COALESCE(case_type, 'civil'))
    AND (
      (
        public.current_app_role() = 'viewer'
        AND public.current_user_can_access_branch(branch_id)
      )
      OR (
        public.current_app_role() IN ('admin', 'accountant', 'employee', 'criminal_legal_manager')
        AND public.staff_can_write_branch(branch_id)
      )
      OR (
        public.current_app_role() = 'payment_follow_up'
        AND case_status = 'payment_in_progress'
      )
    )
  )
  WITH CHECK (
    public.current_user_can_access_case_type(COALESCE(case_type, 'civil'))
    AND (case_type IS DISTINCT FROM 'criminal' OR branch_list_id IS NULL)
    AND (
      (
        public.current_app_role() = 'viewer'
        AND public.current_user_can_access_branch(branch_id)
      )
      OR (
        public.current_app_role() IN ('admin', 'accountant', 'employee', 'criminal_legal_manager')
        AND public.staff_can_write_branch(branch_id)
      )
      OR (
        public.current_app_role() = 'payment_follow_up'
        AND case_status = 'payment_in_progress'
      )
    )
  );
