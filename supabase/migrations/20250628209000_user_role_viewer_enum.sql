-- Step 1 of 2: add مراقب عام to user_role enum.
-- Run this alone in SQL Editor first, then run 20250628210000_viewer_role_rls.sql
-- (PostgreSQL cannot use a new enum value in the same transaction — error 55P04.)

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'viewer';

NOTIFY pgrst, 'reload schema';
