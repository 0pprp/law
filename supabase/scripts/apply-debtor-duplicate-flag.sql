-- انسخ والصق في Supabase SQL Editor إن لم تُطبَّق الـ migration تلقائياً.
ALTER TABLE debtors
  ADD COLUMN IF NOT EXISTS duplicate_flagged_at timestamptz;

ALTER TABLE debtors
  ADD COLUMN IF NOT EXISTS duplicate_flagged_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN debtors.duplicate_flagged_at IS
  'وقت تحويل المدين لكارد الأسماء المكررة — NULL = غير محوّل';

COMMENT ON COLUMN debtors.duplicate_flagged_by IS
  'من حوّل المدين لكارد الأسماء المكررة';

CREATE INDEX IF NOT EXISTS idx_debtors_duplicate_flagged
  ON debtors (branch_id, duplicate_flagged_at)
  WHERE duplicate_flagged_at IS NOT NULL;
