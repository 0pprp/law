-- إضافة حقل «صورة» إلزامي لمهام إيجاد العنوان — كل الفروع
-- يشمل: find_address، find_missing_address، وأي تعريف بعنوان يحتوي «إيجاد عنوان»

-- تأكيد أن الحقول الموجودة من نوع صورة أصبحت إلزامية
UPDATE public.task_required_fields rf
SET
  is_required = true,
  field_label = COALESCE(NULLIF(trim(rf.field_label), ''), 'صورة')
FROM public.task_definitions d
WHERE rf.task_definition_id = d.id
  AND d.is_active = true
  AND (
    d.task_type::text IN ('find_address', 'find_missing_address')
    OR d.label ILIKE '%إيجاد عنوان%'
  )
  AND (rf.field_key = 'address_photo' OR rf.field_type = 'image');

-- إضافة حقل صورة إن لم يكن موجوداً
INSERT INTO public.task_required_fields (task_definition_id, field_key, field_type, field_label, is_required, sort_order)
SELECT
  d.id,
  'address_photo',
  'image',
  'صورة',
  true,
  COALESCE((
    SELECT MAX(rf.sort_order) + 1 FROM public.task_required_fields rf WHERE rf.task_definition_id = d.id
  ), 1)
FROM public.task_definitions d
WHERE d.is_active = true
  AND (
    d.task_type::text IN ('find_address', 'find_missing_address')
    OR d.label ILIKE '%إيجاد عنوان%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.task_required_fields rf
    WHERE rf.task_definition_id = d.id
      AND (rf.field_key = 'address_photo' OR rf.field_type = 'image')
  );

NOTIFY pgrst, 'reload schema';
