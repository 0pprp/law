-- محفظة مدير القانونية: درج (wallet) داخل lawyer_wallet_transactions — ليس جدولاً منفصلاً

ALTER TABLE debtors
  ADD COLUMN IF NOT EXISTS legal_manager_fees numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN debtors.legal_manager_fees IS
  'مجموع أتعاب مدير القانونية على المدين (1,000 د.ع × كل مهمة معتمدة)';

-- إضافة قيمة enum بـ EXECUTE ديناميكي (تجنب خطأ compile-time 42704)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lawyer_wallet_kind') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'lawyer_wallet_kind' AND e.enumlabel = 'legal_manager'
    ) THEN
      EXECUTE 'ALTER TYPE lawyer_wallet_kind ADD VALUE ''legal_manager''';
    END IF;
  END IF;
END $$;

-- wallet_transaction_type اختياري — بعض القواعد تستخدم text لعمود type
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wallet_transaction_type') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'wallet_transaction_type' AND e.enumlabel = 'legal_manager_task_bonus'
    ) THEN
      EXECUTE 'ALTER TYPE wallet_transaction_type ADD VALUE ''legal_manager_task_bonus''';
    END IF;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
