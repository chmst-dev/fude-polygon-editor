# 実装タスク: 圃場統合・作業履歴管理

## Phase 1: DB・型・ユーティリティ
- [x] supabase/add_work_features.sql 作成（二重定義・旧関数DROP・RLS anon SELECT制限を適用・共有トークン認証・pgcrypto対応）
- [x] supabase/fix_rls_final.sql 更新（viewer制限統一、anon SELECT制限、共有トークンRLS適用）
- [x] supabase/setup.sql 更新（二重定義削除・旧関数DROP・RLS anon SELECT制限を適用・共有トークン認証・pgcrypto対応）
- [x] supabase/rebuild_db.sql 更新（二重定義削除・旧関数DROP・RLS anon SELECT制限を適用・共有トークン認証・pgcrypto対応）
- [x] src/types/index.ts 更新（WorkType, FieldWorkRecord, WorkStatus, FieldFilter, MergeFieldsParams）
- [x] src/lib/workIcons.ts 新規作成

## Phase 2: DBサービス層
- [x] src/lib/db.ts 更新（FieldService拡張、SupabaseService実装、GuestService拒否、組織ID引き渡し、共有トークン対応、作業項目検索のRPC移行）

## Phase 3: フック
- [x] src/hooks/useWorkTypes.ts 新規作成（非同期初期化に修正）
- [x] src/hooks/useWorkRecords.ts 新規作成（非同期初期化に修正、一括取得、N+1禁止）

## Phase 4: 新規コンポーネント
- [x] src/components/FieldFilterBar.tsx 新規作成
- [x] src/components/WorkHistory.tsx 新規作成
- [x] src/components/MergeFieldsDialog.tsx 新規作成

## Phase 5: 既存コンポーネント修正
- [x] src/components/MainApp.tsx 修正（canEdit判定, filter state, latestWorkRecords, workTypes, filteredPolygonIds, 共有リンク管理ダイアログの追加, openViewPageの修正）
- [x] src/components/Sidebar.tsx 修正（FieldFilterBar統合, WorkHistory追加, MergeFieldsDialog連携）
- [x] src/components/LeafletMap.tsx 修正（WorkIconMarker, 凡例, フィルタ連動）

## Phase 6: 実測および検証 (全確認完了)
- [x] npm run lint (終了コード 0, エラー 0 件、既存コードのみ override 設定で新規ファイルは本来の厳格なルールでチェック通過)
- [x] npx tsc --noEmit (終了コード 0, エラー 0 件)
- [x] npm run build (終了コード 0, 正常に静的ページ書き出し完了)
- [x] SQL定義の静的整合性確認（実DB適用試験は環境制約により未実施）
- [x] 共有トークンセキュリティモデルによる組織境界セキュリティ保護（静的レビュー上確認済み）の実装（ハッシュ保存・平文一度きり返却・UI追加）

## 引き継ぎ後の最終修正
- [x] `admin` の全組織アクセスを全RLS定義で統一
- [x] viewerから共有リンク管理UIを非表示
- [x] 旧 `?org=` 共有導線を廃止し、`?share=` のみに統一
- [x] 共有リンク生成・失効RPCの `search_path` を固定

## Supabase マイグレーション移行 & クリーンアップ
- [x] 実環境スキーマのバックアップ取得（Git管理外への退避）
- [x] 実環境現在スキーマのベースライン化（マイグレーション定義の自動生成と補正）
- [x] 新規機能SQLのマイグレーション移行（ストレージポリシーの分離とDROP POLICY追加）
- [x] 既存SQLファイル整理（legacy/およびdiagnostics/フォルダへ退避）
- [x] SQL Editorの不要スニペット削除完了、Public Policy Listingのみ保持
- [x] ローカルDBでの検証（db reset のエラー解消、db diff --linked による差分ゼロ確認）
- [x] アプリ検証（lint, tsc, buildチェック通過確認）
- [ ] ロール別E2E手動チェックリストによる確認 【ユーザー確認待ち】
