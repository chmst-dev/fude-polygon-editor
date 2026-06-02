-- ============================================================
-- データベース環境 完全リセット＆一本化 SQL
-- ============================================================
-- 既存のテーブルをすべて削除し（データはクリアされます）、
-- 最新の仕様で一からクリーンに構築し直します。
-- ※これまでに重ねた ALTER や RLS の矛盾・バグを完全に消し去ります。

DROP TABLE IF EXISTS public.change_logs CASCADE;
DROP TABLE IF EXISTS public.field_points CASCADE;
DROP TABLE IF EXISTS public.field_source_polygons CASCADE;
DROP TABLE IF EXISTS public.fields CASCADE;
DROP TABLE IF EXISTS public.source_polygons CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.organizations CASCADE;

-- PostGISの有効化
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. 組織テーブル (organizations)
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. プロフィールテーブル (profiles)
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('admin', 'org_admin', 'viewer')),
  display_name text,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. 元筆ポリゴンマスターデータ (source_polygons)
CREATE TABLE public.source_polygons (
  id text PRIMARY KEY,
  geom geometry(Geometry) NOT NULL, -- SRID指定なしであらゆる形式を許容
  area_sqm numeric,
  original_properties jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX source_polygons_geom_idx ON public.source_polygons USING gist (geom);

-- 4. 圃場マスタ (fields)
CREATE TABLE public.fields (
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
CREATE TABLE public.field_source_polygons (
  field_id uuid REFERENCES public.fields(id) ON DELETE CASCADE,
  source_polygon_id text REFERENCES public.source_polygons(id) ON DELETE CASCADE,
  PRIMARY KEY (field_id, source_polygon_id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. 圃場付属ポイント (field_points)
CREATE TABLE public.field_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id uuid NOT NULL REFERENCES public.fields(id) ON DELETE CASCADE,
  point_type text NOT NULL CHECK (point_type IN ('入口', '駐車場所', '水口', '落とし', '危険箇所', 'その他')), -- 「落とし」を含める
  name text, -- NOT NULL を外す
  description text,
  image_url text, -- 最初から画像URLを含める
  geom geometry(Point, 4326) NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX field_points_geom_idx ON public.field_points USING gist (geom);

-- 7. 変更履歴 (change_logs)
CREATE TABLE public.change_logs (
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
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_my_org_id() RETURNS uuid AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Bounding Box で取得する関数
CREATE OR REPLACE FUNCTION get_source_polygons_in_bbox(
  west double precision,
  south double precision,
  east double precision,
  north double precision
)
RETURNS TABLE(id text, geom geometry, area_sqm numeric, original_properties jsonb)
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT sp.id, sp.geom, sp.area_sqm, sp.original_properties
  FROM source_polygons sp
  WHERE sp.geom && ST_MakeEnvelope(west, south, east, north)
    AND NOT EXISTS (
      SELECT 1 FROM field_source_polygons fsp WHERE fsp.source_polygon_id = sp.id
    )
  LIMIT 3000;
$$;

-- ============================================================
-- RLS (Row Level Security) の設定
-- 非常にシンプルで強力な設定に統合します
-- ============================================================

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_polygons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_source_polygons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_logs ENABLE ROW LEVEL SECURITY;

-- organizations
CREATE POLICY "誰もが自分の組織を参照可能" ON public.organizations FOR SELECT USING (true);
CREATE POLICY "ログインユーザーは組織を作成可能" ON public.organizations FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- profiles
CREATE POLICY "プロフィール参照" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "自身のプロフィール更新" ON public.profiles FOR ALL USING (auth.uid() = id);

-- source_polygons
CREATE POLICY "誰でも筆ポリゴンを参照可能" ON public.source_polygons FOR SELECT USING (true);
CREATE POLICY "ログインユーザーは筆ポリゴンを作成可能" ON public.source_polygons FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- fields & field_source_polygons
CREATE POLICY "誰でも圃場を参照可能" ON public.fields FOR SELECT USING (true);
CREATE POLICY "ログインユーザーは圃場を編集可能" ON public.fields FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "誰でも中間テーブルを参照可能" ON public.field_source_polygons FOR SELECT USING (true);
CREATE POLICY "ログインユーザーは中間テーブルを編集可能" ON public.field_source_polygons FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- field_points
CREATE POLICY "誰でもポイントを参照可能" ON public.field_points FOR SELECT USING (true);
CREATE POLICY "ログインユーザーはポイントを編集可能" ON public.field_points FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- change_logs
CREATE POLICY "誰でもログを参照可能" ON public.change_logs FOR SELECT USING (true);
CREATE POLICY "ログインユーザーはログを記録可能" ON public.change_logs FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- Storage (画像保存用) の設定
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('point_images', 'point_images', true) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "全ユーザーが画像を閲覧可能" ON storage.objects;
CREATE POLICY "全ユーザーが画像を閲覧可能" ON storage.objects FOR SELECT USING (bucket_id = 'point_images');

DROP POLICY IF EXISTS "認証ユーザーが画像をアップロード可能" ON storage.objects;
CREATE POLICY "認証ユーザーが画像をアップロード可能" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'point_images' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "認証ユーザーが画像を削除可能" ON storage.objects;
CREATE POLICY "認証ユーザーが画像を削除可能" ON storage.objects FOR DELETE USING (bucket_id = 'point_images' AND auth.role() = 'authenticated');

-- ============================================================
-- 完了
-- ============================================================
