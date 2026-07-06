-- Storage bucket and policies for point_images
-- Separated from baseline to ensure storage schema is fully initialized before applying policies

-- Create point_images bucket if not exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('point_images', 'point_images', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for storage.objects
DROP POLICY IF EXISTS "point_images_delete_authenticated" ON storage.objects;
create policy "point_images_delete_authenticated"
  on "storage"."objects"
  as permissive
  for delete
  to public
  using (((bucket_id = 'point_images'::text) AND (auth.role() = 'authenticated'::text)));

DROP POLICY IF EXISTS "point_images_insert_authenticated" ON storage.objects;
create policy "point_images_insert_authenticated"
  on "storage"."objects"
  as permissive
  for insert
  to public
  with check (((bucket_id = 'point_images'::text) AND (auth.role() = 'authenticated'::text)));

DROP POLICY IF EXISTS "point_images_select_all" ON storage.objects;
create policy "point_images_select_all"
  on "storage"."objects"
  as permissive
  for select
  to public
  using ((bucket_id = 'point_images'::text));
