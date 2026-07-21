-- Idempotency لتشغيلات استيراد المدينين الجزائيين
CREATE TABLE IF NOT EXISTS public.criminal_import_runs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'completed',
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS criminal_import_runs_user_created_idx
  ON public.criminal_import_runs (user_id, created_at DESC);

ALTER TABLE public.criminal_import_runs ENABLE ROW LEVEL SECURITY;

-- الوصول عبر service role فقط من API — لا سياسات عامة للكتابة من العميل
