-- ============================================================
-- 1. field_points テーブルに画像URLカラムを追加
-- ============================================================
ALTER TABLE public.field_points
ADD COLUMN IF NOT EXISTS image_url text;

-- ============================================================
-- 2. 地点名称（name）カラムの NOT NULL 制約を解除（フリーテキスト廃止のため）
-- ============================================================
ALTER TABLE public.field_points
ALTER COLUMN name DROP NOT NULL;

-- ============================================================
-- 3. 画像保存用 Storage バケットの作成
-- ============================================================
-- "point_images" バケットを作成 (公開アクセス可能)
INSERT INTO storage.buckets (id, name, public)
VALUES ('point_images', 'point_images', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 4. Storage のアクセス権限 (RLSポリシー) の設定
-- ============================================================
-- 誰でも画像を閲覧(ダウンロード)可能
CREATE POLICY "全ユーザーが画像を閲覧可能"
ON storage.objects FOR SELECT
USING (bucket_id = 'point_images');

-- 認証済みユーザーのみ画像をアップロード可能
CREATE POLICY "認証ユーザーが画像をアップロード可能"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'point_images' AND
  auth.role() = 'authenticated'
);

-- 認証済みユーザーのみ画像を削除可能
CREATE POLICY "認証ユーザーが画像を削除可能"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'point_images' AND
  auth.role() = 'authenticated'
);
