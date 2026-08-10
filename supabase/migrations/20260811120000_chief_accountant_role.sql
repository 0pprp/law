-- دور «محاسب رئيسي» (chief_accountant)
-- شغّل هذا الملف أولاً (قيمة enum)، ثم 20260811120100_chief_accountant_schema_rls.sql
--
-- للتراجع (يدوي — لا يُزال enum بسهولة من الإنتاج):
--   -- لا تحذف قيمة enum من user_role بدون خطة

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'chief_accountant';

NOTIFY pgrst, 'reload schema';
