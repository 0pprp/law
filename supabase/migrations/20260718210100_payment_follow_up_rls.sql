-- RLS لمسؤول متابعة التسديد — كل الفروع (لا قيد على branch_id)
-- قراءة/تحديث المدينين في جاري التسديد فقط + قراءة/إدراج تسديداتهم + قراءة الفروع.
--
-- للتراجع (Down):
--   DROP POLICY IF EXISTS payment_follow_up_debtors_select ON public.debtors;
--   DROP POLICY IF EXISTS payment_follow_up_debtors_update ON public.debtors;
--   DROP POLICY IF EXISTS payment_follow_up_payments_select ON public.debtor_payments;
--   DROP POLICY IF EXISTS payment_follow_up_payments_insert ON public.debtor_payments;
--   DROP POLICY IF EXISTS payment_follow_up_branches_select ON public.branches;
--   DROP FUNCTION IF EXISTS public.payment_follow_up_can_access_debtor(uuid, text);
--   DROP INDEX IF EXISTS idx_debtors_payment_in_progress;

CREATE OR REPLACE FUNCTION public.payment_follow_up_can_access_debtor(
  d_branch_id uuid,
  d_case_status text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d_case_status = 'payment_in_progress'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'payment_follow_up'
        AND COALESCE(p.is_active, true)
    )
$$;

DROP POLICY IF EXISTS payment_follow_up_debtors_select ON public.debtors;
CREATE POLICY payment_follow_up_debtors_select ON public.debtors
  FOR SELECT TO authenticated
  USING (public.payment_follow_up_can_access_debtor(branch_id, case_status));

DROP POLICY IF EXISTS payment_follow_up_debtors_update ON public.debtors;
CREATE POLICY payment_follow_up_debtors_update ON public.debtors
  FOR UPDATE TO authenticated
  USING (public.payment_follow_up_can_access_debtor(branch_id, case_status))
  WITH CHECK (public.payment_follow_up_can_access_debtor(branch_id, case_status));

DROP POLICY IF EXISTS payment_follow_up_payments_select ON public.debtor_payments;
CREATE POLICY payment_follow_up_payments_select ON public.debtor_payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.debtors d
      WHERE d.id = debtor_payments.debtor_id
        AND public.payment_follow_up_can_access_debtor(d.branch_id, d.case_status)
    )
  );

DROP POLICY IF EXISTS payment_follow_up_payments_insert ON public.debtor_payments;
CREATE POLICY payment_follow_up_payments_insert ON public.debtor_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.debtors d
      WHERE d.id = debtor_id
        AND public.payment_follow_up_can_access_debtor(d.branch_id, d.case_status)
    )
  );

DROP POLICY IF EXISTS payment_follow_up_branches_select ON public.branches;
CREATE POLICY payment_follow_up_branches_select ON public.branches
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'payment_follow_up'
    )
  );

CREATE INDEX IF NOT EXISTS idx_debtors_payment_in_progress
  ON public.debtors (branch_id, created_at)
  WHERE case_status = 'payment_in_progress';
