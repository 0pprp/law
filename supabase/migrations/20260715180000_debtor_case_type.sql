-- debtor / task_definition case type (civil | criminal)
-- Extends existing debtor flow — no parallel criminal_cases usage.

ALTER TABLE debtors
  ADD COLUMN IF NOT EXISTS case_type text NOT NULL DEFAULT 'civil';

ALTER TABLE task_definitions
  ADD COLUMN IF NOT EXISTS case_type text NOT NULL DEFAULT 'civil';

DO $$ BEGIN
  ALTER TABLE debtors
    ADD CONSTRAINT debtors_case_type_check
    CHECK (case_type IN ('civil', 'criminal'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE task_definitions
    ADD CONSTRAINT task_definitions_case_type_check
    CHECK (case_type IN ('civil', 'criminal'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Seeded criminal task types → case_type = criminal
UPDATE task_definitions
SET case_type = 'criminal'
WHERE task_type IN (
  'criminal_lawsuit_request',
  'police_station_statement',
  'court_statement',
  'witness_statement'
);

CREATE INDEX IF NOT EXISTS idx_debtors_case_type ON debtors (case_type);
CREATE INDEX IF NOT EXISTS idx_debtors_branch_case_type ON debtors (branch_id, case_type);
CREATE INDEX IF NOT EXISTS idx_task_definitions_case_type ON task_definitions (branch_id, case_type);
