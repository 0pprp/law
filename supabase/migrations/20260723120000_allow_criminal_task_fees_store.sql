/**
 * السماح بحفظ أتعاب المهام الجزائية في DB.
 * الإخفاء لغير المدير يبقى في التطبيق (lib/visible-task-fee.ts).
 * نحافظ على حراس تطابق القسم / عدم نقل المهمة بين أقسام.
 */
CREATE OR REPLACE FUNCTION public.enforce_criminal_task_reward_zero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d_case text;
  def_case text;
BEGIN
  IF NEW.debtor_id IS NOT NULL THEN
    SELECT case_type INTO d_case FROM public.debtors WHERE id = NEW.debtor_id;
  END IF;
  IF NEW.task_definition_id IS NOT NULL THEN
    SELECT case_type INTO def_case FROM public.task_definitions WHERE id = NEW.task_definition_id;
  END IF;

  -- أتعاب الجزائي تُحفظ كما هي (لا تُصفَّر هنا)

  IF NEW.assigned_to IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = NEW.assigned_to
        AND p.role = 'lawyer'
        AND COALESCE(p.case_type, 'civil') IS DISTINCT FROM COALESCE(d_case, def_case, 'civil')
    ) THEN
      RAISE EXCEPTION 'lawyer case_type must match debtor/task section';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.debtor_id IS DISTINCT FROM OLD.debtor_id
     AND NEW.debtor_id IS NOT NULL
     AND OLD.debtor_id IS NOT NULL THEN
    IF (
      SELECT case_type FROM public.debtors WHERE id = NEW.debtor_id
    ) IS DISTINCT FROM (
      SELECT case_type FROM public.debtors WHERE id = OLD.debtor_id
    ) THEN
      RAISE EXCEPTION 'cannot move task to debtor in a different case_type';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.tasks.reward_amount IS
  'أتعاب المهمة (مدني أو جزائي). العرض لغير المدير على الجزائي يُصفَّر في التطبيق فقط.';

COMMENT ON COLUMN public.task_definitions.fee_amount IS
  'أتعاب تعريف المهمة. للجزائي تُحفظ القيمة؛ غير المدير يراها صفراً في الواجهة.';
