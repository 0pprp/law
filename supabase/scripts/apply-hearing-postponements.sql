-- انسخ والصق في Supabase SQL Editor إن لم تُطبَّق الـ migration تلقائياً.
CREATE TABLE IF NOT EXISTS public.hearing_postponements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debtor_id uuid NOT NULL REFERENCES public.debtors(id) ON DELETE CASCADE,
  old_date date NOT NULL,
  new_date date NOT NULL,
  reason text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hearing_postponements_reason_nonempty CHECK (length(trim(reason)) > 0),
  CONSTRAINT hearing_postponements_dates_differ CHECK (old_date IS DISTINCT FROM new_date)
);

CREATE INDEX IF NOT EXISTS idx_hearing_postponements_debtor_created
  ON public.hearing_postponements (debtor_id, created_at DESC);

COMMENT ON TABLE public.hearing_postponements IS
  'سجل تأجيل تاريخ المرافعة: التاريخ القديميم + السبب، والتاريخ الجديد يصبح first_hearing_date';

ALTER TABLE public.hearing_postponements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hearing_postponements_select ON public.hearing_postponements;
CREATE POLICY hearing_postponements_select ON public.hearing_postponements
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND COALESCE(p.is_active, true)
    )
  );
