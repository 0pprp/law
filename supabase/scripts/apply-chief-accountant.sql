-- تطبيق يدوي لدور المحاسب الرئيسي — خطوتان منفصلتان (مطلوب بسبب 55P04)
--
-- في Supabase SQL Editor:
--   1) نفّذ فقط القسم «الخطوة 1» ثم اضغط Run
--   2) بعد نجاحه، نفّذ فقط القسم «الخطوة 2» ثم اضغط Run
-- لا تلصق الخطوتين معاً في نفس التشغيل.

-- ############################################################################
-- الخطوة 1 — قيمة enum فقط (شغّلها وحدها ثم انتظر النجاح)
-- ############################################################################
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'chief_accountant';

NOTIFY pgrst, 'reload schema';

-- ############################################################################
-- الخطوة 2 — الجدول + الأعمدة + RLS (شغّلها في تشغيل منفصل بعد الخطوة 1)
-- ############################################################################

CREATE TABLE IF NOT EXISTS public.chief_accountant_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chief_accountant_branches_profile_branch_unique UNIQUE (profile_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_chief_accountant_branches_profile_id
  ON public.chief_accountant_branches (profile_id);

CREATE INDEX IF NOT EXISTS idx_chief_accountant_branches_branch_id
  ON public.chief_accountant_branches (branch_id);

ALTER TABLE public.chief_accountant_branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chief_accountant_branches_admin_all ON public.chief_accountant_branches;
CREATE POLICY chief_accountant_branches_admin_all ON public.chief_accountant_branches
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND COALESCE(p.is_active, true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND COALESCE(p.is_active, true)
    )
  );

DROP POLICY IF EXISTS chief_accountant_branches_self_select ON public.chief_accountant_branches;
CREATE POLICY chief_accountant_branches_self_select ON public.chief_accountant_branches
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'chief_accountant'
        AND COALESCE(p.is_active, true)
    )
  );

ALTER TABLE public.debtors
  ADD COLUMN IF NOT EXISTS file_preparation_status text DEFAULT NULL;

ALTER TABLE public.debtors
  ADD COLUMN IF NOT EXISTS assigned_chief_accountant_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'debtors_file_preparation_status_check'
      AND conrelid = 'public.debtors'::regclass
  ) THEN
    ALTER TABLE public.debtors
      ADD CONSTRAINT debtors_file_preparation_status_check
      CHECK (
        file_preparation_status IS NULL
        OR file_preparation_status IN ('preparing', 'ready')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_debtors_file_preparation_status
  ON public.debtors (file_preparation_status);

CREATE INDEX IF NOT EXISTS idx_debtors_assigned_chief_accountant_id
  ON public.debtors (assigned_chief_accountant_id);

CREATE OR REPLACE FUNCTION public.chief_accountant_can_access_debtor(
  d_assigned_chief_accountant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d_assigned_chief_accountant_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'chief_accountant'
        AND COALESCE(p.is_active, true)
    )
$$;

DROP POLICY IF EXISTS chief_accountant_debtors_select ON public.debtors;
CREATE POLICY chief_accountant_debtors_select ON public.debtors
  FOR SELECT TO authenticated
  USING (public.chief_accountant_can_access_debtor(assigned_chief_accountant_id));

DROP POLICY IF EXISTS chief_accountant_debtors_update ON public.debtors;
CREATE POLICY chief_accountant_debtors_update ON public.debtors
  FOR UPDATE TO authenticated
  USING (public.chief_accountant_can_access_debtor(assigned_chief_accountant_id))
  WITH CHECK (public.chief_accountant_can_access_debtor(assigned_chief_accountant_id));

NOTIFY pgrst, 'reload schema';
