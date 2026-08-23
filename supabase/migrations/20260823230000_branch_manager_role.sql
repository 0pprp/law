-- دور «مدير الفرع» (branch_manager)
-- شغّل قبل 20260823230001_instant_case_nominations.sql إن لزم فصل enum عن الجدول

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'branch_manager';

NOTIFY pgrst, 'reload schema';
