-- Optional: track when a task was assigned to a lawyer
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
