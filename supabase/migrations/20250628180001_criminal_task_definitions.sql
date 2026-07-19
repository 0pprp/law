-- Step 2 of 2: task definitions + required fields (run after 20250628180000 commits).

INSERT INTO task_definitions (branch_id, task_type, label, fee_amount, sort_order, is_active)
SELECT b.id, v.task_type::task_type, v.label, v.fee_amount, v.sort_order, true
FROM branches b
CROSS JOIN (VALUES
  ('criminal_lawsuit_request', 'تقديم طلب دعوى جزائية', 25000::numeric, 200),
  ('police_station_statement', 'تدوين أقوال في مركز الشرطة', 25000::numeric, 201),
  ('court_statement', 'تدوين أقوال في المحكمة', 25000::numeric, 202),
  ('witness_statement', 'تدوين أقوال الشهود', 25000::numeric, 203)
) AS v(task_type, label, fee_amount, sort_order)
WHERE b.is_active = true
  AND b.name IN (
    'بغداد الكرخ', 'بغداد الرصافة', 'بابل', 'البصرة', 'الديوانية', 'ديالى',
    'كربلاء', 'كركوك', 'الموصل', 'النجف الأشرف', 'الناصرية', 'السماوة'
  )
  AND NOT EXISTS (
    SELECT 1 FROM task_definitions td
    WHERE td.branch_id = b.id AND td.task_type::text = v.task_type
  );

-- 1) تقديم طلب دعوى جزائية: ملاحظة + اسم مركز الشرطة + صورة (إجباري)
INSERT INTO task_required_fields (task_definition_id, field_key, field_type, field_label, is_required, sort_order)
SELECT td.id, f.field_key, f.field_type, f.field_label, f.is_required, f.sort_order
FROM task_definitions td
CROSS JOIN (VALUES
  ('note', 'note', 'ملاحظة', true, 1),
  ('police_station_name', 'text', 'اسم مركز الشرطة', true, 2),
  ('image', 'image', 'صورة/مرفق', true, 3)
) AS f(field_key, field_type, field_label, is_required, sort_order)
WHERE td.task_type::text = 'criminal_lawsuit_request'
  AND NOT EXISTS (
    SELECT 1 FROM task_required_fields trf
    WHERE trf.task_definition_id = td.id AND trf.field_key = f.field_key
  );

-- 2) تدوين أقوال في مركز الشرطة: ملاحظة فقط
INSERT INTO task_required_fields (task_definition_id, field_key, field_type, field_label, is_required, sort_order)
SELECT td.id, f.field_key, f.field_type, f.field_label, f.is_required, f.sort_order
FROM task_definitions td
CROSS JOIN (VALUES
  ('note', 'note', 'ملاحظة', true, 1)
) AS f(field_key, field_type, field_label, is_required, sort_order)
WHERE td.task_type::text = 'police_station_statement'
  AND NOT EXISTS (
    SELECT 1 FROM task_required_fields trf
    WHERE trf.task_definition_id = td.id AND trf.field_key = f.field_key
  );

-- 3) تدوين أقوال في المحكمة: ملاحظة إجباري + صورة اختياري
INSERT INTO task_required_fields (task_definition_id, field_key, field_type, field_label, is_required, sort_order)
SELECT td.id, f.field_key, f.field_type, f.field_label, f.is_required, f.sort_order
FROM task_definitions td
CROSS JOIN (VALUES
  ('note', 'note', 'ملاحظة', true, 1),
  ('image', 'image', 'صورة/مرفق', false, 2)
) AS f(field_key, field_type, field_label, is_required, sort_order)
WHERE td.task_type::text = 'court_statement'
  AND NOT EXISTS (
    SELECT 1 FROM task_required_fields trf
    WHERE trf.task_definition_id = td.id AND trf.field_key = f.field_key
  );

-- 4) تدوين أقوال الشهود: ملاحظة إجباري + صورة اختياري
INSERT INTO task_required_fields (task_definition_id, field_key, field_type, field_label, is_required, sort_order)
SELECT td.id, f.field_key, f.field_type, f.field_label, f.is_required, f.sort_order
FROM task_definitions td
CROSS JOIN (VALUES
  ('note', 'note', 'ملاحظة', true, 1),
  ('image', 'image', 'صورة/مرفق', false, 2)
) AS f(field_key, field_type, field_label, is_required, sort_order)
WHERE td.task_type::text = 'witness_statement'
  AND NOT EXISTS (
    SELECT 1 FROM task_required_fields trf
    WHERE trf.task_definition_id = td.id AND trf.field_key = f.field_key
  );

NOTIFY pgrst, 'reload schema';
