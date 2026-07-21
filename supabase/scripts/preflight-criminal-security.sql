-- Preflight: criminal security hardening (READ-ONLY)
-- Run before applying 20260721160000_criminal_rls_security_hardening.sql
-- Does not modify data.

\echo '=== PREFLIGHT: NULL case_type on debtors ==='
SELECT COUNT(*) AS null_debtor_case_type
FROM public.debtors
WHERE case_type IS NULL;

\echo '=== PREFLIGHT: NULL case_type on lawyer profiles ==='
SELECT COUNT(*) AS null_lawyer_case_type
FROM public.profiles
WHERE role = 'lawyer' AND case_type IS NULL;

\echo '=== PREFLIGHT: criminal debtors with branch_list_id ==='
SELECT COUNT(*) AS criminal_with_branch_list
FROM public.debtors
WHERE case_type = 'criminal' AND branch_list_id IS NOT NULL;

\echo '=== PREFLIGHT: criminal tasks with reward_amount <> 0 ==='
SELECT COUNT(*) AS criminal_nonzero_reward
FROM public.tasks t
JOIN public.debtors d ON d.id = t.debtor_id
WHERE d.case_type = 'criminal'
  AND COALESCE(t.reward_amount, 0) <> 0;

\echo '=== PREFLIGHT: lawyer/task section mismatches ==='
SELECT COUNT(*) AS mismatched_lawyer_tasks
FROM public.tasks t
JOIN public.debtors d ON d.id = t.debtor_id
JOIN public.profiles p ON p.id = t.assigned_to
WHERE p.role = 'lawyer'
  AND COALESCE(p.case_type, 'civil') IS DISTINCT FROM COALESCE(d.case_type, 'civil');

\echo '=== PREFLIGHT: criminal_debtor_details on civil debtors ==='
SELECT COUNT(*) AS details_on_civil
FROM public.criminal_debtor_details c
JOIN public.debtors d ON d.id = c.debtor_id
WHERE d.case_type IS DISTINCT FROM 'criminal';

\echo '=== PREFLIGHT: orphan criminal_debtor_details ==='
SELECT COUNT(*) AS orphan_details
FROM public.criminal_debtor_details c
WHERE NOT EXISTS (SELECT 1 FROM public.debtors d WHERE d.id = c.debtor_id);

\echo '=== PREFLIGHT: duplicate import run ids (PK should already prevent) ==='
SELECT id, COUNT(*) AS cnt
FROM public.criminal_import_runs
GROUP BY id
HAVING COUNT(*) > 1;

\echo '=== PREFLIGHT: duplicate payment client_request_id per creator (if column exists) ==='
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'debtor_payments'
      AND column_name = 'client_request_id'
  ) THEN
    RAISE NOTICE 'client_request_id column present — check duplicates via SELECT below';
  ELSE
    RAISE NOTICE 'client_request_id column missing (expected before payment migration)';
  END IF;
END $$;

SELECT created_by, client_request_id, COUNT(*) AS cnt
FROM public.debtor_payments
WHERE client_request_id IS NOT NULL
GROUP BY created_by, client_request_id
HAVING COUNT(*) > 1;

\echo '=== PREFLIGHT DONE — investigate non-zero counts before migrating ==='
