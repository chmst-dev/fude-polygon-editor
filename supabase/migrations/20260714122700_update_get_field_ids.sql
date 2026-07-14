-- B-3. get_field_ids_by_work_type RPC を status 条件付きで更新
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
    AND r.status IN ('in_progress', 'completed')
    AND (v_org_id IS NULL OR f.organization_id = v_org_id);
END;
$$;

-- 既存の GRANT の再適用
REVOKE EXECUTE ON FUNCTION public.get_field_ids_by_work_type(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_field_ids_by_work_type(uuid, text) TO anon, authenticated, service_role;
