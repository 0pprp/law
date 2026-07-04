-- نقل بيانات legal_manager_wallet_transactions (إن وُجد) إلى درج lawyer_wallet_transactions

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'legal_manager_wallet_transactions'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lawyer_wallet_kind') THEN
    INSERT INTO lawyer_wallet_transactions (
      lawyer_id, type, wallet, amount, notes, reference_id,
      created_by, created_at, debtor_id, task_definition_id, source
    )
    SELECT
      lm.legal_manager_user_id,
      'legal_manager_task_bonus',
      'legal_manager'::lawyer_wallet_kind,
      lm.amount,
      lm.notes,
      lm.task_id::text,
      lm.created_by,
      lm.created_at,
      lm.debtor_id,
      lm.task_definition_id,
      'task_completion'
    FROM legal_manager_wallet_transactions lm
    WHERE NOT EXISTS (
      SELECT 1 FROM lawyer_wallet_transactions t
      WHERE t.reference_id = lm.task_id::text
        AND t.wallet = 'legal_manager'::lawyer_wallet_kind
    );
  ELSE
    INSERT INTO lawyer_wallet_transactions (
      lawyer_id, type, amount, notes, reference_id,
      created_by, created_at, debtor_id, task_definition_id, source
    )
    SELECT
      lm.legal_manager_user_id,
      'legal_manager_task_bonus',
      lm.amount,
      lm.notes,
      lm.task_id::text,
      lm.created_by,
      lm.created_at,
      lm.debtor_id,
      lm.task_definition_id,
      'task_completion'
    FROM legal_manager_wallet_transactions lm
    WHERE NOT EXISTS (
      SELECT 1 FROM lawyer_wallet_transactions t
      WHERE t.reference_id = lm.task_id::text
        AND t.type = 'legal_manager_task_bonus'
    );
  END IF;

  DROP TABLE legal_manager_wallet_transactions CASCADE;
END $$;

NOTIFY pgrst, 'reload schema';
