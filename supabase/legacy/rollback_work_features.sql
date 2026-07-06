-- ============================================================
-- ロールバック（原状復帰）安全性評価および非自動化宣言 SQL
-- rollback_work_features.sql
-- ============================================================
-- 重要警告:
-- 1. 本スクリプトを実行可能なロールバックとして扱わないでください。
-- 2. 実DBの「適用前スキーマダンプ」および「データバックアップ」がない限り、
--    自動的なデータベースの原状復帰（完全ロールバック）は不可能です。
-- 3. 適用時のトランザクション失敗時は自動的に `ROLLBACK` されますが、
--    適用コミット（COMMIT）後に障害が発生した場合は、本スクリプトによる
--    強引な復元ではなく、個別修正（forward-fix）を行うか、
--    移行直前の物理・論理バックアップからデータベース全体を復元してください。
-- ============================================================

-- 誤実行防止のための例外発生ブロック
DO $$
BEGIN
  RAISE EXCEPTION '誤実行防止: 本スクリプトは自動適用によるロールバックには使用できません。実環境の移行直前に取得したスキーマダンプから復元するか、手動による個別の forward-fix を行ってください。';
END $$;

-- 以下のクリーンアップ定義は、手動で復旧作業を行う際の「参考情報」として記述されています。
-- 直接一括実行することはできません。

/*
-- 1. 新規テーブルおよび RPC 関数の削除 (データは全消失します)
DROP FUNCTION IF EXISTS public.get_field_source_polygons_by_share_token(text);
DROP FUNCTION IF EXISTS public.get_points_by_share_token(text);
DROP FUNCTION IF EXISTS public.get_fields_by_share_token(text);
DROP FUNCTION IF EXISTS public.get_field_work_records(uuid, text);
DROP FUNCTION IF EXISTS public.get_latest_work_records(uuid[], text);
DROP FUNCTION IF EXISTS public.get_field_ids_by_work_type(uuid, text);
DROP FUNCTION IF EXISTS public.revoke_share_links(uuid);
DROP FUNCTION IF EXISTS public.create_share_link(uuid);
DROP FUNCTION IF EXISTS public.merge_fields(uuid, uuid[], jsonb);

DROP TABLE IF EXISTS public.share_links;
DROP TABLE IF EXISTS public.field_work_records;
DROP TABLE IF EXISTS public.work_types;

-- 2. 変更された既存定義の復元について
-- 既存関数 (get_my_role, get_my_org_id, handle_new_user 等) の定義、
-- および organizations, profiles, fields などの RLS ポリシーは、
-- 適用直前の本番 DB のスキーマ定義ダンプから SQL 定義を直接抽出して
-- 手動で再適用する必要があります（以前の状態は各プロジェクトの運用履歴に依存するため）。
*/
