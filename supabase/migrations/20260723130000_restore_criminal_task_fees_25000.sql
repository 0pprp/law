-- Restore criminal task definition fees to 25,000 IQD.
-- Non-admin visibility remains zeroed in the application layer only.

UPDATE public.task_definitions
SET fee_amount = 25000
WHERE case_type = 'criminal'
  AND (
    task_type IN (
      'criminal_lawsuit_request',
      'police_station_statement',
      'court_statement',
      'witness_statement'
    )
    OR label IN (
      'تقديم طلب دعوى جزائية',
      'تدوين أقوال في مركز الشرطة',
      'تدوين أقوال في المحكمة',
      'تدوين أقوال الشهود'
    )
  );
