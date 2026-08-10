-- RLS إضافي للمحاسب الرئيسي على الملاحظات (للواجهة عبر العميل)
-- شغّل يدوياً بعد هجرة chief_accountant الأساسية.
-- لا يُنفَّذ تلقائياً من التطبيق.

DROP POLICY IF EXISTS chief_accountant_debtor_notes_select ON public.debtor_notes;
CREATE POLICY chief_accountant_debtor_notes_select ON public.debtor_notes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.debtors d
      WHERE d.id = debtor_notes.debtor_id
        AND d.assigned_chief_accountant_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.role = 'chief_accountant'
            AND COALESCE(p.is_active, true)
        )
    )
  );

DROP POLICY IF EXISTS chief_accountant_debtor_notes_insert ON public.debtor_notes;
CREATE POLICY chief_accountant_debtor_notes_insert ON public.debtor_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.debtors d
      WHERE d.id = debtor_id
        AND d.assigned_chief_accountant_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.role = 'chief_accountant'
            AND COALESCE(p.is_active, true)
        )
    )
  );

DROP POLICY IF EXISTS chief_accountant_debtor_attachments_select ON public.debtor_attachments;
CREATE POLICY chief_accountant_debtor_attachments_select ON public.debtor_attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.debtors d
      WHERE d.id = debtor_attachments.debtor_id
        AND d.assigned_chief_accountant_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.role = 'chief_accountant'
            AND COALESCE(p.is_active, true)
        )
    )
  );

NOTIFY pgrst, 'reload schema';
