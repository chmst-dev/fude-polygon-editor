-- ============================================================
-- 地図の表示範囲（バウンディングボックス）内の筆ポリゴンを返す関数
-- Supabase SQL Editor で実行してください
-- ============================================================

CREATE OR REPLACE FUNCTION get_source_polygons_in_bbox(
  west  double precision,
  south double precision,
  east  double precision,
  north double precision
)
RETURNS TABLE(id text, geom geometry, area_sqm numeric, original_properties jsonb)
LANGUAGE sql
SECURITY DEFINER  -- RLSをバイパスして安全に実行
STABLE
AS $$
  SELECT sp.id, sp.geom, sp.area_sqm, sp.original_properties
  FROM   source_polygons sp
  WHERE  sp.geom && ST_MakeEnvelope(west, south, east, north)
    AND  NOT EXISTS (
           -- すでに圃場(field)に紐づいているものは除外（fieldsとして別途表示される）
           SELECT 1 FROM field_source_polygons fsp
           WHERE  fsp.source_polygon_id = sp.id
         )
  LIMIT  3000;
$$;
