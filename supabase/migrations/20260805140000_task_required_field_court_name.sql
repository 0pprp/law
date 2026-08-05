-- أضف court_name لأنواع الحقول الإلزامية المسموحة
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
