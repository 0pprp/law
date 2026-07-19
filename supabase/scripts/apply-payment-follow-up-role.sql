-- تطبيق يدوي: دور مسؤول متابعة التسديد
-- 1) شغّل أولاً: supabase/migrations/20260718210000_payment_follow_up_role.sql
-- 2) ثم هذا الملف (أو الـ migration التالية للـ RLS)

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'payment_follow_up';
NOTIFY pgrst, 'reload schema';
