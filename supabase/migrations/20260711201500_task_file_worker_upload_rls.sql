-- Field workers may upload files only beneath a task assigned to them.
-- Paths: {taskId}/... or expenses/{taskId}/... (matches TaskUpdateForm + expense receipts).

CREATE OR REPLACE FUNCTION public.can_upload_assigned_task_file(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE (
        t.id::text = split_part(object_name, '/', 1)
        OR (
          split_part(object_name, '/', 1) = 'expenses'
          AND t.id::text = split_part(object_name, '/', 2)
        )
      )
      AND t.assigned_to = auth.uid()
      AND p.role IN ('lawyer', 'delegate')
  )
$$;

DROP POLICY IF EXISTS task_files_insert_assigned_worker ON storage.objects;
CREATE POLICY task_files_insert_assigned_worker ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'task-files'
    AND public.can_upload_assigned_task_file(name)
  );

DROP POLICY IF EXISTS task_attachments_insert_assigned_worker ON public.task_attachments;
CREATE POLICY task_attachments_insert_assigned_worker ON public.task_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.can_upload_assigned_task_file(task_id::text || '/attachment')
  );

NOTIFY pgrst, 'reload schema';