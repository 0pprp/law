-- Official branch names ONLY (11). Merge legacy aliases, disable extras.
-- Safe to re-run.

-- Legacy short names → official names (same physical branch, one row each).
CREATE OR REPLACE FUNCTION public.merge_branch_alias(
  p_legacy_name text,
  p_official_name text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_legacy uuid;
  v_official uuid;
  r record;
BEGIN
  SELECT id INTO v_legacy FROM branches WHERE name = p_legacy_name;
  IF v_legacy IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_official FROM branches WHERE name = p_official_name;

  IF v_official IS NULL THEN
    UPDATE branches
    SET name = p_official_name, is_active = true
    WHERE id = v_legacy;
    RETURN;
  END IF;

  IF v_legacy = v_official THEN
    RETURN;
  END IF;

  -- Prefer legacy task_definition fees/labels when both rows exist.
  FOR r IN
    SELECT
      o.id AS official_id,
      l.label AS legacy_label,
      l.fee_amount AS legacy_fee,
      l.sort_order AS legacy_sort,
      l.is_active AS legacy_active
    FROM task_definitions l
    JOIN task_definitions o
      ON o.branch_id = v_official AND o.task_type = l.task_type
    WHERE l.branch_id = v_legacy
  LOOP
    UPDATE task_definitions
    SET
      label = r.legacy_label,
      fee_amount = r.legacy_fee,
      sort_order = r.legacy_sort,
      is_active = r.legacy_active
    WHERE id = r.official_id;
  END LOOP;

  DELETE FROM task_definitions WHERE branch_id = v_legacy;

  UPDATE profiles SET branch_id = v_official WHERE branch_id = v_legacy;
  UPDATE debtors SET branch_id = v_official WHERE branch_id = v_legacy;
  UPDATE tasks SET branch_id = v_official WHERE branch_id = v_legacy;
  UPDATE expenses SET branch_id = v_official WHERE branch_id = v_legacy;
  UPDATE debtor_payments SET branch_id = v_official WHERE branch_id = v_legacy;
  UPDATE activity_logs SET branch_id = v_official WHERE branch_id = v_legacy;
  UPDATE courts SET branch_id = v_official WHERE branch_id = v_legacy;
  UPDATE lawyer_payout_requests SET branch_id = v_official WHERE branch_id = v_legacy;

  DELETE FROM branches WHERE id = v_legacy;
END;
$$;

SELECT public.merge_branch_alias('الكرخ', 'بغداد الكرخ');
SELECT public.merge_branch_alias('الرصافة', 'بغداد الرصافة');

UPDATE branches SET is_active = false WHERE name = 'الفرع الرئيسي';

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

UPDATE branches SET is_active = true
WHERE name IN (
  'بغداد الكرخ', 'بغداد الرصافة', 'البصرة', 'الديوانية', 'ديالى',
  'كربلاء', 'كركوك', 'الموصل', 'النجف الأشرف', 'الناصرية', 'السماوة'
);

UPDATE branches SET is_active = false
WHERE name NOT IN (
  'بغداد الكرخ', 'بغداد الرصافة', 'البصرة', 'الديوانية', 'ديالى',
  'كربلاء', 'كركوك', 'الموصل', 'النجف الأشرف', 'الناصرية', 'السماوة',
  'الفرع الرئيسي'
);

-- Admins stuck on disabled main branch → default to بغداد الكرخ.
UPDATE profiles p
SET branch_id = (SELECT id FROM branches WHERE name = 'بغداد الكرخ' LIMIT 1)
WHERE p.role = 'admin'
  AND p.branch_id IN (SELECT id FROM branches WHERE is_active = false);

DROP FUNCTION IF EXISTS public.merge_branch_alias(text, text);
