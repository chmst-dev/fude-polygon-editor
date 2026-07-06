-- ============================================================
-- マイグレーション事前確認（Preflight）SQL
-- preflight_work_features.sql
-- ============================================================
-- 目的: 本番データベース（Supabase）に移行SQLを適用する前に、
--       現在のスキーマ状態、拡張機能、関数定義、および権限設定を
--       「読み取り専用」で安全に確認するためのものです。
-- 実行方法: Supabase ダッシュボード -> SQL Editor で実行して結果を確認します。
-- ============================================================

-- 1. PostgreSQL/PostGIS/pgcrypto 拡張機能の状態および配置スキーマ確認
SELECT ext.extname, ext.extversion, nsp.nspname AS schema_name
FROM pg_extension ext
JOIN pg_namespace nsp ON nsp.oid = ext.extnamespace
WHERE ext.extname IN ('postgis', 'pgcrypto');

-- 2. 移行対象テーブルの存在確認と列・型定義の確認
SELECT table_name, column_name, data_type, character_maximum_length, is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name IN (
    'organizations', 'profiles', 'source_polygons', 
    'fields', 'field_source_polygons', 'field_points', 
    'work_types', 'field_work_records', 'change_logs', 'share_links'
  )
ORDER BY table_name, ordinal_position;

-- 3. 移行対象テーブルの制約（プライマリキー、外部キー、CHECK制約など）の確認
-- (pg_class/pg_namespaceとのJOINにより対象テーブルを正確に特定)
SELECT con.conname AS constraint_name, 
       con.contype AS constraint_type, 
       c.relname AS table_name,
       pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'organizations', 'profiles', 'source_polygons', 
    'fields', 'field_source_polygons', 'field_points', 
    'work_types', 'field_work_records', 'change_logs', 'share_links'
  );

-- 4. 既存インデックスの確認
SELECT tablename, indexname, indexdef 
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND tablename IN (
    'organizations', 'profiles', 'source_polygons', 
    'fields', 'field_source_polygons', 'field_points', 
    'work_types', 'field_work_records', 'change_logs', 'share_links'
  );

-- 5. RLS (Row Level Security) の有効化・強制適用の状態確認
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'organizations', 'profiles', 'source_polygons', 
    'fields', 'field_source_polygons', 'field_points', 
    'work_types', 'field_work_records', 'change_logs', 'share_links'
  );

-- 6. 現在の RLS ポリシーの適用状態確認 (publicテーブル)
SELECT tablename, policyname, roles, cmd, qual, with_check 
FROM pg_policies 
WHERE schemaname = 'public' 
  AND tablename IN (
    'organizations', 'profiles', 'source_polygons', 
    'fields', 'field_source_polygons', 'field_points', 
    'work_types', 'field_work_records', 'change_logs', 'share_links'
  );

-- 7. ストレージ (storage.objects) の既存 RLS ポリシー確認
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects';

-- 8. 移行に必要な関数および演算子が実際に存在するスキーマの確認
-- 8-1. 指定関数のスキーマ位置確認
SELECT nsp.nspname AS schema_name, 
       p.proname AS function_name, 
       pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
WHERE p.proname IN ('st_makeenvelope', 'gen_random_bytes', 'sha256', 'digest');

-- 8-2. PostGIS '&&' 演算子のスキーマ位置確認
SELECT nsp.nspname AS schema_name, 
       opr.oprname AS operator_name, 
       opr.oprleft::regtype AS left_type, 
       opr.oprright::regtype AS right_type
FROM pg_operator opr
JOIN pg_namespace nsp ON nsp.oid = opr.oprnamespace
WHERE opr.oprname = '&&';

-- 9. 既存 SECURITY DEFINER 関数についての proconfig (パラメータ設定) 確認
-- (search_path が正しく設定されているかを確認します)
SELECT proname AS function_name, 
       pg_get_function_identity_arguments(p.oid) AS arguments, 
       proconfig AS function_config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN ('get_my_role', 'get_my_org_id', 'handle_new_user', 'get_source_polygons_in_bbox');

-- 10. 既存 RPC 関数の定義 (pg_get_functiondef) および所有者の確認
SELECT p.proname AS function_name, 
       pg_get_function_identity_arguments(p.oid) AS arguments, 
       pg_get_userbyid(proowner) AS function_owner,
       pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p 
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' 
  AND proname IN (
    'get_my_role', 'get_my_org_id', 'handle_new_user', 'get_source_polygons_in_bbox',
    'merge_fields', 'create_share_link', 'revoke_share_links', 'get_field_ids_by_work_type',
    'get_latest_work_records', 'get_field_work_records', 'get_fields_by_share_token',
    'get_points_by_share_token', 'get_field_source_polygons_by_share_token'
  );

-- 11. 対象関数の各ロールに対する EXECUTE 権限の確認
-- (has_function_privilege は PUBLIC 権限を包括して判別不能になるため、
--  proacl に対して aclexplode を用いて grantee = 0 (PUBLIC) かつ privilege_type = 'EXECUTE' の有無を厳密に判定)
SELECT p.proname AS function_name, 
       pg_get_function_identity_arguments(p.oid) AS arguments,
       EXISTS (
         SELECT 1 
         FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) ae
         WHERE ae.grantee = 0 
           AND ae.privilege_type = 'EXECUTE'
       ) AS is_public_executable,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       p.proacl AS raw_acl
FROM pg_proc p 
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' 
  AND proname IN (
    'get_my_role', 'get_my_org_id', 'handle_new_user', 'get_source_polygons_in_bbox',
    'merge_fields', 'create_share_link', 'revoke_share_links', 'get_field_ids_by_work_type',
    'get_latest_work_records', 'get_field_work_records', 'get_fields_by_share_token',
    'get_points_by_share_token', 'get_field_source_polygons_by_share_token'
  );

-- 12. Supabase schema migrations 履歴テーブルの有無確認
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'supabase_migrations' 
    AND table_name = 'schema_migrations'
) AS has_migrations_table;

-- 13. migrations 履歴が存在する場合の、直近適用履歴の取得手順 (クエリ)
-- (※履歴テーブルが存在する場合のみ実行してください)
-- SELECT version, statements, dirty 
-- FROM supabase_migrations.schema_migrations 
-- ORDER BY version DESC 
-- LIMIT 10;

-- 14. 既存テーブルのデータ件数確認
SELECT 'organizations' AS table_name, COUNT(*) AS row_count FROM public.organizations UNION ALL
SELECT 'profiles', COUNT(*) FROM public.profiles UNION ALL
SELECT 'fields', COUNT(*) FROM public.fields UNION ALL
SELECT 'field_source_polygons', COUNT(*) FROM public.field_source_polygons UNION ALL
SELECT 'field_points', COUNT(*) FROM public.field_points UNION ALL
SELECT 'change_logs', COUNT(*) FROM public.change_logs;

-- 15. 今回 DROP 対象となる既存関数への依存オブジェクトの確認 (dep.refobjid = 関数OID)
-- ※警告: PL/pgSQLの関数本文内で動的SQLや動的文字列評価によって呼び出されている依存関係は、
--   PostgreSQLの pg_depend では追跡できず、完全な検出は不可能です。
SELECT p.proname AS drop_target_function,
       dep.deptype AS dependency_type,
       CASE dep.classid
         WHEN 'pg_class'::regclass THEN (SELECT relname FROM pg_class WHERE oid = dep.objid)
         WHEN 'pg_proc'::regclass THEN (SELECT proname FROM pg_proc WHERE oid = dep.objid)
         WHEN 'pg_trigger'::regclass THEN (SELECT tgname FROM pg_trigger WHERE oid = dep.objid)
         ELSE dep.objid::text
       END AS dependent_object_name,
       dep.classid::regclass AS dependent_object_class
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_depend dep ON dep.refobjid = p.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'create_share_link', 'revoke_share_links', 'get_field_ids_by_work_type',
    'get_latest_work_records', 'get_field_work_records', 'get_fields_by_share_token',
    'get_points_by_share_token', 'get_field_source_polygons_by_share_token'
  )
  AND dep.deptype IN ('n', 'a');
