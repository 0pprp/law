-- نسخة قابلة للتشغيل اليدوي (Supabase SQL Editor) من:
-- supabase/migrations/20260831180000_debtor_transaction_sale.sql
-- آمنة وقابلة لإعادة التشغيل (idempotent) — لا تحذف أي بيانات.

ALTER TABLE public.debtors
  ADD COLUMN IF NOT EXISTS transaction_number text;

ALTER TABLE public.debtors
  ADD COLUMN IF NOT EXISTS sale_date date;

COMMENT ON COLUMN public.debtors.transaction_number IS
  'رقم المعاملة — يظهر في جداول المدينين';

COMMENT ON COLUMN public.debtors.sale_date IS
  'تاريخ البيع — يُدخل عند إضافة المدين';

CREATE INDEX IF NOT EXISTS idx_debtors_transaction_number
  ON public.debtors (branch_id, transaction_number)
  WHERE transaction_number IS NOT NULL;

NOTIFY pgrst, 'reload schema';
