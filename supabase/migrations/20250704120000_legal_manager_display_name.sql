-- تحديث عرض اسم دور مدير القانونية (اختياري — القيمة في DB تبقى viewer)
UPDATE public.profiles
SET full_name = 'مدير القانونية'
WHERE username = 'admin12' AND role = 'viewer';
