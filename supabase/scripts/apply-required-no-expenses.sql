-- ملف قديم متوافق: الصرفيات تدخل الآن في معادلة المبلغ المطلوب.
CREATE OR REPLACE FUNCTION public.sync_debtor_total_expenses()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debtor_id uuid;
  v_total_expenses numeric;
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

  UPDATE public.debtors d
  SET
    total_expenses = v_total_expenses,
    required_amount = CASE
      WHEN d.receipt_amount > 0 THEN LEAST(
        GREATEST(0, d.remaining_amount)
          + GREATEST(0, COALESCE(v_total_expenses, 0))
          + GREATEST(0, COALESCE(d.penalty_amount, 0)),
        d.receipt_amount
      )
      ELSE GREATEST(0, d.remaining_amount)
        + GREATEST(0, COALESCE(v_total_expenses, 0))
        + GREATEST(0, COALESCE(d.penalty_amount, 0))
    END
  WHERE d.id = v_debtor_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

NOTIFY pgrst, 'reload schema';
