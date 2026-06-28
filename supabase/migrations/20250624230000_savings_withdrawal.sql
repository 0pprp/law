-- Savings withdrawal type (سحب ادخار)
DO $$
BEGIN
  ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'savings_withdrawal';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
