-- ================================================================
-- Migration: 20260715100000_criminal_cases_module.sql
-- الدعاوى الجزائية — Mirror Module
-- مستقل تماماً — لا ALTER TABLE على أي جدول موجود
-- Backup taken: backup-2026-07-15T14-25-58/ (11 tables, 182 debtors, 189 tasks)
-- ================================================================


-- ────────────────────────────────────────────────────────────────
-- §0. دالة updated_at المشتركة (idempotent)
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ────────────────────────────────────────────────────────────────
-- §1a. Enum: حالة الدعوى الجزائية (Case-level)
-- ────────────────────────────────────────────────────────────────
CREATE TYPE criminal_case_status AS ENUM (
  'open',         -- قيد النظر (الافتراضي)
  'under_study',  -- تحت الدراسة / قبل التحريك الرسمي
  'suspended',    -- موقوفة مؤقتاً
  'closed'        -- محسومة / منتهية
);


-- ────────────────────────────────────────────────────────────────
-- §1b. Enum: حالة مهمة الدعوى الجزائية (Task-level) — مستقل بالكامل
-- ────────────────────────────────────────────────────────────────
-- القيم المُصمَّمة لدورة عمل الجزائي تحديداً:
--
--   assigned          ← المهمة أُنشئت وعُيِّنت، تنتظر قبول المحامي أو البدء
--   pending_acceptance← تعيين أُرسل وينتظر قبولاً صريحاً من المحامي
--   in_progress       ← قُبلت وجارٍ التنفيذ
--   submitted         ← رفع المحامي الإنجاز للإدارة
--   pending_review    ← في قائمة انتظار الاعتماد لدى الإدارة
--   approved          ← اعتمدت الإدارة وأُفرجت الأتعاب
--   needs_revision    ← رُدَّت للمحامي (يدمج rejected + needs_info المدني —
--                       في سياق الجزائي الرفض دائماً مصحوب بطلب إعادة عمل)
--   completed         ← دورة الحياة أُغلقت نهائياً
--
-- مستبعدات مقصودة من task_status المدني:
--   draft / new              ← المهام تُنشأ وتُعيَّن مباشرة
--   waiting_assignment /
--     pending_assignment     ← مسار التعيين مبسَّط (لا queue داخلي)
--   postponed                ← الإيقاف على مستوى الدعوى لا المهمة
--   failed                   ← لا معنى له: المهمة إما تُعتمد أو تُعاد
--   closed                   ← مستبدل بـ completed
--   rejected / needs_info    ← مدمجان بـ needs_revision
CREATE TYPE criminal_task_status AS ENUM (
  'assigned',
  'pending_acceptance',
  'in_progress',
  'submitted',
  'pending_review',
  'approved',
  'needs_revision',
  'completed'
);


-- ────────────────────────────────────────────────────────────────
-- §2. criminal_cases — الكيان الجذر
-- ────────────────────────────────────────────────────────────────
CREATE TABLE criminal_cases (
  id                  uuid          DEFAULT gen_random_uuid() PRIMARY KEY,

  -- التعريف القانوني
  case_number         text,
  case_year           smallint,
  court               text,
  crime_type          text,

  -- الأطراف
  client_name         text          NOT NULL,
  client_side         text          NOT NULL
                      CHECK (client_side IN ('plaintiff', 'defendant')),
  opposing_party      text,

  -- التصنيف والموقع
  governorate         text,
  branch_id           uuid          NOT NULL
                      REFERENCES branches(id),

  -- التعيين
  assigned_lawyer_id  uuid
                      REFERENCES profiles(id) ON DELETE SET NULL,

  -- الحالة والتواريخ
  status              criminal_case_status NOT NULL DEFAULT 'open',
  opened_at           date,
  closed_at           timestamptz,

  -- ملاحظات
  notes               text,

  -- أوديت
  created_by          uuid
                      REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_criminal_cases_updated_at
  BEFORE UPDATE ON criminal_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_criminal_cases_branch ON criminal_cases (branch_id);
CREATE INDEX idx_criminal_cases_status ON criminal_cases (status);
CREATE INDEX idx_criminal_cases_lawyer ON criminal_cases (assigned_lawyer_id);


-- ────────────────────────────────────────────────────────────────
-- §3. criminal_case_task_definitions — تعريفات أنواع المهام
-- ────────────────────────────────────────────────────────────────
CREATE TABLE criminal_case_task_definitions (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_id   uuid        NOT NULL
              REFERENCES branches(id),
  label       text        NOT NULL,
  fee_amount  numeric     NOT NULL DEFAULT 0
              CHECK (fee_amount >= 0),
  sort_order  int         NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cc_task_defs_branch
  ON criminal_case_task_definitions (branch_id, is_active);


-- ────────────────────────────────────────────────────────────────
-- §4. criminal_case_required_fields — الحقول الإلزامية
-- ────────────────────────────────────────────────────────────────
CREATE TABLE criminal_case_required_fields (
  id                  uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  task_definition_id  uuid    NOT NULL
                      REFERENCES criminal_case_task_definitions(id)
                      ON DELETE CASCADE,
  field_key           text    NOT NULL,
  field_type          text    NOT NULL DEFAULT 'text',
  field_label         text,
  is_required         boolean NOT NULL DEFAULT true,
  sort_order          int     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (task_definition_id, field_key)
);

CREATE INDEX idx_cc_req_fields_def
  ON criminal_case_required_fields (task_definition_id);


-- ────────────────────────────────────────────────────────────────
-- §5. criminal_case_task_expense_limits — سقوف الصرفيات
-- ────────────────────────────────────────────────────────────────
CREATE TABLE criminal_case_task_expense_limits (
  id                  uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  task_definition_id  uuid    NOT NULL
                      REFERENCES criminal_case_task_definitions(id)
                      ON DELETE CASCADE,
  name                text    NOT NULL,
  max_amount          numeric NOT NULL CHECK (max_amount > 0),
  sort_order          int     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cc_expense_limits_def
  ON criminal_case_task_expense_limits (task_definition_id);


-- ────────────────────────────────────────────────────────────────
-- §6. criminal_case_tasks — مهام الدعوى الجزائية
-- ────────────────────────────────────────────────────────────────
CREATE TABLE criminal_case_tasks (
  id                    uuid                  DEFAULT gen_random_uuid() PRIMARY KEY,

  -- الروابط الأساسية
  criminal_case_id      uuid                  NOT NULL
                        REFERENCES criminal_cases(id)
                        ON DELETE RESTRICT,
  task_definition_id    uuid
                        REFERENCES criminal_case_task_definitions(id)
                        ON DELETE SET NULL,

  -- الحالة والتعيين
  task_status           criminal_task_status  NOT NULL DEFAULT 'assigned',
  assigned_to           uuid
                        REFERENCES profiles(id) ON DELETE SET NULL,
  branch_id             uuid                  NOT NULL
                        REFERENCES branches(id),

  -- الأولوية والمواعيد
  priority              text                  NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_date              date,
  assignment_expires_at timestamptz,
  accepted_at           timestamptz,
  assigned_at           timestamptz,

  -- المحتوى والإنجاز
  admin_notes           text,
  lawyer_notes          text,
  legal_result          text,
  completion_data       jsonb,
  completed_at          timestamptz,

  -- الأتعاب
  reward_amount         numeric               NOT NULL DEFAULT 0
                        CHECK (reward_amount >= 0),
  fee_status            text                  NOT NULL DEFAULT 'pending'
                        CHECK (fee_status IN ('pending', 'released')),

  -- أوديت
  created_by            uuid
                        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at            timestamptz           NOT NULL DEFAULT now(),
  updated_at            timestamptz           NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_criminal_case_tasks_updated_at
  BEFORE UPDATE ON criminal_case_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_cc_tasks_case      ON criminal_case_tasks (criminal_case_id);
CREATE INDEX idx_cc_tasks_assigned  ON criminal_case_tasks (assigned_to);
CREATE INDEX idx_cc_tasks_branch_st ON criminal_case_tasks (branch_id, task_status);


-- ────────────────────────────────────────────────────────────────
-- §7. criminal_case_expenses — الصرفيات
-- ────────────────────────────────────────────────────────────────
CREATE TABLE criminal_case_expenses (
  id                        uuid        DEFAULT gen_random_uuid() PRIMARY KEY,

  -- الروابط
  criminal_case_id          uuid        NOT NULL
                            REFERENCES criminal_cases(id)
                            ON DELETE RESTRICT,
  criminal_case_task_id     uuid
                            REFERENCES criminal_case_tasks(id)
                            ON DELETE SET NULL,
  task_expense_limit_id     uuid
                            REFERENCES criminal_case_task_expense_limits(id)
                            ON DELETE SET NULL,

  -- قيم الصرفية
  amount                    numeric     NOT NULL CHECK (amount > 0),
  description               text,
  expense_date              date        NOT NULL DEFAULT CURRENT_DATE,
  status                    text        NOT NULL DEFAULT 'pending_approval'
                            CHECK (status IN ('pending_approval', 'approved', 'rejected')),
  max_allowed_amount        numeric,

  -- المحامي والمحفظة
  lawyer_id                 uuid
                            REFERENCES profiles(id) ON DELETE SET NULL,
  wallet_deducted_at        timestamptz,

  -- أوديت
  created_by                uuid
                            REFERENCES profiles(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_criminal_case_expenses_updated_at
  BEFORE UPDATE ON criminal_case_expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_cc_expenses_case   ON criminal_case_expenses (criminal_case_id);
CREATE INDEX idx_cc_expenses_task   ON criminal_case_expenses (criminal_case_task_id);
CREATE INDEX idx_cc_expenses_status ON criminal_case_expenses (status);

NOTIFY pgrst, 'reload schema';
