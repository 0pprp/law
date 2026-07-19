-- محفظة المحامين:
-- المحاسب العام يرى/يدير كل الفروع، ومحاسب الفرع يبقى ضمن فرعه فقط.

CREATE OR REPLACE FUNCTION public.can_access_lawyer_wallet_profile(p_target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles caller
    LEFT JOIN public.profiles target ON target.id = p_target_user_id
    WHERE caller.id = auth.uid()
      AND (
        caller.role IN ('admin', 'employee', 'viewer')
        OR (
          caller.role = 'accountant'
          AND (
            caller.accountant_type = 'general'
            OR target.branch_id = caller.branch_id
          )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION public.can_access_lawyer_wallet_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_lawyer_wallet_profile(uuid) TO authenticated;

DROP POLICY IF EXISTS lawyer_wallet_tx_select_staff ON public.lawyer_wallet_transactions;
CREATE POLICY lawyer_wallet_tx_select_staff
  ON public.lawyer_wallet_transactions
  FOR SELECT TO authenticated
  USING (
    public.can_access_lawyer_wallet_profile(lawyer_wallet_transactions.lawyer_id)
  );

DROP POLICY IF EXISTS lawyer_wallet_tx_insert_staff ON public.lawyer_wallet_transactions;
CREATE POLICY lawyer_wallet_tx_insert_staff
  ON public.lawyer_wallet_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_lawyer_wallet_profile(lawyer_wallet_transactions.lawyer_id)
    AND NOT public.is_viewer_role()
  );

NOTIFY pgrst, 'reload schema';
