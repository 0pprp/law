-- طلبات عدم الالتزام (جاري التسديد → إعادة آخر مهمة غير مكلفة)
-- آمن وقابل لإعادة التشغيل
-- Rollback (يدوي):
--   DROP FUNCTION IF EXISTS public.approve_payment_noncompliance_request(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.reject_payment_noncompliance_request(uuid, uuid, text);
--   DROP TABLE IF EXISTS public.payment_noncompliance_requests;

CREATE TABLE IF NOT EXISTS public.payment_noncompliance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debtor_id uuid NOT NULL REFERENCES public.debtors(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  source_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  note text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  rejection_reason text,
  created_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_noncompliance_one_pending
  ON public.payment_noncompliance_requests (debtor_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_payment_noncompliance_status_created
  ON public.payment_noncompliance_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_noncompliance_branch_status
  ON public.payment_noncompliance_requests (branch_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_noncompliance_requested_by
  ON public.payment_noncompliance_requests (requested_by, created_at DESC);

COMMENT ON TABLE public.payment_noncompliance_requests IS
  'طلبات عدم الالتزام من مسؤول متابعة التسديد — موافقة المدير/مسؤول القانونية تعيد آخر مهمة غير مكلفة';

ALTER TABLE public.payment_noncompliance_requests ENABLE ROW LEVEL SECURITY;

-- ——— RLS ———

DROP POLICY IF EXISTS payment_noncompliance_pfu_select ON public.payment_noncompliance_requests;
CREATE POLICY payment_noncompliance_pfu_select ON public.payment_noncompliance_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'payment_follow_up'
        AND COALESCE(p.is_active, true)
        AND payment_noncompliance_requests.requested_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS payment_noncompliance_pfu_insert ON public.payment_noncompliance_requests;
CREATE POLICY payment_noncompliance_pfu_insert ON public.payment_noncompliance_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'payment_follow_up'
        AND COALESCE(p.is_active, true)
    )
    AND EXISTS (
      SELECT 1 FROM public.debtors d
      WHERE d.id = debtor_id
        AND d.case_status = 'payment_in_progress'
    )
  );

DROP POLICY IF EXISTS payment_noncompliance_admin_select ON public.payment_noncompliance_requests;
CREATE POLICY payment_noncompliance_admin_select ON public.payment_noncompliance_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'viewer')
        AND COALESCE(p.is_active, true)
    )
  );

-- ——— موافقة ذرّية: claim + استنساخ آخر مهمة غير مكلفة + إخراج المدين من جاري التسديد ———

CREATE OR REPLACE FUNCTION public.approve_payment_noncompliance_request(
  p_request_id uuid,
  p_reviewer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.payment_noncompliance_requests%ROWTYPE;
  v_debtor public.debtors%ROWTYPE;
  v_src public.tasks%ROWTYPE;
  v_new_task_id uuid;
  v_fee numeric := 0;
  v_task_type text;
  v_def_id uuid;
BEGIN
  -- Claim الطلب أولاً لمنع الموافقة المزدوجة
  UPDATE public.payment_noncompliance_requests
  SET status = 'approved',
      reviewed_by = p_reviewer_id,
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_request_id
    AND status = 'pending'
  RETURNING * INTO v_req;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.payment_noncompliance_requests WHERE id = p_request_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'تمت معالجة الطلب مسبقاً', 'code', 'already_processed');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'الطلب غير موجود', 'code', 'not_found');
  END IF;

  SELECT * INTO v_debtor
  FROM public.debtors
  WHERE id = v_req.debtor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.payment_noncompliance_requests
    SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
    WHERE id = p_request_id;
    RETURN jsonb_build_object('ok', false, 'error', 'المدين غير موجود', 'code', 'debtor_missing');
  END IF;

  IF v_debtor.case_status IS DISTINCT FROM 'payment_in_progress' THEN
    UPDATE public.payment_noncompliance_requests
    SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
    WHERE id = p_request_id;
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'المدين لم يعد في جاري التسديد',
      'code', 'not_in_payment'
    );
  END IF;

  IF v_debtor.last_task_id IS NULL AND v_req.source_task_id IS NULL THEN
    UPDATE public.payment_noncompliance_requests
    SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
    WHERE id = p_request_id;
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'لا توجد مهمة سابقة محفوظة لهذا المدين، راجع سجل المهام.',
      'code', 'no_last_task'
    );
  END IF;

  SELECT * INTO v_src
  FROM public.tasks
  WHERE id = COALESCE(v_req.source_task_id, v_debtor.last_task_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.payment_noncompliance_requests
    SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
    WHERE id = p_request_id;
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'المهمة السابقة محذوفة أو غير موجودة — لا يمكن إنشاء مهمة وهمية.',
      'code', 'source_task_missing'
    );
  END IF;

  IF v_src.debtor_id IS DISTINCT FROM v_debtor.id THEN
    UPDATE public.payment_noncompliance_requests
    SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
    WHERE id = p_request_id;
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'مرجع المهمة السابقة لا يخص هذا المدين',
      'code', 'task_debtor_mismatch'
    );
  END IF;

  v_def_id := v_src.task_definition_id;
  v_task_type := v_src.task_type::text;
  v_fee := COALESCE(v_src.reward_amount, 0);

  IF v_def_id IS NOT NULL THEN
    -- task_type قد يكون enum — نحوّله لنص قبل المقارنة
    SELECT COALESCE(fee_amount, v_fee), COALESCE(NULLIF(task_type::text, ''), v_task_type)
    INTO v_fee, v_task_type
    FROM public.task_definitions
    WHERE id = v_def_id;
  END IF;

  INSERT INTO public.tasks (
    debtor_id,
    task_definition_id,
    task_type,
    task_status,
    assigned_to,
    reward_amount,
    branch_id,
    created_by
  ) VALUES (
    v_debtor.id,
    v_def_id,
    v_task_type,
    'waiting_assignment',
    NULL,
    COALESCE(v_fee, 0),
    COALESCE(v_debtor.branch_id, v_src.branch_id),
    p_reviewer_id
  )
  RETURNING id INTO v_new_task_id;

  UPDATE public.debtors
  SET case_status = 'active',
      current_task_id = v_new_task_id,
      payment_type = NULL,
      payment_location = NULL,
      closed_at = NULL
  WHERE id = v_debtor.id;

  UPDATE public.payment_noncompliance_requests
  SET created_task_id = v_new_task_id,
      updated_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'debtor_id', v_debtor.id,
    'new_task_id', v_new_task_id,
    'source_task_id', v_src.id
  );
END;
$$;

-- ——— رفض ذرّي ———

CREATE OR REPLACE FUNCTION public.reject_payment_noncompliance_request(
  p_request_id uuid,
  p_reviewer_id uuid,
  p_rejection_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE public.payment_noncompliance_requests
  SET status = 'rejected',
      reviewed_by = p_reviewer_id,
      reviewed_at = now(),
      rejection_reason = NULLIF(trim(p_rejection_reason), ''),
      updated_at = now()
  WHERE id = p_request_id
    AND status = 'pending'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.payment_noncompliance_requests WHERE id = p_request_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'تمت معالجة الطلب مسبقاً', 'code', 'already_processed');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'الطلب غير موجود', 'code', 'not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'request_id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_payment_noncompliance_request(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_payment_noncompliance_request(uuid, uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
