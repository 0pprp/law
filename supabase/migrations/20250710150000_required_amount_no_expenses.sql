-- المبلغ المطلوب = min(متبقي الوصل + الشرط الجزائي، مبلغ الوصل) — لا يزيد بالصرفيات
-- المتبقي في النظام = المطلوب − التسديدات

CREATE OR REPLACE FUNCTION public.sync_debtor_total_expenses()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debtor_id uuid;
BEGIN
  v_debtor_id := COALESCE(NEW.debtor_id, OLD.debtor_id);
  IF v_debtor_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.debtors d
  SET total_expenses = COALESCE((
    SELECT SUM(e.amount::numeric)
    FROM public.expenses e
    WHERE e.debtor_id = v_debtor_id
      AND COALESCE(e.status, 'approved') = 'approved'
  ), 0)
  WHERE d.id = v_debtor_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

NOTIFY pgrst, 'reload schema';
