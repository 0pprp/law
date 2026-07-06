-- قوائم الفرع: جدول + ربط بالمدينين + seed + RLS

CREATE TABLE IF NOT EXISTS public.branch_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_lists_branch_name_unique UNIQUE (branch_id, name)
);

CREATE INDEX IF NOT EXISTS idx_branch_lists_branch_id ON public.branch_lists(branch_id);

ALTER TABLE public.debtors
  ADD COLUMN IF NOT EXISTS branch_list_id uuid REFERENCES public.branch_lists(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_debtors_branch_list_id ON public.debtors(branch_list_id);

CREATE OR REPLACE FUNCTION public.set_branch_lists_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_branch_lists_updated_at ON public.branch_lists;
CREATE TRIGGER trg_branch_lists_updated_at
  BEFORE UPDATE ON public.branch_lists
  FOR EACH ROW EXECUTE FUNCTION public.set_branch_lists_updated_at();

CREATE OR REPLACE FUNCTION public.resolve_branch_id_for_lists(p_candidates text[])
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT b.id
  FROM public.branches b
  WHERE b.name = ANY(p_candidates)
    AND COALESCE(b.is_active, true) = true
  ORDER BY array_position(p_candidates, b.name)
  LIMIT 1;
$$;

-- Seed — idempotent (لا يكرر الاسم داخل نفس الفرع)
DO $seed$
DECLARE
  rec record;
  v_branch_id uuid;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      (ARRAY['بغداد الرصافة','الرصافة']::text[], 'شيخ عمر الاولى'::text),
      (ARRAY['بغداد الرصافة','الرصافة']::text[], 'شيخ عمر الثالثة'::text),
      (ARRAY['بغداد الرصافة','الرصافة']::text[], 'الصدرية'::text),
      (ARRAY['بغداد الرصافة','الرصافة']::text[], 'فضوة العرب'::text),
      (ARRAY['بغداد الرصافة','الرصافة']::text[], 'كمب سارة'::text),
      (ARRAY['بغداد الرصافة','الرصافة']::text[], 'الطالبية'::text),
      (ARRAY['بغداد الرصافة','الرصافة']::text[], 'السوق الاولى'::text),
      (ARRAY['بغداد الرصافة','الرصافة']::text[], 'الرستمية'::text),
      (ARRAY['بغداد الرصافة','الرصافة']::text[], 'الوزيرية'::text),
      (ARRAY['بغداد الرصافة','الرصافة']::text[], 'الرصافي 1'::text),
      (ARRAY['بغداد الرصافة','الرصافة']::text[], 'الشعب'::text),
      (ARRAY['بغداد الرصافة','الرصافة']::text[], 'البلديات'::text),
      (ARRAY['بغداد الرصافة','الرصافة']::text[], 'الامين'::text),
      (ARRAY['بغداد الرصافة','الرصافة']::text[], 'الكمالية'::text),

      (ARRAY['النجف الأشرف','النجف']::text[], 'الشمالية'::text),
      (ARRAY['النجف الأشرف','النجف']::text[], 'الوسطى'::text),
      (ARRAY['النجف الأشرف','النجف']::text[], 'الولاية نجف 1'::text),
      (ARRAY['النجف الأشرف','النجف']::text[], 'الولاية نجف 2'::text),
      (ARRAY['النجف الأشرف','النجف']::text[], 'الكوفة'::text),
      (ARRAY['النجف الأشرف','النجف']::text[], 'المشخاب 2'::text),
      (ARRAY['النجف الأشرف','النجف']::text[], 'قائمه الشهرية'::text),
      (ARRAY['النجف الأشرف','النجف']::text[], 'الكفل'::text),
      (ARRAY['النجف الأشرف','النجف']::text[], 'الحيدرية'::text),
      (ARRAY['النجف الأشرف','النجف']::text[], 'الاجهزة الصينية'::text),

      (ARRAY['بغداد الكرخ','الكرخ']::text[], 'الدورة'::text),
      (ARRAY['بغداد الكرخ','الكرخ']::text[], 'البياع'::text),
      (ARRAY['بغداد الكرخ','الكرخ']::text[], 'الوشاش'::text),
      (ARRAY['بغداد الكرخ','الكرخ']::text[], 'الرحمانية 2'::text),
      (ARRAY['بغداد الكرخ','الكرخ']::text[], 'الشعلة'::text),
      (ARRAY['بغداد الكرخ','الكرخ']::text[], 'الجهاد'::text),
      (ARRAY['بغداد الكرخ','الكرخ']::text[], 'الحرية'::text),
      (ARRAY['بغداد الكرخ','الكرخ']::text[], 'قائمة الشهرية'::text),
      (ARRAY['بغداد الكرخ','الكرخ']::text[], 'الكاظمية الجديدة'::text),
      (ARRAY['بغداد الكرخ','الكرخ']::text[], 'أبو غريب'::text),

      (ARRAY['كربلاء']::text[], 'الحر كربلاء'::text),
      (ARRAY['كربلاء']::text[], 'الصناعي كربلاء'::text),
      (ARRAY['كربلاء']::text[], 'العسكري كربلاء'::text),
      (ARRAY['كربلاء']::text[], 'طويريج كربلاء'::text),
      (ARRAY['كربلاء']::text[], 'الشبانات'::text),
      (ARRAY['كربلاء']::text[], 'الحسينية كربلاء'::text),
      (ARRAY['كربلاء']::text[], 'متوقفين العسكري'::text),
      (ARRAY['كربلاء']::text[], 'الشهرية'::text),
      (ARRAY['كربلاء']::text[], 'الولاية كربلاء'::text),

      (ARRAY['الحلة']::text[], 'الحمزة'::text),
      (ARRAY['الحلة']::text[], 'السوق'::text),
      (ARRAY['الحلة']::text[], 'القاسم'::text),
      (ARRAY['الحلة']::text[], 'المحاويل'::text),
      (ARRAY['الحلة']::text[], 'المسيب'::text),
      (ARRAY['الحلة']::text[], 'الاسكندرية'::text),
      (ARRAY['الحلة']::text[], 'الثورة'::text),
      (ARRAY['الحلة']::text[], 'الشهرية'::text),
      (ARRAY['الحلة']::text[], 'السوق 2'::text),

      (ARRAY['الديوانية']::text[], 'الصناعي الديوانية'::text),
      (ARRAY['الديوانية']::text[], 'الدغارة الديوانية'::text),
      (ARRAY['الديوانية']::text[], 'السوق الديوانية'::text),
      (ARRAY['الديوانية']::text[], 'الاسكان الديوانية'::text),
      (ARRAY['الديوانية']::text[], 'متوقفين الدغارة'::text),
      (ARRAY['الديوانية']::text[], 'متوقفين الاسكان'::text),
      (ARRAY['الديوانية']::text[], 'الشامية'::text),
      (ARRAY['الديوانية']::text[], 'المندوب الشهري'::text),
      (ARRAY['الديوانية']::text[], 'متوقفين الشامية'::text),

      (ARRAY['الكوت']::text[], 'الصناعي'::text),
      (ARRAY['الكوت']::text[], 'السوق 2'::text),
      (ARRAY['الكوت']::text[], 'الخاجية'::text),
      (ARRAY['الكوت']::text[], 'السوق 1'::text),
      (ARRAY['الكوت']::text[], 'الصناعي القديم'::text),
      (ARRAY['الكوت']::text[], 'السوق اثنان القديم'::text),
      (ARRAY['الكوت']::text[], 'الهوره'::text),
      (ARRAY['الكوت']::text[], 'المندوب الشهري'::text),
      (ARRAY['الكوت']::text[], 'النعمانية'::text),
      (ARRAY['الكوت']::text[], 'تنازلات'::text),
      (ARRAY['الكوت']::text[], 'الصويره'::text),
      (ARRAY['الكوت']::text[], 'الانوار'::text),

      (ARRAY['الناصرية']::text[], 'سوق الشيوخ'::text),
      (ARRAY['الناصرية']::text[], 'حبوبي 1'::text),
      (ARRAY['الناصرية']::text[], 'حبوبي 2'::text),
      (ARRAY['الناصرية']::text[], 'حي الصناعي'::text),
      (ARRAY['الناصرية']::text[], 'المدينة'::text),
      (ARRAY['الناصرية']::text[], 'الاسكان'::text),
      (ARRAY['الناصرية']::text[], 'الشهرية'::text),

      (ARRAY['البصرة']::text[], 'الجزائر الاولى'::text),
      (ARRAY['البصرة']::text[], 'الجزائر الثانية'::text),
      (ARRAY['البصرة']::text[], 'خمسة ميل الأولى'::text),
      (ARRAY['البصرة']::text[], 'خمسة ميل الثالثة'::text),
      (ARRAY['البصرة']::text[], 'خمسة ميل الرابعة'::text),
      (ARRAY['البصرة']::text[], 'القبلة الأولى'::text),
      (ARRAY['البصرة']::text[], 'الجزيرة'::text),
      (ARRAY['البصرة']::text[], 'ابي الخصيب الأولى'::text),
      (ARRAY['البصرة']::text[], 'ابي الخصيب الثانية'::text),
      (ARRAY['البصرة']::text[], 'كرمة علي'::text),
      (ARRAY['البصرة']::text[], 'الزبير الأولى'::text),
      (ARRAY['البصرة']::text[], 'الزبير الثانية'::text),
      (ARRAY['البصرة']::text[], 'الزبير الثالثة'::text),
      (ARRAY['البصرة']::text[], 'الحيانية'::text),
      (ARRAY['البصرة']::text[], 'العشار الأولى'::text),
      (ARRAY['البصرة']::text[], 'العشار الثانية'::text),
      (ARRAY['البصرة']::text[], 'العشار الرابعة'::text),
      (ARRAY['البصرة']::text[], 'الشهري'::text),

      (ARRAY['المثنى','السماوة']::text[], 'السوق الاول'::text),
      (ARRAY['المثنى','السماوة']::text[], 'حي الصناعي'::text),
      (ARRAY['المثنى','السماوة']::text[], 'الوركاء'::text),
      (ARRAY['المثنى','السماوة']::text[], 'الرميثة'::text),
      (ARRAY['المثنى','السماوة']::text[], 'المركز'::text),
      (ARRAY['المثنى','السماوة']::text[], 'الشهري'::text),

      (ARRAY['ديالى']::text[], 'الامين'::text),
      (ARRAY['ديالى']::text[], 'التحرير2'::text),
      (ARRAY['ديالى']::text[], 'التحرير 1'::text),
      (ARRAY['ديالى']::text[], 'الخالص'::text),
      (ARRAY['ديالى']::text[], 'السوق 1'::text),
      (ARRAY['ديالى']::text[], 'بهرز'::text),
      (ARRAY['ديالى']::text[], 'الكاطون'::text),
      (ARRAY['ديالى']::text[], 'المقدادية'::text),
      (ARRAY['ديالى']::text[], 'بلدروز ديالى'::text),
      (ARRAY['ديالى']::text[], 'خانقين'::text),

      (ARRAY['الموصل']::text[], 'سوق النبي يونس'::text),
      (ARRAY['الموصل']::text[], 'الصناعي 1'::text),
      (ARRAY['الموصل']::text[], 'سومر'::text),
      (ARRAY['الموصل']::text[], 'المندوب الشهري'::text),
      (ARRAY['الموصل']::text[], 'الميثاق'::text),
      (ARRAY['الموصل']::text[], 'الزهراء'::text),
      (ARRAY['الموصل']::text[], 'الصناعي 2'::text),
      (ARRAY['الموصل']::text[], 'سوق الجديدة'::text),
      (ARRAY['الموصل']::text[], 'وادي عكاب'::text),

      (ARRAY['كركوك']::text[], 'السوق'::text),
      (ARRAY['كركوك']::text[], 'الصناعي'::text),
      (ARRAY['كركوك']::text[], 'حي العسكري'::text),
      (ARRAY['كركوك']::text[], 'القورية'::text),
      (ARRAY['كركوك']::text[], 'القادسية'::text)
    ) AS t(branch_keys, list_name)
  LOOP
    v_branch_id := public.resolve_branch_id_for_lists(rec.branch_keys);
    IF v_branch_id IS NULL THEN
      CONTINUE;
    END IF;
    INSERT INTO public.branch_lists (branch_id, name)
    VALUES (v_branch_id, rec.list_name)
    ON CONFLICT (branch_id, name) DO NOTHING;
  END LOOP;
END;
$seed$;

ALTER TABLE public.branch_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS branch_lists_authenticated_all ON public.branch_lists;
CREATE POLICY branch_lists_authenticated_all ON public.branch_lists
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS viewer_select_all ON public.branch_lists;
CREATE POLICY viewer_select_all ON public.branch_lists
  FOR SELECT TO authenticated
  USING (public.is_viewer_role());

NOTIFY pgrst, 'reload schema';
