-- Allow authenticated community members to read registered field data across
-- organizations while keeping write operations scoped by existing role/org
-- policies.

DROP POLICY IF EXISTS fields_select_own_org ON public.fields;
CREATE POLICY fields_select_authenticated
ON public.fields
FOR SELECT
USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS fsp_select_own_org ON public.field_source_polygons;
CREATE POLICY fsp_select_authenticated
ON public.field_source_polygons
FOR SELECT
USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS field_points_select_own_org ON public.field_points;
CREATE POLICY field_points_select_authenticated
ON public.field_points
FOR SELECT
USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS fwr_select_own_org ON public.field_work_records;
CREATE POLICY fwr_select_authenticated
ON public.field_work_records
FOR SELECT
USING (auth.role() = 'authenticated');

CREATE OR REPLACE FUNCTION public.get_field_ids_by_work_type(
  p_work_type_id uuid,
  p_share_token text DEFAULT NULL
)
RETURNS TABLE(field_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org_id uuid;
  v_token_hash text;
BEGIN
  IF auth.uid() IS NULL THEN
    IF p_share_token IS NULL THEN
      RAISE EXCEPTION 'UNAUTHORIZED: anonymous access requires a share token.';
    END IF;

    v_token_hash := encode(sha256(p_share_token::bytea), 'hex');

    SELECT organization_id INTO v_org_id
    FROM public.share_links
    WHERE token_hash = v_token_hash
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > timezone('utc', now()));

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'UNAUTHORIZED: invalid or expired share token.';
    END IF;
  END IF;

  RETURN QUERY
  SELECT DISTINCT r.field_id
  FROM public.field_work_records r
  JOIN public.fields f ON f.id = r.field_id
  WHERE r.work_type_id = p_work_type_id
    AND (v_org_id IS NULL OR f.organization_id = v_org_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_latest_work_records(
  p_field_ids uuid[],
  p_share_token text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  field_id uuid,
  work_type_id uuid,
  work_type_code text,
  work_type_name text,
  work_type_icon_key text,
  work_type_color text,
  status text,
  worked_on date,
  notes text,
  created_by uuid,
  creator_name text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org_id uuid;
  v_token_hash text;
BEGIN
  IF auth.uid() IS NULL THEN
    IF p_share_token IS NULL THEN
      RAISE EXCEPTION 'UNAUTHORIZED: anonymous access requires a share token.';
    END IF;

    v_token_hash := encode(sha256(p_share_token::bytea), 'hex');

    SELECT organization_id INTO v_org_id
    FROM public.share_links
    WHERE token_hash = v_token_hash
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > timezone('utc', now()));

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'UNAUTHORIZED: invalid or expired share token.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.fields f
      WHERE f.id = ANY(p_field_ids)
        AND f.organization_id IS DISTINCT FROM v_org_id
    ) THEN
      RAISE EXCEPTION 'FORBIDDEN: share token cannot access one or more requested fields.';
    END IF;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (r.field_id)
    r.id,
    r.field_id,
    r.work_type_id,
    wt.code AS work_type_code,
    wt.name AS work_type_name,
    wt.icon_key AS work_type_icon_key,
    wt.color AS work_type_color,
    r.status,
    r.worked_on,
    r.notes,
    r.created_by,
    p.display_name AS creator_name,
    r.created_at,
    r.updated_at
  FROM public.field_work_records r
  JOIN public.work_types wt ON wt.id = r.work_type_id
  LEFT JOIN public.profiles p ON p.id = r.created_by
  WHERE r.field_id = ANY(p_field_ids)
  ORDER BY r.field_id, r.worked_on DESC NULLS LAST, r.created_at DESC, r.id DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_field_work_records(
  p_field_id uuid,
  p_share_token text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  field_id uuid,
  work_type_id uuid,
  work_type_code text,
  work_type_name text,
  work_type_icon_key text,
  work_type_color text,
  status text,
  worked_on date,
  notes text,
  created_by uuid,
  creator_name text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org_id uuid;
  v_token_hash text;
BEGIN
  IF auth.uid() IS NULL THEN
    IF p_share_token IS NULL THEN
      RAISE EXCEPTION 'UNAUTHORIZED: anonymous access requires a share token.';
    END IF;

    v_token_hash := encode(sha256(p_share_token::bytea), 'hex');

    SELECT organization_id INTO v_org_id
    FROM public.share_links
    WHERE token_hash = v_token_hash
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > timezone('utc', now()));

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'UNAUTHORIZED: invalid or expired share token.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.fields f
      WHERE f.id = p_field_id
        AND f.organization_id IS DISTINCT FROM v_org_id
    ) THEN
      RAISE EXCEPTION 'FORBIDDEN: share token cannot access this field.';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.field_id,
    r.work_type_id,
    wt.code AS work_type_code,
    wt.name AS work_type_name,
    wt.icon_key AS work_type_icon_key,
    wt.color AS work_type_color,
    r.status,
    r.worked_on,
    r.notes,
    r.created_by,
    p.display_name AS creator_name,
    r.created_at,
    r.updated_at
  FROM public.field_work_records r
  JOIN public.work_types wt ON wt.id = r.work_type_id
  LEFT JOIN public.profiles p ON p.id = r.created_by
  WHERE r.field_id = p_field_id
  ORDER BY r.worked_on DESC NULLS LAST, r.created_at DESC, r.id DESC;
END;
$$;
