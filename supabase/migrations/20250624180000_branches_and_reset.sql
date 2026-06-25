-- Deactivate legacy "main branch" and ensure the 11 official branches exist.
-- Safe to re-run.

UPDATE branches
SET is_active = false
WHERE name = 'الفرع الرئيسي';

INSERT INTO branches (name, is_active)
SELECT v.name, true
FROM (VALUES
  ('بغداد الكرخ'),
  ('بغداد الرصافة'),
  ('البصرة'),
  ('الديوانية'),
  ('ديالى'),
  ('كربلاء'),
  ('كركوك'),
  ('الموصل'),
  ('النجف الأشرف'),
  ('الناصرية'),
  ('السماوة')
) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM branches b WHERE b.name = v.name
);
