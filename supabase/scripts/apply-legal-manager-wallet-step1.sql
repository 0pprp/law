-- ═══════════════════════════════════════════════════════════════
-- الخطوة 1 — نفّذ هذا أولاً ثم اضغط Run
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE debtors
  ADD COLUMN IF NOT EXISTS legal_manager_fees numeric NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lawyer_wallet_kind') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'lawyer_wallet_kind' AND e.enumlabel = 'legal_manager'
    ) THEN
      EXECUTE 'ALTER TYPE lawyer_wallet_kind ADD VALUE ''legal_manager''';
    END IF;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
