-- تحويل required_amount من عمود مُولَّد إلى عمود مخزَّن + المعادلة الصحيحة:
-- المطلوب: يزيد فقط بالصرفيات المعتمدة
-- المتبقي: المطلوب − إجمالي التسديدات

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'debtors'
      AND column_name = 'required_amount'
      AND is_generated = 'ALWAYS'
  ) THEN
    ALTER TABLE public.debtors DROP COLUMN required_amount;
  END IF;
END $$;

ALTER TABLE public.debtors
  ADD COLUMN IF NOT EXISTS required_amount numeric NOT NULL DEFAULT 0;

-- إعادة بناء المطلوب من الحالة الحالية (متبقي + تسديدات)
UPDATE public.debtors d
SET required_amount = GREATEST(0, COALESCE(d.remaining_amount, 0) + COALESCE(d.total_payments, 0))
WHERE COALESCE(d.required_amount, 0) = 0
   OR COALESCE(d.required_amount, 0) <> GREATEST(0, COALESCE(d.remaining_amount, 0) + COALESCE(d.total_payments, 0));

UPDATE public.debtors d
SET remaining_amount = GREATEST(0, COALESCE(d.required_amount, 0) - COALESCE(d.total_payments, 0));

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
  v_required numeric;
  v_payments numeric;
BEGIN
  v_debtor_id := COALESCE(NEW.debtor_id, OLD.debtor_id);
  IF v_debtor_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(d.total_expenses, 0), COALESCE(d.required_amount, 0), COALESCE(d.total_payments, 0)
  INTO v_old_exp, v_required, v_payments
  FROM public.debtors d
  WHERE d.id = v_debtor_id;

  SELECT COALESCE(SUM(e.amount::numeric), 0)
  INTO v_new_exp
  FROM public.expenses e
  WHERE e.debtor_id = v_debtor_id
    AND COALESCE(e.status, 'approved') = 'approved';

  v_delta := v_new_exp - COALESCE(v_old_exp, 0);
  v_required := GREATEST(0, COALESCE(v_required, 0) + v_delta);

  UPDATE public.debtors d
  SET
    total_expenses = v_new_exp,
    required_amount = v_required,
    remaining_amount = GREATEST(0, v_required - v_payments)
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
  v_required numeric;
  v_new_payments numeric;
BEGIN
  v_debtor_id := COALESCE(NEW.debtor_id, OLD.debtor_id);
  IF v_debtor_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(p.amount::numeric), 0)
  INTO v_new_payments
  FROM public.debtor_payments p
  WHERE p.debtor_id = v_debtor_id;

  SELECT COALESCE(d.required_amount, 0)
  INTO v_required
  FROM public.debtors d
  WHERE d.id = v_debtor_id;

  UPDATE public.debtors d
  SET
    total_payments = v_new_payments,
    remaining_amount = GREATEST(0, COALESCE(v_required, 0) - v_new_payments)
  WHERE d.id = v_debtor_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

NOTIFY pgrst, 'reload schema';
