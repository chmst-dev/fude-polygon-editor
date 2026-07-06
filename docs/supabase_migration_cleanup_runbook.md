# Supabase SQL資産整理・マイグレーション移行 作業指示書

## 目的

この作業の目的は、Supabase SQL Editorへの手動投入を前提とした現在のSQL資産を整理し、実環境の現在状態を基準にした `supabase/migrations/` 管理へ安全に移行することです。

この作業が完了するまで、別機能のDB変更を含む `git push`、本番DBへのSQL適用、Table Editorでのスキーマ変更は停止してください。

> [!IMPORTANT]
> SQL Editorの保存スニペット数と、リポジトリ内のSQLファイル数を一致させることは目標ではありません。正本は、移行後の `supabase/migrations/` とGit履歴です。

## 現状

- `supabase/` 直下にSQLファイルが13個あります。
- `supabase/migrations/` と `supabase/config.toml` はまだありません。
- `setup.sql`、`rebuild_db.sql`、差分追加、修正、事前確認、ロールバックが同じ階層に混在しています。
- `setup.sql`、`rebuild_db.sql`、`add_work_features.sql`、`fix_rls_final.sql` には重複する定義があります。
- アプリの lint、型チェック、build と、実環境DBへのSQL適用確認は別物です。実環境への適用状況は未確認として扱います。

## 絶対に行わないこと

- `supabase/rebuild_db.sql` を実環境で実行しない。
- `supabase/setup.sql` を既存の実環境で実行しない。
- `supabase db reset --linked` または本番DBを指す `--db-url` 付きの `db reset` を実行しない。
- ベースラインを確認する前に `supabase db push` を実行しない。
- `migration repair` を「エラーが消えそう」という理由だけで実行しない。
- SQL EditorやTable Editorで、調査クエリ以外のスキーマ変更を行わない。
- DBパスワード、アクセストークン、接続文字列、ダンプファイルをGitへ追加しない。
- 既存のSQLファイルを、適用状況を確認せず削除またはmigrationへコピーしない。

## 完了条件

次のすべてを満たした時点で完了です。

- 実環境の適用前バックアップが、Git管理外の安全な場所に保存されている。
- 実環境の現在スキーマを表すベースラインmigrationがGit管理されている。
- ローカルDBを空の状態から `supabase db reset` で再構築できる。
- ローカルDBと実環境のschema diffが、説明可能な差分ゼロになっている。
- `supabase migration list` のLOCALとREMOTEが一致している。
- `supabase db push --dry-run` が、意図しない適用対象を表示しない。
- 既存の13ファイルが「baselineへ吸収済み」「今後のmigration」「診断用」「legacy」のいずれかに分類されている。
- 今後のDB変更ルールがREADMEまたは運用文書に記載されている。

---

## Phase 0: 変更凍結と作業記録

1. DB変更を伴う他作業を止めます。作業中にSQL EditorやTable Editorを変更する担当者がいないことを確認します。
2. 対象のSupabase Project Ref、環境名、本番・ステージングの別、作業日時、作業担当者を記録します。
3. 現在のGit状態を保存します。

   ```powershell
   git status --short
   git rev-parse HEAD
   ```

4. 既存の未コミット変更を破棄しないでください。本作業と無関係な変更には触れません。
5. SQL Editorのスニペットは、次の3分類だけ記録します。
   - スキーマ変更を行うもの
   - 調査・集計専用のもの
   - 役割不明または重複しているもの

スニペットの数合わせや全件コピーは不要です。実行日時が分からないスニペットは「適用済み」と判定しません。

> [!IMPORTANT]
> Supabase DashboardのSQL Editorに保存されたスニペットと、リポジトリ内の `supabase/*.sql`、`supabase/legacy/*.sql` は別の資産です。ローカルファイルの整理だけで、Dashboard上のスニペットが移動・改名・削除されることはありません。DashboardのSQL Editorを実際に開き、スニペット名と内容を個別に棚卸ししてください。リポジトリ内に `supabase/snippets/` が存在するかどうかは、Dashboard上のスニペット件数とは関係ありません。

### Phase 0 停止条件

- 対象環境が本番かステージングか判別できない。
- 他担当者によるDB変更を止められない。
- 接続先Project Refを確認できない。

いずれかに該当した場合は先へ進みません。

---

## Phase 1: CLI初期化と読み取り専用調査

### 1-1. Supabase CLIを導入する

Supabase CLIはプロジェクトのdevDependencyとしてバージョンを固定してください。導入後、`package.json` とlockfileをGit管理対象にします。

```powershell
npm install --save-dev supabase
npx supabase --version
npx supabase init
```

`supabase init` により `supabase/config.toml` が作成されます。既存SQLファイルは削除しません。

### 1-2. 対象プロジェクトをリンクする

```powershell
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
```

パスワードやトークンをコマンドへ直書きしません。リンク後、DashboardのURLと `<PROJECT_REF>` が一致することを二重確認します。

### 1-3. 現在のmigration履歴を確認する

```powershell
npx supabase migration list --linked
```

出力を作業記録へ貼り付けます。ここでは `repair`、`push`、`reset` を実行しません。

次のどちらかに分類します。

- **A: REMOTE履歴なし** — SQL Editorによる手動管理からの初回移行として進める。
- **B: REMOTE履歴あり** — 既存履歴を壊さず取得し、ローカルとの不一致原因を先に調査する。

履歴があるのに対応するmigrationファイルが見つからない場合は、勝手にREMOTE履歴をrevertしません。

---

## Phase 2: 適用前バックアップ

Git管理外の `C:\tmp\fude-supabase-backup\<日時>\` などへ、少なくともschemaとdataを分けて保存します。

```powershell
npx supabase db dump --linked --file "C:\tmp\fude-supabase-backup\<日時>\schema.sql"
npx supabase db dump --linked --data-only --use-copy --file "C:\tmp\fude-supabase-backup\<日時>\data.sql"
```

必要な場合はrolesも保存します。

```powershell
npx supabase db dump --linked --role-only --file "C:\tmp\fude-supabase-backup\<日時>\roles.sql"
```

注意事項:

- 標準のDB dumpにはStorage内の画像ファイル本体は含まれません。`point_images` など利用中のbucketは別に保全します。
- dumpコマンドの終了コード、各ファイルの存在、ファイルサイズが0ではないことを確認します。
- バックアップの復元試験をしていない場合は、完了報告に「取得済み・復元未検証」と明記します。

### Phase 2 停止条件

- dumpが失敗した。
- dumpファイルが空、または安全な保存先を確保できない。
- Storageの必要なデータを保全できない。

---

## Phase 3: 実環境スキーマのベースライン化

### 3-1. REMOTE履歴がない場合

実環境の現在状態を新しいbaseline migrationとして取得します。

```powershell
npx supabase db pull baseline_remote_schema
```

`Update remote migration history table?` と確認された場合、**初回は `N`** を選びます。生成ファイルをレビューし、ローカル再構築まで成功する前にREMOTE履歴を変更しないためです。

生成される想定ファイル:

```text
supabase/migrations/<TIMESTAMP>_baseline_remote_schema.sql
```

### 3-2. REMOTE履歴がある場合

先に次を実行し、履歴と既存ファイルを取得・比較します。

```powershell
npx supabase migration list --linked
npx supabase migration fetch --linked
```

REMOTEにだけ存在する履歴、LOCALにだけ存在する履歴がある場合は、各timestampについて対応する変更内容を特定します。内容を確認できないtimestampを推測で `applied` または `reverted` にしません。

### 3-3. ベースライン内容をレビューする

最低限、次を確認します。

- アプリが使用する `public` schemaのテーブル、列、制約、index。
- RLSの有効状態とpolicy。
- RPCおよびtrigger関数。
- `SECURITY DEFINER` 関数の `search_path`。
- `anon`、`authenticated` へのGRANT/REVOKE。
- `storage.objects` 関連policy。
- PostGIS、pgcryptoなどのextension依存。

`auth` と `storage` schemaは通常の `db pull` では除外される場合があります。アプリ固有の変更がある場合だけ、公式CLIの対象schema指定を確認したうえで別途取得・レビューします。Supabase管理オブジェクトを無差別にbaselineへ含めません。

---

## Phase 4: ローカルでの再構築確認

Docker Desktopを起動した状態で、ローカルSupabaseを開始します。

```powershell
npx supabase start
npx supabase db reset
```

ここでの `db reset` は、`--linked` も `--db-url` も付けないローカル専用です。

続いて、ローカルと実環境の差分を確認します。

```powershell
npx supabase db diff --linked
```

差分が出た場合は、次のどれかに分類してください。

- dump対象外のSupabase管理schemaによる想定差分。
- extensionの配置差による差分。
- baselineの取得漏れ。
- 実環境で作業中に変更が発生したschema drift。

説明できない差分が1つでもあれば先へ進みません。baselineへ手作業でSQLを足す場合は、追加理由と根拠となる実環境オブジェクトを記録します。

---

## Phase 5: 既存SQLファイルの棚卸し

各ファイルを次の表に記録します。判定はファイル名ではなく、実環境のオブジェクト定義との比較で行います。

| ファイル | 用途 | 実環境へ適用済みか | baselineに含まれるか | 今後の扱い |
|---|---|---:|---:|---|
| `setup.sql` | 新規環境の初期構築 | 要確認 | 要確認 | legacy候補・本番実行禁止 |
| `rebuild_db.sql` | 全再構築 | 実行禁止 | 対象外 | legacy・本番実行禁止 |
| `add_auth_trigger.sql` | 差分追加 | 要確認 | 要確認 | 吸収済みまたは新migration |
| `add_bbox_function.sql` | 差分追加 | 要確認 | 要確認 | 吸収済みまたは新migration |
| `add_image_support.sql` | 差分追加 | 要確認 | 要確認 | 吸収済みまたは新migration |
| `add_work_features.sql` | 今回の機能差分 | 未確認 | 要確認 | 下記分岐に従う |
| `fix_everything.sql` | 複合修正 | 要確認 | 要確認 | legacy候補 |
| `fix_geom_srid.sql` | 修正 | 要確認 | 要確認 | 吸収済みまたは新migration |
| `fix_points_rls.sql` | RLS修正 | 要確認 | 要確認 | 吸収済みまたは新migration |
| `fix_profiles.sql` | 修正 | 要確認 | 要確認 | 吸収済みまたは新migration |
| `fix_rls_final.sql` | RLS統合修正 | 未確認 | 要確認 | legacy候補または新migration |
| `preflight_work_features.sql` | 読み取り中心の事前確認 | 適用対象外 | 対象外 | `supabase/diagnostics/` 候補 |
| `rollback_work_features.sql` | 誤実行防止付き手順 | 適用対象外 | 対象外 | `supabase/legacy/` 候補 |

### `add_work_features.sql` の分岐

- **実環境にすべて存在する場合**: baselineに吸収済みとし、同じSQLを新migrationとして再適用しない。
- **実環境に一部だけ存在する場合**: baseline取得後、足りない差分だけを新しいtimestamp付きmigrationとして作成する。
- **実環境に存在しない場合**: baselineとは分離し、新しい正式migrationとしてレビュー・検証する。

新しいmigrationは次で作成します。

```powershell
npx supabase migration new add_work_features
```

既存ファイルを丸ごとコピーせず、現在のbaselineに対して必要な差分だけを記述します。

### legacy整理ルール

- 適用済みの手動SQLは、履歴の証拠としてすぐ削除せず `supabase/legacy/` へ移動する。
- 各legacyファイルの先頭に「本番実行禁止」「baselineへ吸収済みか」「用途」を記載する。
- 診断クエリは `supabase/diagnostics/` へ分離する。
- `supabase/` 直下には、CLIが管理する標準ファイルと用途が明確なディレクトリだけを残す。

---

## Phase 6: ベースライン履歴の同期

Phase 4とPhase 5の確認が完了し、baselineが実環境の現在状態と一致すると承認された後だけ実施します。

REMOTE履歴なしでbaselineを作成した場合、ファイル名先頭のtimestampを指定して「実環境では適用済み」と記録します。

```powershell
npx supabase migration repair <BASELINE_TIMESTAMP> --status applied --linked
npx supabase migration list --linked
```

`migration repair` はSQLを適用せず履歴だけを変更します。したがって、baselineと実環境が一致する証拠がない状態では実行禁止です。

続いてdry-runを行います。

```powershell
npx supabase db push --linked --dry-run
```

baselineを再適用しようとしていないことを確認します。未適用の正式migrationがある場合は、そのファイルだけがtimestamp順に表示されることを確認します。

---

## Phase 7: 未適用migrationの検証と適用

未適用の機能migrationがある場合、まずローカルDBを空から再構築します。

```powershell
npx supabase db reset
npm run lint
npx tsc --noEmit
npm run build
```

さらに、最低限次のロール別E2EをステージングまたはSupabase Branching環境で確認します。

- `admin`: 全組織の参照・管理。
- `org_admin`: 自組織の参照・編集、共有リンク管理。
- `viewer`: 自組織の読み取り専用。編集・共有リンク管理UIなし。
- `anon` + `?share=`: 有効な共有トークン範囲だけ読み取り可能。
- 無効・期限切れトークン: データを取得できない。

コード、RLS定義、RPC定義を読む静的レビューはE2Eの代替にはなりません。テストフレームワークがない場合も、各ロールの実アカウントと実際に発行した共有トークンを使い、ブラウザ操作とDB応答を確認します。静的レビューしか行っていない場合、完了報告では「設計レビュー済み・E2E未実施」と明記してください。

本番適用前に再度確認します。

```powershell
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

実際の `npx supabase db push --linked` は、対象migration、バックアップ、検証結果について人間の承認を得てから実行します。DB migrationを先に適用し、成功確認後に対応するフロントエンドをdeployします。

---

## Phase 8: 今後の運用ルール

移行完了後は、次のルールを守ります。

1. DB変更は必ず `npx supabase migration new <name>` で作る。
2. SQL EditorはSELECT中心の調査に使い、remote schemaを直接変更しない。
3. DashboardでローカルDBを変更した場合は、`supabase db diff` でmigration化する。
4. migrationは `supabase db reset` で空のローカルDBから検証する。
5. push前に `supabase migration list --linked` と `supabase db push --dry-run` を確認する。
6. migrationファイルは適用後に編集しない。修正は新しいmigrationで行う。
7. 本番への `db push` は同時に複数人が実行しない。
8. スキーマ変更とアプリ変更の検証結果を分けて報告する。

## 作業完了報告テンプレート

```markdown
## Supabase migration整理 完了報告

- 対象Project Ref: `<PROJECT_REF>`
- 対象環境: 本番 / ステージング
- baseline: `supabase/migrations/<TIMESTAMP>_baseline_remote_schema.sql`
- バックアップ: 取得済み / 復元確認済み・未確認
- migration list: LOCAL/REMOTE一致 / 不一致あり
- schema diff: 差分なし / 想定差分あり / 未解決差分あり
- db push dry-run: 適用なし / 適用予定 `<ファイル名>`
- legacy整理: 完了 / 未完了
- ローカルdb reset: 成功 / 未実施 / 失敗
- lint: 成功 / 未実施 / 失敗
- TypeScript: 成功 / 未実施 / 失敗
- build: 成功 / 未実施 / 失敗
- ロール別E2E: 成功 / 一部未実施 / 未実施
- SQL Editorスニペット棚卸し: 完了 / 削除承認待ち / 未実施
- 実環境db push: 実施済み / 未実施
- 残課題:
  - ...
```

## 参照

- [Supabase: Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase CLI: db pull / migration list / migration repair](https://supabase.com/docs/reference/cli/supabase-db-push)
- [Supabase CLI: db dump / db push / db reset](https://supabase.com/docs/reference/cli/supabase-start)
