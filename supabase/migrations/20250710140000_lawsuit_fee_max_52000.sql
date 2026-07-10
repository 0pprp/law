-- رفع الحد الأعلى لصرفية «رسم دعوى» (مهمة إقامة دعوى) من 51,000 إلى 52,000 د.ع

UPDATE public.task_definition_expenses
SET max_amount = 52000
WHERE name IN ('رسم دعوى', 'رسم الدعوى');

NOTIFY pgrst, 'reload schema';
