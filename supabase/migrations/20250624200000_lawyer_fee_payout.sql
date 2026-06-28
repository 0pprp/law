-- Allow fee_payout wallet transactions (صرف أتعاب للمحامي — negative amount)
DO $$
BEGIN
  ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'fee_payout';
EXCEPTION
  WHEN undefined_object THEN
    NULL;
END $$;
