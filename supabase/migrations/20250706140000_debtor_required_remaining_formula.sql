-- معادلة المدين (required_amount عمود مُولَّد — لا يُحدَّث مباشرة):
-- المبلغ المطلوب = remaining_amount + total_payments  (أو تعريف DB الحالي)
-- عند صرفية معتمدة: remaining += مبلغ الصرفية
-- عند تسديد: remaining -= مبلغ التسديد، total_payments يُزامَن

CREATE OR REPLACE FUNCTION public.sync_debtor_total_expenses()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debtor_id uuid;
  v_old_exp numeric;
  v_new_exp numeric;
  v_delta numeric;
BEGIN
  v_debtor_id := COALESCE(NEW.debtor_id, OLD.debtor_id);
  IF v_debtor_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(d.total_expenses, 0)
  INTO v_old_exp
  FROM public.debtors d
  WHERE d.id = v_debtor_id;

  SELECT COALESCE(SUM(e.amount::numeric), 0)
  INTO v_new_exp
  FROM public.expenses e
  WHERE e.debtor_id = v_debtor_id
    AND COALESCE(e.status, 'approved') = 'approved';

  v_delta := v_new_exp - COALESCE(v_old_exp, 0);

  UPDATE public.debtors d
  SET
    total_expenses = v_new_exp,
    remaining_amount = GREATEST(0, COALESCE(d.remaining_amount, 0) + v_delta)
  WHERE d.id = v_debtor_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_debtor_total_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debtor_id uuid;
  v_old_payments numeric;
  v_new_payments numeric;
  v_delta numeric;
BEGIN
  v_debtor_id := COALESCE(NEW.debtor_id, OLD.debtor_id);
  IF v_debtor_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(d.total_payments, 0)
  INTO v_old_payments
  FROM public.debtors d
  WHERE d.id = v_debtor_id;

  SELECT COALESCE(SUM(p.amount::numeric), 0)
  INTO v_new_payments
  FROM public.debtor_payments p
  WHERE p.debtor_id = v_debtor_id;

  v_delta := v_new_payments - COALESCE(v_old_payments, 0);

  UPDATE public.debtors d
  SET
    total_payments = v_new_payments,
    remaining_amount = GREATEST(0, COALESCE(d.remaining_amount, 0) - v_delta)
  WHERE d.id = v_debtor_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- إصلاح المتبقي ليتوافق مع المطلوب المُولَّد: remaining = required − payments
UPDATE public.debtors d
SET remaining_amount = GREATEST(0, COALESCE(d.required_amount, 0) - COALESCE(d.total_payments, 0));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_expenses_sync_debtor_totals'
  ) THEN
    CREATE TRIGGER trg_expenses_sync_debtor_totals
      AFTER INSERT OR UPDATE OR DELETE ON public.expenses
      FOR EACH ROW EXECUTE FUNCTION public.sync_debtor_total_expenses();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_payments_sync_debtor_totals'
  ) THEN
    CREATE TRIGGER trg_payments_sync_debtor_totals
      AFTER INSERT OR UPDATE OR DELETE ON public.debtor_payments
      FOR EACH ROW EXECUTE FUNCTION public.sync_debtor_total_payments();
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
