-- ربط المندوب بقائمة فرع محددة (واحد لكل مندوب)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS branch_list_id uuid REFERENCES public.branch_lists(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_branch_list_id
  ON public.profiles(branch_list_id)
  WHERE branch_list_id IS NOT NULL;

COMMENT ON COLUMN public.profiles.branch_list_id IS
  'للمندوبين: القائمة التي يخدمها المندوب داخل فرعه';
