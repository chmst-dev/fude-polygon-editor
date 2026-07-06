-- ============================================================
-- データベース環境 初期セットアップ SQL (setup.sql)
-- ============================================================

-- PostGISの有効化 (Supabaseでは標準で利用可能)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. 組織テーブル (organizations)
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. プロフィールテーブル (profiles)
-- ロール: 'admin' (全体管理者), 'org_admin' (組織管理者), 'viewer' (閲覧者)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('admin', 'org_admin', 'viewer')),
  display_name text,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. 元筆ポリゴンマスターデータ (source_polygons)
CREATE TABLE IF NOT EXISTS public.source_polygons (
  id text PRIMARY KEY,
  geom geometry(Geometry) NOT NULL, -- SRID指定なしであらゆる形式を許容
  area_sqm numeric,
  original_properties jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS source_polygons_geom_idx ON public.source_polygons USING gist (geom);

-- 4. 圃場マスタ (fields)
CREATE TABLE IF NOT EXISTS public.fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  producer_name text,
  field_name text,
  crop_type text,
  notes text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. 圃場と元筆の多対多中間テーブル (field_source_polygons)
CREATE TABLE IF NOT EXISTS public.field_source_polygons (
  field_id uuid REFERENCES public.fields(id) ON DELETE CASCADE,
  source_polygon_id text REFERENCES public.source_polygons(id) ON DELETE CASCADE,
  PRIMARY KEY (field_id, source_polygon_id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. 圃場付属ポイント (field_points)
CREATE TABLE IF NOT EXISTS public.field_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id uuid NOT NULL REFERENCES public.fields(id) ON DELETE CASCADE,
  point_type text NOT NULL CHECK (point_type IN ('入口', '駐車場所', '水口', '落とし', '危険箇所', 'その他')),
  name text,
  description text,
  image_url text,
  geom geometry(Point, 4326) NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS field_points_geom_idx ON public.field_points USING gist (geom);

-- 7. 作業種別マスタ (work_types)
CREATE TABLE IF NOT EXISTS public.work_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  icon_key text NOT NULL,
  color text NOT NULL DEFAULT '#64748b',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT timezone('utc', now()) NOT NULL
);

-- 初期作業項目の投入
INSERT INTO public.work_types (code, name, icon_key, color, sort_order) VALUES
  ('tillage',     '耕起',   'shovel',       '#a16207', 10),
  ('puddling',    '代かき',  'waves',        '#0369a1', 20),
  ('seeding',     '播種',   'seed',         '#15803d', 30),
  ('transplant',  '定植',   'sprout',       '#16a34a', 40),
  ('fertilize',   '施肥',   'flask',        '#7c3aed', 50),
  ('pesticide',   '防除',   'spray',        '#dc2626', 60),
  ('weeding',     '除草',   'scissors',     '#ca8a04', 70),
  ('irrigation',  '水管理',  'droplet',      '#0284c7', 80),
  ('harvest',     '収穫',   'wheat',        '#d97706', 90),
  ('other',       'その他',  'circle-ellipsis', '#64748b', 100)
ON CONFLICT (code) DO NOTHING;

-- 8. 圃場作業記録 (field_work_records)
CREATE TABLE IF NOT EXISTS public.field_work_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id uuid NOT NULL REFERENCES public.fields(id) ON DELETE CASCADE,
  work_type_id uuid NOT NULL REFERENCES public.work_types(id),
  status text NOT NULL DEFAULT 'planned'
    CONSTRAINT field_work_records_status_check
    CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
  worked_on date,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT timezone('utc', now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS field_work_records_field_id_idx ON public.field_work_records (field_id);
CREATE INDEX IF NOT EXISTS field_work_records_latest_idx ON public.field_work_records (field_id, worked_on DESC NULLS LAST, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS field_work_records_work_type_idx ON public.field_work_records (work_type_id);

-- 9. 変更履歴 (change_logs)
CREATE TABLE IF NOT EXISTS public.change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id uuid REFERENCES public.fields(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  old_values jsonb,
  new_values jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================
-- ヘルパー関数とトリガー
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_role() RETURNS text AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.get_my_org_id() RETURNS uuid AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public;

-- Auth Trigger による自動組織・プロフィール作成
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  new_org_id uuid;
  display_name_val text;
BEGIN
  display_name_val := COALESCE(
    new.raw_user_meta_data->>'display_name',
    split_part(new.email, '@', 1)
  );

  INSERT INTO public.organizations (name)
  VALUES (display_name_val || 'の組織')
  RETURNING id INTO new_org_id;

  INSERT INTO public.profiles (id, organization_id, role, display_name)
  VALUES (new.id, new_org_id, 'org_admin', display_name_val);

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Bounding Box で取得する関数
CREATE OR REPLACE FUNCTION public.get_source_polygons_in_bbox(
  west double precision,
  south double precision,
  east double precision,
  north double precision
)
RETURNS TABLE(id text, geom geometry, area_sqm numeric, original_properties jsonb)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT sp.id, sp.geom, sp.area_sqm, sp.original_properties
  FROM public.source_polygons sp
  WHERE sp.geom && ST_MakeEnvelope(west, south, east, north)
    AND NOT EXISTS (
      SELECT 1 FROM public.field_source_polygons fsp WHERE fsp.source_polygon_id = sp.id
    )
  LIMIT 3000;
$$;

-- updated_at 自動更新用
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS field_work_records_updated_at ON public.field_work_records;
CREATE TRIGGER field_work_records_updated_at
  BEFORE UPDATE ON public.field_work_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- merge_fields RPC (圃場統合トランザクション)
CREATE OR REPLACE FUNCTION public.merge_fields(
  p_target_field_id  uuid,
  p_source_field_ids uuid[],
  p_field_data       jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id    uuid;
  v_user_role  text;
  v_user_org   uuid;
  v_org_id     uuid;
  v_all_ids    uuid[];
  v_count      integer;
  v_source_id  uuid;
  v_old_data   jsonb;
BEGIN
  -- 1. 認証確認
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: ログインが必要です。';
  END IF;

  -- 2. ロール確認
  SELECT role, organization_id
    INTO v_user_role, v_user_org
    FROM public.profiles
   WHERE id = v_user_id;

  IF v_user_role NOT IN ('admin', 'org_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: 圃場統合には admin または org_admin 権限が必要です。';
  END IF;

  -- 3. source が 1件以上であること
  IF array_length(p_source_field_ids, 1) IS NULL OR array_length(p_source_field_ids, 1) < 1 THEN
    RAISE EXCEPTION 'INVALID_ARGS: 統合元の圃場を1件以上指定してください。';
  END IF;

  v_all_ids := array_append(p_source_field_ids, p_target_field_id);

  -- 4. 同一組織・存在検証
  SELECT COUNT(*), MAX(organization_id)
    INTO v_count, v_org_id
    FROM public.fields
   WHERE id = ANY(v_all_ids);

  IF v_count <> array_length(v_all_ids, 1) THEN
    RAISE EXCEPTION 'NOT_FOUND: 指定された圃場の一部が存在しません。';
  END IF;

  IF (SELECT COUNT(DISTINCT organization_id) FROM public.fields WHERE id = ANY(v_all_ids)) > 1 THEN
    RAISE EXCEPTION 'CROSS_ORG: 異なる組織の圃場は統合できません。';
  END IF;

  IF (v_user_role IS DISTINCT FROM 'admin') AND (v_user_org IS DISTINCT FROM v_org_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: 自組織の圃場のみ統合できます。';
  END IF;

  SELECT row_to_json(f)::jsonb INTO v_old_data
    FROM public.fields f WHERE id = p_target_field_id;

  -- 5. target のメタデータ更新
  UPDATE public.fields SET
    producer_name = COALESCE(p_field_data->>'producer_name', producer_name),
    field_name    = COALESCE(p_field_data->>'field_name', field_name),
    crop_type     = COALESCE(p_field_data->>'crop_type', crop_type),
    notes         = COALESCE(p_field_data->>'notes', notes),
    status        = COALESCE(p_field_data->>'status', status),
    updated_at    = timezone('utc', now())
  WHERE id = p_target_field_id;

  -- 6. field_source_polygons 移動
  FOREACH v_source_id IN ARRAY p_source_field_ids LOOP
    INSERT INTO public.field_source_polygons (field_id, source_polygon_id, created_at)
      SELECT p_target_field_id, source_polygon_id, created_at
        FROM public.field_source_polygons
       WHERE field_id = v_source_id
    ON CONFLICT (field_id, source_polygon_id) DO NOTHING;
  END LOOP;

  -- 7. field_points 移動
  UPDATE public.field_points
     SET field_id = p_target_field_id
   WHERE field_id = ANY(p_source_field_ids);

  -- 8. field_work_records 移動
  UPDATE public.field_work_records
     SET field_id = p_target_field_id
   WHERE field_id = ANY(p_source_field_ids);

  -- 9. source 削除
  DELETE FROM public.fields WHERE id = ANY(p_source_field_ids);

  -- 10. change_logs 記録
  INSERT INTO public.change_logs (field_id, profile_id, action, old_values, new_values)
  VALUES (
    p_target_field_id,
    v_user_id,
    'merge_fields',
    jsonb_build_object(
      'target_field_id', p_target_field_id,
      'source_field_ids', to_jsonb(p_source_field_ids),
      'target_before', v_old_data
    ),
    jsonb_build_object(
      'target_field_id', p_target_field_id,
      'merged_from', to_jsonb(p_source_field_ids),
      'new_metadata', p_field_data
    )
  );

  RETURN p_target_field_id;
END;
$$;

-- 共有リンク管理テーブル (share_links)
CREATE TABLE IF NOT EXISTS public.share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, -- 共有トークンのSHA-256ハッシュ値
  expires_at timestamp with time zone, -- 有効期限 (NULLは期限なし)
  is_active boolean NOT NULL DEFAULT true, -- 失効/有効フラグ
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- --------------------------------------------------------
-- create_share_link: 共有リンク(平文トークン)を新規生成して一度だけ返す
-- --------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_share_link(uuid);
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
  -- 1. 権限検証
  v_role := public.get_my_role();
  v_my_org_id := public.get_my_org_id();

  IF v_role IS DISTINCT FROM 'admin' THEN
    IF v_role IS DISTINCT FROM 'org_admin' OR v_my_org_id IS DISTINCT FROM p_org_id THEN
      RAISE EXCEPTION 'FORBIDDEN: 共有リンクを作成する権限がありません。';
    END IF;
  END IF;

  -- 2. トークン生成
  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(sha256(v_raw_token::bytea), 'hex');

  -- 既存の有効な共有リンクをすべて失効させる
  UPDATE public.share_links
  SET is_active = false
  WHERE organization_id = p_org_id AND is_active = true;

  -- 新規保存
  INSERT INTO public.share_links (organization_id, token_hash)
  VALUES (p_org_id, v_token_hash);

  RETURN v_raw_token;
END;
$$;

-- --------------------------------------------------------
-- revoke_share_links: 組織の共有リンクをすべて失効させる
-- --------------------------------------------------------
DROP FUNCTION IF EXISTS public.revoke_share_links(uuid);
CREATE OR REPLACE FUNCTION public.revoke_share_links(
  p_org_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_my_org_id uuid;
BEGIN
  v_role := public.get_my_role();
  v_my_org_id := public.get_my_org_id();

  IF v_role IS DISTINCT FROM 'admin' THEN
    IF v_role IS DISTINCT FROM 'org_admin' OR v_my_org_id IS DISTINCT FROM p_org_id THEN
      RAISE EXCEPTION 'FORBIDDEN: 共有リンクを操作する権限がありません。';
    END IF;
  END IF;

  UPDATE public.share_links
  SET is_active = false
  WHERE organization_id = p_org_id AND is_active = true;
END;
$$;

-- --------------------------------------------------------
-- get_field_ids_by_work_type: 作業種別に該当する圃場ID一覧を取得 (組織・共有トークン制限付き)
-- --------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_field_ids_by_work_type(uuid, text);
DROP FUNCTION IF EXISTS public.get_field_ids_by_work_type(uuid);
CREATE OR REPLACE FUNCTION public.get_field_ids_by_work_type(
  p_work_type_id uuid,
  p_share_token text DEFAULT NULL
)
RETURNS TABLE (
  field_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org_id uuid;
  v_token_hash text;
BEGIN
  -- 1. ログイン済みユーザー
  IF auth.uid() IS NOT NULL THEN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
      v_org_id := public.get_my_org_id();
    END IF;
  -- 2. 匿名ユーザー
  ELSE
    IF p_share_token IS NULL THEN
      RAISE EXCEPTION 'UNAUTHORIZED: 匿名アクセスには共有トークンの指定が必要です。';
    END IF;

    v_token_hash := encode(sha256(p_share_token::bytea), 'hex');

    SELECT organization_id INTO v_org_id
    FROM public.share_links
    WHERE token_hash = v_token_hash
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > timezone('utc', now()));

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'UNAUTHORIZED: 無効な共有トークン、または期限切れです。';
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

-- --------------------------------------------------------
-- get_latest_work_records RPC (N+1防止一括取得・共有トークン検証付き)
DROP FUNCTION IF EXISTS public.get_latest_work_records(uuid[]);
DROP FUNCTION IF EXISTS public.get_latest_work_records(uuid[], uuid);
DROP FUNCTION IF EXISTS public.get_latest_work_records(uuid[], text);
CREATE OR REPLACE FUNCTION public.get_latest_work_records(
  p_field_ids uuid[],
  p_share_token text DEFAULT NULL
)
RETURNS TABLE (
  id           uuid,
  field_id     uuid,
  work_type_id uuid,
  work_type_code text,
  work_type_name text,
  work_type_icon_key text,
  work_type_color text,
  status       text,
  worked_on    date,
  notes        text,
  created_by   uuid,
  creator_name text,
  created_at   timestamp with time zone,
  updated_at   timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org_id uuid;
  v_token_hash text;
BEGIN
  -- 1. ログイン済みユーザーの検証
  IF auth.uid() IS NOT NULL THEN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
      IF EXISTS (
        SELECT 1 FROM public.fields f
        WHERE f.id = ANY(p_field_ids) AND f.organization_id IS DISTINCT FROM public.get_my_org_id()
      ) THEN
        RAISE EXCEPTION 'FORBIDDEN: 他組織のデータにアクセスする権限がありません。';
      END IF;
    END IF;
  -- 2. 匿名ユーザー (共有URL) の検証
  ELSE
    IF p_share_token IS NULL THEN
      RAISE EXCEPTION 'UNAUTHORIZED: 匿名アクセスには共有トークンの指定が必要です。';
    END IF;

    -- トークンのハッシュ化と検証
    v_token_hash := encode(sha256(p_share_token::bytea), 'hex');

    SELECT organization_id INTO v_org_id
    FROM public.share_links
    WHERE token_hash = v_token_hash
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > timezone('utc', now()));

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'UNAUTHORIZED: 無効な共有トークン、または期限切れです。';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.fields f
      WHERE f.id = ANY(p_field_ids) AND f.organization_id IS DISTINCT FROM v_org_id
    ) THEN
      RAISE EXCEPTION 'FORBIDDEN: 指定された共有トークンではアクセスできない圃場データが含まれています。';
    END IF;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (r.field_id)
    r.id,
    r.field_id,
    r.work_type_id,
    wt.code   AS work_type_code,
    wt.name   AS work_type_name,
    wt.icon_key AS work_type_icon_key,
    wt.color  AS work_type_color,
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

-- get_field_work_records RPC (特定圃場の全履歴取得・共有トークン検証付き)
DROP FUNCTION IF EXISTS public.get_field_work_records(uuid);
DROP FUNCTION IF EXISTS public.get_field_work_records(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_field_work_records(uuid, text);
CREATE OR REPLACE FUNCTION public.get_field_work_records(
  p_field_id uuid,
  p_share_token text DEFAULT NULL
)
RETURNS TABLE (
  id           uuid,
  field_id     uuid,
  work_type_id uuid,
  work_type_code text,
  work_type_name text,
  work_type_icon_key text,
  work_type_color text,
  status       text,
  worked_on    date,
  notes        text,
  created_by   uuid,
  creator_name text,
  created_at   timestamp with time zone,
  updated_at   timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org_id uuid;
  v_token_hash text;
BEGIN
  -- 1. ログイン済みユーザーの検証
  IF auth.uid() IS NOT NULL THEN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
      IF EXISTS (
        SELECT 1 FROM public.fields f
        WHERE f.id = p_field_id AND f.organization_id IS DISTINCT FROM public.get_my_org_id()
      ) THEN
        RAISE EXCEPTION 'FORBIDDEN: 他組織のデータにアクセスする権限がありません。';
      END IF;
    END IF;
  -- 2. 匿名ユーザー (共有URL) の検証
  ELSE
    IF p_share_token IS NULL THEN
      RAISE EXCEPTION 'UNAUTHORIZED: 匿名アクセスには共有トークンの指定が必要です。';
    END IF;

    -- トークンのハッシュ化と検証
    v_token_hash := encode(sha256(p_share_token::bytea), 'hex');

    SELECT organization_id INTO v_org_id
    FROM public.share_links
    WHERE token_hash = v_token_hash
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > timezone('utc', now()));

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'UNAUTHORIZED: 無効な共有トークン、または期限切れです。';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.fields f
      WHERE f.id = p_field_id AND f.organization_id IS DISTINCT FROM v_org_id
    ) THEN
      RAISE EXCEPTION 'FORBIDDEN: 指定された共有トークンではアクセスできない圃場データです。';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.field_id,
    r.work_type_id,
    wt.code   AS work_type_code,
    wt.name   AS work_type_name,
    wt.icon_key AS work_type_icon_key,
    wt.color  AS work_type_color,
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

-- 共有トークンによる安全な閲覧のためのRPC群

-- A. get_fields_by_share_token
DROP FUNCTION IF EXISTS public.get_fields_by_share_token(text);
CREATE OR REPLACE FUNCTION public.get_fields_by_share_token(
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org_id uuid;
  v_token_hash text;
  v_result jsonb;
BEGIN
  v_token_hash := encode(sha256(p_token::bytea), 'hex');

  SELECT organization_id INTO v_org_id
  FROM public.share_links
  WHERE token_hash = v_token_hash
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > timezone('utc', now()));

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: 無効な共有トークン、または期限切れです。';
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', f.id,
      'organization_id', f.organization_id,
      'producer_name', f.producer_name,
      'field_name', f.field_name,
      'crop_type', f.crop_type,
      'notes', f.notes,
      'status', f.status,
      'field_source_polygons', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'source_polygon_id', fsp.source_polygon_id,
            'source_polygons', jsonb_build_object(
              'id', sp.id,
              'geom', st_asgeojson(sp.geom)::jsonb,
              'area_sqm', sp.area_sqm,
              'original_properties', sp.original_properties
            )
          )
        )
        FROM public.field_source_polygons fsp
        JOIN public.source_polygons sp ON sp.id = fsp.source_polygon_id
        WHERE fsp.field_id = f.id
      ), '[]'::jsonb)
    )
  ), '[]'::jsonb) INTO v_result
  FROM public.fields f
  WHERE f.organization_id = v_org_id;

  RETURN v_result;
END;
$$;

-- B. get_points_by_share_token
DROP FUNCTION IF EXISTS public.get_points_by_share_token(text);
CREATE OR REPLACE FUNCTION public.get_points_by_share_token(
  p_token text
)
RETURNS TABLE (
  id uuid,
  field_id uuid,
  point_type text,
  name text,
  description text,
  image_url text,
  geom geometry(Point, 4326),
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org_id uuid;
  v_token_hash text;
BEGIN
  v_token_hash := encode(sha256(p_token::bytea), 'hex');

  SELECT organization_id INTO v_org_id
  FROM public.share_links
  WHERE token_hash = v_token_hash
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > timezone('utc', now()));

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: 無効な共有トークンです。';
  END IF;

  RETURN QUERY
  SELECT fp.id, fp.field_id, fp.point_type, fp.name, fp.description, fp.image_url, fp.geom, fp.created_at
  FROM public.field_points fp
  JOIN public.fields f ON f.id = fp.field_id
  WHERE f.organization_id = v_org_id;
END;
$$;

-- C. get_field_source_polygons_by_share_token
DROP FUNCTION IF EXISTS public.get_field_source_polygons_by_share_token(text);
CREATE OR REPLACE FUNCTION public.get_field_source_polygons_by_share_token(
  p_token text
)
RETURNS TABLE (
  field_id uuid,
  source_polygon_id text,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org_id uuid;
  v_token_hash text;
BEGIN
  v_token_hash := encode(sha256(p_token::bytea), 'hex');

  SELECT organization_id INTO v_org_id
  FROM public.share_links
  WHERE token_hash = v_token_hash
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > timezone('utc', now()));

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: 無効な共有トークンです。';
  END IF;

  RETURN QUERY
  SELECT fsp.field_id, fsp.source_polygon_id, fsp.created_at
  FROM public.field_source_polygons fsp
  JOIN public.fields f ON f.id = fsp.field_id
  WHERE f.organization_id = v_org_id;
END;
$$;

-- ============================================================
-- RLS (Row Level Security) の設定
-- ============================================================

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_polygons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_source_polygons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_work_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;

-- share_links
DROP POLICY IF EXISTS "share_links_select_own_org" ON public.share_links;
CREATE POLICY "share_links_select_own_org" ON public.share_links FOR SELECT USING (
  auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR public.get_my_org_id() = organization_id)
);

DROP POLICY IF EXISTS "share_links_insert_own_org" ON public.share_links;
CREATE POLICY "share_links_insert_own_org" ON public.share_links FOR INSERT WITH CHECK (
  auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR (public.get_my_org_id() = organization_id AND public.get_my_role() = 'org_admin'))
);

DROP POLICY IF EXISTS "share_links_update_own_org" ON public.share_links;
CREATE POLICY "share_links_update_own_org" ON public.share_links FOR UPDATE USING (
  auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR (public.get_my_org_id() = organization_id AND public.get_my_role() = 'org_admin'))
) WITH CHECK (
  auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR public.get_my_org_id() = organization_id)
);

DROP POLICY IF EXISTS "share_links_delete_own_org" ON public.share_links;
CREATE POLICY "share_links_delete_own_org" ON public.share_links FOR DELETE USING (
  auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR (public.get_my_org_id() = organization_id AND public.get_my_role() = 'org_admin'))
);

-- organizations (anon 封鎖、認証済自組織のみ)
DROP POLICY IF EXISTS "org_select_all" ON public.organizations;
CREATE POLICY "org_select_own" ON public.organizations FOR SELECT USING (
  auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR public.get_my_org_id() = id)
);
CREATE POLICY "org_insert_authenticated" ON public.organizations FOR INSERT WITH CHECK (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "org_update_own" ON public.organizations;
CREATE POLICY "org_update_own" ON public.organizations FOR UPDATE USING (
  public.get_my_role() = 'admin' OR public.get_my_org_id() = id
) WITH CHECK (
  public.get_my_role() = 'admin' OR public.get_my_org_id() = id
);

-- profiles
CREATE POLICY "profiles_select_own_or_org" ON public.profiles FOR SELECT USING (
  auth.uid() = id OR public.get_my_role() = 'admin' OR public.get_my_org_id() = organization_id
);
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- source_polygons (anon 封鎖、認証済のみ。viewerは読み取り専用)
DROP POLICY IF EXISTS "source_polygons_select_all" ON public.source_polygons;
CREATE POLICY "source_polygons_select_authenticated" ON public.source_polygons FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "source_polygons_insert_authenticated" ON public.source_polygons FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.get_my_role() IN ('admin', 'org_admin'));
CREATE POLICY "source_polygons_update_authenticated" ON public.source_polygons FOR UPDATE USING (auth.role() = 'authenticated' AND public.get_my_role() IN ('admin', 'org_admin')) WITH CHECK (auth.role() = 'authenticated' AND public.get_my_role() IN ('admin', 'org_admin'));

-- fields (anon 封鎖、認証済自組織のみ。viewerは読み取り専用)
DROP POLICY IF EXISTS "fields_select_all" ON public.fields;
DROP POLICY IF EXISTS "fields_select_own_org" ON public.fields;
CREATE POLICY "fields_select_own_org" ON public.fields FOR SELECT USING (auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR public.get_my_org_id() = organization_id));
DROP POLICY IF EXISTS "fields_insert_own_org" ON public.fields;
CREATE POLICY "fields_insert_own_org" ON public.fields FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR (public.get_my_role() = 'org_admin' AND public.get_my_org_id() = organization_id)));
DROP POLICY IF EXISTS "fields_update_own_org" ON public.fields;
CREATE POLICY "fields_update_own_org" ON public.fields FOR UPDATE USING (auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR (public.get_my_role() = 'org_admin' AND public.get_my_org_id() = organization_id))) WITH CHECK (auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR (public.get_my_role() = 'org_admin' AND public.get_my_org_id() = organization_id)));
DROP POLICY IF EXISTS "fields_delete_own_org" ON public.fields;
CREATE POLICY "fields_delete_own_org" ON public.fields FOR DELETE USING (auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR (public.get_my_role() = 'org_admin' AND public.get_my_org_id() = organization_id)));

-- field_source_polygons (anon 封鎖、認証済自組織のみ)
DROP POLICY IF EXISTS "fsp_select_all" ON public.field_source_polygons;
DROP POLICY IF EXISTS "fsp_select_own_org" ON public.field_source_polygons;
CREATE POLICY "fsp_select_own_org" ON public.field_source_polygons FOR SELECT USING (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.fields f
      WHERE f.id = field_source_polygons.field_id
        AND f.organization_id = public.get_my_org_id()
    )
  )
);
DROP POLICY IF EXISTS "fsp_insert_own_org" ON public.field_source_polygons;
CREATE POLICY "fsp_insert_own_org" ON public.field_source_polygons FOR INSERT WITH CHECK (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'org_admin'
      AND EXISTS (SELECT 1 FROM public.fields WHERE fields.id = field_source_polygons.field_id AND fields.organization_id = public.get_my_org_id())
    )
  )
);
DROP POLICY IF EXISTS "fsp_delete_own_org" ON public.field_source_polygons;
CREATE POLICY "fsp_delete_own_org" ON public.field_source_polygons FOR DELETE USING (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'org_admin'
      AND EXISTS (SELECT 1 FROM public.fields WHERE fields.id = field_source_polygons.field_id AND fields.organization_id = public.get_my_org_id())
    )
  )
);

-- field_points (anon 封鎖、認証済自組織のみ)
DROP POLICY IF EXISTS "field_points_select_all" ON public.field_points;
DROP POLICY IF EXISTS "field_points_select_own_org" ON public.field_points;
CREATE POLICY "field_points_select_own_org" ON public.field_points FOR SELECT USING (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.fields f
      WHERE f.id = field_points.field_id
        AND f.organization_id = public.get_my_org_id()
    )
  )
);
DROP POLICY IF EXISTS "field_points_insert_own_org" ON public.field_points;
CREATE POLICY "field_points_insert_own_org" ON public.field_points FOR INSERT WITH CHECK (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'org_admin'
      AND EXISTS (SELECT 1 FROM public.fields WHERE fields.id = field_points.field_id AND fields.organization_id = public.get_my_org_id())
    )
  )
);
DROP POLICY IF EXISTS "field_points_update_own_org" ON public.field_points;
CREATE POLICY "field_points_update_own_org" ON public.field_points FOR UPDATE USING (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'org_admin'
      AND EXISTS (SELECT 1 FROM public.fields WHERE fields.id = field_points.field_id AND fields.organization_id = public.get_my_org_id())
    )
  )
) WITH CHECK (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'org_admin'
      AND EXISTS (SELECT 1 FROM public.fields WHERE fields.id = field_points.field_id AND fields.organization_id = public.get_my_org_id())
    )
  )
);
DROP POLICY IF EXISTS "field_points_delete_own_org" ON public.field_points;
CREATE POLICY "field_points_delete_own_org" ON public.field_points FOR DELETE USING (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'org_admin'
      AND EXISTS (SELECT 1 FROM public.fields WHERE fields.id = field_points.field_id AND fields.organization_id = public.get_my_org_id())
    )
  )
);

-- work_types
CREATE POLICY "work_types_select_all" ON public.work_types FOR SELECT USING (true);
CREATE POLICY "work_types_insert_admin" ON public.work_types FOR INSERT WITH CHECK (public.get_my_role() IN ('admin', 'org_admin'));
CREATE POLICY "work_types_update_admin" ON public.work_types FOR UPDATE USING (public.get_my_role() IN ('admin', 'org_admin')) WITH CHECK (public.get_my_role() IN ('admin', 'org_admin'));

-- field_work_records (viewer = 閲覧専用)
CREATE POLICY "fwr_select_own_org" ON public.field_work_records FOR SELECT USING (auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_work_records.field_id AND f.organization_id = public.get_my_org_id())));
CREATE POLICY "fwr_insert_own_org" ON public.field_work_records FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.get_my_role() IN ('admin', 'org_admin') AND auth.uid() = created_by AND (public.get_my_role() = 'admin' OR EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_work_records.field_id AND f.organization_id = public.get_my_org_id())));
CREATE POLICY "fwr_update_own" ON public.field_work_records FOR UPDATE USING (auth.role() = 'authenticated' AND (auth.uid() = created_by OR public.get_my_role() IN ('admin', 'org_admin')) AND (public.get_my_role() = 'admin' OR EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_work_records.field_id AND f.organization_id = public.get_my_org_id()))) WITH CHECK (auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_work_records.field_id AND f.organization_id = public.get_my_org_id())));
CREATE POLICY "fwr_delete_own" ON public.field_work_records FOR DELETE USING (auth.role() = 'authenticated' AND (auth.uid() = created_by OR public.get_my_role() IN ('admin', 'org_admin')) AND (public.get_my_role() = 'admin' OR EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_work_records.field_id AND f.organization_id = public.get_my_org_id())));

-- change_logs
CREATE POLICY "change_logs_select_own_org" ON public.change_logs FOR SELECT USING (auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = change_logs.profile_id AND profiles.organization_id = public.get_my_org_id())));
CREATE POLICY "change_logs_insert_own" ON public.change_logs FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND auth.uid() = profile_id);

-- ============================================================
-- Storage (画像保存用) の設定
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('point_images', 'point_images', true) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "point_images_select_all" ON storage.objects;
CREATE POLICY "point_images_select_all" ON storage.objects FOR SELECT USING (bucket_id = 'point_images');

DROP POLICY IF EXISTS "point_images_insert_authenticated" ON storage.objects;
CREATE POLICY "point_images_insert_authenticated" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'point_images'
  AND auth.role() = 'authenticated'
  AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'org_admin')
);

DROP POLICY IF EXISTS "point_images_delete_authenticated" ON storage.objects;
CREATE POLICY "point_images_delete_authenticated" ON storage.objects FOR DELETE USING (
  bucket_id = 'point_images'
  AND auth.role() = 'authenticated'
  AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'org_admin')
);

-- ============================================================
-- SECURITY DEFINER 関数の不要な PUBLIC 実行権限の剥奪と明示的な許可設定
-- ============================================================

-- 1. 内部ヘルパー関数 (authenticated / service_role のみ)
REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_my_org_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_org_id() TO authenticated, service_role;

-- 2. トリガー用関数 (service_role のみ)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- 3. 一般取得 RPC (authenticated / service_role のみ)
REVOKE EXECUTE ON FUNCTION public.get_source_polygons_in_bbox(double precision, double precision, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_source_polygons_in_bbox(double precision, double precision, double precision, double precision) TO authenticated, service_role;

-- 4. 管理用 RPC (authenticated / service_role のみ)
REVOKE EXECUTE ON FUNCTION public.merge_fields(uuid, uuid[], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_fields(uuid, uuid[], jsonb) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.create_share_link(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_share_link(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.revoke_share_links(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_share_links(uuid) TO authenticated, service_role;

-- 5. 共有トークンを用いた閲覧用 RPC (anon / authenticated / service_role 全て実行可能)
REVOKE EXECUTE ON FUNCTION public.get_field_ids_by_work_type(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_field_ids_by_work_type(uuid, text) TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_latest_work_records(uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_latest_work_records(uuid[], text) TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_field_work_records(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_field_work_records(uuid, text) TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_fields_by_share_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_fields_by_share_token(text) TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_points_by_share_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_points_by_share_token(text) TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_field_source_polygons_by_share_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_field_source_polygons_by_share_token(text) TO anon, authenticated, service_role;
