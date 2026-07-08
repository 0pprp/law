-- محاسب عام: نفس دور accountant مع accountant_type = 'general' — يرى ويتابع جميع الفروع.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS accountant_type text NOT NULL DEFAULT 'branch';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_accountant_type_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_accountant_type_check
  CHECK (accountant_type IN ('branch', 'general'));

COMMENT ON COLUMN public.profiles.accountant_type IS
  'نوع المحاسب: branch = محاسب فرع (مقيّد بفرعه)، general = محاسب عام (كل الفروع)';

CREATE INDEX IF NOT EXISTS idx_profiles_accountant_type
  ON public.profiles (accountant_type)
  WHERE role = 'accountant';

CREATE OR REPLACE FUNCTION public.is_accountant_role(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id
      AND p.role = 'accountant'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_general_accountant_profile(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id
      AND p.role = 'accountant'
      AND p.accountant_type = 'general'
  )
$$;

-- طلبات السحب: المحاسب العام يرى كل الفروع
DROP POLICY IF EXISTS lawyer_payout_requests_select_staff ON public.lawyer_payout_requests;
CREATE POLICY lawyer_payout_requests_select_staff
  ON public.lawyer_payout_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'employee', 'accountant', 'viewer')
        AND (
          p.role IN ('admin', 'viewer')
          OR public.is_general_accountant_profile(p.id)
          OR lawyer_payout_requests.branch_id = p.branch_id
        )
    )
  );

DROP POLICY IF EXISTS lawyer_payout_requests_update_staff ON public.lawyer_payout_requests;
CREATE POLICY lawyer_payout_requests_update_staff
  ON public.lawyer_payout_requests
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'employee', 'accountant', 'viewer')
        AND (
          p.role IN ('admin', 'viewer')
          OR public.is_general_accountant_profile(p.id)
          OR lawyer_payout_requests.branch_id = p.branch_id
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'employee', 'accountant', 'viewer')
        AND (
          p.role IN ('admin', 'viewer')
          OR public.is_general_accountant_profile(p.id)
          OR lawyer_payout_requests.branch_id = p.branch_id
        )
    )
  );

NOTIFY pgrst, 'reload schema';
