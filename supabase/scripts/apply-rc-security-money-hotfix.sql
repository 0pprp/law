-- Manual apply: RC security + money integrity hotfix
-- Run in Supabase SQL editor before production deploy.

-- 1) Revoke dangerous SECURITY DEFINER RPCs from authenticated
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'credit_task_completion_fee'
  ) THEN
    REVOKE ALL ON FUNCTION public.credit_task_completion_fee(uuid, uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.credit_task_completion_fee(uuid, uuid) FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.credit_task_completion_fee(uuid, uuid) TO service_role;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'approve_payment_noncompliance_request'
  ) THEN
    REVOKE ALL ON FUNCTION public.approve_payment_noncompliance_request(uuid, uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.approve_payment_noncompliance_request(uuid, uuid) FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.approve_payment_noncompliance_request(uuid, uuid) TO service_role;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'reject_payment_noncompliance_request'
  ) THEN
    REVOKE ALL ON FUNCTION public.reject_payment_noncompliance_request(uuid, uuid, text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.reject_payment_noncompliance_request(uuid, uuid, text) FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.reject_payment_noncompliance_request(uuid, uuid, text) TO service_role;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'replace_task_required_fields'
  ) THEN
    REVOKE ALL ON FUNCTION public.replace_task_required_fields(uuid, jsonb) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.replace_task_required_fields(uuid, jsonb) FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.replace_task_required_fields(uuid, jsonb) TO service_role;
  END IF;
END $$;

-- 2) Lawyer privilege escalation guard
CREATE OR REPLACE FUNCTION public.tasks_prevent_lawyer_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_allowed_status boolean;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('lawyer', 'delegate', 'محامي', 'attorney') THEN
    RETURN NEW;
  END IF;

  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND NEW.assigned_to IS NOT NULL
     AND NEW.assigned_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'غير مسموح بتغيير المكلّف';
  END IF;

  IF NEW.reward_amount IS DISTINCT FROM OLD.reward_amount THEN
    RAISE EXCEPTION 'غير مسموح بتعديل مبلغ الأتعاب';
  END IF;
  IF NEW.fee_status IS DISTINCT FROM OLD.fee_status THEN
    RAISE EXCEPTION 'غير مسموح بتعديل حالة الأتعاب';
  END IF;

  IF NEW.task_status IS DISTINCT FROM OLD.task_status THEN
    v_allowed_status := (
      (OLD.task_status = 'assignment_pending_acceptance' AND NEW.task_status = 'assigned')
      OR (OLD.task_status IN ('assigned', 'in_progress', 'needs_revision', 'needs_info', 'rejected')
          AND NEW.task_status IN ('assigned', 'in_progress', 'submitted', 'pending_review'))
      OR (OLD.task_status = 'assignment_pending_acceptance'
          AND NEW.task_status IN ('waiting_assignment', 'pending_assignment'))
      OR (OLD.task_status IN ('assigned', 'in_progress', 'needs_revision')
          AND NEW.task_status IN ('waiting_assignment', 'pending_assignment'))
    );
    IF NOT v_allowed_status THEN
      RAISE EXCEPTION 'غير مسموح بتغيير حالة المهمة إلى %', NEW.task_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_prevent_lawyer_privilege_escalation ON public.tasks;
CREATE TRIGGER trg_tasks_prevent_lawyer_privilege_escalation
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.tasks_prevent_lawyer_privilege_escalation();

-- 3) Required amount sync fix
CREATE OR REPLACE FUNCTION public.sync_debtor_total_expenses()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debtor_id uuid;
  v_total_expenses numeric;
  v_base numeric;
  v_required numeric;
  v_payments numeric;
BEGIN
  v_debtor_id := COALESCE(NEW.debtor_id, OLD.debtor_id);
  IF v_debtor_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(e.amount::numeric), 0)
  INTO v_total_expenses
  FROM public.expenses e
  WHERE e.debtor_id = v_debtor_id
    AND COALESCE(e.status, 'approved') = 'approved';

  SELECT GREATEST(
    0,
    COALESCE(d.required_amount, 0)
      - COALESCE(d.total_expenses, 0)
      - COALESCE(d.penalty_amount, 0)
  )
  INTO v_base
  FROM public.debtors d
  WHERE d.id = v_debtor_id;

  v_required := public.calculate_debtor_required_amount(
    COALESCE(v_base, 0),
    v_total_expenses,
    (SELECT COALESCE(penalty_amount, 0) FROM public.debtors WHERE id = v_debtor_id),
    (SELECT COALESCE(receipt_amount, 0) FROM public.debtors WHERE id = v_debtor_id)
  );

  SELECT COALESCE(SUM(p.amount::numeric), 0)
  INTO v_payments
  FROM public.debtor_payments p
  WHERE p.debtor_id = v_debtor_id;

  UPDATE public.debtors d
  SET
    total_expenses = v_total_expenses,
    required_amount = v_required,
    remaining_amount = GREATEST(0, v_required - v_payments),
    total_payments = v_payments
  WHERE d.id = v_debtor_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

UPDATE public.debtors d
SET
  required_amount = public.calculate_debtor_required_amount(
    GREATEST(
      0,
      COALESCE(d.required_amount, 0)
        - COALESCE(d.total_expenses, 0)
        - COALESCE(d.penalty_amount, 0)
    ),
    d.total_expenses,
    d.penalty_amount,
    d.receipt_amount
  );

UPDATE public.debtors d
SET remaining_amount = GREATEST(
  0,
  COALESCE(d.required_amount, 0) - COALESCE(d.total_payments, 0)
);

-- 4) payment_follow_up column guard
CREATE OR REPLACE FUNCTION public.debtors_restrict_payment_follow_up_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'payment_follow_up' THEN
    RETURN NEW;
  END IF;

  IF NEW.case_status IS DISTINCT FROM OLD.case_status THEN
    RAISE EXCEPTION 'غير مسموح بتغيير حالة القضية';
  END IF;
  IF NEW.required_amount IS DISTINCT FROM OLD.required_amount
     OR NEW.remaining_amount IS DISTINCT FROM OLD.remaining_amount
     OR NEW.total_payments IS DISTINCT FROM OLD.total_payments
     OR NEW.total_expenses IS DISTINCT FROM OLD.total_expenses
     OR NEW.penalty_amount IS DISTINCT FROM OLD.penalty_amount
     OR NEW.receipt_amount IS DISTINCT FROM OLD.receipt_amount
     OR NEW.lawyer_fees IS DISTINCT FROM OLD.lawyer_fees
     OR NEW.current_task_id IS DISTINCT FROM OLD.current_task_id
     OR NEW.last_task_id IS DISTINCT FROM OLD.last_task_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'غير مسموح بتعديل الأرصدة أو المهام لهذا الدور';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_debtors_restrict_payment_follow_up_update ON public.debtors;
CREATE TRIGGER trg_debtors_restrict_payment_follow_up_update
  BEFORE UPDATE ON public.debtors
  FOR EACH ROW
  EXECUTE FUNCTION public.debtors_restrict_payment_follow_up_update();

NOTIFY pgrst, 'reload schema';
