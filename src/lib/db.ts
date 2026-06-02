import { supabase } from './supabase';
import * as turf from '@turf/turf';

export interface FieldService {
  isOnline(): Promise<boolean>;
  isReadOnly(): boolean;
  getFields(): Promise<any[]>;
  saveField(field: any): Promise<any>;
  deleteField(fieldId: string): Promise<void>;
  getPoints(): Promise<any[]>;
  savePoint(point: any): Promise<any>;
  deletePoint(pointId: string): Promise<void>;
  groupPolygons(polygonIds: string[], fieldData: any): Promise<any>;
  // 地図の表示範囲内の未着手筆ポリゴンをDBから取得する（ビューポートベース読み込み）
  getSourcePolygonsInBbox(west: number, south: number, east: number, north: number): Promise<any[]>;
  uploadPointImage?(file: File, pointId: string): Promise<string>;
  getProducers?(): Promise<string[]>;
}


// Supabase（認証・クラウド）用実装
export class SupabaseService implements FieldService {
  protected userOrgId: string | null = null;
  protected userId: string | null = null;

  async isOnline() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      this.userId = session.user.id;
      const { data } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', this.userId)
        .single();
      this.userOrgId = data?.organization_id || null;
      return true;
    }
    return false;
  }

  isReadOnly() {
    return false;
  }

  async getFields() {
    await this.isOnline();
    if (!this.userId) return [];

    // 1. 紐付け済みの fields を取得
    const { data, error } = await supabase
      .from('fields')
      .select(`
        id,
        organization_id,
        producer_name,
        field_name,
        crop_type,
        notes,
        status,
        field_source_polygons (
          source_polygon_id,
          source_polygons (
            id,
            geom,
            area_sqm,
            original_properties
          )
        )
      `);

    if (error) {
      console.error('Error fetching fields from Supabase:', error);
      return [];
    }

    // ユーザーが編集済みの fields のみ返す
    // 未着手の筆ポリゴンはビューポートに応じて getSourcePolygonsInBbox() で別途取得する
    return this.transformFields(data);
  }

  protected transformFields(data: any[]) {
    return data.map((f: any) => {
      const sourcePolygons = f.field_source_polygons
        ?.map((fsp: any) => fsp.source_polygons)
        .filter(Boolean) || [];

      let geometry = null;
      if (sourcePolygons.length > 0) {
        if (sourcePolygons.length === 1) {
          geometry = sourcePolygons[0].geom;
        } else {
          try {
            let unioned = turf.feature(sourcePolygons[0].geom);
            for (let i = 1; i < sourcePolygons.length; i++) {
              unioned = turf.union(turf.featureCollection([unioned, turf.feature(sourcePolygons[i].geom)])) || unioned;
            }
            geometry = unioned.geometry;
          } catch (e) {
            geometry = sourcePolygons[0].geom;
          }
        }
      }

      return {
        internalId: f.id,
        sourceFeatureId: sourcePolygons.length > 0 ? sourcePolygons[0].id : null,
        producerName: f.producer_name || '',
        fieldName: f.field_name || '',
        cropType: f.crop_type || '',
        areaText: sourcePolygons.reduce((acc: number, sp: any) => acc + (sp.area_sqm || 0), 0).toString(),
        notes: f.notes || '',
        remarks: f.status || '',
        geometry: geometry,
        properties: {
          organizationId: f.organization_id,
          sourcePolygons: sourcePolygons.map((sp: any) => ({ id: sp.id, originalProperties: sp.original_properties }))
        }
      };
    });
  }

  async getProducers(): Promise<string[]> {
    await this.isOnline();
    if (!this.userOrgId) return [];

    const { data, error } = await supabase
      .from('fields')
      .select('producer_name')
      .eq('organization_id', this.userOrgId)
      .not('producer_name', 'is', null)
      .neq('producer_name', '');
    
    if (error) {
      console.error('Error fetching producers:', error);
      return [];
    }

    // 重複を排除したリストを返す
    const producers = data.map((d: any) => d.producer_name);
    return Array.from(new Set(producers)).sort();
  }

  async saveField(field: any) {
    await this.isOnline();
    if (!this.userOrgId) throw new Error('所属組織がありません。');

    const dbField = {
      producer_name: field.producerName,
      field_name: field.fieldName,
      crop_type: field.cropType,
      notes: field.notes,
      status: field.remarks || 'active',
      organization_id: this.userOrgId
    };

    let fieldId = field.internalId;
    
    // 未着手のマスタ状態から始めて編集保存された場合、または新規作成の場合
    const isUnmapped = field.properties?.isUnmapped || false;
    const isNew = isUnmapped || !fieldId || fieldId.startsWith('poly-') || fieldId.includes('-group-');

    if (isNew) {
      // 1. fieldsにインサート
      const { data, error } = await supabase
        .from('fields')
        .insert(dbField)
        .select('id')
        .single();
      if (error) throw error;
      fieldId = data.id;

      // 2. もし未着手マスタ（単一の筆ポリゴン）からの編集開始であれば、中間テーブルに紐付けを登録
      if (isUnmapped && field.sourceFeatureId) {
        // マスタテーブル（source_polygons）に登録がなければ念のため追加
        const { data: hasSp } = await supabase
          .from('source_polygons')
          .select('id')
          .eq('id', field.sourceFeatureId)
          .maybeSingle();

        if (!hasSp) {
          await supabase.from('source_polygons').insert({
            id: field.sourceFeatureId,
            geom: field.geometry,
            area_sqm: turf.area(turf.feature(field.geometry)),
            original_properties: field.properties?.originalProperties || {}
          });
        }

        // 中間テーブルに紐付け
        await supabase
          .from('field_source_polygons')
          .insert({
            field_id: fieldId,
            source_polygon_id: field.sourceFeatureId
          });
      }

      await this.logChange(fieldId, 'create', null, dbField);
    } else {
      // 既存更新
      const { data: oldData } = await supabase.from('fields').select('*').eq('id', fieldId).single();
      const { error } = await supabase
        .from('fields')
        .update(dbField)
        .eq('id', fieldId);
      if (error) throw error;

      await this.logChange(fieldId, 'update', oldData, dbField);
    }

    return { 
      ...field, 
      internalId: fieldId,
      properties: {
        ...field.properties,
        isUnmapped: false // マウント済み（作業中）へ
      }
    };
  }

  async deleteField(fieldId: string) {
    await this.isOnline();
    
    // クラウド側にあるID（uuid）のみ削除
    if (fieldId && !fieldId.startsWith('poly-')) {
      const { data: oldData } = await supabase.from('fields').select('*').eq('id', fieldId).single();
      const { error } = await supabase.from('fields').delete().eq('id', fieldId);
      if (error) throw error;
      await this.logChange(fieldId, 'delete', oldData, null);
    }
  }

  async getPoints() {
    await this.isOnline();
    if (!this.userId) return [];

    const { data, error } = await supabase
      .from('field_points')
      .select('*');

    if (error) {
      console.error('Error fetching points from Supabase:', error);
      return [];
    }

    return this.transformPoints(data);
  }

  protected transformPoints(data: any[]) {
    return data.map((pt: any) => {
      let coords = [0, 0];
      if (pt.geom && typeof pt.geom === 'object' && pt.geom.coordinates) {
        coords = pt.geom.coordinates;
      } else if (typeof pt.geom === 'string') {
        // もし PostgREST が WKT 文字列等を返してきた場合の簡易パース (POINT(139.7 35.6))
        const match = pt.geom.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
        if (match) {
          coords = [parseFloat(match[1]), parseFloat(match[2])];
        } else {
          console.warn('Unexpected geom string format:', pt.geom);
        }
      }

      return {
        id: pt.id,
        fieldInternalId: pt.field_id,
        pointType: pt.point_type,
        name: pt.name || pt.point_type, // nameがなければpointTypeを表示
        description: pt.description || '',
        imageUrl: pt.image_url || null,
        coordinates: coords
      };
    });
  }

  async savePoint(point: any) {
    await this.isOnline();
    
    // 関連する fieldId が一時的な poly- のままであれば、まだ fields が作成されていないため、
    // point の保存は fields の作成完了まで保留します
    if (point.fieldInternalId && point.fieldInternalId.startsWith('poly-')) {
      return point;
    }

    // Supabase (PostgREST) は geometry 型に対して GeoJSON オブジェクトを直接受け付ける設定になっている可能性が高いため戻す
    const geom = {
      type: 'Point',
      coordinates: point.coordinates
    };

    const dbPoint = {
      field_id: point.fieldInternalId,
      point_type: point.pointType,
      name: point.name || point.pointType,
      description: point.description,
      image_url: point.imageUrl,
      geom: geom
    };

    if (point.id && !point.id.startsWith('point-')) {
      const { error } = await supabase
        .from('field_points')
        .update(dbPoint)
        .eq('id', point.id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from('field_points')
        .insert(dbPoint)
        .select('id')
        .single();
      if (error) throw error;
      point.id = data.id;
    }

    return point;
  }

  async deletePoint(pointId: string) {
    await this.isOnline();
    if (pointId && !pointId.startsWith('point-')) {
      const { error } = await supabase.from('field_points').delete().eq('id', pointId);
      if (error) throw error;
    }
  }

  async uploadPointImage(file: File, pointId: string): Promise<string> {
    await this.isOnline();
    const ext = file.name.split('.').pop();
    const fileName = `${pointId}-${Date.now()}.${ext}`;

    const { error } = await supabase.storage
      .from('point_images')
      .upload(fileName, file, { upsert: true });

    if (error) throw error;

    const { data } = supabase.storage
      .from('point_images')
      .getPublicUrl(fileName);

    return data.publicUrl;
  }

  async groupPolygons(polygonIds: string[], fieldData: any) {
    await this.isOnline();
    if (!this.userOrgId) throw new Error('所属組織がありません。');

    const dbField = {
      producer_name: fieldData.producerName || '',
      field_name: fieldData.fieldName || '',
      crop_type: fieldData.cropType || '',
      notes: fieldData.notes || '',
      status: 'active',
      organization_id: this.userOrgId
    };

    const { data: newFieldData, error: fieldError } = await supabase
      .from('fields')
      .insert(dbField)
      .select('id')
      .single();

    if (fieldError) throw fieldError;
    const newFieldId = newFieldData.id;

    for (const polyId of polygonIds) {
      const { data: exists } = await supabase
        .from('source_polygons')
        .select('id')
        .eq('id', polyId)
        .maybeSingle();

      if (!exists) {
        const localField = fieldData._localGeometries?.[polyId];
        if (localField) {
          await supabase.from('source_polygons').insert({
            id: polyId,
            geom: localField.geometry,
            area_sqm: turf.area(turf.feature(localField.geometry)),
            original_properties: localField.properties || {}
          });
        }
      }
    }

    const relations = polygonIds.map(polyId => ({
      field_id: newFieldId,
      source_polygon_id: polyId
    }));

    const { error: relationError } = await supabase
      .from('field_source_polygons')
      .insert(relations);

    if (relationError) throw relationError;

    await this.logChange(newFieldId, 'group_polygons', null, { ...dbField, grouped_polygons: polygonIds });

    return {
      internalId: newFieldId,
      producerName: dbField.producer_name,
      fieldName: dbField.field_name,
      cropType: dbField.crop_type,
      notes: dbField.notes,
      remarks: dbField.status
    };
  }

  // 地図の表示範囲内の未着手筆ポリゴンをDBから取得
  async getSourcePolygonsInBbox(west: number, south: number, east: number, north: number): Promise<any[]> {
    const { data, error } = await supabase.rpc('get_source_polygons_in_bbox', {
      west, south, east, north
    });

    if (error) {
      // 関数未作成時（PGRST202）は警告のみ表示して空配列を返す
      if ((error as any).code !== 'PGRST202') {
        console.error('Bbox query error:', error);
      }
      return [];
    }

    return (data || []).map((sp: any) => ({
      internalId: sp.id,
      sourceFeatureId: sp.id,
      producerName: '',
      fieldName: '',
      cropType: '',
      areaText: (sp.area_sqm || 0).toString(),
      notes: '',
      remarks: '',
      geometry: sp.geom,
      properties: {
        isUnmapped: true,
        originalProperties: sp.original_properties
      }
    }));
  }

  // ダミー（グループ化用 - 元の実装に続く）
  _groupPolygonsPlaceholder() {
  }

  protected async logChange(fieldId: string, action: string, oldValues: any, newValues: any) {
    if (!this.userId) return;
    await supabase.from('change_logs').insert({
      field_id: fieldId,
      profile_id: this.userId,
      action: action,
      old_values: oldValues,
      new_values: newValues
    });
  }

  // 筆ポリゴン（GeoJSON）一括自動保存用（Phase C）
  async uploadSourcePolygons(polygons: any[], progressCallback?: (progress: string) => void) {
    await this.isOnline();
    if (!this.userOrgId) throw new Error('所属組織がありません。ログインしてください。');

    const total = polygons.length;
    let successCount = 0;
    
    // 安全のため100件ずつのチャンクでUpsert
    const chunkSize = 100;
    for (let i = 0; i < total; i += chunkSize) {
      const chunk = polygons.slice(i, i + chunkSize);
      
      if (progressCallback) {
        progressCallback(`筆データをクラウドに保存中... ${i} / ${total}`);
      }

      // 1. source_polygons マスタの一括Upsert
      const sourceInserts = chunk.map(p => ({
        id: p.id || p.properties?.id || p.internalId || `source-${Date.now()}-${Math.random()}`,
        geom: p.geometry,
        area_sqm: turf.area(turf.feature(p.geometry)),
        original_properties: p.properties || {}
      }));

      const { error: spError } = await supabase
        .from('source_polygons')
        .upsert(sourceInserts, { onConflict: 'id' });

      if (spError) {
        console.error('Source polygons chunk upload error:', spError);
        throw spError;
      }

      successCount += chunk.length;
    }

    if (progressCallback) {
      progressCallback(`完了: ${successCount}件の筆データをクラウドに保存しました`);
    }
  }
}

// 閲覧用URL（非ログイン共有閲覧機能）に対応した読み取り専用サービス
export class GuestService extends SupabaseService {
  constructor(private guestOrgId: string) {
    super();
    this.userOrgId = guestOrgId;
  }

  async isOnline() {
    return true; 
  }

  isReadOnly() {
    return true;
  }

  async getFields() {
    const { data, error } = await supabase
      .from('fields')
      .select(`
        id,
        organization_id,
        producer_name,
        field_name,
        crop_type,
        notes,
        status,
        field_source_polygons (
          source_polygon_id,
          source_polygons (
            id,
            geom,
            area_sqm,
            original_properties
          )
        )
      `)
      .eq('organization_id', this.userOrgId);

    if (error) {
      console.error('Error fetching guest fields from Supabase:', error);
      return [];
    }

    return this.transformFields(data);
  }

  async getPoints() {
    // 確実に動作させるため、まず組織内の field_id 一覧を取得
    const { data: fields } = await supabase
      .from('fields')
      .select('id')
      .eq('organization_id', this.userOrgId);
      
    if (!fields || fields.length === 0) return [];
    
    // field_id の配列を生成
    const fieldIds = fields.map(f => f.id);

    // .in() クエリは最大要素数に制限があるため、今回は念のため全件取得してからフロント側でフィルタリングする方式で確実に取る
    const { data, error } = await supabase
      .from('field_points')
      .select('*');

    if (error) {
      console.error('Error fetching guest points from Supabase:', error);
      return [];
    }

    // 自分の組織の field_id に合致するものだけ抽出
    const filteredPoints = (data || []).filter((pt: any) => fieldIds.includes(pt.field_id));
    return this.transformPoints(filteredPoints);
  }

  async saveField(field: any) {
    throw new Error('閲覧専用モードのため、編集はできません。');
  }

  async deleteField(fieldId: string) {
    throw new Error('閲覧専用モードのため、削除はできません。');
  }

  async savePoint(point: any) {
    throw new Error('閲覧専用モードのため、編集はできません。');
  }

  async deletePoint(pointId: string) {
    throw new Error('閲覧専用モードのため、削除はできません。');
  }

  async groupPolygons(polygonIds: string[], fieldData: any): Promise<any> {
    throw new Error('閲覧専用モードのため、結合グループ化はできません。');
  }

  // ゲストも筆ポリゴン（source_polygons）は閲覧可能 → 親クラスの実装をそのまま使用...とはせず、
  // 共有URLでは登録済みの圃場（fields）だけを見せるという要件のため、
  // 未着手のマスタデータ（source_polygons単体）は取得しない（空配列を返す）ようにオーバーライドする
  async getSourcePolygonsInBbox(_west: number, _south: number, _east: number, _north: number): Promise<any[]> {
    return [];
  }
}

const getQueryParam = (name: string): string | null => {
  if (typeof window === 'undefined') return null;
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
};

// セッションを監視し、最適なデータベースサービスインスタンスを返すファクトリ
export class DbServiceFactory {
  static async getService(): Promise<FieldService> {
    // 古いローカルストレージデータ（MVP時代の名残）をクリーンアップ
    if (typeof window !== 'undefined') {
      localStorage.removeItem('fude-state');
    }

    const orgId = getQueryParam('org') || getQueryParam('share');
    if (orgId) {
      return new GuestService(orgId);
    }

    // 今後は常にSupabaseServiceを使用する
    const supabaseService = new SupabaseService();
    await supabaseService.isOnline();
    return supabaseService;
  }
}
