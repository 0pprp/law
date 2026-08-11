-- انسخ والصق في Supabase SQL Editor
-- السبب: القيد الفريد على (task_type, branch_id) يمنع أكثر من مهمة custom لكل فرع
-- ملاحظة: الاسم قد لا يكون task_def_type_branch_uniq — لذلك نسقط أي قيد/فهرس مطابق

-- 1) إسقاط قيود UNIQUE على task_type + branch_id (أي اسم)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'task_definitions'
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) ILIKE '%task_type%'
      AND pg_get_constraintdef(c.oid) ILIKE '%branch_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.task_definitions DROP CONSTRAINT IF EXISTS %I', r.conname);
    RAISE NOTICE 'Dropped constraint: %', r.conname;
  END LOOP;
END $$;

-- 2) إسقاط فهارس UNIQUE على task_type + branch_id (إن وُجدت كـ index وليس constraint)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT i.relname AS index_name
    FROM pg_index x
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'task_definitions'
      AND x.indisunique
      AND NOT x.indisprimary
      AND pg_get_indexdef(x.indexrelid) ILIKE '%task_type%'
      AND pg_get_indexdef(x.indexrelid) ILIKE '%branch_id%'
      AND i.relname <> 'task_def_branch_case_label_uniq'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.index_name);
    RAISE NOTICE 'Dropped index: %', r.index_name;
  END LOOP;
END $$;

-- 3) فريد منطقي: نفس التسمية داخل الفرع + نوع الدعوى فقط
CREATE UNIQUE INDEX IF NOT EXISTS task_def_branch_case_label_uniq
  ON public.task_definitions (branch_id, coalesce(case_type, 'civil'), lower(trim(label)));

-- 4) تحقق: يفترض ألا يبقى فهرس فريد على task_type+branch_id
SELECT c.conname AS name, 'constraint' AS kind, pg_get_constraintdef(c.oid) AS def
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND t.relname = 'task_definitions' AND c.contype = 'u'
UNION ALL
SELECT i.relname, 'index', pg_get_indexdef(x.indexrelid)
FROM pg_index x
JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND t.relname = 'task_definitions' AND x.indisunique AND NOT x.indisprimary
ORDER BY 1;
