-- تطبيق يدوي: نوع ومكان التسديد (جاري التسديد)
-- آمن وقابل لإعادة التشغيل

ALTER TABLE debtors
  ADD COLUMN IF NOT EXISTS payment_type text;

ALTER TABLE debtors
  ADD COLUMN IF NOT EXISTS payment_location text;

DO $$ BEGIN
  ALTER TABLE debtors
    ADD CONSTRAINT debtors_payment_type_check
    CHECK (payment_type IS NULL OR payment_type IN ('daily', 'weekly', 'monthly'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE debtors
    ADD CONSTRAINT debtors_payment_location_check
    CHECK (payment_location IS NULL OR payment_location IN ('company', 'execution'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
