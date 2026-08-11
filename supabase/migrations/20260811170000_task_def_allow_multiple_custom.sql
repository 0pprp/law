-- السماح بعدة مهام custom في نفس الفرع (المهام الجزائية)
-- يسقط أي قيد/فهرس فريد على (task_type, branch_id) مهما كان اسمه

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
  END LOOP;
END $$;

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
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS task_def_branch_case_label_uniq
  ON public.task_definitions (branch_id, coalesce(case_type, 'civil'), lower(trim(label)));
