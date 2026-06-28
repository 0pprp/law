-- Savings wallet (محفظة الادخار) separate from fee wallet (محفظة الأتعاب)

DO $$
BEGIN
  CREATE TYPE lawyer_wallet_kind AS ENUM ('fees', 'savings');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE lawyer_wallet_transactions
  ADD COLUMN IF NOT EXISTS wallet lawyer_wallet_kind NOT NULL DEFAULT 'fees';

-- Past accountant deposits belong to savings wallet
UPDATE lawyer_wallet_transactions
SET wallet = 'savings'
WHERE type = 'accountant_transfer';

DO $$
BEGIN
  ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'transfer_from_savings';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_lawyer_wallet_tx_lawyer_wallet
  ON lawyer_wallet_transactions (lawyer_id, wallet);
