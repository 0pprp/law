-- Step 1 of 2: add enum values only. Commit before using them (PostgreSQL 55P04).
-- Run this query alone in SQL Editor, then run 20250628180001_criminal_task_definitions.sql.

ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'criminal_lawsuit_request';
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'police_station_statement';
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'court_statement';
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'witness_statement';

NOTIFY pgrst, 'reload schema';
