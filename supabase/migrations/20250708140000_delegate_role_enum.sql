-- Step 1: add delegate to user_role enum (run alone if applying manually — 55P04).
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'delegate';

NOTIFY pgrst, 'reload schema';
