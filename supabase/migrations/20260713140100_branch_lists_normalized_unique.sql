-- Step 2: unique per branch — APPLY ONLY AFTER merge-branch-list-duplicates.mjs --apply
-- If this fails with duplicate key, re-run the merge script.

CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_lists_branch_normalized
  ON public.branch_lists (branch_id, normalized_name)
  WHERE normalized_name IS NOT NULL AND btrim(normalized_name) <> '';

NOTIFY pgrst, 'reload schema';
