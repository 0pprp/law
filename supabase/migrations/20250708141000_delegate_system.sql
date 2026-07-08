-- نظام المندوبين: جداول المحفظة + حقول مهمة إيجاد عنوان + RLS بسيط

-- حالة تبليغ المدين على المهمة
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS debtor_notified text NOT NULL DEFAULT 'unset';

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_debtor_notified_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_debtor_notified_check
  CHECK (debtor_notified IN ('unset', 'yes', 'no'));

COMMENT ON COLUMN public.tasks.debtor_notified IS
  'هل تم تبليغ المدين؟ unset=لم يحدد، yes، no — يغيّره المدير/مسؤول القانونية فقط';

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS delegate_fee_status text NOT NULL DEFAULT 'none';

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_delegate_fee_status_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_delegate_fee_status_check
  CHECK (delegate_fee_status IN ('none', 'pending', 'available', 'withdrawn'));

COMMENT ON COLUMN public.tasks.delegate_fee_status IS
  'حالة أتعاب المندوب: none | pending | available | withdrawn';

CREATE TABLE IF NOT EXISTS public.delegate_wallets (
  delegate_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  pending_balance numeric NOT NULL DEFAULT 0,
  available_balance numeric NOT NULL DEFAULT 0,
  total_withdrawn numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delegate_wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delegate_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  amount numeric NOT NULL,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delegate_wallet_transactions_type_check CHECK (
    type IN (
      'delegate_address_fee_pending',
      'delegate_fee_released',
      'delegate_fee_rehold',
      'delegate_wallet_withdrawal'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_delegate_wallet_tx_delegate
  ON public.delegate_wallet_transactions (delegate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delegate_wallet_tx_task
  ON public.delegate_wallet_transactions (task_id)
  WHERE task_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_delegate_fee_pending_once
  ON public.delegate_wallet_transactions (task_id)
  WHERE type = 'delegate_address_fee_pending' AND task_id IS NOT NULL;

-- بذرة: أضف «صورة» إلزامية لمهام إيجاد العنوان (كل الفروع)
UPDATE public.task_required_fields rf
SET is_required = true, field_label = COALESCE(NULLIF(trim(rf.field_label), ''), 'صورة')
FROM public.task_definitions d
WHERE rf.task_definition_id = d.id
  AND d.is_active = true
  AND (
    d.task_type::text IN ('find_address', 'find_missing_address')
    OR d.label ILIKE '%إيجاد عنوان%'
  )
  AND (rf.field_key = 'address_photo' OR rf.field_type = 'image');

INSERT INTO public.task_required_fields (task_definition_id, field_key, field_type, field_label, is_required, sort_order)
SELECT d.id, 'address_photo', 'image', 'صورة', true,
  COALESCE((
    SELECT MAX(rf.sort_order) + 1 FROM public.task_required_fields rf WHERE rf.task_definition_id = d.id
  ), 1)
FROM public.task_definitions d
WHERE d.is_active = true
  AND (
    d.task_type::text IN ('find_address', 'find_missing_address')
    OR d.label ILIKE '%إيجاد عنوان%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.task_required_fields rf
    WHERE rf.task_definition_id = d.id
      AND (rf.field_key = 'address_photo' OR rf.field_type = 'image')
  );

-- لا أتعاب صرفيات تلقائية لهذه المهمة — لا نلمس expense maps

CREATE OR REPLACE FUNCTION public.is_delegate_role(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id AND p.role = 'delegate'
  )
$$;

ALTER TABLE public.delegate_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delegate_wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delegate_wallets_select ON public.delegate_wallets;
CREATE POLICY delegate_wallets_select ON public.delegate_wallets
  FOR SELECT TO authenticated
  USING (
    delegate_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'employee', 'viewer')
    )
  );

DROP POLICY IF EXISTS delegate_wallet_tx_select ON public.delegate_wallet_transactions;
CREATE POLICY delegate_wallet_tx_select ON public.delegate_wallet_transactions
  FOR SELECT TO authenticated
  USING (
    delegate_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'employee', 'viewer')
    )
  );

-- المندوب يرى المهام المكلّف بها فقط (إضافة سياسة موازية دون حذف سياسات المحامي)
DROP POLICY IF EXISTS delegate_tasks_select_assigned ON public.tasks;
CREATE POLICY delegate_tasks_select_assigned ON public.tasks
  FOR SELECT TO authenticated
  USING (
    public.is_delegate_role()
    AND assigned_to = auth.uid()
  );

DROP POLICY IF EXISTS delegate_tasks_update_assigned ON public.tasks;
CREATE POLICY delegate_tasks_update_assigned ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    public.is_delegate_role()
    AND assigned_to = auth.uid()
  )
  WITH CHECK (
    public.is_delegate_role()
    AND assigned_to = auth.uid()
  );

NOTIFY pgrst, 'reload schema';
