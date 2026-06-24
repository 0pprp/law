-- Track last approved task when a debtor case is closed
ALTER TABLE debtors ADD COLUMN IF NOT EXISTS last_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_debtors_last_task_id ON debtors(last_task_id);
