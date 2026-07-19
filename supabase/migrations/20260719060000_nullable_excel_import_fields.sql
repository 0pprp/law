-- الاستيراد المرن: الاسم الكامل فقط إلزامي.
-- أي عمود Excel غير موجود يُحفظ NULL بدل اختلاق قيمة افتراضية.

ALTER TABLE public.debtors
  ALTER COLUMN phone DROP NOT NULL,
  ALTER COLUMN id_number DROP NOT NULL,
  ALTER COLUMN receipt_number DROP NOT NULL,
  ALTER COLUMN receipt_type DROP NOT NULL,
  ALTER COLUMN receipt_amount DROP NOT NULL,
  ALTER COLUMN remaining_amount DROP NOT NULL,
  ALTER COLUMN required_amount DROP NOT NULL,
  ALTER COLUMN total_expenses DROP NOT NULL,
  ALTER COLUMN penalty_amount DROP NOT NULL,
  ALTER COLUMN has_contract DROP NOT NULL,
  ALTER COLUMN address DROP NOT NULL,
  ALTER COLUMN notes DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
