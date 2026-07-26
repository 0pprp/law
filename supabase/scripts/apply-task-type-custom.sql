-- Apply manually in Supabase SQL Editor if migrations are not auto-run.
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'custom';
