-- ============================================================
-- field_points テーブルの閲覧権限（RLSポリシー）を修正するSQL
-- ============================================================

-- 既存の field_points テーブルの RLS を有効化（念のため）
ALTER TABLE public.field_points ENABLE ROW LEVEL SECURITY;

-- 全ユーザー（ゲストの共有URLを含む）がポイントを閲覧できるようにポリシーを作成
-- (すでに別のポリシーが存在する場合は IF NOT EXISTS 的に動作させるため、エラーを無視するか DROP してから作ります)
DROP POLICY IF EXISTS "誰でもポイントを閲覧可能" ON public.field_points;
CREATE POLICY "誰でもポイントを閲覧可能"
ON public.field_points FOR SELECT
USING (true);

-- 認証ユーザーのみがポイントを登録・更新・削除できるようにするポリシー（必要に応じて）
DROP POLICY IF EXISTS "認証ユーザーがポイントを操作可能" ON public.field_points;
CREATE POLICY "認証ユーザーがポイントを操作可能"
ON public.field_points FOR ALL
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');
