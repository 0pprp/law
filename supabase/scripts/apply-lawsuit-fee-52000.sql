-- تشغيل يدوي في Supabase SQL Editor
UPDATE public.task_definition_expenses
SET max_amount = 52000
WHERE name IN ('رسم دعوى', 'رسم الدعوى');

NOTIFY pgrst, 'reload schema';
