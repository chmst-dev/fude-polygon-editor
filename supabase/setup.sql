-- PostGISの有効化 (Supabaseでは標準で利用可能)
create extension if not exists postgis;

-- 1. 組織テーブル (organizations)
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. プロフィールテーブル (profiles)
-- ロール: 'admin' (全体管理者), 'org_admin' (組織管理者), 'viewer' (閲覧者)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  role text not null check (role in ('admin', 'org_admin', 'viewer')),
  display_name text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. 元筆ポリゴンマスターデータ (source_polygons)
-- 農林水産省等のオリジナルデータを格納 (読み取り専用マスタ)
create table if not exists public.source_polygons (
  id text primary key, -- 元のフィーチャーID (MAFF筆IDなど)
  geom geometry(Geometry, 4326) not null, -- PostGISの地理空間ジオメトリ
  area_sqm numeric, -- 平方メートル面積
  original_properties jsonb, -- 元の全属性
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index if not exists source_polygons_geom_idx on public.source_polygons using gist (geom);

-- 4. 圃場マスタ (fields)
-- 現場実態に即した「圃場」単位のデータ。複数の source_polygons を束ねられる
create table if not exists public.fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  producer_name text, -- 生産者名
  field_name text, -- 現場の通称（圃場名）
  crop_type text, -- 作付
  notes text, -- 注意点
  status text not null default 'active', -- ステータス ('active', 'inactive', 'planned')
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. 圃場と元筆の多対多中間テーブル (field_source_polygons)
-- 複数の筆を1つの圃場（field）に紐づける (グループ化)
create table if not exists public.field_source_polygons (
  field_id uuid references public.fields(id) on delete cascade,
  source_polygon_id text references public.source_polygons(id) on delete cascade,
  primary key (field_id, source_polygon_id),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. 圃場付属ポイント (field_points)
-- 水口や入口など、圃場内の重要地点
create table if not exists public.field_points (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.fields(id) on delete cascade,
  point_type text not null check (point_type in ('入口', '駐車場所', '水口', '水尻', '危険箇所', 'その他')),
  name text not null,
  description text,
  geom geometry(Point, 4326) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index if not exists field_points_geom_idx on public.field_points using gist (geom);

-- 7. 変更履歴 (change_logs)
create table if not exists public.change_logs (
  id uuid primary key default gen_random_uuid(),
  field_id uuid references public.fields(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  action text not null, -- 'create', 'update', 'delete', 'group_polygons', 'add_point' など
  old_values jsonb,
  new_values jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLSの有効化
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.source_polygons enable row level security;
alter table public.fields enable row level security;
alter table public.field_source_polygons enable row level security;
alter table public.field_points enable row level security;
alter table public.change_logs enable row level security;

-- 共通ヘルパー関数: 現在のユーザーのロールを取得
create or replace function public.get_my_role()
returns text as $$
  select role from public.profiles where id = auth.uid();
$$ language sql security definer;

-- 共通ヘルパー関数: 現在のユーザーの所属組織IDを取得
create or replace function public.get_my_org_id()
returns uuid as $$
  select organization_id from public.profiles where id = auth.uid();
$$ language sql security definer;

---------------------------------------------------------
-- profiles のポリシー
---------------------------------------------------------
drop policy if exists "自分のプロフィールの参照・作成・更新" on public.profiles;
create policy "自分のプロフィールの参照・作成・更新" on public.profiles
  for all using (auth.uid() = id);

drop policy if exists "同じ組織のメンバーの参照" on public.profiles;
create policy "同じ組織のメンバーの参照" on public.profiles
  for select using (
    get_my_role() = 'admin' or get_my_org_id() = organization_id
  );

---------------------------------------------------------
-- organizations のポリシー
---------------------------------------------------------
drop policy if exists "管理者は全組織参照・編集可能" on public.organizations;
create policy "管理者は全組織参照・編集可能" on public.organizations
  for all using (get_my_role() = 'admin');

drop policy if exists "所属ユーザーは自組織のみ参照可能" on public.organizations;
create policy "所属ユーザーは自組織のみ参照可能" on public.organizations
  for select using (get_my_org_id() = id);

drop policy if exists "認証ユーザーは組織を作成可能" on public.organizations;
create policy "認証ユーザーは組織を作成可能" on public.organizations
  for insert with check (auth.role() = 'authenticated');

---------------------------------------------------------
-- source_polygons のポリシー (共有読み取り専用マスタ)
---------------------------------------------------------
drop policy if exists "全認証ユーザーが参照可能" on public.source_polygons;
create policy "全認証ユーザーが参照可能" on public.source_polygons
  for select using (auth.role() in ('authenticated', 'anon'));

drop policy if exists "管理者のみ作成・更新・削除可能" on public.source_polygons;
create policy "管理者のみ作成・更新・削除可能" on public.source_polygons
  for all using (get_my_role() = 'admin');

---------------------------------------------------------
-- fields のポリシー
---------------------------------------------------------
drop policy if exists "管理者は全件アクセス可能" on public.fields;
create policy "管理者は全件アクセス可能" on public.fields
  for all using (get_my_role() = 'admin');

drop policy if exists "組織管理者は自組織の圃場のみ参照・編集可能" on public.fields;
create policy "組織管理者は自組織の圃場のみ参照・編集可能" on public.fields
  for all using (
    get_my_role() = 'org_admin' and get_my_org_id() = organization_id
  );

drop policy if exists "一般閲覧者は自組織の圃場のみ参照可能" on public.fields;
create policy "一般閲覧者は自組織の圃場のみ参照可能" on public.fields
  for select using (
    auth.role() = 'anon' or
    (get_my_role() = 'viewer' and get_my_org_id() = organization_id)
  );

---------------------------------------------------------
-- field_source_polygons のポリシー
---------------------------------------------------------
drop policy if exists "fieldsの権限に基づくfield_source_polygonsアクセス" on public.field_source_polygons;
create policy "fieldsの権限に基づくfield_source_polygonsアクセス" on public.field_source_polygons
  for all using (
    auth.role() = 'anon' or
    get_my_role() = 'admin' or 
    exists (
      select 1 from public.fields 
      where fields.id = field_source_polygons.field_id 
        and fields.organization_id = get_my_org_id()
    )
  );

---------------------------------------------------------
-- field_points のポリシー
---------------------------------------------------------
drop policy if exists "fieldsの権限に基づくfield_pointsアクセス" on public.field_points;
create policy "fieldsの権限に基づくfield_pointsアクセス" on public.field_points
  for all using (
    auth.role() = 'anon' or
    get_my_role() = 'admin' or 
    exists (
      select 1 from public.fields 
      where fields.id = field_points.field_id 
        and fields.organization_id = get_my_org_id()
    )
  );

---------------------------------------------------------
-- change_logs のポリシー
---------------------------------------------------------
drop policy if exists "自組織に関連するログのみ参照可能" on public.change_logs;
create policy "自組織に関連するログのみ参照可能" on public.change_logs
  for select using (
    get_my_role() = 'admin' or
    exists (
      select 1 from public.profiles
      where profiles.id = change_logs.profile_id
        and profiles.organization_id = get_my_org_id()
    )
  );

drop policy if exists "認証ユーザーはログ挿入可能" on public.change_logs;
create policy "認証ユーザーはログ挿入可能" on public.change_logs
  for insert with check (auth.role() = 'authenticated');
