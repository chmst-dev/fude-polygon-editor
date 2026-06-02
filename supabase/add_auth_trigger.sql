-- ============================================================
-- 追加マイグレーション: Auth Trigger による自動組織・プロフィール作成
-- Supabase の SQL Editor でこのファイルを実行してください
-- ============================================================

-- 新規ユーザーサインアップ時に自動で組織とプロフィールを作成する関数
create or replace function public.handle_new_user()
returns trigger as $$
declare
  new_org_id uuid;
  display_name_val text;
begin
  -- メタデータからdisplay_nameを取得（なければメールのローカル部を使用）
  display_name_val := coalesce(
    new.raw_user_meta_data->>'display_name',
    split_part(new.email, '@', 1)
  );

  -- 組織を自動作成
  insert into public.organizations (name)
  values (display_name_val || 'の組織')
  returning id into new_org_id;

  -- プロフィールを自動作成（org_adminロールで登録）
  insert into public.profiles (id, organization_id, role, display_name)
  values (new.id, new_org_id, 'org_admin', display_name_val);

  return new;
end;
$$ language plpgsql security definer;

-- 既存のトリガーがあれば削除してから再作成
drop trigger if exists on_auth_user_created on auth.users;

-- auth.users に新規レコードが挿入された際にトリガーを発火
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- source_polygons の INSERT ポリシーを org_admin にも開放
-- (筆データのアップロードに必要)
drop policy if exists "管理者のみ作成・更新・削除可能" on public.source_polygons;
create policy "認証ユーザーは筆データを作成・更新可能" on public.source_polygons
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
