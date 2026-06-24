-- Review queue + rejection revision statuses
DO $$ BEGIN
  ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'pending_review';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'needs_revision';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
