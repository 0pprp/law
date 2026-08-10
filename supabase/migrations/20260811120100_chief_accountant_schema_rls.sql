-- مخطط + RLS للمحاسب الرئيسي
-- يعتمد تشغيل: 20260811120000_chief_accountant_role.sql (قيمة enum)
--
-- للتراجع (يدوي):
--   DROP POLICY IF EXISTS chief_accountant_debtors_select ON public.debtors;
--   DROP POLICY IF EXISTS chief_accountant_debtors_update ON public.debtors;
--   DROP POLICY IF EXISTS chief_accountant_branches_admin_all ON public.chief_accountant_branches;
--   DROP POLICY IF EXISTS chief_accountant_branches_self_select ON public.chief_accountant_branches;
--   DROP FUNCTION IF EXISTS public.chief_accountant_can_access_debtor(uuid);
--   DROP INDEX IF EXISTS idx_debtors_file_preparation_status;
--   DROP INDEX IF EXISTS idx_debtors_assigned_chief_accountant_id;
--   ALTER TABLE public.debtors DROP COLUMN IF EXISTS assigned_chief_accountant_id;
--   ALTER TABLE public.debtors DROP COLUMN IF EXISTS file_preparation_status;
--   DROP TABLE IF EXISTS public.chief_accountant_branches;

-- ——— جدول فروع المحاسب الرئيسي ———
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

COMMENT ON TABLE public.chief_accountant_branches IS
  'فروع مرتبطة بحساب محاسب رئيسي (profile_id)';

ALTER TABLE public.chief_accountant_branches ENABLE ROW LEVEL SECURITY;

-- admin: كامل
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

-- chief_accountant: SELECT فقط لصفوفه
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

-- ——— أعمدة المدينين ———
ALTER TABLE public.debtors
  ADD COLUMN IF NOT EXISTS file_preparation_status text
    DEFAULT NULL;

ALTER TABLE public.debtors
  ADD COLUMN IF NOT EXISTS assigned_chief_accountant_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL;

-- قيد القيم المسموحة (NULL مسموح)
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

COMMENT ON COLUMN public.debtors.file_preparation_status IS
  'حالة تجهيز الملف: preparing | ready | NULL';
COMMENT ON COLUMN public.debtors.assigned_chief_accountant_id IS
  'المحاسب الرئيسي المعيَّن على المدين';

-- ——— RLS المدينين للمحاسب الرئيسي ———
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
