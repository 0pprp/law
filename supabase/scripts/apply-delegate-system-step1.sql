-- الخطوة 1 فقط: إضافة دور المندوب إلى enum
-- شغّل هذا السكربت وحده، ثم انتقل إلى apply-delegate-system-step2.sql
-- (PostgreSQL يمنع استخدام قيمة enum جديدة في نفس المعاملة — خطأ 55P04)

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'delegate';

NOTIFY pgrst, 'reload schema';
