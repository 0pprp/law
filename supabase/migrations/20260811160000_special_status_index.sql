-- فهرس لتسريع كروت الأسماء التي تحتاج مراقبة
CREATE INDEX IF NOT EXISTS idx_debtors_special_status_id
  ON public.debtors (special_status_id)
  WHERE special_status_id IS NOT NULL;
