-- المبلغ المطلوب =
-- MIN(المبلغ المتبقي + إجمالي المصروفات + الشرط الجزائي، مبلغ الوصل الأصلي)
-- القيم الفارغة للمصروفات والشرط الجزائي تعامل كصفر.

CREATE OR REPLACE FUNCTION public.calculate_debtor_required_amount(
  p_remaining_amount numeric,
  p_total_expenses numeric,
  p_penalty_amount numeric,
  p_receipt_amount numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_receipt_amount > 0 THEN
      LEAST(
        GREATEST(0, p_remaining_amount)
          + GREATEST(0, COALESCE(p_total_expenses, 0))
          + GREATEST(0, COALESCE(p_penalty_amount, 0)),
        p_receipt_amount
      )
    ELSE
      GREATEST(0, p_remaining_amount)
        + GREATEST(0, COALESCE(p_total_expenses, 0))
        + GREATEST(0, COALESCE(p_penalty_amount, 0))
  END;
$$;

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

  -- قاعدة ثابتة = المطلوب − المصروفات − الشرط (وليس المتبقي الحي بعد التسديدات)
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

-- إصلاح بيانات: استعادة القاعدة ثم إعادة حساب المطلوب والمتبقي
UPDATE public.debtors d
SET required_amount = public.calculate_debtor_required_amount(
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

NOTIFY pgrst, 'reload schema';
