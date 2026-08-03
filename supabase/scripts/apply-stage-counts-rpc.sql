-- Performance: stage counts RPC + supporting indexes
-- Apply in Supabase SQL Editor or via scripts/apply-stage-counts-rpc.mjs

CREATE INDEX IF NOT EXISTS idx_debtors_branch_current_task
  ON debtors (branch_id, current_task_id)
  WHERE current_task_id IS NOT NULL AND case_status != 'closed';

CREATE INDEX IF NOT EXISTS idx_tasks_def_status_assigned
  ON tasks (task_definition_id, task_status, assigned_to)
  WHERE task_definition_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_debtors_case_type_branch
  ON debtors (case_type, branch_id)
  WHERE case_status != 'closed';

CREATE INDEX IF NOT EXISTS idx_debtors_special_status_null_current
  ON debtors (branch_id, case_type, branch_list_id)
  WHERE current_task_id IS NOT NULL
    AND special_status_id IS NULL
    AND case_status IS DISTINCT FROM 'closed';

CREATE OR REPLACE FUNCTION get_stage_counts(
  p_branch_id uuid DEFAULT NULL,
  p_case_type text DEFAULT NULL,
  p_branch_list_id uuid DEFAULT NULL,
  p_today date DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  task_definition_id uuid,
  unassigned_count bigint,
  assigned_count bigint,
  overdue_count bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    t.task_definition_id,
    COUNT(*) FILTER (WHERE t.assigned_to IS NULL)::bigint AS unassigned_count,
    COUNT(*) FILTER (WHERE t.assigned_to IS NOT NULL)::bigint AS assigned_count,
    COUNT(*) FILTER (
      WHERE t.assigned_to IS NOT NULL
        AND t.due_date IS NOT NULL
        AND t.due_date < p_today
    )::bigint AS overdue_count
  FROM debtors d
  INNER JOIN tasks t ON t.id = d.current_task_id
  WHERE d.case_status IS DISTINCT FROM 'closed'
    AND d.current_task_id IS NOT NULL
    AND d.special_status_id IS NULL
    AND (p_branch_id IS NULL OR d.branch_id = p_branch_id)
    AND (p_case_type IS NULL OR d.case_type = p_case_type)
    AND (p_branch_list_id IS NULL OR d.branch_list_id = p_branch_list_id)
    AND t.task_definition_id IS NOT NULL
    AND t.task_status NOT IN ('completed', 'closed', 'failed', 'approved', 'rejected')
  GROUP BY t.task_definition_id;
$$;

GRANT EXECUTE ON FUNCTION get_stage_counts(uuid, text, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION get_stage_counts(uuid, text, uuid, date) TO service_role;
