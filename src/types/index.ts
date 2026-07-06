import type { Feature, Polygon, MultiPolygon } from 'geojson';

export type FieldPolygon = {
  internalId: string;
  sourceFeatureId: string | null;
  producerName: string;
  fieldName: string;
  cropType: string;
  areaText: string;
  notes: string;
  remarks: string;
  geometry: Polygon | MultiPolygon;
  properties: any;
};

export type PointType = "入口" | "駐車場所" | "水口" | "水尻" | "危険箇所" | "その他";

export type FieldPoint = {
  id: string;
  fieldInternalId: string;
  pointType: PointType;
  name: string;
  description: string;
  coordinates: [number, number];
  imageUrl?: string | null;
};

export type AppState = { polygons: FieldPolygon[]; points: FieldPoint[]; };

// ============================================================
// 作業履歴・作業種別
// ============================================================

export type WorkStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

export interface WorkType {
  id: string;
  code: string;
  name: string;
  iconKey: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
}

export interface FieldWorkRecord {
  id: string;
  fieldId: string;
  workTypeId: string;
  workTypeCode: string;
  workTypeName: string;
  workTypeIconKey: string;
  workTypeColor: string;
  status: WorkStatus;
  workedOn: string | null;   // ISO date string "YYYY-MM-DD"
  notes: string | null;
  createdBy: string | null;
  creatorName: string | null;
  createdAt: string;
  updatedAt: string;
}

// 新規登録時の入力型（id/created_at/updated_at/createdBy はDB側で設定）
export interface NewWorkRecord {
  fieldId: string;
  workTypeId: string;
  status: WorkStatus;
  workedOn: string | null;
  notes: string | null;
}

// ============================================================
// 検索フィルター
// ============================================================

export interface FieldFilter {
  producerName: string;
  workTypeId: string;
}

// ============================================================
// 圃場統合
// ============================================================

export interface MergeFieldsParams {
  targetFieldId: string;
  sourceFieldIds: string[];
  fieldData: {
    producerName: string;
    fieldName: string;
    cropType: string;
    notes: string;
    status: string;
  };
}
