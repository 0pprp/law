-- Official branch display names ONLY (12). Do not create parallel rows for aliases
-- like «الكرخ» / «الرصافة» — use 20250628170000_consolidate_official_branches.sql
-- to merge legacy aliases into these names.
-- Safe to re-run.

UPDATE branches
SET is_active = false
WHERE name = 'الفرع الرئيسي';

INSERT INTO branches (name, is_active)
SELECT v.name, true
FROM (VALUES
  ('بغداد الكرخ'),
  ('بغداد الرصافة'),
  ('بابل'),
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
