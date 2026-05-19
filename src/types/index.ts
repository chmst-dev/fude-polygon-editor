import type { Feature, Polygon, MultiPolygon } from 'geojson';
export type FieldPolygon = { internalId: string; sourceFeatureId: string | null; producerName: string; fieldName: string; cropType: string; areaText: string; notes: string; remarks: string; geometry: Polygon | MultiPolygon; properties: any; };
export type PointType = "入口" | "駐車場所" | "水口" | "水尻" | "危険箇所" | "その他";
export type FieldPoint = { id: string; fieldInternalId: string; pointType: PointType; name: string; description: string; coordinates: [number, number]; };
export type AppState = { polygons: FieldPolygon[]; points: FieldPoint[]; };
