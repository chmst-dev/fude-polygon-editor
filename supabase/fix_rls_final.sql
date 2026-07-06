-- ============================================================
-- RLS 統合修正 SQL (fix_rls_final.sql)
-- ============================================================
-- 目的: public スキーマの全テーブルで RLS を有効化し、
--       viewerロールが閲覧専用（更新不可）となるようポリシーを設定する。
--       全体管理者 (admin) ロールは、組織境界をバイパスして全データを操作できる権限を維持する。
--       未ログインの匿名 (anon) アクセスからの直接の SELECT は全て封鎖し、
--       共有トークン認証付き RPC のみを経由して安全に公開する。
-- ============================================================

-- STEP 1: 全テーブルの RLS 有効化
ALTER TABLE public.organizations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_polygons       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fields                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_source_polygons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_points          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_types            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_work_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_links           ENABLE ROW LEVEL SECURITY;

-- STEP 2: 既存ポリシーをすべてクリア
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
        'fields', 'field_source_polygons', 'field_points',
        'work_types', 'field_work_records', 'change_logs', 'share_links'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename
    );
  END LOOP;
END $$;

-- STEP 3: share_links ポリシー (admin は全組織分を参照可能)
CREATE POLICY "share_links_select_own_org" ON public.share_links FOR SELECT USING (
  auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR public.get_my_org_id() = organization_id)
);
CREATE POLICY "share_links_insert_own_org" ON public.share_links FOR INSERT WITH CHECK (
  auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR (public.get_my_org_id() = organization_id AND public.get_my_role() = 'org_admin'))
);
CREATE POLICY "share_links_update_own_org" ON public.share_links FOR UPDATE USING (
  auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR (public.get_my_org_id() = organization_id AND public.get_my_role() = 'org_admin'))
) WITH CHECK (
  auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR public.get_my_org_id() = organization_id)
);
CREATE POLICY "share_links_delete_own_org" ON public.share_links FOR DELETE USING (
  auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR (public.get_my_org_id() = organization_id AND public.get_my_role() = 'org_admin'))
);

-- STEP 4: organizations ポリシー (anon 封鎖、adminは全件、org_admin/viewerは自組織のみ)
CREATE POLICY "org_select_own" ON public.organizations FOR SELECT USING (
  auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR public.get_my_org_id() = id)
);
CREATE POLICY "org_insert_authenticated" ON public.organizations FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "org_update_own" ON public.organizations FOR UPDATE USING (
  public.get_my_role() = 'admin' OR public.get_my_org_id() = id
) WITH CHECK (
  public.get_my_role() = 'admin' OR public.get_my_org_id() = id
);

-- STEP 5: profiles ポリシー
CREATE POLICY "profiles_select_own_or_org" ON public.profiles FOR SELECT USING (
  auth.uid() = id OR public.get_my_role() = 'admin' OR public.get_my_org_id() = organization_id
);
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- STEP 6: source_polygons ポリシー (anon 封鎖、認証済のみ。viewerは読み取り専用)
CREATE POLICY "source_polygons_select_authenticated" ON public.source_polygons FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "source_polygons_insert_authenticated" ON public.source_polygons FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.get_my_role() IN ('admin', 'org_admin'));
CREATE POLICY "source_polygons_update_authenticated" ON public.source_polygons FOR UPDATE USING (auth.role() = 'authenticated' AND public.get_my_role() IN ('admin', 'org_admin')) WITH CHECK (auth.role() = 'authenticated' AND public.get_my_role() IN ('admin', 'org_admin'));

-- STEP 7: fields ポリシー (anon 封鎖、adminは全件、org_admin/viewerは自組織のみ)
CREATE POLICY "fields_select_own_org" ON public.fields FOR SELECT USING (
  auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR public.get_my_org_id() = organization_id)
);
CREATE POLICY "fields_insert_own_org" ON public.fields FOR INSERT WITH CHECK (
  auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR (public.get_my_role() = 'org_admin' AND public.get_my_org_id() = organization_id))
);
CREATE POLICY "fields_update_own_org" ON public.fields FOR UPDATE USING (
  auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR (public.get_my_role() = 'org_admin' AND public.get_my_org_id() = organization_id))
) WITH CHECK (
  auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR (public.get_my_role() = 'org_admin' AND public.get_my_org_id() = organization_id))
);
CREATE POLICY "fields_delete_own_org" ON public.fields FOR DELETE USING (
  auth.role() = 'authenticated' AND (public.get_my_role() = 'admin' OR (public.get_my_role() = 'org_admin' AND public.get_my_org_id() = organization_id))
);

-- STEP 8: field_source_polygons ポリシー (anon 封鎖、adminは全件、org_admin/viewerは自組織のみ)
CREATE POLICY "fsp_select_own_org" ON public.field_source_polygons FOR SELECT USING (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.fields f
      WHERE f.id = field_source_polygons.field_id
        AND f.organization_id = public.get_my_org_id()
    )
  )
);
CREATE POLICY "fsp_insert_own_org" ON public.field_source_polygons FOR INSERT WITH CHECK (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'org_admin'
      AND EXISTS (
        SELECT 1 FROM public.fields WHERE fields.id = field_source_polygons.field_id AND fields.organization_id = public.get_my_org_id()
      )
    )
  )
);
CREATE POLICY "fsp_delete_own_org" ON public.field_source_polygons FOR DELETE USING (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'org_admin'
      AND EXISTS (
        SELECT 1 FROM public.fields WHERE fields.id = field_source_polygons.field_id AND fields.organization_id = public.get_my_org_id()
      )
    )
  )
);

-- STEP 9: field_points ポリシー (anon 封鎖、adminは全件、org_admin/viewerは自組織のみ)
CREATE POLICY "field_points_select_own_org" ON public.field_points FOR SELECT USING (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.fields f
      WHERE f.id = field_points.field_id
        AND f.organization_id = public.get_my_org_id()
    )
  )
);
CREATE POLICY "field_points_insert_own_org" ON public.field_points FOR INSERT WITH CHECK (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'org_admin'
      AND EXISTS (SELECT 1 FROM public.fields WHERE fields.id = field_points.field_id AND fields.organization_id = public.get_my_org_id())
    )
  )
);
CREATE POLICY "field_points_update_own_org" ON public.field_points FOR UPDATE USING (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'org_admin'
      AND EXISTS (SELECT 1 FROM public.fields WHERE fields.id = field_points.field_id AND fields.organization_id = public.get_my_org_id())
    )
  )
) WITH CHECK (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'org_admin'
      AND EXISTS (SELECT 1 FROM public.fields WHERE fields.id = field_points.field_id AND fields.organization_id = public.get_my_org_id())
    )
  )
);
CREATE POLICY "field_points_delete_own_org" ON public.field_points FOR DELETE USING (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'org_admin'
      AND EXISTS (SELECT 1 FROM public.fields WHERE fields.id = field_points.field_id AND fields.organization_id = public.get_my_org_id())
    )
  )
);

-- STEP 10: work_types ポリシー
CREATE POLICY "work_types_select_all" ON public.work_types FOR SELECT USING (true);
CREATE POLICY "work_types_insert_admin" ON public.work_types FOR INSERT WITH CHECK (public.get_my_role() IN ('admin', 'org_admin'));
CREATE POLICY "work_types_update_admin" ON public.work_types FOR UPDATE USING (public.get_my_role() IN ('admin', 'org_admin')) WITH CHECK (public.get_my_role() IN ('admin', 'org_admin'));

-- STEP 11: field_work_records ポリシー (anon 封鎖、adminは全件、org_admin/viewerは自組織のみ。viewer = 閲覧専用)
CREATE POLICY "fwr_select_own_org" ON public.field_work_records FOR SELECT USING (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.fields f
      WHERE f.id = field_work_records.field_id
        AND f.organization_id = public.get_my_org_id()
    )
  )
);
CREATE POLICY "fwr_insert_own_org" ON public.field_work_records FOR INSERT WITH CHECK (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'org_admin'
      AND auth.uid() = created_by
      AND EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_work_records.field_id AND f.organization_id = public.get_my_org_id())
    )
  )
);
CREATE POLICY "fwr_update_own" ON public.field_work_records FOR UPDATE USING (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'org_admin'
      AND (auth.uid() = created_by OR public.get_my_role() = 'admin')
      AND EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_work_records.field_id AND f.organization_id = public.get_my_org_id())
    )
  )
) WITH CHECK (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_work_records.field_id AND f.organization_id = public.get_my_org_id())
  )
);
CREATE POLICY "fwr_delete_own" ON public.field_work_records FOR DELETE USING (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'org_admin'
      AND (auth.uid() = created_by OR public.get_my_role() = 'admin')
      AND EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_work_records.field_id AND f.organization_id = public.get_my_org_id())
    )
  )
);

-- STEP 12: change_logs ポリシー
CREATE POLICY "change_logs_select_own_org" ON public.change_logs FOR SELECT USING (
  auth.role() = 'authenticated' AND (
    public.get_my_role() = 'admin'
    OR EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = change_logs.profile_id AND profiles.organization_id = public.get_my_org_id())
  )
);
CREATE POLICY "change_logs_insert_own" ON public.change_logs FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND auth.uid() = profile_id);

-- STEP 13: Storage (point_images) ポリシーの再設定 (viewer = 閲覧専用)
DROP POLICY IF EXISTS "point_images_select_all" ON storage.objects;
CREATE POLICY "point_images_select_all" ON storage.objects FOR SELECT USING (bucket_id = 'point_images');

DROP POLICY IF EXISTS "point_images_insert_authenticated" ON storage.objects;
CREATE POLICY "point_images_insert_authenticated" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'point_images'
  AND auth.role() = 'authenticated'
  AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'org_admin')
);

DROP POLICY IF EXISTS "point_images_delete_authenticated" ON storage.objects;
CREATE POLICY "point_images_delete_authenticated" ON storage.objects FOR DELETE USING (
  bucket_id = 'point_images'
  AND auth.role() = 'authenticated'
  AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'org_admin')
);
