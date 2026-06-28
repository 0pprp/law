-- مراقب عام (viewer): SELECT على كل بيانات الفروع — بدون INSERT/UPDATE/DELETE
-- سياسات إضافية (OR) لا تغيّر صلاحيات المدير/المحاسب/المحامي.

CREATE OR REPLACE FUNCTION public.auth_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text FROM profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_viewer_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth_profile_role() = 'viewer'
$$;

-- جداول العمليات — المراقب يرى كل الصفوف مثل المدير
DO $policies$
DECLARE
  t text;
  tables text[] := ARRAY[
    'branches',
    'profiles',
    'debtors',
    'tasks',
    'task_definitions',
    'task_required_fields',
    'task_definition_expenses',
    'expenses',
    'expense_types',
    'debtor_payments',
    'debtor_attachments',
    'debtor_notes',
    'task_attachments',
    'lawyer_attachments',
    'activity_logs',
    'courts',
    'execution_departments',
    'task_payment_receipts'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS viewer_select_all ON %I', t);
      EXECUTE format(
        'CREATE POLICY viewer_select_all ON %I FOR SELECT TO authenticated USING (public.is_viewer_role())',
        t
      );
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END
$policies$;

-- lawyer_payout_requests / lawyer_wallet_transactions (تحديث السياسات الموجودة)
DROP POLICY IF EXISTS lawyer_payout_requests_select_staff ON lawyer_payout_requests;
CREATE POLICY lawyer_payout_requests_select_staff ON lawyer_payout_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'employee', 'accountant', 'viewer')
        AND (
          p.role IN ('admin', 'viewer')
          OR lawyer_payout_requests.branch_id = p.branch_id
        )
    )
  );

DROP POLICY IF EXISTS lawyer_wallet_tx_select_staff ON lawyer_wallet_transactions;
CREATE POLICY lawyer_wallet_tx_select_staff ON lawyer_wallet_transactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'accountant', 'employee', 'viewer')
    )
  );

-- Storage: قراءة المرفقات للمراقب
DO $storage$
DECLARE
  b text;
  buckets text[] := ARRAY['debtor-files', 'task-files', 'lawyer-files'];
BEGIN
  FOREACH b IN ARRAY buckets
  LOOP
    IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = b) THEN
      EXECUTE format('DROP POLICY IF EXISTS viewer_read_%I ON storage.objects', replace(b, '-', '_'));
      EXECUTE format(
        $fmt$
        CREATE POLICY viewer_read_%s ON storage.objects
          FOR SELECT TO authenticated
          USING (
            bucket_id = %L
            AND public.is_viewer_role()
          )
        $fmt$,
        replace(b, '-', '_'),
        b
      );
    END IF;
  END LOOP;
END
$storage$;

NOTIFY pgrst, 'reload schema';
