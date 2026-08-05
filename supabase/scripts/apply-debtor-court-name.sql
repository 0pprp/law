-- طبّق يدوياً إن لزم: محكمة اختيارية على المدين (تجاوز محكمة القائمة)
ALTER TABLE public.debtors
  ADD COLUMN IF NOT EXISTS court_name text;

COMMENT ON COLUMN public.debtors.court_name IS
  'محكمة المدين الاختيارية — إن وُجدت تُعرض بدل محكمة القائمة (حالات استثنائية دون تغيير الربط بالقائمة)';
