-- محفظة القرطاسية: طوابع فقط (إزالة الفايلات)

-- حذف حركات الفايلات التاريخية
DELETE FROM public.lawyer_stationery_transactions WHERE item = 'files';

-- إسقاط عمود رصيد الفايلات
ALTER TABLE public.lawyer_stationery_wallets
  DROP COLUMN IF EXISTS files_balance;

-- تقييد item على stamps فقط
ALTER TABLE public.lawyer_stationery_transactions
  DROP CONSTRAINT IF EXISTS lawyer_stationery_transactions_item_check;

ALTER TABLE public.lawyer_stationery_transactions
  ADD CONSTRAINT lawyer_stationery_transactions_item_check
  CHECK (item = 'stamps');

NOTIFY pgrst, 'reload schema';
