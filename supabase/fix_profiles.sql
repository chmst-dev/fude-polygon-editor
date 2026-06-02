-- ============================================================
-- 既存の auth.users のための profiles / organizations 復旧スクリプト
-- ============================================================
-- 先ほどのテーブル削除により、ログインセッションは残っているのに
-- プロフィールデータだけが消えてしまった状態を修復します。

DO $$ 
DECLARE
  r RECORD;
  new_org_id uuid;
  display_name_val text;
BEGIN
  -- auth.users には存在するが profiles に存在しないユーザーを全て処理
  FOR r IN SELECT * FROM auth.users WHERE id NOT IN (SELECT id FROM public.profiles) LOOP
    
    -- 表示名をメタデータまたはメールアドレスから作成
    display_name_val := COALESCE(
      r.raw_user_meta_data->>'display_name',
      split_part(r.email, '@', 1)
    );

    -- 組織を新規作成
    INSERT INTO public.organizations (name)
    VALUES (display_name_val || 'の組織')
    RETURNING id INTO new_org_id;

    -- プロフィールを作成
    INSERT INTO public.profiles (id, organization_id, role, display_name)
    VALUES (r.id, new_org_id, 'org_admin', display_name_val);

  END LOOP;
END $$;
