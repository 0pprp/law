-- ═══════════════════════════════════════════════════════════════
-- الخطوة 2 — بعد نجاح الخطوة 1، نفّذ هذا في query/run منفصل
-- ═══════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS idx_lawyer_wallet_lm_bonus_once
  ON lawyer_wallet_transactions (reference_id)
  WHERE wallet = 'legal_manager'::lawyer_wallet_kind
    AND amount > 0
    AND reference_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
