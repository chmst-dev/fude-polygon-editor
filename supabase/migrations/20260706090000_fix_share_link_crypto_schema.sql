-- create_share_link uses a hardened search_path that intentionally excludes
-- the extensions schema. Qualify pgcrypto's gen_random_bytes explicitly.
CREATE OR REPLACE FUNCTION public.create_share_link(
  p_org_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_raw_token text;
  v_token_hash text;
  v_my_org_id uuid;
BEGIN
  v_role := public.get_my_role();
  v_my_org_id := public.get_my_org_id();

  IF v_role IS DISTINCT FROM 'admin' THEN
    IF v_role IS DISTINCT FROM 'org_admin' OR v_my_org_id IS DISTINCT FROM p_org_id THEN
      RAISE EXCEPTION 'FORBIDDEN: 共有リンクを作成する権限がありません。';
    END IF;
  END IF;

  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(sha256(v_raw_token::bytea), 'hex');

  UPDATE public.share_links
  SET is_active = false
  WHERE organization_id = p_org_id AND is_active = true;

  INSERT INTO public.share_links (organization_id, token_hash)
  VALUES (p_org_id, v_token_hash);

  RETURN v_raw_token;
END;
$$;

