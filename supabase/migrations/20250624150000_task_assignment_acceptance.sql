-- Task assignment acceptance workflow
DO $$ BEGIN
  ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'pending_assignment';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'assignment_pending_acceptance';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignment_expires_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS acceptance_method text;
