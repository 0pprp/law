-- طبّق يدوياً إن لزم: السماح بحقل اسم المحكمة في الحقول الإلزامية
ALTER TABLE public.task_required_fields
  DROP CONSTRAINT IF EXISTS task_required_fields_field_type_check;

ALTER TABLE public.task_required_fields
  ADD CONSTRAINT task_required_fields_field_type_check
  CHECK (field_type = ANY (ARRAY[
    'note'::text,
    'image'::text,
    'pdf'::text,
    'decision_number'::text,
    'case_number'::text,
    'date'::text,
    'gps'::text,
    'receipt'::text,
    'legal_result'::text,
    'text'::text,
    'number'::text,
    'court_decision'::text,
    'team'::text,
    'court_name'::text
  ]));

-- حدّث حقول إقامة دعوى لتستخدم النوع court_name إن وُجدت كـ text
UPDATE public.task_required_fields
SET field_type = 'court_name',
    field_label = COALESCE(NULLIF(trim(field_label), ''), 'اسم المحكمة')
WHERE field_key = 'court_name'
  AND field_type = 'text';
