-- ============================================================
-- RLS 統合修正 SQL (fix_rls_final.sql)
-- ============================================================
-- 目的: public スキーマの全テーブルで RLS を有効化し、
--       アプリ仕様に合った最小権限ポリシーを設定する。
--
-- 適用方法: Supabase ダッシュボード → SQL Editor で全文貼り付けて実行
--
-- 影響範囲:
--   - anon への INSERT/UPDATE/DELETE は全テーブルで禁止される
--   - authenticated は自組織データのみ操作可能になる
--   - SELECT は引き続き anon でも許可（共有URL機能のため）
-- ============================================================

-- ============================================================
-- STEP 1: 全テーブルの RLS 有効化（すでに ON なら無害）
-- ============================================================
ALTER TABLE public.organizations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_polygons       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fields                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_source_polygons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_points          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_logs           ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 2: 既存ポリシーをすべてクリア（冪等に再実行できるよう）
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'organizations', 'profiles', 'source_polygons',
        'fields', 'field_source_polygons', 'field_points', 'change_logs'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename
    );
  END LOOP;
END $$;

-- ============================================================
-- STEP 3: organizations ポリシー
-- ============================================================
-- 全員が組織名を参照可能（共有URLでの組織表示・ヘルパー関数に必要）
CREATE POLICY "org_select_all"
  ON public.organizations FOR SELECT
  USING (true);

-- ログインユーザーは組織を作成可能（サインアップトリガー用）
CREATE POLICY "org_insert_authenticated"
  ON public.organizations FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- 自組織の情報のみ更新可能
CREATE POLICY "org_update_own"
  ON public.organizations FOR UPDATE
  USING (public.get_my_org_id() = id)
  WITH CHECK (public.get_my_org_id() = id);

-- 管理者のみ削除可能
CREATE POLICY "org_delete_admin"
  ON public.organizations FOR DELETE
  USING (public.get_my_role() = 'admin');

-- ============================================================
-- STEP 4: profiles ポリシー
-- ============================================================
-- 自身または同組織メンバーのプロフィールのみ参照可能
-- （change_logs の JOIN で profiles.display_name を取得するために必要）
CREATE POLICY "profiles_select_own_or_org"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id
    OR public.get_my_org_id() = organization_id
  );

-- 自身のプロフィールのみ更新可能
CREATE POLICY "profiles_update_self"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- handle_new_user() トリガー (SECURITY DEFINER) での挿入を補助
-- auth.uid() = id になるユーザー自身の挿入のみ許可
CREATE POLICY "profiles_insert_self"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ============================================================
-- STEP 5: source_polygons ポリシー
-- ============================================================
-- 全員が筆ポリゴンマスタを参照可能（地図の基盤データ）
CREATE POLICY "source_polygons_select_all"
  ON public.source_polygons FOR SELECT
  USING (true);

-- ログインユーザーのみ作成可能（筆データアップロード機能）
CREATE POLICY "source_polygons_insert_authenticated"
  ON public.source_polygons FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ログインユーザーのみ更新可能（upsert 対応）
CREATE POLICY "source_polygons_update_authenticated"
  ON public.source_polygons FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 削除は管理者のみ
CREATE POLICY "source_polygons_delete_admin"
  ON public.source_polygons FOR DELETE
  USING (public.get_my_role() = 'admin');

-- ============================================================
-- STEP 6: fields ポリシー
-- ============================================================
-- 全員が圃場を参照可能
-- ※ GuestService（共有URL）が anon で閲覧するため必要
--   フロント側 GuestService.getFields() で organization_id フィルタ実施
CREATE POLICY "fields_select_all"
  ON public.fields FOR SELECT
  USING (true);

-- 自組織の圃場のみ作成可能
CREATE POLICY "fields_insert_own_org"
  ON public.fields FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND public.get_my_org_id() = organization_id
  );

-- 自組織の圃場のみ更新可能
CREATE POLICY "fields_update_own_org"
  ON public.fields FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND public.get_my_org_id() = organization_id
  )
  WITH CHECK (
    auth.role() = 'authenticated'
    AND public.get_my_org_id() = organization_id
  );

-- 自組織の圃場のみ削除可能
CREATE POLICY "fields_delete_own_org"
  ON public.fields FOR DELETE
  USING (
    auth.role() = 'authenticated'
    AND public.get_my_org_id() = organization_id
  );

-- ============================================================
-- STEP 7: field_source_polygons ポリシー（中間テーブル）
-- ============================================================
-- 全員が参照可能（fields の JOIN に必要）
CREATE POLICY "fsp_select_all"
  ON public.field_source_polygons FOR SELECT
  USING (true);

-- 自組織の field に紐づく中間レコードのみ作成可能
CREATE POLICY "fsp_insert_own_org"
  ON public.field_source_polygons FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.fields
      WHERE fields.id = field_source_polygons.field_id
        AND fields.organization_id = public.get_my_org_id()
    )
  );

-- 自組織の field に紐づく中間レコードのみ削除可能
CREATE POLICY "fsp_delete_own_org"
  ON public.field_source_polygons FOR DELETE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.fields
      WHERE fields.id = field_source_polygons.field_id
        AND fields.organization_id = public.get_my_org_id()
    )
  );

-- ============================================================
-- STEP 8: field_points ポリシー
-- ============================================================
-- 全員が参照可能（共有URLのゲストも地点マーカーを閲覧）
CREATE POLICY "field_points_select_all"
  ON public.field_points FOR SELECT
  USING (true);

-- 自組織の field に紐づくポイントのみ作成可能
CREATE POLICY "field_points_insert_own_org"
  ON public.field_points FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.fields
      WHERE fields.id = field_points.field_id
        AND fields.organization_id = public.get_my_org_id()
    )
  );

-- 自組織の field に紐づくポイントのみ更新可能
CREATE POLICY "field_points_update_own_org"
  ON public.field_points FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.fields
      WHERE fields.id = field_points.field_id
        AND fields.organization_id = public.get_my_org_id()
    )
  )
  WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.fields
      WHERE fields.id = field_points.field_id
        AND fields.organization_id = public.get_my_org_id()
    )
  );

-- 自組織の field に紐づくポイントのみ削除可能
CREATE POLICY "field_points_delete_own_org"
  ON public.field_points FOR DELETE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.fields
      WHERE fields.id = field_points.field_id
        AND fields.organization_id = public.get_my_org_id()
    )
  );

-- ============================================================
-- STEP 9: change_logs ポリシー
-- ============================================================
-- ログインユーザーは自組織に関連するログのみ参照可能
CREATE POLICY "change_logs_select_own_org"
  ON public.change_logs FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      public.get_my_role() = 'admin'
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = change_logs.profile_id
          AND profiles.organization_id = public.get_my_org_id()
      )
    )
  );

-- 自身のログのみ挿入可能
CREATE POLICY "change_logs_insert_own"
  ON public.change_logs FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND auth.uid() = profile_id
  );

-- ============================================================
-- STEP 10: Storage (point_images) ポリシーの再設定
-- ============================================================
DROP POLICY IF EXISTS "全ユーザーが画像を閲覧可能"       ON storage.objects;
DROP POLICY IF EXISTS "認証ユーザーが画像をアップロード可能" ON storage.objects;
DROP POLICY IF EXISTS "認証ユーザーが画像を削除可能"       ON storage.objects;
-- rebuild_db.sql で設定した英語名も念のため削除
DROP POLICY IF EXISTS "point_images_select_all"         ON storage.objects;
DROP POLICY IF EXISTS "point_images_insert_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "point_images_delete_authenticated" ON storage.objects;

-- 全員が point_images バケットの画像を閲覧可能（公開画像）
CREATE POLICY "point_images_select_all"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'point_images');

-- ログインユーザーのみアップロード可能
CREATE POLICY "point_images_insert_authenticated"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'point_images'
    AND auth.role() = 'authenticated'
  );

-- ログインユーザーのみ削除可能
CREATE POLICY "point_images_delete_authenticated"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'point_images'
    AND auth.role() = 'authenticated'
  );

-- ============================================================
-- STEP 11: 適用確認クエリ（実行後に確認用として使用）
-- ============================================================
-- 以下を別途実行してポリシー一覧を確認できます:
--
-- SELECT tablename, policyname, cmd, roles, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
