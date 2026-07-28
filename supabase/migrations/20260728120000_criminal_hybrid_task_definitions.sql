-- ================================================================
-- Migration: criminal hybrid task definitions
-- is_hybrid + criminal_case_task_definition_links
-- ================================================================

ALTER TABLE criminal_case_task_definitions
  ADD COLUMN IF NOT EXISTS is_hybrid boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS criminal_case_task_definition_links (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_definition_id uuid NOT NULL
    REFERENCES criminal_case_task_definitions(id) ON DELETE CASCADE,
  linked_definition_id uuid NOT NULL
    REFERENCES criminal_case_task_definitions(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  is_optional boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_definition_id, linked_definition_id),
  CHECK (parent_definition_id <> linked_definition_id)
);

CREATE INDEX IF NOT EXISTS idx_cc_hybrid_links_parent
  ON criminal_case_task_definition_links (parent_definition_id, sort_order);

ALTER TABLE criminal_case_task_definition_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cc_hybrid_links_admin_select ON criminal_case_task_definition_links;
CREATE POLICY cc_hybrid_links_admin_select ON criminal_case_task_definition_links
  FOR SELECT TO authenticated USING (public.auth_profile_role() = 'admin');

DROP POLICY IF EXISTS cc_hybrid_links_admin_insert ON criminal_case_task_definition_links;
CREATE POLICY cc_hybrid_links_admin_insert ON criminal_case_task_definition_links
  FOR INSERT TO authenticated WITH CHECK (public.auth_profile_role() = 'admin');

DROP POLICY IF EXISTS cc_hybrid_links_admin_update ON criminal_case_task_definition_links;
CREATE POLICY cc_hybrid_links_admin_update ON criminal_case_task_definition_links
  FOR UPDATE TO authenticated
  USING (public.auth_profile_role() = 'admin')
  WITH CHECK (public.auth_profile_role() = 'admin');

DROP POLICY IF EXISTS cc_hybrid_links_admin_delete ON criminal_case_task_definition_links;
CREATE POLICY cc_hybrid_links_admin_delete ON criminal_case_task_definition_links
  FOR DELETE TO authenticated
  USING (public.auth_profile_role() = 'admin');
