-- Step 1: add normalized_name (apply anytime).
-- Do NOT add the unique constraint until duplicates are merged
-- (see scripts/merge-branch-list-duplicates.mjs and 20260713140100_...).

ALTER TABLE public.branch_lists
  ADD COLUMN IF NOT EXISTS normalized_name text;

COMMENT ON COLUMN public.branch_lists.normalized_name IS
  'مفتاح مقارنة مطبّع لأسماء القوائم داخل الفرع — للمقارنة فقط';

CREATE INDEX IF NOT EXISTS idx_branch_lists_branch_normalized
  ON public.branch_lists (branch_id, normalized_name);

NOTIFY pgrst, 'reload schema';
