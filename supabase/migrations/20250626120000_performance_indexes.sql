-- Performance indexes for branch-scoped queries at scale (10k+ debtors).
-- Safe to re-run (IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- debtors
CREATE INDEX IF NOT EXISTS idx_debtors_branch_id ON debtors(branch_id);
CREATE INDEX IF NOT EXISTS idx_debtors_branch_full_name ON debtors(branch_id, full_name);
CREATE INDEX IF NOT EXISTS idx_debtors_branch_phone ON debtors(branch_id, phone);
CREATE INDEX IF NOT EXISTS idx_debtors_branch_receipt ON debtors(branch_id, receipt_number);
CREATE INDEX IF NOT EXISTS idx_debtors_branch_case_status ON debtors(branch_id, case_status);
CREATE INDEX IF NOT EXISTS idx_debtors_branch_current_task
  ON debtors(branch_id, current_task_id)
  WHERE current_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_debtors_full_name_trgm ON debtors USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_debtors_phone_trgm ON debtors USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_debtors_receipt_trgm ON debtors USING gin (receipt_number gin_trgm_ops);

-- tasks (assigned lawyer column is assigned_to, not lawyer_id)
CREATE INDEX IF NOT EXISTS idx_tasks_branch_id ON tasks(branch_id);
CREATE INDEX IF NOT EXISTS idx_tasks_branch_debtor_id ON tasks(branch_id, debtor_id);
CREATE INDEX IF NOT EXISTS idx_tasks_branch_assigned_to ON tasks(branch_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_branch_task_status ON tasks(branch_id, task_status);
CREATE INDEX IF NOT EXISTS idx_tasks_branch_task_definition_id ON tasks(branch_id, task_definition_id);
CREATE INDEX IF NOT EXISTS idx_tasks_branch_review_queue
  ON tasks(branch_id, task_status, completed_at)
  WHERE assigned_to IS NOT NULL AND debtor_id IS NOT NULL;

-- expenses / payments / activity_logs
CREATE INDEX IF NOT EXISTS idx_expenses_branch_id ON expenses(branch_id);
CREATE INDEX IF NOT EXISTS idx_debtor_payments_branch_id ON debtor_payments(branch_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_branch_id ON activity_logs(branch_id);
