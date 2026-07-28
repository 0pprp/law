-- مبلغ بذمة المدين الجزائي كنص حر (استيراد/عرض)
ALTER TABLE criminal_debtor_details
  ADD COLUMN IF NOT EXISTS amount_owed text;

NOTIFY pgrst, 'reload schema';
