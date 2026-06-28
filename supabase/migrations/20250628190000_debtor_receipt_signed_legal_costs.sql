-- هل الوصل موقّع ليتحمّل المدين التكاليف القانونية؟
ALTER TABLE debtors
  ADD COLUMN IF NOT EXISTS receipt_signed_legal_costs boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN debtors.receipt_signed_legal_costs IS
  'هل الوصل موقّع ليتحمّل المدين التكاليف القانونية';

NOTIFY pgrst, 'reload schema';
