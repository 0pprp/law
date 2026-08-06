-- محفظة القرطاسية: رصيد فايلات + طوابع لكل محامٍ
-- يُخصم تلقائياً عند الاعتماد النهائي لإنجاز إقامة دعوى

CREATE TABLE IF NOT EXISTS public.lawyer_stationery_wallets (
  lawyer_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  files_balance integer NOT NULL DEFAULT 0 CHECK (files_balance >= 0),
  stamps_balance integer NOT NULL DEFAULT 0 CHECK (stamps_balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lawyer_stationery_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lawyer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item text NOT NULL CHECK (item IN ('files', 'stamps')),
  amount integer NOT NULL,
  type text NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'lawsuit_deduction')),
  notes text,
  reference_id uuid,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lawyer_stationery_tx_lawyer_created_idx
  ON public.lawyer_stationery_transactions (lawyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS lawyer_stationery_tx_reference_idx
  ON public.lawyer_stationery_transactions (reference_id)
  WHERE reference_id IS NOT NULL;

ALTER TABLE public.lawyer_stationery_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lawyer_stationery_transactions ENABLE ROW LEVEL SECURITY;

-- المحامي يرى محفظته فقط
DROP POLICY IF EXISTS lawyer_stationery_wallet_select_own ON public.lawyer_stationery_wallets;
CREATE POLICY lawyer_stationery_wallet_select_own ON public.lawyer_stationery_wallets
  FOR SELECT TO authenticated
  USING (lawyer_id = auth.uid());

DROP POLICY IF EXISTS lawyer_stationery_tx_select_own ON public.lawyer_stationery_transactions;
CREATE POLICY lawyer_stationery_tx_select_own ON public.lawyer_stationery_transactions
  FOR SELECT TO authenticated
  USING (lawyer_id = auth.uid());

-- طاقم الإدارة: قراءة/كتابة ضمن نطاق محفظة المحامي (نفس منطق محفظة الصرفيات)
DROP POLICY IF EXISTS staff_stationery_wallet_select ON public.lawyer_stationery_wallets;
CREATE POLICY staff_stationery_wallet_select ON public.lawyer_stationery_wallets
  FOR SELECT TO authenticated
  USING (public.can_access_lawyer_wallet_profile(lawyer_id));

DROP POLICY IF EXISTS staff_stationery_wallet_insert ON public.lawyer_stationery_wallets;
CREATE POLICY staff_stationery_wallet_insert ON public.lawyer_stationery_wallets
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_lawyer_wallet_profile(lawyer_id)
    AND NOT public.is_viewer_role()
  );

DROP POLICY IF EXISTS staff_stationery_wallet_update ON public.lawyer_stationery_wallets;
CREATE POLICY staff_stationery_wallet_update ON public.lawyer_stationery_wallets
  FOR UPDATE TO authenticated
  USING (
    public.can_access_lawyer_wallet_profile(lawyer_id)
    AND NOT public.is_viewer_role()
  )
  WITH CHECK (
    public.can_access_lawyer_wallet_profile(lawyer_id)
    AND NOT public.is_viewer_role()
  );

DROP POLICY IF EXISTS staff_stationery_tx_select ON public.lawyer_stationery_transactions;
CREATE POLICY staff_stationery_tx_select ON public.lawyer_stationery_transactions
  FOR SELECT TO authenticated
  USING (public.can_access_lawyer_wallet_profile(lawyer_id));

DROP POLICY IF EXISTS staff_stationery_tx_insert ON public.lawyer_stationery_transactions;
CREATE POLICY staff_stationery_tx_insert ON public.lawyer_stationery_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_lawyer_wallet_profile(lawyer_id)
    AND NOT public.is_viewer_role()
  );

NOTIFY pgrst, 'reload schema';