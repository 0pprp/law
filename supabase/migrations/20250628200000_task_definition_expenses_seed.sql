-- Complete task expense definitions per task_type (all branches). Idempotent by name.

INSERT INTO task_definition_expenses (task_definition_id, name, max_amount, sort_order)
SELECT td.id, v.name, v.max_amount, v.sort_order
FROM task_definitions td
JOIN (VALUES
  ('file_lawsuit', 'رسم دعوى', 51000::numeric, 0),
  ('file_lawsuit', 'صرفيات تبليغ', 10000::numeric, 1),
  ('decision_ratification', 'صرفيات تصديق قرار', 8000::numeric, 0),
  ('open_file', 'صرفيات فتح اضبارة', 10000::numeric, 0),
  ('summons', 'صرفيات تكليف بالحضور', 10000::numeric, 0),
  ('forced_appearance', 'صرفيات احضار جبري', 25000::numeric, 0),
  ('arrest_warrant', 'صرفيات أمر قبض', 25000::numeric, 0),
  ('imprisonment_in_absentia', 'صرفيات حبس غيابي', 10000::numeric, 0),
  ('department_correspondence', 'صرفيات مفاتحة دوائر', 10000::numeric, 0),
  ('newspaper_publication', 'صرفيات نشر جريدة', 30000::numeric, 0),
  ('salary_seizure', 'صرفيات حجز راتب', 25000::numeric, 0)
) AS v(task_type, name, max_amount, sort_order) ON td.task_type::text = v.task_type
WHERE NOT EXISTS (
  SELECT 1 FROM task_definition_expenses tde
  WHERE tde.task_definition_id = td.id AND tde.name = v.name
);

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS lawyer_id uuid REFERENCES profiles(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
