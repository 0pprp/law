-- Manual apply helper (Supabase SQL Editor)
-- 1) Add column
-- 2) After running: node --env-file=.env.local scripts/merge-branch-list-duplicates.mjs --apply
-- 3) Add unique index

ALTER TABLE public.branch_lists
  ADD COLUMN IF NOT EXISTS normalized_name text;

CREATE INDEX IF NOT EXISTS idx_branch_lists_branch_normalized
  ON public.branch_lists (branch_id, normalized_name);

-- After cleanup:
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_lists_branch_normalized
--   ON public.branch_lists (branch_id, normalized_name)
--   WHERE normalized_name IS NOT NULL AND btrim(normalized_name) <> '';

NOTIFY pgrst, 'reload schema';
