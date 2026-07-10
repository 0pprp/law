-- Atomic replace of task_required_fields for a definition.
-- Apply manually in Supabase SQL Editor — do NOT auto-run on production.
-- If insert fails, the whole transaction rolls back and old fields remain.

CREATE OR REPLACE FUNCTION public.replace_task_required_fields(
  p_definition_id uuid,
  p_fields jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_definition_id IS NULL THEN
    RAISE EXCEPTION 'task_definition_id required';
  END IF;

  DELETE FROM public.task_required_fields
  WHERE task_definition_id = p_definition_id;

  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'array' OR jsonb_array_length(p_fields) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.task_required_fields (
    task_definition_id,
    field_key,
    field_type,
    field_label,
    is_required,
    sort_order
  )
  SELECT
    p_definition_id,
    COALESCE(f->>'field_key', 'field_' || ord::text),
    COALESCE(f->>'field_type', 'text'),
    COALESCE(f->>'field_label', ''),
    COALESCE((f->>'is_required')::boolean, true),
    COALESCE((f->>'sort_order')::int, ord - 1)
  FROM jsonb_array_elements(p_fields) WITH ORDINALITY AS t(f, ord);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_task_required_fields(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_task_required_fields(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_task_required_fields(uuid, jsonb) TO service_role;
