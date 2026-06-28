-- Use task.reward_amount (snapshot at assignment) when crediting fees — not a later catalog price change.

CREATE OR REPLACE FUNCTION credit_task_completion_fee(
  p_task_id uuid,
  p_reviewer_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_fee numeric := 0;
  v_label text := 'مهمة';
  v_existing uuid;
  v_inserted boolean := false;
BEGIN
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'المهمة غير موجودة', 'amount', 0);
  END IF;

  IF v_task.task_status IN ('rejected', 'needs_revision', 'needs_info') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لا تُضاف أتعاب لمهمة مرفوضة', 'amount', 0);
  END IF;

  IF v_task.task_status NOT IN ('approved', 'completed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لا تُضاف الأتعاب إلا بعد اعتماد المهمة', 'amount', 0);
  END IF;

  SELECT id INTO v_existing
  FROM lawyer_wallet_transactions
  WHERE reference_id = p_task_id::text
    AND wallet = 'fees'
    AND amount > 0
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE tasks SET fee_status = 'released' WHERE id = p_task_id AND fee_status IS DISTINCT FROM 'released';
    RETURN jsonb_build_object('ok', true, 'amount', 0, 'already_credited', true);
  END IF;

  IF v_task.task_definition_id IS NOT NULL THEN
    SELECT COALESCE(fee_amount, 0), COALESCE(NULLIF(trim(label), ''), 'مهمة')
    INTO v_fee, v_label
    FROM task_definitions
    WHERE id = v_task.task_definition_id;
  END IF;

  IF COALESCE(v_task.reward_amount, 0) > 0 THEN
    v_fee := v_task.reward_amount;
  END IF;

  IF v_fee <= 0 OR v_task.assigned_to IS NULL THEN
    UPDATE tasks SET fee_status = 'released' WHERE id = p_task_id;
    RETURN jsonb_build_object('ok', true, 'amount', 0, 'already_credited', false);
  END IF;

  BEGIN
    INSERT INTO lawyer_wallet_transactions (
      lawyer_id,
      type,
      wallet,
      amount,
      notes,
      reference_id,
      created_by,
      debtor_id,
      task_definition_id,
      source
    ) VALUES (
      v_task.assigned_to,
      'approved_task_payment',
      'fees',
      v_fee,
      'إضافة أتعاب مهمة (' || v_label || ')',
      p_task_id::text,
      p_reviewer_id,
      v_task.debtor_id,
      v_task.task_definition_id,
      'task_completion'
    );
    v_inserted := true;
  EXCEPTION
    WHEN unique_violation THEN
      v_inserted := false;
  END;

  UPDATE tasks SET fee_status = 'released' WHERE id = p_task_id;

  RETURN jsonb_build_object(
    'ok', true,
    'amount', CASE WHEN v_inserted THEN v_fee ELSE 0 END,
    'already_credited', NOT v_inserted
  );
END;
$$;
