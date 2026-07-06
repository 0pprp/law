-- RLS لمستمسكات المحامين + bucket lawyer-files

CREATE OR REPLACE FUNCTION public.is_staff_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.auth_profile_role(), '') IN ('admin', 'employee', 'accountant', 'viewer')
$$;

ALTER TABLE public.lawyer_attachments
  ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES public.profiles(id);

ALTER TABLE public.lawyer_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lawyer_attachments_insert_staff ON public.lawyer_attachments;
CREATE POLICY lawyer_attachments_insert_staff ON public.lawyer_attachments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff_role());

DROP POLICY IF EXISTS lawyer_attachments_select_staff ON public.lawyer_attachments;
CREATE POLICY lawyer_attachments_select_staff ON public.lawyer_attachments
  FOR SELECT TO authenticated
  USING (
    public.is_staff_role()
    OR lawyer_id = auth.uid()
  );

DROP POLICY IF EXISTS lawyer_attachments_delete_admin ON public.lawyer_attachments;
CREATE POLICY lawyer_attachments_delete_admin ON public.lawyer_attachments
  FOR DELETE TO authenticated
  USING (public.auth_profile_role() IN ('admin', 'employee'));

-- Storage: lawyer-files
DROP POLICY IF EXISTS lawyer_files_insert_staff ON storage.objects;
CREATE POLICY lawyer_files_insert_staff ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lawyer-files'
    AND public.is_staff_role()
  );

DROP POLICY IF EXISTS lawyer_files_select_staff ON storage.objects;
CREATE POLICY lawyer_files_select_staff ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'lawyer-files'
    AND (
      public.is_staff_role()
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS lawyer_files_delete_admin ON storage.objects;
CREATE POLICY lawyer_files_delete_admin ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'lawyer-files'
    AND public.auth_profile_role() IN ('admin', 'employee')
  );

NOTIFY pgrst, 'reload schema';
