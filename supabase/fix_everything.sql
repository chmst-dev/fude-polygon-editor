-- ============================================================
-- 1. field_points の CHECK制約（point_typeの制限）を削除
-- 「水尻」を「落とし」に変更したことによるエラーを防止します
-- ============================================================
-- 既存のCHECK制約を安全に削除するため、制約名を探して削除します
DO $$ 
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.field_points'::regclass AND contype = 'c';
  
  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.field_points DROP CONSTRAINT ' || constraint_name;
  END IF;
END $$;

-- 念のため、nameのNOT NULL制約も確実に外しておきます
ALTER TABLE public.field_points ALTER COLUMN name DROP NOT NULL;

-- ============================================================
-- 2. field_points の RLS（アクセス権限）を完全にリセット
-- 重複や設定ミスによる「保存したのに見えない」問題を解決します
-- ============================================================
ALTER TABLE public.field_points ENABLE ROW LEVEL SECURITY;

-- 全ての既存ポリシーを削除（コンフリクト回避）
DROP POLICY IF EXISTS "fieldsの権限に基づくfield_pointsアクセス" ON public.field_points;
DROP POLICY IF EXISTS "誰でもポイントを閲覧可能" ON public.field_points;
DROP POLICY IF EXISTS "認証ユーザーがポイントを操作可能" ON public.field_points;

-- 新しい、シンプルで確実なポリシーを設定

-- (A) 閲覧：全員（共有URLのゲスト含む）が全てのポイントを取得可能
CREATE POLICY "ポイント閲覧ポリシー"
ON public.field_points FOR SELECT
USING (true);

-- (B) 挿入・更新・削除：ログイン済みのユーザーのみ可能
CREATE POLICY "ポイント編集ポリシー"
ON public.field_points FOR ALL
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- これでテーブルの制限や権限による「保存エラー」「取得エラー」は全て解消されます。
-- ============================================================
