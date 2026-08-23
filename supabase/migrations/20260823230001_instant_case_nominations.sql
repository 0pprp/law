-- ترشيح الأسماء / الدعاوى الفورية
-- المندوب والمحاسب الفرعي يرشّحون → مدير الفرع يوافق/يرفض → يظهر للمدير

CREATE TABLE IF NOT EXISTS public.instant_case_nominations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  branch_list_id uuid NOT NULL REFERENCES public.branch_lists(id) ON DELETE RESTRICT,
  debtor_name text NOT NULL,
  sale_price numeric NOT NULL CHECK (sale_price > 0),
  governorate text,
  nominated_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  nominator_role text NOT NULL CHECK (nominator_role IN ('delegate', 'accountant')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  debtor_id uuid REFERENCES public.debtors(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instant_case_nominations_approved_has_debtor
    CHECK (status = 'pending' OR debtor_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_instant_noms_branch_status_created
  ON public.instant_case_nominations (branch_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_instant_noms_nominated_by
  ON public.instant_case_nominations (nominated_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_instant_noms_debtor_id
  ON public.instant_case_nominations (debtor_id)
  WHERE debtor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_instant_case_nominations_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_instant_case_nominations_updated_at ON public.instant_case_nominations;
CREATE TRIGGER trg_instant_case_nominations_updated_at
  BEFORE UPDATE ON public.instant_case_nominations
  FOR EACH ROW EXECUTE FUNCTION public.set_instant_case_nominations_updated_at();

ALTER TABLE public.instant_case_nominations ENABLE ROW LEVEL SECURITY;

-- القراءة/الكتابة عبر service role في الـ APIs؛ سياسات محدودة للمصادق عليهم
DROP POLICY IF EXISTS instant_noms_select_own_or_branch ON public.instant_case_nominations;
CREATE POLICY instant_noms_select_own_or_branch ON public.instant_case_nominations
  FOR SELECT TO authenticated
  USING (
    nominated_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND COALESCE(p.is_active, true)
        AND (
          p.role = 'admin'
          OR (p.role = 'branch_manager' AND p.branch_id = instant_case_nominations.branch_id)
        )
    )
  );

DROP POLICY IF EXISTS instant_noms_insert_nominators ON public.instant_case_nominations;
CREATE POLICY instant_noms_insert_nominators ON public.instant_case_nominations
  FOR INSERT TO authenticated
  WITH CHECK (
    nominated_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND COALESCE(p.is_active, true)
        AND (
          p.role = 'delegate'
          OR (p.role = 'accountant' AND COALESCE(p.accountant_type, 'branch') = 'branch')
        )
        AND p.branch_id = instant_case_nominations.branch_id
    )
  );

COMMENT ON TABLE public.instant_case_nominations IS
  'ترشيحات الدعاوى الفورية من المندوب/المحاسب الفرعي؛ المرفوض يُحذف ولا يبقى صفاً';

NOTIFY pgrst, 'reload schema';
