-- fee_status tracking + approved_task_payment enum + RLS for wallet reads

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS fee_status text;

DO $$
BEGIN
  ALTER TYPE wallet_transaction_type ADD VALUE IF NOT EXISTS 'approved_task_payment';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE lawyer_wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lawyer_wallet_tx_select_own ON lawyer_wallet_transactions;
CREATE POLICY lawyer_wallet_tx_select_own ON lawyer_wallet_transactions
  FOR SELECT TO authenticated
  USING (lawyer_id = auth.uid());

DROP POLICY IF EXISTS lawyer_wallet_tx_select_staff ON lawyer_wallet_transactions;
CREATE POLICY lawyer_wallet_tx_select_staff ON lawyer_wallet_transactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'accountant', 'employee')
    )
  );

DROP POLICY IF EXISTS lawyer_wallet_tx_insert_staff ON lawyer_wallet_transactions;
CREATE POLICY lawyer_wallet_tx_insert_staff ON lawyer_wallet_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'accountant', 'employee')
    )
  );

NOTIFY pgrst, 'reload schema';
