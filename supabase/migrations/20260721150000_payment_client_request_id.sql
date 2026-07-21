-- Payment idempotency: official client_request_id column (replaces notes [req:] hack for new rows)
-- Safe on existing DBs. Does not parse old notes.

ALTER TABLE public.debtor_payments
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

-- Unique per creator + request id (allows same UUID across users; blocks double-submit)
CREATE UNIQUE INDEX IF NOT EXISTS debtor_payments_creator_client_request_uidx
  ON public.debtor_payments (created_by, client_request_id)
  WHERE client_request_id IS NOT NULL AND created_by IS NOT NULL;

-- Lookup index for debtor-scoped dedup
CREATE INDEX IF NOT EXISTS debtor_payments_debtor_client_request_idx
  ON public.debtor_payments (debtor_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMENT ON COLUMN public.debtor_payments.client_request_id IS
  'Idempotency key from client; unique per created_by. Legacy rows remain NULL.';
