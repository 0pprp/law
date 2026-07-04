-- نفّذ هذا السكربت في Supabase SQL Editor إذا فشل الإيداع/السحب اليدوي
-- بسبب: lawyer_wallet_transactions_type_check

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wallet_transaction_type')
     AND NOT EXISTS (
       SELECT 1 FROM pg_type t
       JOIN pg_enum e ON t.oid = e.enumtypid
       WHERE t.typname = 'wallet_transaction_type' AND e.enumlabel = 'legal_manager_manual_deposit'
     ) THEN
    EXECUTE 'ALTER TYPE wallet_transaction_type ADD VALUE ''legal_manager_manual_deposit''';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wallet_transaction_type')
     AND NOT EXISTS (
       SELECT 1 FROM pg_type t
       JOIN pg_enum e ON t.oid = e.enumtypid
       WHERE t.typname = 'wallet_transaction_type' AND e.enumlabel = 'legal_manager_manual_withdrawal'
     ) THEN
    EXECUTE 'ALTER TYPE wallet_transaction_type ADD VALUE ''legal_manager_manual_withdrawal''';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wallet_transaction_type')
     AND NOT EXISTS (
       SELECT 1 FROM pg_type t
       JOIN pg_enum e ON t.oid = e.enumtypid
       WHERE t.typname = 'wallet_transaction_type' AND e.enumlabel = 'legal_manager_withdrawal'
     ) THEN
    EXECUTE 'ALTER TYPE wallet_transaction_type ADD VALUE ''legal_manager_withdrawal''';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wallet_transaction_type')
     AND NOT EXISTS (
       SELECT 1 FROM pg_type t
       JOIN pg_enum e ON t.oid = e.enumtypid
       WHERE t.typname = 'wallet_transaction_type' AND e.enumlabel = 'legal_manager_task_bonus'
     ) THEN
    EXECUTE 'ALTER TYPE wallet_transaction_type ADD VALUE ''legal_manager_task_bonus''';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lawyer_wallet_transactions_type_check'
      AND conrelid = 'public.lawyer_wallet_transactions'::regclass
  ) THEN
    ALTER TABLE lawyer_wallet_transactions
      DROP CONSTRAINT lawyer_wallet_transactions_type_check;

    ALTER TABLE lawyer_wallet_transactions
      ADD CONSTRAINT lawyer_wallet_transactions_type_check
      CHECK (type IN (
        'accountant_transfer',
        'approved_task_payment',
        'manual_adjustment',
        'fee_payout',
        'transfer_from_savings',
        'savings_withdrawal',
        'task_expense_deduction',
        'task_fee',
        'legal_manager_task_bonus',
        'legal_manager_withdrawal',
        'legal_manager_manual_deposit',
        'legal_manager_manual_withdrawal'
      ));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
