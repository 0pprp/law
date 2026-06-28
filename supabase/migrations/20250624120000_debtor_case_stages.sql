-- Safe migration: case stage tracking for debtors
-- Run once in Supabase SQL Editor. Idempotent — safe to re-run.

-- 1. Add columns if missing
ALTER TABLE debtors ADD COLUMN IF NOT EXISTS current_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE debtors ADD COLUMN IF NOT EXISTS case_status text DEFAULT 'active';
ALTER TABLE debtors ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- 2. Index for dashboard queries
CREATE INDEX IF NOT EXISTS idx_debtors_current_task_id ON debtors(current_task_id);
CREATE INDEX IF NOT EXISTS idx_debtors_case_status ON debtors(case_status);

-- 3. Backfill current_task_id for active debtors without one
--    Links each debtor to their latest non-terminal task
UPDATE debtors d
SET current_task_id = sub.task_id
FROM (
  SELECT DISTINCT ON (t.debtor_id)
    t.debtor_id,
    t.id AS task_id
  FROM tasks t
  WHERE t.task_status NOT IN ('approved', 'completed', 'closed')
  ORDER BY t.debtor_id, t.created_at DESC
) sub
WHERE d.id = sub.debtor_id
  AND (d.case_status IS NULL OR d.case_status <> 'closed')
  AND d.current_task_id IS NULL;

-- 4. Mark debtors with no active task but only approved tasks as needing review (optional)
--    Does NOT delete or modify historical task data.
