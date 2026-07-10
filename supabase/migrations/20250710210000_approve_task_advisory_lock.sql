-- Proposed atomic task approval (status + expense deduction + fee credit + LM bonus).
-- Apply manually after review — do NOT auto-run on production.
-- This function coordinates locks; wallet math stays identical to app logic.
-- Until applied, app uses reverseTaskExpenseDeductionOnFailure compensation.

-- NOTE: Full wallet credit/deduction logic remains in application code for now
-- because type checks and idempotency helpers are TypeScript-side.
-- This migration provides an advisory-lock wrapper the app can call later.

CREATE OR REPLACE FUNCTION public.begin_approve_task_lock(p_task_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Session-level advisory lock keyed by task id hash
  PERFORM pg_advisory_xact_lock(hashtextextended(p_task_id::text, 0));
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_approve_task_lock(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_approve_task_lock(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.begin_approve_task_lock(uuid) TO service_role;

COMMENT ON FUNCTION public.begin_approve_task_lock(uuid) IS
  'Transaction advisory lock for approve-task to prevent concurrent partial wallet updates';
