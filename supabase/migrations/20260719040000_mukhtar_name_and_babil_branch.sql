-- ميزتان صغيرتان:
-- 1) «اسم المختار» النصي الاختياري لمهمتي إيجاد العنوان فقط.
-- 2) إضافة فرع «بابل» بصورة idempotent.
--
-- بيانات الإنجاز تُحفظ في tasks.completion_data JSON؛ لذلك لا نحتاج عموداً جديداً.

-- أبقِ الحقول الثلاثة الحالية كما هي، وأضف الحقل الرابع فقط.
UPDATE public.task_required_fields rf
SET
  field_type = 'text',
  field_label = 'اسم المختار',
  is_required = false
FROM public.task_definitions d
WHERE rf.task_definition_id = d.id
  AND d.task_type::text IN ('find_address', 'find_missing_address')
  AND rf.field_key = 'mukhtar_name';

INSERT INTO public.task_required_fields (
  task_definition_id,
  field_key,
  field_type,
  field_label,
  is_required,
  sort_order
)
SELECT
  d.id,
  'mukhtar_name',
  'text',
  'اسم المختار',
  false,
  COALESCE((
    SELECT MAX(rf.sort_order) + 1
    FROM public.task_required_fields rf
    WHERE rf.task_definition_id = d.id
  ), 1)
FROM public.task_definitions d
WHERE d.is_active = true
  AND d.task_type::text IN ('find_address', 'find_missing_address')
  AND NOT EXISTS (
    SELECT 1
    FROM public.task_required_fields rf
    WHERE rf.task_definition_id = d.id
      AND rf.field_key = 'mukhtar_name'
  );

-- لا تنشئ نسخة ثانية إن كان فرع بابل موجوداً.
UPDATE public.branches
SET is_active = true
WHERE trim(name) = 'بابل';

INSERT INTO public.branches (name, city, is_active)
SELECT 'بابل', 'بابل', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.branches WHERE trim(name) = 'بابل'
);

-- اجعل الفرع قابلاً لتوزيع المهام فوراً: انسخ كتالوج المهام وحقوله وصرفياته
-- من فرع بغداد الكرخ، من دون إنشاء نوع مكرر داخل بابل.
DO $$
DECLARE
  v_source_branch_id uuid;
  v_target_branch_id uuid;
  v_source_def record;
  v_target_def_id uuid;
BEGIN
  SELECT id INTO v_source_branch_id
  FROM public.branches
  WHERE name = 'بغداد الكرخ'
  LIMIT 1;

  SELECT id INTO v_target_branch_id
  FROM public.branches
  WHERE trim(name) = 'بابل'
  LIMIT 1;

  IF v_source_branch_id IS NULL OR v_target_branch_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_source_def IN
    SELECT task_type, label, fee_amount, sort_order, is_active, case_type
    FROM public.task_definitions
    WHERE branch_id = v_source_branch_id
  LOOP
    SELECT id INTO v_target_def_id
    FROM public.task_definitions
    WHERE branch_id = v_target_branch_id
      AND task_type::text = v_source_def.task_type::text
    LIMIT 1;

    IF v_target_def_id IS NULL THEN
      INSERT INTO public.task_definitions (
        branch_id, task_type, label, fee_amount, sort_order, is_active, case_type
      ) VALUES (
        v_target_branch_id, v_source_def.task_type, v_source_def.label,
        v_source_def.fee_amount, v_source_def.sort_order, v_source_def.is_active,
        v_source_def.case_type
      )
      RETURNING id INTO v_target_def_id;
    END IF;

    INSERT INTO public.task_required_fields (
      task_definition_id, field_key, field_type, field_label, is_required, sort_order
    )
    SELECT
      v_target_def_id, rf.field_key, rf.field_type, rf.field_label, rf.is_required, rf.sort_order
    FROM public.task_required_fields rf
    JOIN public.task_definitions source_definition
      ON source_definition.id = rf.task_definition_id
    WHERE source_definition.branch_id = v_source_branch_id
      AND source_definition.task_type::text = v_source_def.task_type::text
      AND NOT EXISTS (
        SELECT 1 FROM public.task_required_fields existing
        WHERE existing.task_definition_id = v_target_def_id
          AND existing.field_key = rf.field_key
      );

    INSERT INTO public.task_definition_expenses (
      task_definition_id, name, max_amount, sort_order
    )
    SELECT v_target_def_id, expense.name, expense.max_amount, expense.sort_order
    FROM public.task_definition_expenses expense
    JOIN public.task_definitions source_definition
      ON source_definition.id = expense.task_definition_id
    WHERE source_definition.branch_id = v_source_branch_id
      AND source_definition.task_type::text = v_source_def.task_type::text
      AND NOT EXISTS (
        SELECT 1 FROM public.task_definition_expenses existing
        WHERE existing.task_definition_id = v_target_def_id
          AND existing.name = expense.name
      );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
