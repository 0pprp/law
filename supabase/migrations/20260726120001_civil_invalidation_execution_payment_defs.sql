-- Seed civil task definitions: الابطال + تسديد بالتنفيذ
-- Uses existing unused enum values (file_closure, first_registration).
-- Fee 0, no required fields, no expense lines.

INSERT INTO task_definitions (
  branch_id, task_type, label, fee_amount, sort_order, is_active, case_type
)
SELECT b.id, v.task_type::task_type, v.label, v.fee_amount, v.sort_order, true, 'civil'
FROM branches b
CROSS JOIN (VALUES
  ('file_closure', 'ابطال', 0::numeric, 118),
  ('first_registration', 'تسديد بالتنفيذ', 0::numeric, 119)
) AS v(task_type, label, fee_amount, sort_order)
WHERE b.is_active = true
  AND EXISTS (
    SELECT 1 FROM task_definitions td0
    WHERE td0.branch_id = b.id AND td0.case_type = 'civil'
  )
  AND NOT EXISTS (
    SELECT 1 FROM task_definitions td
    WHERE td.branch_id = b.id AND td.task_type::text = v.task_type
  );
