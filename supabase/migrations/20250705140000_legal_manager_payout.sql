-- طلبات سحب محفظة مدير القانونية (نفس lawyer_payout_requests + wallet_kind = legal_manager)

ALTER TABLE lawyer_payout_requests DROP CONSTRAINT IF EXISTS lawyer_payout_requests_wallet_kind_check;

ALTER TABLE lawyer_payout_requests
  ADD CONSTRAINT lawyer_payout_requests_wallet_kind_check
  CHECK (wallet_kind IN ('fees', 'savings', 'legal_manager'));

DROP POLICY IF EXISTS lawyer_payout_requests_insert_legal_manager ON lawyer_payout_requests;

CREATE POLICY lawyer_payout_requests_insert_legal_manager ON lawyer_payout_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    lawyer_id = auth.uid()
    AND status = 'pending'
    AND wallet_kind = 'legal_manager'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'viewer'
        AND p.is_active = true
    )
  );

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

NOTIFY pgrst, 'reload schema';
