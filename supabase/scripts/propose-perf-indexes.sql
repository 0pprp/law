-- Suggested performance indexes — apply manually in Supabase SQL Editor.
-- Do NOT use CONCURRENTLY here: SQL Editor runs inside a transaction (ERROR 25001).
-- For zero-downtime on a large live DB, run each CREATE INDEX CONCURRENTLY
-- as a separate statement outside a transaction (psql with autocommit).

-- tasks list / overdue / review
CREATE INDEX IF NOT EXISTS idx_tasks_branch_status_due
  ON public.tasks (branch_id, task_status, due_date);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_status
  ON public.tasks (assigned_to, task_status);

CREATE INDEX IF NOT EXISTS idx_tasks_debtor_status
  ON public.tasks (debtor_id, task_status);

-- debtors filters
CREATE INDEX IF NOT EXISTS idx_debtors_branch_list
  ON public.debtors (branch_id, branch_list_id);

-- activity
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_branch
  ON public.activity_logs (created_at DESC, branch_id);

-- lawyer wallet
CREATE INDEX IF NOT EXISTS idx_lawyer_wallet_tx_lawyer_created
  ON public.lawyer_wallet_transactions (lawyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lawyer_wallet_tx_ref_type
  ON public.lawyer_wallet_transactions (reference_id, type)
  WHERE reference_id IS NOT NULL;

-- delegate wallet
CREATE INDEX IF NOT EXISTS idx_delegate_wallet_tx_delegate_created
  ON public.delegate_wallet_transactions (delegate_id, created_at DESC);
