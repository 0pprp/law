-- نسخة قابلة للتشغيل اليدوي (Supabase SQL Editor) من:
-- supabase/migrations/20260831010000_debtor_receipts_prepared.sql
-- آمنة وقابلة لإعادة التشغيل (idempotent) — لا تحذف أي بيانات.

ALTER TABLE public.debtors
  ADD COLUMN IF NOT EXISTS receipts_prepared boolean NOT NULL DEFAULT false;

ALTER TABLE public.debtors
  ADD COLUMN IF NOT EXISTS receipts_prepared_at timestamptz;

ALTER TABLE public.debtors
  ADD COLUMN IF NOT EXISTS receipts_prepared_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.debtors.receipts_prepared IS
  'تم تجهيز الوصل من كارد تجهيز الوصولات — يبقى بعد مغادرة مرحلة المرافعات لتمييز صف المدين بالأخضر';

CREATE INDEX IF NOT EXISTS idx_debtors_receipts_prepared
  ON public.debtors (receipts_prepared)
  WHERE receipts_prepared = true;

NOTIFY pgrst, 'reload schema';
