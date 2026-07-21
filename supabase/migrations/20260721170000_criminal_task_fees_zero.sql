-- Criminal task fees must always be 0 (no lawyer fee on criminal section).
UPDATE public.task_definitions
SET fee_amount = 0
WHERE case_type = 'criminal'
  AND COALESCE(fee_amount, 0) <> 0;

COMMENT ON COLUMN public.task_definitions.fee_amount IS
  'Default task fee. Criminal definitions must remain 0.';
