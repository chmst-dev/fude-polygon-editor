-- source_polygonsのgeomカラムをSRID指定なし（任意のSRIDを受け付ける）に変更
-- Supabase SQL Editor で実行してください

-- geomカラムの型を変更（SRID指定なし → どんな座標系のジオメトリも受け付ける）
ALTER TABLE public.source_polygons
  ALTER COLUMN geom TYPE geometry(Geometry)
  USING geom::geometry(Geometry);

-- インデックスを再作成
DROP INDEX IF EXISTS source_polygons_geom_idx;
CREATE INDEX source_polygons_geom_idx ON public.source_polygons USING gist (geom);
