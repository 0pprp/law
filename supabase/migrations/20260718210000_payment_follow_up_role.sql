-- دور «مسؤول متابعة التسديد» + صلاحيات قراءة جاري التسديد وتسجيل التسديد فقط.
-- الحالة: debtors.case_status = 'payment_in_progress'
--
-- للتراجع (يدوي — لا يمكن إزالة قيمة enum بسهولة):
--   DROP POLICY IF EXISTS staff_debtors_select ON public.debtors;
--   ... أعد إنشاء السياسات السابقة ...
--   DROP FUNCTION IF EXISTS public.is_payment_follow_up();
--   -- لا تحذف قيمة enum من user_role في الإنتاج بدون خطة

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'payment_follow_up';

NOTIFY pgrst, 'reload schema';
