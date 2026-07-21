-- Verify: criminal security hardening (READ-ONLY)
-- Alias: verify-criminal-rls.sql expectations

\echo '=== VERIFY: RLS enabled on sensitive tables ==='
SELECT c.relname AS table_name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'debtors', 'tasks', 'debtor_payments', 'profiles',
    'criminal_debtor_details', 'criminal_import_runs', 'activity_logs'
  )
ORDER BY 1;

\echo '=== VERIFY: helper functions exist with search_path ==='
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer,
       p.proconfig AS config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'current_app_user_id',
    'current_app_role',
    'current_profile_case_type',
    'current_user_can_access_case_type',
    'current_user_can_access_branch',
    'current_user_can_access_debtor',
    'current_user_can_access_task',
    'current_user_can_access_lawyer',
    'storage_debtor_id_from_path',
    'current_user_can_access_storage_object',
    'enforce_debtor_case_type_immutable',
    'enforce_lawyer_case_type_immutable',
    'enforce_criminal_task_reward_zero'
  )
ORDER BY 1;

\echo '=== VERIFY: section policies present ==='
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    policyname LIKE 'section_%'
    OR policyname LIKE 'criminal_%'
  )
ORDER BY tablename, policyname;

\echo '=== VERIFY: storage policies for debtor-files ==='
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname LIKE 'section_debtor_files%'
ORDER BY 1;

\echo '=== VERIFY: triggers ==='
SELECT tgname, relname
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND tgname IN (
    'trg_enforce_debtor_case_type_immutable',
    'trg_enforce_lawyer_case_type_immutable',
    'trg_enforce_criminal_task_reward_zero',
    'trg_enforce_criminal_details_debtor_immutable',
    'trg_enforce_criminal_debtor_details'
  )
ORDER BY 1;

\echo '=== VERIFY: payment client_request_id column + index ==='
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'debtor_payments'
  AND column_name = 'client_request_id';

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'debtor_payments'
  AND indexname LIKE '%client_request%';

\echo '=== VERIFY: criminal branch_list check constraint ==='
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.debtors'::regclass
  AND conname = 'debtors_criminal_branch_list_null_check';

\echo '=== VERIFY: no NULL case_type after cleanup ==='
SELECT
  (SELECT COUNT(*) FROM public.debtors WHERE case_type IS NULL) AS null_debtors,
  (SELECT COUNT(*) FROM public.profiles WHERE role = 'lawyer' AND case_type IS NULL) AS null_lawyers;

\echo '=== VERIFY DONE ==='
