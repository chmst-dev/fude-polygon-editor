import { supabase } from './supabase';
import * as turf from '@turf/turf';
import type { WorkType, FieldWorkRecord, NewWorkRecord, UpdateWorkRecord, MergeFieldsParams } from '@/types';

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
  getLastUpdateLog?(fieldId: string): Promise<any>;
  // 作業種別・履歴
  getWorkTypes(): Promise<WorkType[]>;
  getWorkRecords(fieldIds: string[]): Promise<FieldWorkRecord[]>;
  saveWorkRecord(record: NewWorkRecord): Promise<FieldWorkRecord>;
  updateWorkRecord(record: UpdateWorkRecord): Promise<FieldWorkRecord>;
  deleteWorkRecord(id: string): Promise<void>;
  getFieldIdsByWorkType(workTypeId: string): Promise<string[]>;
  // 登録済み圃場統合（DBトランザクション）
  mergeFields(params: MergeFieldsParams): Promise<{ mergedFieldId: string }>;
}


// Supabase（認証・クラウド）用実装
export class SupabaseService implements FieldService {
  protected userOrgId: string | null = null;
  protected userId: string | null = null;

  async isOnline() {
    // モバイル環境で auth.getSession() が無限に待ち続けるケースに対応するため
    // 8 秒のタイムアウトを設定する。タイムアウト時はセッションなしとして続行。
    let session: any = null;
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('auth.getSession timeout')), 8000)
      );
      const result = await Promise.race([
        supabase.auth.getSession(),
        timeoutPromise
      ]) as any;
      session = result?.data?.session ?? null;
    } catch (e) {
      console.warn('[SupabaseService.isOnline] getSession タイムアウトまたはエラー:', e);
      return false;
    }

    if (session?.user) {
      this.userId = session.user.id;
      try {
        const { data } = await supabase
          .from('profiles')
          .select('organization_id')
          .eq('id', this.userId)
          .single();
        this.userOrgId = data?.organization_id || null;
      } catch (e) {
        console.warn('[SupabaseService.isOnline] profiles 取得エラー:', e);
      }
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

    // 1. 紐付け済みの fields を取得 (PostgRESTの1000行制限対策としてページングで全件取得)
    const PAGE_SIZE = 1000;
    let allData: any[] = [];
    let from = 0;
    let hasMore = true;

    while (hasMore) {
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
        .order('id')
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        console.error('Error fetching fields from Supabase:', error);
        return [];
      }

      if (data && data.length > 0) {
        allData = [...allData, ...data];
        if (data.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          from += PAGE_SIZE;
        }
      } else {
        hasMore = false;
      }
    }

    // organization_id が不明な圃場は、共同閲覧では画面ロード時に自動修復しない。
    // 所有者が分からないデータを現在ユーザーの組織へ寄せると、他組織の圃場を
    // 誤って移管する可能性があるため、必要な場合は管理者が明示的に補正する。

    // 名称未設定かつ情報が一切ない不要な登録済み圃場（ゴミデータ）を自動クリーンアップする。
    // producer_name, field_name, crop_type, notes がすべて空のものを対象とする。
    let filteredData = allData;
    if (this.userOrgId && allData && allData.length > 0) {
      const emptyFields = allData.filter((f: any) =>
        f.organization_id === this.userOrgId &&
        (!f.producer_name || f.producer_name.trim() === '') &&
        (!f.field_name || f.field_name.trim() === '') &&
        (!f.crop_type || f.crop_type.trim() === '') &&
        (!f.notes || f.notes.trim() === '')
      );

      if (emptyFields.length > 0) {
        const idsToDelete = emptyFields.map((f: any) => f.id);
        console.log(`[自動クリーンアップ] 情報が空の不要な圃場が ${idsToDelete.length} 件あります。削除します...`, idsToDelete);
        
        // バックグラウンドで一括削除を実行（CASCADE制約により、紐づくpointsも自動削除される）
        supabase
          .from('fields')
          .delete()
          .in('id', idsToDelete)
          .then(({ error: e }) => {
            if (e) console.error('[自動クリーンアップ] 削除エラー:', e);
            else console.log(`[自動クリーンアップ完了] ${idsToDelete.length} 件の不要な圃場を削除しました。`);
          });

        // 今回返すデータから、削除対象のレコードを除外する
        filteredData = allData.filter((f: any) => !idsToDelete.includes(f.id));
      }
    }

    // ユーザーが編集済みの fields のみ返す
    // 未着手の筆ポリゴンはビューポートに応じて getSourcePolygonsInBbox() で別途取得する
    return this.transformFields(filteredData);
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
      const updateField = {
        ...dbField,
        organization_id: oldData?.organization_id || this.userOrgId,
      };
      const { error } = await supabase
        .from('fields')
        .update(updateField)
        .eq('id', fieldId);
      if (error) throw error;

      await this.logChange(fieldId, 'update', oldData, updateField);
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

    // PostgRESTの1000行制限対策としてページングで全件取得
    const PAGE_SIZE = 1000;
    let allData: any[] = [];
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('field_points')
        .select('*')
        .order('id')
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        console.error('Error fetching points from Supabase:', error);
        return [];
      }

      if (data && data.length > 0) {
        allData = [...allData, ...data];
        if (data.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          from += PAGE_SIZE;
        }
      } else {
        hasMore = false;
      }
    }

    console.log('[DEBUG] Fetched points data:', allData);

    return this.transformPoints(allData);
  }

  protected transformPoints(data: any[]) {
    return data.map((pt: any) => {
      let coords = [0, 0];
      if (pt.geom && typeof pt.geom === 'object' && pt.geom.coordinates) {
        coords = pt.geom.coordinates;
      } else if (typeof pt.geom === 'string') {
        const match = pt.geom.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
        if (match) {
          coords = [parseFloat(match[1]), parseFloat(match[2])];
        } else if (pt.geom.match(/^[0-9A-Fa-f]+$/)) {
          // EWKB hex パース
          try {
            const buf = new Uint8Array(pt.geom.match(/[\da-f]{2}/gi)?.map((h: string) => parseInt(h, 16)) || []);
            const view = new DataView(buf.buffer);
            const littleEndian = buf[0] === 1;
            const type = view.getUint32(1, littleEndian);
            const hasSRID = (type & 0x20000000) !== 0;
            let offset = 5;
            if (hasSRID) offset += 4;
            if (offset + 16 <= buf.length) {
              const x = view.getFloat64(offset, littleEndian);
              const y = view.getFloat64(offset + 8, littleEndian);
              coords = [x, y];
            }
          } catch (e) {
            console.error('EWKB parse error:', e);
          }
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
    if (!this.userId || !this.userOrgId) throw new Error('Not logged in');
    
    // 関連する fieldId が一時的な poly- や source- のままであれば、まだ fields が作成されていないため、
    // point の保存は fields の作成完了まで保留します
    if (point.fieldInternalId && (point.fieldInternalId.startsWith('poly-') || point.fieldInternalId.startsWith('source-'))) {
      return point;
    }

    // PostGIS に確実に保存されるよう、EWKT (SRID付き Well-Known Text) を使用
    const geomWkt = `SRID=4326;POINT(${point.coordinates[0]} ${point.coordinates[1]})`;

    const dbPoint = {
      field_id: point.fieldInternalId,
      point_type: point.pointType,
      name: point.name || point.pointType,
      description: point.description,
      image_url: point.imageUrl,
      geom: geomWkt
    };

    let newId = point.id;
    if (point.id && !point.id.startsWith('point-')) {
      // UPDATE
      const { error } = await supabase
        .from('field_points')
        .update(dbPoint)
        .eq('id', point.id);
      if (error) throw error;
    } else {
      // INSERT
      const { data, error } = await supabase
        .from('field_points')
        .insert(dbPoint)
        .select('id')
        .single();
      if (error) throw error;
      newId = data.id;
    }

    return { ...point, id: newId };
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

    // 1. 登録済み圃場（fields.idに一致）が含まれているか検証
    // fields.id は UUID型のため、polygonIds から UUID 形式のもののみを抽出して問い合わせる
    const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    const uuidIds = polygonIds.filter((id) => UUID_RE.test(id));
    if (uuidIds.length > 0) {
      const { data: existingFields, error: checkFieldError } = await supabase
        .from('fields')
        .select('id, field_name, producer_name')
        .in('id', uuidIds);

      if (checkFieldError) throw checkFieldError;
      if (existingFields && existingFields.length > 0) {
        const names = existingFields.map(f => f.field_name || f.producer_name || '名称未設定').join(', ');
        throw new Error(`登録済み圃場（${names}）はグループ化できません。未登録の筆を選択してください。`);
      }
    }

    // 2. 既に他の圃場に属しているsource_polygonがあるか検証
    const { data: existingRelations, error: checkRelationError } = await supabase
      .from('field_source_polygons')
      .select(`
        source_polygon_id,
        fields (
          id,
          field_name,
          producer_name
        )
      `)
      .in('source_polygon_id', polygonIds);

    if (checkRelationError) throw checkRelationError;
    if (existingRelations && existingRelations.length > 0) {
      const dupFields = existingRelations.map((r: any) => {
        let f = r.fields;
        if (Array.isArray(f)) {
          f = f[0];
        }
        if (!f) return '不明な圃場';
        const pName = f.producer_name ? `${f.producer_name} ` : '';
        const fName = f.field_name || '名称未設定';
        return `「${pName}${fName}」`;
      });
      const uniqueDupFields = Array.from(new Set(dupFields)).join(', ');
      throw new Error(`選択された筆は既に他の圃場（${uniqueDupFields}）に登録されています。`);
    }

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

  async getLastUpdateLog(fieldId: string): Promise<any> {
    await this.isOnline();
    if (!this.userId) return null;

    if (!fieldId || fieldId.startsWith('poly-') || fieldId.startsWith('source-')) {
      return null;
    }

    const { data, error } = await supabase
      .from('change_logs')
      .select(`
        created_at,
        action,
        profiles (
          display_name
        )
      `)
      .eq('field_id', fieldId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching last update log:', error);
      return null;
    }

    return data;
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

  // ────────────────────────────────────────────────────────────
  // 作業種別・作業履歴
  // ────────────────────────────────────────────────────────────

  async getWorkTypes(): Promise<WorkType[]> {
    const { data, error } = await supabase
      .from('work_types')
      .select('id, code, name, icon_key, color, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order');

    if (error) {
      console.error('Error fetching work_types:', error);
      return [];
    }

    return (data || []).map((wt: any) => ({
      id: wt.id,
      code: wt.code,
      name: wt.name,
      iconKey: wt.icon_key,
      color: wt.color,
      sortOrder: wt.sort_order,
      isActive: wt.is_active,
    }));
  }

  /**
   * 複数圃場の作業履歴を一括取得（N+1クエリ禁止）。
   * get_latest_work_records RPC を使用して各圃場の最新1件を返す。
   * 全履歴が必要な場合は get_field_work_records RPC を使用する。
   */
  async getWorkRecords(fieldIds: string[]): Promise<FieldWorkRecord[]> {
    if (!fieldIds || fieldIds.length === 0) return [];

    const { data, error } = await supabase.rpc('get_latest_work_records', {
      p_field_ids: fieldIds,
      p_share_token: null,
    });

    if (error) {
      if ((error as any).code !== 'PGRST202') {
        console.error('Error fetching work records:', error);
      }
      return [];
    }

    return this.transformWorkRecords(data || []);
  }

  /**
   * 特定圃場の全作業履歴を取得（新着順）
   */
  async getFieldWorkRecords(fieldId: string): Promise<FieldWorkRecord[]> {
    if (!fieldId || fieldId.startsWith('poly-') || fieldId.startsWith('source-')) {
      return [];
    }

    const { data, error } = await supabase.rpc('get_field_work_records', {
      p_field_id: fieldId,
      p_share_token: null,
    });

    if (error) {
      if ((error as any).code !== 'PGRST202') {
        console.error('Error fetching field work records:', error);
      }
      return [];
    }

    return this.transformWorkRecords(data || []);
  }

  protected transformWorkRecords(data: any[]): FieldWorkRecord[] {
    return data.map((r: any) => ({
      id: r.id,
      fieldId: r.field_id,
      workTypeId: r.work_type_id,
      workTypeCode: r.work_type_code,
      workTypeName: r.work_type_name,
      workTypeIconKey: r.work_type_icon_key,
      workTypeColor: r.work_type_color,
      status: r.status,
      workedOn: r.worked_on ?? null,
      notes: r.notes ?? null,
      createdBy: r.created_by ?? null,
      creatorName: r.creator_name ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async saveWorkRecord(record: NewWorkRecord): Promise<FieldWorkRecord> {
    await this.isOnline();
    if (!this.userId || !this.userOrgId) throw new Error('ログインが必要です。');

    const dbRecord = {
      field_id: record.fieldId,
      work_type_id: record.workTypeId,
      status: record.status,
      worked_on: record.workedOn || null,
      notes: record.notes || null,
      created_by: this.userId,
    };

    const { data, error } = await supabase
      .from('field_work_records')
      .insert(dbRecord)
      .select(`
        id, field_id, work_type_id, status, worked_on, notes,
        created_by, created_at, updated_at,
        work_types!inner(code, name, icon_key, color)
      `)
      .single();

    if (error) throw error;

    return {
      id: data.id,
      fieldId: data.field_id,
      workTypeId: data.work_type_id,
      workTypeCode: (data.work_types as any).code,
      workTypeName: (data.work_types as any).name,
      workTypeIconKey: (data.work_types as any).icon_key,
      workTypeColor: (data.work_types as any).color,
      status: data.status,
      workedOn: data.worked_on ?? null,
      notes: data.notes ?? null,
      createdBy: data.created_by ?? null,
      // The authoritative history refresh resolves creatorName via the RPC.
      // created_by references auth.users, so PostgREST cannot embed profiles here.
      creatorName: null,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async updateWorkRecord(record: UpdateWorkRecord): Promise<FieldWorkRecord> {
    await this.isOnline();
    if (!this.userId) throw new Error('ログインが必要です。');

    // field_id / created_by / created_at は更新しない。
    // work_type_id / status / worked_on / notes のみ UPDATE する。
    // クエリ自体に .select().single() を付与して実際に1行更新されたことを担保する。
    // 更新件数が0件（RLS拒否など）の場合は single() がエラーを発生させるため、安全に例外が発生する。
    const { data, error } = await supabase
      .from('field_work_records')
      .update({
        work_type_id: record.workTypeId,
        status: record.status,
        worked_on: record.workedOn || null,
        notes: record.notes || null,
      })
      .eq('id', record.id)
      .select(`
        id, field_id, work_type_id, status, worked_on, notes,
        created_by, created_at, updated_at,
        work_types!inner(code, name, icon_key, color)
      `)
      .single();

    if (error) throw error;

    return {
      id: data.id,
      fieldId: data.field_id,
      workTypeId: data.work_type_id,
      workTypeCode: (data.work_types as any).code,
      workTypeName: (data.work_types as any).name,
      workTypeIconKey: (data.work_types as any).icon_key,
      workTypeColor: (data.work_types as any).color,
      status: data.status,
      workedOn: data.worked_on ?? null,
      notes: data.notes ?? null,
      createdBy: data.created_by ?? null,
      // creatorName は呼び出し元の refresh() で authoritative 再取得により復元される。
      creatorName: null,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async deleteWorkRecord(id: string): Promise<void> {
    await this.isOnline();
    if (!this.userId) throw new Error('ログインが必要です。');

    // DELETE クエリ自身に .select('id').single() を付けて、実際に削除された行があることを担保する。
    // RLSや存在しないIDなどで0件の場合、single() がエラーを発生させ、安全に例外が発生する。
    const { error } = await supabase
      .from('field_work_records')
      .delete()
      .eq('id', id)
      .select('id')
      .single();

    if (error) throw error;
  }

  async getFieldIdsByWorkType(workTypeId: string): Promise<string[]> {
    await this.isOnline();
    if (!this.userId) return [];

    const { data, error } = await supabase.rpc('get_field_ids_by_work_type', {
      p_work_type_id: workTypeId,
    });

    if (error) {
      console.error('[SupabaseService.getFieldIdsByWorkType] error:', error);
      return [];
    }

    return (data || []).map((r: any) => r.field_id);
  }

  // ────────────────────────────────────────────────────────────
  // 登録済み圃場統合（groupPolygons とは別物・DBトランザクション）
  // ────────────────────────────────────────────────────────────

  async mergeFields(params: MergeFieldsParams): Promise<{ mergedFieldId: string }> {
    await this.isOnline();
    if (!this.userId || !this.userOrgId) throw new Error('ログインが必要です。');

    const { data, error } = await supabase.rpc('merge_fields', {
      p_target_field_id: params.targetFieldId,
      p_source_field_ids: params.sourceFieldIds,
      p_field_data: {
        producer_name: params.fieldData.producerName,
        field_name: params.fieldData.fieldName,
        crop_type: params.fieldData.cropType,
        notes: params.fieldData.notes,
        status: params.fieldData.status,
      },
    });

    if (error) throw error;

    return { mergedFieldId: data as string };
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
  private shareToken: string;

  constructor(shareToken: string) {
    super();
    this.shareToken = shareToken;
    this.userOrgId = null as any;
  }

  async isOnline() {
    return true; 
  }

  isReadOnly() {
    return true;
  }

  async getFields() {
    const { data, error } = await supabase.rpc('get_fields_by_share_token', {
      p_token: this.shareToken
    });

    if (error) {
      console.error('Error fetching guest fields from Supabase by share token:', error);
      return [];
    }

    if (data && data.length > 0) {
      this.userOrgId = data[0].organization_id;
    }

    return this.transformFields(data);
  }

  async getPoints() {
    const { data, error } = await supabase.rpc('get_points_by_share_token', {
      p_token: this.shareToken
    });

    if (error) {
      console.error('Error fetching guest points from Supabase by share token:', error);
      return [];
    }

    return this.transformPoints(data || []);
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

  // 共有URLでは登録済みの圃場（fields）だけを見せる。
  // 未着手のマスタデータ（source_polygons単体）は取得しない（空配列を返す）。
  async getSourcePolygonsInBbox(_west: number, _south: number, _east: number, _north: number): Promise<any[]> {
    return [];
  }

  async getLastUpdateLog(_fieldId: string): Promise<any> {
    return null;
  }

  // ────────────────────────────────────────────────────────────
  // 作業履歴・統合: GuestService は読み取り以外すべて拒否
  // ────────────────────────────────────────────────────────────

  async getWorkTypes(): Promise<WorkType[]> {
    // work_types は全員参照可（親クラスと同実装）
    const { data, error } = await supabase
      .from('work_types')
      .select('id, code, name, icon_key, color, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order');

    if (error) return [];

    return (data || []).map((wt: any) => ({
      id: wt.id,
      code: wt.code,
      name: wt.name,
      iconKey: wt.icon_key,
      color: wt.color,
      sortOrder: wt.sort_order,
      isActive: wt.is_active,
    }));
  }

  async getWorkRecords(fieldIds: string[]): Promise<FieldWorkRecord[]> {
    if (!fieldIds || fieldIds.length === 0) return [];

    const { data, error } = await supabase.rpc('get_latest_work_records', {
      p_field_ids: fieldIds,
      p_share_token: this.shareToken,
    });

    if (error) return [];
    return this.transformWorkRecords(data || []);
  }

  async getFieldWorkRecords(fieldId: string): Promise<FieldWorkRecord[]> {
    if (!fieldId || fieldId.startsWith('poly-') || fieldId.startsWith('source-')) {
      return [];
    }

    const { data, error } = await supabase.rpc('get_field_work_records', {
      p_field_id: fieldId,
      p_share_token: this.shareToken,
    });

    if (error) return [];
    return this.transformWorkRecords(data || []);
  }

  async saveWorkRecord(_record: NewWorkRecord): Promise<FieldWorkRecord> {
    throw new Error('閲覧専用モードのため、作業登録はできません。');
  }

  async updateWorkRecord(_record: UpdateWorkRecord): Promise<FieldWorkRecord> {
    throw new Error('閲覧専用モードのため、作業更新はできません。');
  }

  async deleteWorkRecord(_id: string): Promise<void> {
    throw new Error('閲覧専用モードのため、作業削除はできません。');
  }

  async getFieldIdsByWorkType(workTypeId: string): Promise<string[]> {
    const { data, error } = await supabase.rpc('get_field_ids_by_work_type', {
      p_work_type_id: workTypeId,
      p_share_token: this.shareToken,
    });

    if (error) {
      console.error('[GuestService.getFieldIdsByWorkType] error:', error);
      return [];
    }
    return (data || []).map((r: any) => r.field_id);
  }

  async mergeFields(_params: MergeFieldsParams): Promise<{ mergedFieldId: string }> {
    throw new Error('閲覧専用モードのため、圃場統合はできません。');
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

    const shareToken = getQueryParam('share');
    if (shareToken) {
      return new GuestService(shareToken);
    }

    // 今後は常にSupabaseServiceを使用する
    // 10 秒以内に isOnline() が完了しない場合（モバイルでのハング対策）は
    // 未ログイン状態として SupabaseService をそのまま返す
    const supabaseService = new SupabaseService();
    try {
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('getService timeout')), 10000)
      );
      await Promise.race([supabaseService.isOnline(), timeoutPromise]);
    } catch (e) {
      console.warn('[DbServiceFactory.getService] タイムアウトまたはエラー。未ログイン状態で続行します:', e);
    }
    return supabaseService;
  }
}
