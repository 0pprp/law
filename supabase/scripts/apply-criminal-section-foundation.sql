-- Foundation: criminal section roles + lawyer case_type + criminal_debtor_details
-- Idempotent — safe if objects already exist in the remote DB.
--
-- Note: Run ADD VALUE alone first if your Postgres rejects new enum use in same txn.
-- This file does not reference criminal_legal_manager in policies yet.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'criminal_legal_manager';

-- Lawyer / profile case section (civil | criminal). Existing rows → civil.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS case_type text NOT NULL DEFAULT 'civil';

DO $$ BEGIN
  ALTER TABLE profiles
    ADD CONSTRAINT profiles_case_type_check
    CHECK (case_type IN ('civil', 'criminal'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_role_case_type ON profiles (role, case_type);

-- Criminal debtor details (1:1). No-op if table already exists remotely.
CREATE TABLE IF NOT EXISTS criminal_debtor_details (
  debtor_id uuid PRIMARY KEY REFERENCES debtors(id) ON DELETE CASCADE,
  job_title text,
  current_address text,
  incident_date date,
  charge_type text,
  contract_guarantor_status text
    CHECK (contract_guarantor_status IS NULL OR contract_guarantor_status IN ('yes', 'no', 'contract_only')),
  first_witness_name text,
  second_witness_name text,
  documents_contract_file_path text,
  petition_file_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION set_criminal_debtor_details_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_criminal_debtor_details_updated_at ON criminal_debtor_details;
CREATE TRIGGER trg_criminal_debtor_details_updated_at
  BEFORE UPDATE ON criminal_debtor_details
  FOR EACH ROW EXECUTE FUNCTION set_criminal_debtor_details_updated_at();

CREATE OR REPLACE FUNCTION enforce_criminal_debtor_details_case_type()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  ct text;
BEGIN
  SELECT case_type INTO ct FROM debtors WHERE id = NEW.debtor_id;
  IF ct IS DISTINCT FROM 'criminal' THEN
    RAISE EXCEPTION 'criminal_debtor_details allowed only for debtors.case_type = criminal';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_criminal_debtor_details ON criminal_debtor_details;
CREATE TRIGGER trg_enforce_criminal_debtor_details
  BEFORE INSERT OR UPDATE ON criminal_debtor_details
  FOR EACH ROW EXECUTE FUNCTION enforce_criminal_debtor_details_case_type();

NOTIFY pgrst, 'reload schema';
