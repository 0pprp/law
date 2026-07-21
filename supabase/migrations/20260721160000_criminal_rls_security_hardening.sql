-- =============================================================================
-- Criminal / civil section RLS security hardening
-- Local/Dev only until production deployment checklist is approved.
-- Does NOT delete data. Fails safely on unclassifiable NULL case_type rows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) Precondition: refuse ambiguous NULL case_type on debtors/profiles
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  n bigint;
BEGIN
  SELECT COUNT(*) INTO n FROM public.debtors WHERE case_type IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION
      'preflight: % debtors have NULL case_type — classify safely before RLS hardening', n;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'case_type'
  ) THEN
    SELECT COUNT(*) INTO n FROM public.profiles WHERE case_type IS NULL;
    IF n > 0 THEN
      -- Default only when role is not lawyer (lawyers need explicit section)
      UPDATE public.profiles
      SET case_type = 'civil'
      WHERE case_type IS NULL AND role IS DISTINCT FROM 'lawyer';

      SELECT COUNT(*) INTO n FROM public.profiles WHERE case_type IS NULL AND role = 'lawyer';
      IF n > 0 THEN
        RAISE EXCEPTION
          'preflight: % lawyer profiles have NULL case_type — set explicitly before continuing', n;
      END IF;
    END IF;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1) Central helpers (profiles table is source of truth — not JWT claims)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_profile_case_type()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT case_type::text FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_access_case_type(target_case_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN target_case_type IS NULL OR target_case_type NOT IN ('civil', 'criminal') THEN false
    WHEN public.current_app_role() IN ('admin', 'accountant', 'employee', 'payment_follow_up') THEN true
    WHEN public.current_app_role() = 'viewer' THEN target_case_type = 'civil'
    WHEN public.current_app_role() = 'criminal_legal_manager' THEN target_case_type = 'criminal'
    WHEN public.current_app_role() = 'lawyer' THEN
      COALESCE(public.current_profile_case_type(), 'civil') = target_case_type
    WHEN public.current_app_role() = 'delegate' THEN target_case_type = 'civil'
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_access_branch(target_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND COALESCE(p.is_active, true)
      AND (
        p.role IN ('admin', 'employee', 'viewer', 'criminal_legal_manager', 'payment_follow_up', 'delegate')
        OR (
          p.role = 'accountant'
          AND (
            public.is_general_accountant_profile(p.id)
            OR target_branch_id IS NULL
            OR p.branch_id = target_branch_id
          )
        )
        OR (
          p.role = 'lawyer'
          AND (
            -- general lawyer / same branch (existing conventions)
            p.branch_id IS NULL
            OR target_branch_id IS NULL
            OR p.branch_id = target_branch_id
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_access_debtor(p_debtor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.debtors d
    WHERE d.id = p_debtor_id
      AND public.current_user_can_access_case_type(COALESCE(d.case_type, 'civil'))
      AND public.current_user_can_access_branch(d.branch_id)
      AND (
        public.current_app_role() IN (
          'admin', 'accountant', 'employee', 'viewer',
          'criminal_legal_manager', 'payment_follow_up'
        )
        OR (
          public.current_app_role() = 'lawyer'
          AND EXISTS (
            SELECT 1 FROM public.tasks t
            WHERE t.debtor_id = d.id AND t.assigned_to = auth.uid()
          )
        )
        OR (
          public.current_app_role() = 'delegate'
          AND EXISTS (
            SELECT 1 FROM public.tasks t
            WHERE t.debtor_id = d.id AND t.assigned_to = auth.uid()
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_access_task(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    LEFT JOIN public.debtors d ON d.id = t.debtor_id
    WHERE t.id = p_task_id
      AND public.current_user_can_access_case_type(COALESCE(d.case_type, 'civil'))
      AND public.current_user_can_access_branch(COALESCE(t.branch_id, d.branch_id))
      AND (
        public.current_app_role() IN (
          'admin', 'accountant', 'employee', 'viewer', 'criminal_legal_manager'
        )
        OR (
          public.current_app_role() = 'payment_follow_up'
          AND d.case_status = 'payment_in_progress'
        )
        OR (
          public.current_app_role() IN ('lawyer', 'delegate')
          AND t.assigned_to = auth.uid()
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_access_lawyer(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles lp
    WHERE lp.id = p_profile_id
      AND lp.role = 'lawyer'
      AND public.current_user_can_access_case_type(COALESCE(lp.case_type, 'civil'))
      AND (
        public.current_app_role() IN (
          'admin', 'accountant', 'employee', 'viewer', 'criminal_legal_manager'
        )
        OR auth.uid() = p_profile_id
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.storage_debtor_id_from_path(object_name text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parts text[];
  candidate text;
BEGIN
  IF object_name IS NULL OR length(object_name) > 512 THEN
    RETURN NULL;
  END IF;
  -- Reject traversal / absolute / query fragments
  IF object_name ~* '(^|/)\.\.(/|$)' OR object_name ~ '[?#\\]' THEN
    RETURN NULL;
  END IF;

  parts := string_to_array(object_name, '/');

  -- criminal/documents/{debtorId}/{file}
  -- criminal/petitions/{debtorId}/{file}
  IF array_length(parts, 1) >= 4
     AND parts[1] = 'criminal'
     AND parts[2] IN ('documents', 'petitions') THEN
    candidate := parts[3];
  -- legacy / civil paths: {branchOrFolder}/{debtorId}/...
  ELSIF array_length(parts, 1) >= 2 THEN
    -- Prefer UUID-looking segment
    FOR i IN 1 .. array_length(parts, 1) LOOP
      IF parts[i] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        candidate := parts[i];
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF candidate IS NULL THEN
    RETURN NULL;
  END IF;
  IF candidate !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN candidate::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_access_storage_object(bucket text, object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN bucket IS DISTINCT FROM 'debtor-files' THEN false
    WHEN public.storage_debtor_id_from_path(object_name) IS NULL THEN false
    WHEN object_name LIKE 'criminal/%'
         AND NOT public.current_user_can_access_case_type('criminal') THEN false
    ELSE public.current_user_can_access_debtor(public.storage_debtor_id_from_path(object_name))
  END
$$;

-- Keep legacy staff helpers in sync (include criminal_legal_manager)
CREATE OR REPLACE FUNCTION public.is_staff_write_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_app_role(), '') IN (
    'admin', 'employee', 'accountant', 'criminal_legal_manager'
  )
$$;

CREATE OR REPLACE FUNCTION public.staff_can_write_branch(target_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.role IN ('admin', 'employee', 'criminal_legal_manager')
        OR (
          p.role = 'accountant'
          AND (
            public.is_general_accountant_profile(p.id)
            OR p.branch_id = target_branch_id
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.staff_can_read_branch(target_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.role IN ('admin', 'employee', 'viewer', 'criminal_legal_manager')
        OR (
          p.role = 'accountant'
          AND (
            public.is_general_accountant_profile(p.id)
            OR p.branch_id = target_branch_id
          )
        )
      )
  )
$$;

GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_profile_case_type() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_can_access_case_type(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_can_access_branch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_can_access_debtor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_can_access_task(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_can_access_lawyer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.storage_debtor_id_from_path(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_can_access_storage_object(text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2) Triggers: immutable debtor.case_type, criminal branch_list null, reward=0
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_debtor_case_type_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.case_type IS DISTINCT FROM OLD.case_type THEN
    RAISE EXCEPTION 'debtors.case_type is immutable after create';
  END IF;
  IF NEW.case_type = 'criminal' AND NEW.branch_list_id IS NOT NULL THEN
    RAISE EXCEPTION 'criminal debtors must have branch_list_id IS NULL';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_debtor_case_type_immutable ON public.debtors;
CREATE TRIGGER trg_enforce_debtor_case_type_immutable
  BEFORE INSERT OR UPDATE ON public.debtors
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_debtor_case_type_immutable();

-- Lawyer profiles.case_type lock after insert
-- Future cross-section lawyer moves need a dedicated migration/workflow
-- (reassign tasks, wallets, payouts) — do not unlock via ordinary UPDATE.
CREATE OR REPLACE FUNCTION public.enforce_lawyer_case_type_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.role = 'lawyer'
     AND OLD.role = 'lawyer'
     AND NEW.case_type IS DISTINCT FROM OLD.case_type THEN
    RAISE EXCEPTION 'profiles.case_type for lawyers is immutable after create';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_lawyer_case_type_immutable ON public.profiles;
CREATE TRIGGER trg_enforce_lawyer_case_type_immutable
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_lawyer_case_type_immutable();

-- Criminal tasks: reward_amount must be 0 on insert/update
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

  IF COALESCE(d_case, def_case, 'civil') = 'criminal' THEN
    IF COALESCE(NEW.reward_amount, 0) <> 0 THEN
      RAISE EXCEPTION 'criminal task reward_amount must be 0';
    END IF;
    NEW.reward_amount := 0;
  END IF;

  -- Cross-section assignment guard
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

  -- Prevent changing debtor to another section
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

DROP TRIGGER IF EXISTS trg_enforce_criminal_task_reward_zero ON public.tasks;
CREATE TRIGGER trg_enforce_criminal_task_reward_zero
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_criminal_task_reward_zero();

-- Prevent rebinding criminal_debtor_details.debtor_id
CREATE OR REPLACE FUNCTION public.enforce_criminal_details_debtor_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.debtor_id IS DISTINCT FROM OLD.debtor_id THEN
    RAISE EXCEPTION 'criminal_debtor_details.debtor_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_criminal_details_debtor_immutable ON public.criminal_debtor_details;
CREATE TRIGGER trg_enforce_criminal_details_debtor_immutable
  BEFORE UPDATE ON public.criminal_debtor_details
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_criminal_details_debtor_immutable();

-- CHECK: criminal debtors branch_list_id null (additive; may fail if bad data)
DO $$
BEGIN
  ALTER TABLE public.debtors
    ADD CONSTRAINT debtors_criminal_branch_list_null_check
    CHECK (case_type IS DISTINCT FROM 'criminal' OR branch_list_id IS NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN check_violation THEN
    RAISE EXCEPTION 'cannot add debtors_criminal_branch_list_null_check: existing criminal rows have branch_list_id';
END $$;

-- -----------------------------------------------------------------------------
-- 3) RLS: debtors — case + branch aware (drop overly-broad viewer_select_all)
-- -----------------------------------------------------------------------------

ALTER TABLE public.debtors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS viewer_select_all ON public.debtors;
DROP POLICY IF EXISTS staff_debtors_select ON public.debtors;
DROP POLICY IF EXISTS staff_debtors_insert ON public.debtors;
DROP POLICY IF EXISTS staff_debtors_update ON public.debtors;
DROP POLICY IF EXISTS section_debtors_select ON public.debtors;
DROP POLICY IF EXISTS section_debtors_insert ON public.debtors;
DROP POLICY IF EXISTS section_debtors_update ON public.debtors;
DROP POLICY IF EXISTS section_debtors_delete ON public.debtors;

CREATE POLICY section_debtors_select ON public.debtors
  FOR SELECT TO authenticated
  USING (
    public.current_user_can_access_case_type(COALESCE(case_type, 'civil'))
    AND public.current_user_can_access_branch(branch_id)
    AND (
      public.current_app_role() IN (
        'admin', 'accountant', 'employee', 'viewer', 'criminal_legal_manager'
      )
      OR (
        public.current_app_role() = 'payment_follow_up'
        AND case_status = 'payment_in_progress'
      )
      OR (
        public.current_app_role() IN ('lawyer', 'delegate')
        AND EXISTS (
          SELECT 1 FROM public.tasks t
          WHERE t.debtor_id = debtors.id AND t.assigned_to = auth.uid()
        )
      )
    )
  );

CREATE POLICY section_debtors_insert ON public.debtors
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_can_access_case_type(COALESCE(case_type, 'civil'))
    AND (case_type IS DISTINCT FROM 'criminal' OR branch_list_id IS NULL)
    AND (
      (
        public.current_app_role() = 'viewer'
        AND COALESCE(case_type, 'civil') = 'civil'
        AND public.current_user_can_access_branch(branch_id)
      )
      OR (
        public.current_app_role() = 'criminal_legal_manager'
        AND case_type = 'criminal'
        AND public.staff_can_write_branch(branch_id)
      )
      OR (
        public.current_app_role() IN ('admin', 'accountant', 'employee')
        AND public.staff_can_write_branch(branch_id)
      )
    )
  );

CREATE POLICY section_debtors_update ON public.debtors
  FOR UPDATE TO authenticated
  USING (
    public.current_user_can_access_case_type(COALESCE(case_type, 'civil'))
    AND (
      (
        public.current_app_role() = 'viewer'
        AND COALESCE(case_type, 'civil') = 'civil'
        AND public.current_user_can_access_branch(branch_id)
      )
      OR (
        public.current_app_role() IN ('admin', 'accountant', 'employee', 'criminal_legal_manager')
        AND public.staff_can_write_branch(branch_id)
      )
      OR (
        public.current_app_role() = 'payment_follow_up'
        AND case_status = 'payment_in_progress'
      )
    )
  )
  WITH CHECK (
    public.current_user_can_access_case_type(COALESCE(case_type, 'civil'))
    AND (case_type IS DISTINCT FROM 'criminal' OR branch_list_id IS NULL)
    AND (
      (
        public.current_app_role() = 'viewer'
        AND COALESCE(case_type, 'civil') = 'civil'
        AND public.current_user_can_access_branch(branch_id)
      )
      OR (
        public.current_app_role() IN ('admin', 'accountant', 'employee', 'criminal_legal_manager')
        AND public.staff_can_write_branch(branch_id)
      )
      OR (
        public.current_app_role() = 'payment_follow_up'
        AND case_status = 'payment_in_progress'
      )
    )
  );

-- No broad DELETE for authenticated — use service-role after API auth only
DROP POLICY IF EXISTS section_debtors_delete ON public.debtors;
DROP POLICY IF EXISTS staff_debtors_delete ON public.debtors;

-- -----------------------------------------------------------------------------
-- 4) criminal_debtor_details
-- -----------------------------------------------------------------------------

ALTER TABLE public.criminal_debtor_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS criminal_details_select ON public.criminal_debtor_details;
DROP POLICY IF EXISTS criminal_details_insert ON public.criminal_debtor_details;
DROP POLICY IF EXISTS criminal_details_update ON public.criminal_debtor_details;
DROP POLICY IF EXISTS criminal_details_delete ON public.criminal_debtor_details;

CREATE POLICY criminal_details_select ON public.criminal_debtor_details
  FOR SELECT TO authenticated
  USING (public.current_user_can_access_debtor(debtor_id));

CREATE POLICY criminal_details_insert ON public.criminal_debtor_details
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_can_access_debtor(debtor_id)
    AND public.is_staff_write_role()
    AND EXISTS (
      SELECT 1 FROM public.debtors d
      WHERE d.id = debtor_id AND d.case_type = 'criminal'
    )
  );

CREATE POLICY criminal_details_update ON public.criminal_debtor_details
  FOR UPDATE TO authenticated
  USING (
    public.current_user_can_access_debtor(debtor_id)
    AND public.is_staff_write_role()
  )
  WITH CHECK (
    public.current_user_can_access_debtor(debtor_id)
    AND EXISTS (
      SELECT 1 FROM public.debtors d
      WHERE d.id = debtor_id AND d.case_type = 'criminal'
    )
  );

CREATE POLICY criminal_details_delete ON public.criminal_debtor_details
  FOR DELETE TO authenticated
  USING (
    public.current_user_can_access_debtor(debtor_id)
    AND public.current_app_role() IN ('admin', 'criminal_legal_manager')
  );

-- -----------------------------------------------------------------------------
-- 5) tasks + payments + related — tighten viewer_select_all with case filter
-- -----------------------------------------------------------------------------

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS viewer_select_all ON public.tasks;
DROP POLICY IF EXISTS staff_tasks_select ON public.tasks;
DROP POLICY IF EXISTS section_tasks_select ON public.tasks;

CREATE POLICY section_tasks_select ON public.tasks
  FOR SELECT TO authenticated
  USING (public.current_user_can_access_task(id));

ALTER TABLE public.debtor_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS viewer_select_all ON public.debtor_payments;
DROP POLICY IF EXISTS section_payments_select ON public.debtor_payments;
DROP POLICY IF EXISTS section_payments_insert ON public.debtor_payments;
DROP POLICY IF EXISTS section_payments_update ON public.debtor_payments;
DROP POLICY IF EXISTS section_payments_delete ON public.debtor_payments;

CREATE POLICY section_payments_select ON public.debtor_payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.debtors d
      WHERE d.id = debtor_payments.debtor_id
        AND public.current_user_can_access_case_type(COALESCE(d.case_type, 'civil'))
        AND public.current_user_can_access_branch(COALESCE(debtor_payments.branch_id, d.branch_id))
        AND (
          public.current_app_role() IN (
            'admin', 'accountant', 'employee', 'viewer', 'criminal_legal_manager'
          )
          OR (
            public.current_app_role() = 'payment_follow_up'
            AND d.case_status = 'payment_in_progress'
          )
        )
    )
  );

CREATE POLICY section_payments_insert ON public.debtor_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.debtors d
      WHERE d.id = debtor_id
        AND public.current_user_can_access_case_type(COALESCE(d.case_type, 'civil'))
        AND public.staff_can_write_branch(COALESCE(branch_id, d.branch_id))
        AND public.current_app_role() IN (
          'admin', 'accountant', 'employee', 'payment_follow_up'
        )
    )
  );

CREATE POLICY section_payments_update ON public.debtor_payments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.debtors d
      WHERE d.id = debtor_payments.debtor_id
        AND public.current_user_can_access_case_type(COALESCE(d.case_type, 'civil'))
        AND public.staff_can_write_branch(COALESCE(debtor_payments.branch_id, d.branch_id))
        AND public.current_app_role() IN ('admin', 'accountant')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.debtors d
      WHERE d.id = debtor_id
        AND public.current_user_can_access_case_type(COALESCE(d.case_type, 'civil'))
        AND public.staff_can_write_branch(COALESCE(branch_id, d.branch_id))
        AND public.current_app_role() IN ('admin', 'accountant')
    )
  );

CREATE POLICY section_payments_delete ON public.debtor_payments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.debtors d
      WHERE d.id = debtor_payments.debtor_id
        AND public.current_user_can_access_case_type(COALESCE(d.case_type, 'civil'))
        AND public.staff_can_write_branch(COALESCE(debtor_payments.branch_id, d.branch_id))
        AND public.current_app_role() IN ('admin', 'accountant')
    )
  );

-- Profiles: self always; staff see non-lawyers; lawyer rows are section-scoped
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS viewer_select_all ON public.profiles;
DROP POLICY IF EXISTS section_profiles_select_lawyers ON public.profiles;
DROP POLICY IF EXISTS section_profiles_select ON public.profiles;

CREATE POLICY section_profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (
      role IS DISTINCT FROM 'lawyer'
      AND public.current_app_role() IN (
        'admin', 'accountant', 'employee', 'viewer',
        'criminal_legal_manager', 'payment_follow_up', 'delegate'
      )
    )
    OR (
      role = 'lawyer'
      AND public.current_user_can_access_case_type(COALESCE(case_type, 'civil'))
      AND public.current_app_role() IN (
        'admin', 'accountant', 'employee', 'viewer', 'criminal_legal_manager'
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 6) criminal_import_runs policies
-- -----------------------------------------------------------------------------

ALTER TABLE public.criminal_import_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS criminal_import_runs_select ON public.criminal_import_runs;
DROP POLICY IF EXISTS criminal_import_runs_insert ON public.criminal_import_runs;
DROP POLICY IF EXISTS criminal_import_runs_update ON public.criminal_import_runs;
DROP POLICY IF EXISTS criminal_import_runs_delete ON public.criminal_import_runs;

CREATE POLICY criminal_import_runs_select ON public.criminal_import_runs
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_app_role() = 'admin'
  );

CREATE POLICY criminal_import_runs_insert ON public.criminal_import_runs
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.current_app_role() IN ('admin', 'accountant', 'criminal_legal_manager')
  );

-- Completed runs are immutable for clients
CREATE POLICY criminal_import_runs_update ON public.criminal_import_runs
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND status IS DISTINCT FROM 'completed'
    AND public.current_app_role() IN ('admin', 'accountant', 'criminal_legal_manager')
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.current_app_role() IN ('admin', 'accountant', 'criminal_legal_manager')
  );

-- No DELETE for authenticated

-- -----------------------------------------------------------------------------
-- 7) activity_logs — insert-only for authenticated; section-filtered select
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'activity_logs'
  ) THEN
    EXECUTE 'ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS viewer_select_all ON public.activity_logs';
    EXECUTE 'DROP POLICY IF EXISTS section_activity_select ON public.activity_logs';
    EXECUTE 'DROP POLICY IF EXISTS section_activity_insert ON public.activity_logs';
    EXECUTE 'DROP POLICY IF EXISTS section_activity_update ON public.activity_logs';
    EXECUTE 'DROP POLICY IF EXISTS section_activity_delete ON public.activity_logs';

    EXECUTE $p$
      CREATE POLICY section_activity_select ON public.activity_logs
        FOR SELECT TO authenticated
        USING (
          public.current_app_role() = 'admin'
          OR (
            COALESCE((new_data->>'case_type'), 'civil') IN ('civil', 'criminal')
            AND public.current_user_can_access_case_type(
              COALESCE((new_data->>'case_type'), 'civil')
            )
          )
        )
    $p$;

    EXECUTE $p$
      CREATE POLICY section_activity_insert ON public.activity_logs
        FOR INSERT TO authenticated
        WITH CHECK (auth.uid() IS NOT NULL)
    $p$;
    -- No UPDATE/DELETE policies for authenticated
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 8) Storage policies for debtor-files (path + debtor scope)
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS debtor_files_insert_staff ON storage.objects;
DROP POLICY IF EXISTS debtor_files_select_staff ON storage.objects;
DROP POLICY IF EXISTS debtor_files_delete_staff ON storage.objects;
DROP POLICY IF EXISTS viewer_read_debtor_files ON storage.objects;
DROP POLICY IF EXISTS section_debtor_files_select ON storage.objects;
DROP POLICY IF EXISTS section_debtor_files_insert ON storage.objects;
DROP POLICY IF EXISTS section_debtor_files_update ON storage.objects;
DROP POLICY IF EXISTS section_debtor_files_delete ON storage.objects;

CREATE POLICY section_debtor_files_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'debtor-files'
    AND public.current_user_can_access_storage_object(bucket_id, name)
  );

CREATE POLICY section_debtor_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'debtor-files'
    AND public.is_staff_write_role()
    AND public.current_user_can_access_storage_object(bucket_id, name)
    AND (
      name !~* '^criminal/'
      OR (
        name ~* '^criminal/(documents|petitions)/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f-]{36}\.pdf$'
        AND public.current_user_can_access_case_type('criminal')
      )
    )
  );

-- Prefer insert/delete over update for path safety
CREATE POLICY section_debtor_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'debtor-files'
    AND public.current_app_role() IN ('admin', 'employee', 'criminal_legal_manager')
    AND public.current_user_can_access_storage_object(bucket_id, name)
  );

-- -----------------------------------------------------------------------------
-- 9) Grants note: helpers already granted; revoke dangerous public EXECUTE noise
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.storage_debtor_id_from_path(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_debtor_id_from_path(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
