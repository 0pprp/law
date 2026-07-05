-- المحامي والموظفون: قراءة تعريفات المهام وبنود الصرفيات (لتدفق «تم الإنجاز»)
DROP POLICY IF EXISTS authenticated_select_task_definition_expenses ON task_definition_expenses;
CREATE POLICY authenticated_select_task_definition_expenses ON task_definition_expenses
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS authenticated_select_task_definitions_read ON task_definitions;
CREATE POLICY authenticated_select_task_definitions_read ON task_definitions
  FOR SELECT TO authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';
