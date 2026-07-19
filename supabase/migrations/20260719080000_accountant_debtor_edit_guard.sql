-- المحاسب يستطيع تعديل حقول نموذج بيانات المدين فقط.
-- المحاسب العام: كل الفروع، محاسب الفرع: فرعه فقط (تفرضها RLS الحالية).
-- يمنع التلاعب المباشر بحالة القضية والمهام والأرصدة ومرجع الفرع عبر REST.

CREATE OR REPLACE FUNCTION public.debtors_restrict_accountant_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_old_protected jsonb;
  v_new_protected jsonb;
BEGIN
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_role IS DISTINCT FROM 'accountant' THEN
    RETURN NEW;
  END IF;

  v_old_protected := to_jsonb(OLD) - ARRAY[
    'full_name',
    'phone',
    'address',
    'id_number',
    'receipt_type',
    'receipt_number',
    'receipt_amount',
    'lawyer_fees',
    'penalty_amount',
    'has_contract',
    'receipt_signed_legal_costs',
    'notes',
    'branch_list_id',
    'updated_at'
  ];
  v_new_protected := to_jsonb(NEW) - ARRAY[
    'full_name',
    'phone',
    'address',
    'id_number',
    'receipt_type',
    'receipt_number',
    'receipt_amount',
    'lawyer_fees',
    'penalty_amount',
    'has_contract',
    'receipt_signed_legal_costs',
    'notes',
    'branch_list_id',
    'updated_at'
  ];

  IF v_new_protected IS DISTINCT FROM v_old_protected THEN
    RAISE EXCEPTION 'غير مسموح للمحاسب بتعديل حالة المدين أو المهام أو الأرصدة أو الفرع';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_debtors_restrict_accountant_update ON public.debtors;
CREATE TRIGGER trg_debtors_restrict_accountant_update
  BEFORE UPDATE ON public.debtors
  FOR EACH ROW
  EXECUTE FUNCTION public.debtors_restrict_accountant_update();

