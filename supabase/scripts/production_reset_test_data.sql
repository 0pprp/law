-- =============================================================================
-- تصفير بيانات التشغيل فقط — جاهز للمراجعة اليدوية في Supabase SQL Editor
-- =============================================================================
-- ⚠️  تحذير: لا تشغّل إلا بعد أخذ نسخة احتياطية (Database + Storage).
--
-- الهدف: نظام نظيف بدون بيانات اختبار، مع إبقاء إعدادات النظام كاملة.
--
-- يُحفظ:
--   • حساب المدير:     username = haider  (role = admin)
--   • حساب المراقب:    username = admin12 (role = viewer) — أو أول viewer
--   • الفروع branches
--   • task_definitions + task_required_fields + task_definition_expenses (حدود الصرف)
--   • expense_types (= expense_definitions في الواجهة)
--   • courts + execution_departments
--
-- يُحذف (DELETE فقط — بدون DROP TABLE / schema):
--   • المدينون + مرفقاتهم + ملاحظاتهم + تسديداتهم
--   • المهام + مرفقاتها + قيم الإنجاز (completion_data داخل tasks)
--   • القضايا المحسومة (كل المدينين case_status = closed تُحذف مع الجدول)
--   • الصرفيات التشغيلية expenses
--   • حركات محفظة الأتعاب والصرفيات lawyer_wallet_transactions (عمود wallet)
--   • طلبات الصرف lawyer_payout_requests + إيصالات task_payment_receipts
--   • سجل النشاط activity_logs
--   • المحامون / المحاسبون / كل profile ليس المدير ولا المراقب
--   • auth.users للمحذوفين فقط
--
-- تعيين أسماء في هذا المشروع:
--   payments              → debtor_payments
--   debtor_files          → debtor_attachments
--   task_files            → task_attachments
--   expense_definitions   → expense_types + task_definition_expenses
--   task_completion_values→ غير موجود؛ البيانات في tasks.completion_data
--   notifications         → غير موجود كجدول (تُحسب وقت التشغيل)
--
-- طريقة التشغيل:
--   1) شغّل «القسم أ» فقط وراجع النتائج
--   2) شغّل «القسم ب» (BEGIN…COMMIT) بعد الموافقة
--   3) شغّل «القسم ج» للتحقق
--   4) افرغ Storage يدوياً: debtor-files / task-files / lawyer-files
-- =============================================================================


-- =============================================================================
-- القسم أ — فحص قبل الحذف (لا يغيّر بيانات)
-- =============================================================================

-- أ.1 أعداد رئيسية
SELECT 'debtors'  AS metric, COUNT(*)::bigint AS value FROM public.debtors
UNION ALL SELECT 'tasks',              COUNT(*)::bigint FROM public.tasks
UNION ALL SELECT 'profiles',           COUNT(*)::bigint FROM public.profiles
UNION ALL SELECT 'auth.users',         COUNT(*)::bigint FROM auth.users
UNION ALL SELECT 'debtor_payments',    COUNT(*)::bigint FROM public.debtor_payments
UNION ALL SELECT 'expenses',           COUNT(*)::bigint FROM public.expenses
UNION ALL SELECT 'activity_logs',      COUNT(*)::bigint FROM public.activity_logs
UNION ALL SELECT 'lawyer_wallet_tx',   COUNT(*)::bigint FROM public.lawyer_wallet_transactions
UNION ALL SELECT 'debtors_closed',     COUNT(*)::bigint FROM public.debtors WHERE case_status = 'closed'
ORDER BY metric;

-- أ.2 المستخدمون الذين سيبقون (يجب أن يظهر haider + المراقب)
WITH keep_users AS (
  SELECT p.id, p.username, p.full_name, p.role
  FROM public.profiles p
  WHERE p.username = 'haider' AND p.role = 'admin'

  UNION ALL

  SELECT p.id, p.username, p.full_name, p.role
  FROM public.profiles p
  WHERE p.username = 'admin12' AND p.role = 'viewer'

  UNION ALL

  SELECT p.id, p.username, p.full_name, p.role
  FROM public.profiles p
  WHERE p.id = (
    SELECT x.id
    FROM public.profiles x
    WHERE x.role = 'viewer'
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE username = 'admin12' AND role = 'viewer'
      )
    ORDER BY x.created_at
    LIMIT 1
  )
)
SELECT
  'يبقى' AS action,
  k.username,
  k.full_name,
  k.role,
  k.id,
  u.email AS auth_email
FROM keep_users k
JOIN auth.users u ON u.id = k.id
ORDER BY k.role, k.username;

-- أ.3 المستخدمون الذين سيُحذفون
WITH keep_users AS (
  SELECT p.id
  FROM public.profiles p
  WHERE p.username = 'haider' AND p.role = 'admin'
  UNION
  SELECT p.id FROM public.profiles p
  WHERE p.username = 'admin12' AND p.role = 'viewer'
  UNION
  SELECT p.id
  FROM public.profiles p
  WHERE p.id = (
    SELECT x.id FROM public.profiles x
    WHERE x.role = 'viewer'
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE username = 'admin12' AND role = 'viewer'
      )
    ORDER BY x.created_at LIMIT 1
  )
)
SELECT
  'يُحذف' AS action,
  p.username,
  p.full_name,
  p.role,
  p.id,
  u.email AS auth_email
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE p.id NOT IN (SELECT id FROM keep_users)
ORDER BY p.role, p.username;

-- أ.4 إعدادات النظام (للتأكد أنها لن تُمس)
SELECT 'branches'                 AS table_name, COUNT(*)::bigint AS rows FROM public.branches
UNION ALL SELECT 'task_definitions',          COUNT(*)::bigint FROM public.task_definitions
UNION ALL SELECT 'task_required_fields',      COUNT(*)::bigint FROM public.task_required_fields
UNION ALL SELECT 'task_definition_expenses',  COUNT(*)::bigint FROM public.task_definition_expenses
UNION ALL SELECT 'expense_types',            COUNT(*)::bigint FROM public.expense_types
UNION ALL SELECT 'courts',                   COUNT(*)::bigint FROM public.courts
UNION ALL SELECT 'execution_departments',    COUNT(*)::bigint FROM public.execution_departments
ORDER BY table_name;

-- أ.5 إيقاف فوري إن لم يوجد المدير haider
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE username = 'haider' AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'توقف: حساب المدير haider غير موجود. لا تُنفَّذ عملية التصفير.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE username = 'admin12' AND role = 'viewer'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE role = 'viewer'
  ) THEN
    RAISE EXCEPTION 'توقف: حساب المراقب العام غير موجود.';
  END IF;
END $$;


-- =============================================================================
-- القسم ب — الحذف داخل معاملة واحدة
-- =============================================================================
-- ⚠️  انسخ والصق القسم ب كاملاً (من BEGIN إلى COMMIT) وشغّله دفعة واحدة.
--     لا تشغّل كل سطر على حدة — محرر Supabase قد يفقد الجداول المؤقتة.
-- =============================================================================
BEGIN;

-- ── ب.1 تحقق: المدير والمراقب موجودان ────────────────────────────────────
DO $$
DECLARE
  v_keep_cnt int;
BEGIN
  SELECT COUNT(*) INTO v_keep_cnt
  FROM (
    SELECT id FROM public.profiles WHERE username = 'haider' AND role = 'admin'
    UNION
    SELECT id FROM public.profiles WHERE username = 'admin12' AND role = 'viewer'
    UNION
    (
      SELECT p.id
      FROM public.profiles p
      WHERE p.role = 'viewer'
        AND NOT EXISTS (
          SELECT 1 FROM public.profiles WHERE username = 'admin12' AND role = 'viewer'
        )
      ORDER BY p.created_at
      LIMIT 1
    )
  ) keep_check;

  IF v_keep_cnt < 2 THEN
    RAISE EXCEPTION 'توقف: يجب الإبقاء على المدير (haider) والمراقب (admin12/viewer).';
  END IF;
END $$;

-- ── ب.2 فك ارتباط المدينين بالمهام (تجنب FK) ─────────────────────────────
UPDATE public.debtors
SET current_task_id = NULL,
    last_task_id    = NULL;

-- ── ب.3 محافظ الأتعاب + الصرفيات + طلبات الصرف ───────────────────────────
-- lawyer_wallet_transactions.wallet = 'fees'    → محفظة الأتعاب
-- lawyer_wallet_transactions.wallet = 'savings' → محفظة الصرفيات
DELETE FROM public.lawyer_wallet_transactions;
DELETE FROM public.lawyer_payout_requests;
DELETE FROM public.task_payment_receipts;

-- ── ب.4 مرفقات المهام والمدينين والمحامين ────────────────────────────────
DELETE FROM public.task_attachments;
DELETE FROM public.debtor_attachments;
DELETE FROM public.lawyer_attachments;

-- ── ب.5 ملاحظات المدينين ──────────────────────────────────────────────────
DELETE FROM public.debtor_notes;

-- ── ب.6 تسديدات + صرفيات تشغيلية + سجل النشاط ───────────────────────────
DELETE FROM public.debtor_payments;
DELETE FROM public.expenses;
DELETE FROM public.activity_logs;

-- ── ب.7 جداول اختيارية (إن وُجدت في قاعدتك) ─────────────────────────────
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

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'lawyer_expense_wallet_transactions') THEN
    EXECUTE 'DELETE FROM public.lawyer_expense_wallet_transactions';
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

-- ── ب.8 المهام (تشمل completion_data = قيم الإنجاز) ثم المدينون ─────────
DELETE FROM public.tasks;
DELETE FROM public.debtors;

-- ── ب.9 حذف المحامين / المحاسبين / المستخدمين التجريبيين ────────────────
--     (بدون جدول مؤقت — متوافق مع Supabase SQL Editor)
DELETE FROM public.profiles
WHERE id NOT IN (
  SELECT id FROM public.profiles WHERE username = 'haider' AND role = 'admin'
  UNION
  SELECT id FROM public.profiles WHERE username = 'admin12' AND role = 'viewer'
  UNION
  (
    SELECT p.id
    FROM public.profiles p
    WHERE p.role = 'viewer'
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE username = 'admin12' AND role = 'viewer'
      )
    ORDER BY p.created_at
    LIMIT 1
  )
);

-- ── ب.10 حذف auth.users للمحذوفين فقط (لا يمس haider ولا المراقب) ─────────
DELETE FROM auth.users
WHERE id NOT IN (
  SELECT id FROM public.profiles WHERE username = 'haider' AND role = 'admin'
  UNION
  SELECT id FROM public.profiles WHERE username = 'admin12' AND role = 'viewer'
  UNION
  (
    SELECT p.id
    FROM public.profiles p
    WHERE p.role = 'viewer'
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE username = 'admin12' AND role = 'viewer'
      )
    ORDER BY p.created_at
    LIMIT 1
  )
);

COMMIT;


-- =============================================================================
-- القسم ج — التحقق بعد الحذف
-- =============================================================================

-- ج.1 أعداد التشغيل (يجب أن تكون صفر)
SELECT 'debtors'          AS metric, COUNT(*)::bigint AS value, 'يجب 0' AS expected FROM public.debtors
UNION ALL SELECT 'tasks',              COUNT(*)::bigint, 'يجب 0' FROM public.tasks
UNION ALL SELECT 'debtor_payments',    COUNT(*)::bigint, 'يجب 0' FROM public.debtor_payments
UNION ALL SELECT 'expenses',           COUNT(*)::bigint, 'يجب 0' FROM public.expenses
UNION ALL SELECT 'activity_logs',      COUNT(*)::bigint, 'يجب 0' FROM public.activity_logs
UNION ALL SELECT 'lawyer_wallet_tx',   COUNT(*)::bigint, 'يجب 0' FROM public.lawyer_wallet_transactions
UNION ALL SELECT 'task_attachments',   COUNT(*)::bigint, 'يجب 0' FROM public.task_attachments
UNION ALL SELECT 'debtor_attachments', COUNT(*)::bigint, 'يجب 0' FROM public.debtor_attachments
ORDER BY metric;

-- ج.2 المستخدمون المتبقون (يجب 2: haider + المراقب)
SELECT
  p.username,
  p.full_name,
  p.role,
  p.is_active,
  u.email AS auth_email
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
ORDER BY p.role, p.username;

SELECT
  'profiles_remaining' AS check_name,
  COUNT(*)::bigint     AS actual,
  2::bigint            AS expected
FROM public.profiles;

SELECT
  'auth_users_remaining' AS check_name,
  COUNT(*)::bigint       AS actual,
  2::bigint              AS expected
FROM auth.users;

-- ج.3 إعدادات النظام (يجب أن تبقى > 0)
SELECT 'branches'                AS table_name, COUNT(*)::bigint AS rows, 'يجب > 0' AS expected FROM public.branches
UNION ALL SELECT 'task_definitions',         COUNT(*)::bigint, 'يجب > 0' FROM public.task_definitions
UNION ALL SELECT 'task_required_fields',     COUNT(*)::bigint, 'يجب > 0' FROM public.task_required_fields
UNION ALL SELECT 'task_definition_expenses', COUNT(*)::bigint, 'يجب >= 0' FROM public.task_definition_expenses
UNION ALL SELECT 'expense_types',           COUNT(*)::bigint, 'يجب >= 0' FROM public.expense_types
UNION ALL SELECT 'courts',                  COUNT(*)::bigint, 'يجب >= 0' FROM public.courts
UNION ALL SELECT 'execution_departments',   COUNT(*)::bigint, 'يجب >= 0' FROM public.execution_departments
ORDER BY table_name;


-- =============================================================================
-- بعد SQL — خطوات يدوية
-- =============================================================================
-- 1) Supabase Storage: احذف ملفات الاختبار من (لا تحذف الـ buckets):
--      debtor-files | task-files | lawyer-files
-- 2) تسجيل الدخول:
--      haider  / haider12  → مدير عام
--      admin12 / admin12   → مراقب عام
-- 3) npm run build
-- =============================================================================
