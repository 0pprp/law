-- يُنفَّذ في migration/commit منفصل بعد 20250705120000 (قيمة enum يجب أن تكون مُلتزمة)
-- لا تستخدم wallet::text في predicate — 42P17 (not IMMUTABLE)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'lawyer_wallet_kind' AND e.enumlabel = 'legal_manager'
  ) THEN
    RAISE NOTICE 'تخطّي الفهرس: قيمة legal_manager غير موجودة في lawyer_wallet_kind — نفّذ 20250705120000 أولاً';
    RETURN;
  END IF;

  EXECUTE $idx$
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lawyer_wallet_lm_bonus_once
      ON lawyer_wallet_transactions (reference_id)
      WHERE wallet = 'legal_manager'::lawyer_wallet_kind
        AND amount > 0
        AND reference_id IS NOT NULL
  $idx$;
END $$;

NOTIFY pgrst, 'reload schema';
