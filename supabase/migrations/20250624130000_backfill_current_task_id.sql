-- Backfill and normalize debtor.current_task_id (single source of truth for case stage)
-- Idempotent — safe to re-run.

-- Closed debtors must not point at a current task
UPDATE debtors
SET current_task_id = NULL
WHERE case_status = 'closed'
  AND current_task_id IS NOT NULL;

-- Active debtors: set current_task_id to latest non-terminal task
UPDATE debtors d
SET current_task_id = sub.task_id
FROM (
  SELECT DISTINCT ON (t.debtor_id)
    t.debtor_id,
    t.id AS task_id
  FROM tasks t
  INNER JOIN debtors d2 ON d2.id = t.debtor_id
  WHERE t.task_status NOT IN ('approved', 'completed', 'closed')
    AND (d2.case_status IS NULL OR d2.case_status <> 'closed')
  ORDER BY t.debtor_id, t.created_at DESC
) sub
WHERE d.id = sub.debtor_id
  AND (d.case_status IS NULL OR d.case_status <> 'closed')
  AND (
    d.current_task_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM tasks ct
      WHERE ct.id = d.current_task_id
        AND ct.task_status NOT IN ('approved', 'completed', 'closed')
    )
  );
