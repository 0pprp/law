-- =============================================================================
-- تصفير بيانات التشغيل — تجهيز Production
-- =============================================================================
-- ⚠️  خذ نسخة احتياطية قبل التشغيل (Database + Storage).
--
-- يُحذف:
--   • المدينون + المهام + المرفقات + التسديدات + الصرفيات
--   • المحافظ وحركاتها + طلبات السحب + إيصالات الدفع
--   • سجل النشاط + القضايا المحسومة (كل المدينين)
--   • المحامون / المحاسبون / مستخدمي الاختبار
--   • مرفقات المحامين المحذوفين
--
-- يُبقى:
--   • المدير:           username = haider  (role = admin)
--   • مسؤول القانونية:  username = admin12 (role = viewer)
--   • الفروع branches
--   • قوائم الفروع branch_lists
--   • تعريفات المهام task_definitions + task_required_fields
--   • أسعار/صرفيات التعريف task_definition_expenses + expense_types
--   • المحاكم courts + دوائر التنفيذ execution_departments
--   • الأدوار والصلاحيات (schema + RLS — لا يُمس)
--
-- بعد SQL:
--   1) افرغ Storage: debtor-files, task-files, lawyer-files
--      node --env-file=.env.local scripts/empty-storage-buckets.mjs
--   2) إن حُذفت قوائم الفروع بالخطأ:
--      supabase/scripts/restore_branch_lists_seed.sql
-- =============================================================================


-- =============================================================================
-- القسم أ — فحص قبل الحذف
-- =============================================================================

SELECT 'debtors' AS metric, COUNT(*)::bigint AS value FROM public.debtors
UNION ALL SELECT 'tasks', COUNT(*)::bigint FROM public.tasks
UNION ALL SELECT 'expenses', COUNT(*)::bigint FROM public.expenses
UNION ALL SELECT 'activity_logs', COUNT(*)::bigint FROM public.activity_logs
UNION ALL SELECT 'lawyer_wallet_tx', COUNT(*)::bigint FROM public.lawyer_wallet_transactions
UNION ALL SELECT 'branch_lists', COUNT(*)::bigint FROM public.branch_lists
UNION ALL SELECT 'task_definitions', COUNT(*)::bigint FROM public.task_definitions
UNION ALL SELECT 'profiles', COUNT(*)::bigint FROM public.profiles
ORDER BY metric;

-- المستخدمون الذين سيبقون
SELECT p.username, p.full_name, p.role, p.id
FROM public.profiles p
WHERE (p.username = 'haider' AND p.role = 'admin')
   OR (p.username = 'admin12' AND p.role = 'viewer')
ORDER BY p.role;

-- المستخدمون الذين سيُحذفون
WITH keep_ids AS (
  SELECT id FROM public.profiles WHERE username = 'haider' AND role = 'admin'
  UNION
  SELECT id FROM public.profiles WHERE username = 'admin12' AND role = 'viewer'
)
SELECT p.username, p.full_name, p.role
FROM public.profiles p
WHERE p.id NOT IN (SELECT id FROM keep_ids)
ORDER BY p.role, p.username;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE username = 'haider' AND role = 'admin') THEN
    RAISE EXCEPTION 'توقف: حساب المدير haider غير موجود.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE username = 'admin12' AND role = 'viewer') THEN
    RAISE EXCEPTION 'توقف: حساب مسؤول القانونية admin12 غير موجود.';
  END IF;
END $$;


-- =============================================================================
-- القسم ب — التصفير (شغّل من BEGIN إلى COMMIT دفعة واحدة)
-- =============================================================================

BEGIN;

-- ب.1 فك ارتباط المدينين بالمهام
UPDATE public.debtors
SET current_task_id = NULL,
    last_task_id    = NULL,
    legal_manager_fees = 0,
    total_expenses = 0,
    total_payments = 0
WHERE id IS NOT NULL;

-- ب.2 محافظ + طلبات سحب + إيصالات
DELETE FROM public.lawyer_wallet_transactions;
DELETE FROM public.lawyer_payout_requests;
DELETE FROM public.task_payment_receipts;

-- ب.3 مرفقات وملاحظات
DELETE FROM public.task_attachments;
DELETE FROM public.debtor_attachments;
DELETE FROM public.debtor_notes;

-- ب.4 تسديدات + صرفيات + سجل النشاط
DELETE FROM public.debtor_payments;
DELETE FROM public.expenses;
DELETE FROM public.activity_logs;

-- ب.5 جداول اختيارية إن وُجدت
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'legal_cases') THEN
    EXECUTE 'DELETE FROM public.legal_cases';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'task_completion_values') THEN
    EXECUTE 'DELETE FROM public.task_completion_values';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    EXECUTE 'DELETE FROM public.notifications';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'debtor_import_batches') THEN
    EXECUTE 'DELETE FROM public.debtor_import_batches';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'debtor_import_rows') THEN
    EXECUTE 'DELETE FROM public.debtor_import_rows';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'import_logs') THEN
    EXECUTE 'DELETE FROM public.import_logs';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'excel_import_logs') THEN
    EXECUTE 'DELETE FROM public.excel_import_logs';
  END IF;
END $$;

-- ب.6 المهام ثم المدينون (يشمل القضايا المحسومة — كل السجلات)
DELETE FROM public.tasks;
DELETE FROM public.debtors;

-- ب.7 مرفقات المحامين غير المحفوظين (قبل حذف profiles)
DELETE FROM public.lawyer_attachments
WHERE lawyer_id NOT IN (
  SELECT id FROM public.profiles WHERE username = 'haider' AND role = 'admin'
  UNION
  SELECT id FROM public.profiles WHERE username = 'admin12' AND role = 'viewer'
);

-- ب.8 حذف كل المستخدمين ما عدا المدير ومسؤول القانونية
DELETE FROM public.profiles
WHERE id NOT IN (
  SELECT id FROM public.profiles WHERE username = 'haider' AND role = 'admin'
  UNION
  SELECT id FROM public.profiles WHERE username = 'admin12' AND role = 'viewer'
);

-- ب.9 حذف auth.users للمحذوفين
DELETE FROM auth.users
WHERE id NOT IN (
  SELECT id FROM public.profiles
);

COMMIT;


-- =============================================================================
-- القسم ج — التحقق بعد التصفير
-- =============================================================================

SELECT 'debtors' AS metric, COUNT(*)::bigint AS value, '0' AS expected FROM public.debtors
UNION ALL SELECT 'tasks', COUNT(*)::bigint, '0' FROM public.tasks
UNION ALL SELECT 'expenses', COUNT(*)::bigint, '0' FROM public.expenses
UNION ALL SELECT 'activity_logs', COUNT(*)::bigint, '0' FROM public.activity_logs
UNION ALL SELECT 'lawyer_wallet_tx', COUNT(*)::bigint, '0' FROM public.lawyer_wallet_transactions
UNION ALL SELECT 'branch_lists', COUNT(*)::bigint, '>0' FROM public.branch_lists
UNION ALL SELECT 'task_definitions', COUNT(*)::bigint, '>0' FROM public.task_definitions
UNION ALL SELECT 'courts', COUNT(*)::bigint, '>=0' FROM public.courts
UNION ALL SELECT 'execution_departments', COUNT(*)::bigint, '>=0' FROM public.execution_departments
ORDER BY metric;

SELECT p.username, p.full_name, p.role
FROM public.profiles p
ORDER BY p.role;

SELECT COUNT(*)::bigint AS profiles_remaining FROM public.profiles;
-- المتوقع: 2 (haider + admin12)
