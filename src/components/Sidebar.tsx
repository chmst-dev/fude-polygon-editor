'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Target, Search, CheckSquare, Square, Layers, Navigation, ExternalLink, MapPin, Camera, Save, Loader2, Clock, Eraser, GitMerge, AlertCircle } from 'lucide-react';
import { calculateArea } from '@/lib/utils';
import * as turf from '@turf/turf';
import imageCompression from 'browser-image-compression';
import { useToast } from './Toast';
import FieldFilterBar from './FieldFilterBar';
import WorkHistory from './WorkHistory';
import MergeFieldsDialog from './MergeFieldsDialog';
import type { WorkType, FieldFilter } from '@/types';

export default function Sidebar({
  polygons,
  points,
  setPolygons,
  setPoints,
  selectedPolygonId,
  setSelectedPolygonId,
  isAddingPoint,
  setIsAddingPoint,
  dbService,
  selectedPolygonIds = [],
  setSelectedPolygonIds,
  isMultiSelectMode = false,
  setIsMultiSelectMode,
  gpsPosition = null,
  isMobile = false,
  onShowMap,
  orgId,
  activeTabOverride,
  setActiveTabOverride,
  canEdit = false,
  workTypes = [] as WorkType[],
  fieldFilter = { producerName: '', workTypeId: '' } as FieldFilter,
  onFilterChange,
  filteredPolygonIds = null as string[] | null,
  onWorkRecordChanged,
  onMergeSuccess,
  canEditPolygon,
  currentUserId = null,
  userRole = '',
  doneFieldIds = [] as string[],
  showUndone = false,
}: any) {
  const [localActiveTab, setLocalActiveTab] = useState<'list' | 'edit' | 'points' | 'map'>('list');

  // ゲスト閲覧専用モードかチェック
  const isGuestMode = dbService?.isReadOnly() || false;

  // スマホの下部ナビとタブの状態を同期（ゲストモードなら強制的に一覧（list）アクティブに固定）
  const activeTab = isGuestMode ? 'list' : (activeTabOverride || localActiveTab);
  const sidebarTab = activeTab === 'map' ? 'list' : activeTab;
  const setActiveTab = isGuestMode ? () => {} : (setActiveTabOverride ? (tab: any) => setActiveTabOverride(tab) : setLocalActiveTab);

  const [searchQuery, setSearchQuery] = useState('');

  // 圃場統合ダイアログ表示フラグ
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  // 未登録ポリゴンと登録済み圃場の混在エラー
  const [mergeError, setMergeError] = useState<string | null>(null);

  // グループ化時のフォーム入力用
  const [groupProducer, setGroupProducer] = useState('');
  const [groupFieldName, setGroupFieldName] = useState('');
  const [groupCrop, setGroupCrop] = useState('');
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [isGrouping, setIsGrouping] = useState(false);

  // 生産者名サジェスト用
  const [producers, setProducers] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingImageId, setUploadingImageId] = useState<string | null>(null);

  const toast = useToast();

  useEffect(() => {
    if (dbService?.getProducers && !dbService.isReadOnly()) {
      dbService.getProducers().then(setProducers).catch(console.error);
    }
  }, [dbService]);

  // 地域名（逆ジオコーディング）と最近見た圃場履歴のステート
  const [localityName, setLocalityName] = useState<string>('');
  const [localityLoading, setLocalityLoading] = useState(false);
  const [recentFieldIds, setRecentFieldIds] = useState<string[]>([]);

  // 最終更新者関連のステート
  const [lastUpdate, setLastUpdate] = useState<{ displayName: string; updatedAt: string } | null>(null);
  const [loadingLastUpdate, setLoadingLastUpdate] = useState(false);

  const fetchLastUpdate = useCallback(async (fieldId: string) => {
    if (!dbService?.getLastUpdateLog || isGuestMode) return;
    if (!fieldId || fieldId.startsWith('poly-') || fieldId.startsWith('source-')) {
      setLastUpdate(null);
      return;
    }
    setLoadingLastUpdate(true);
    try {
      const log = await dbService.getLastUpdateLog(fieldId);
      if (log) {
        const date = new Date(log.created_at);
        const formattedDate = date.toLocaleString('ja-JP', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
        setLastUpdate({
          displayName: log.profiles?.display_name || '名称未設定',
          updatedAt: formattedDate
        });
      } else {
        setLastUpdate(null);
      }
    } catch (e) {
      console.error('Error fetching last update log:', e);
      setLastUpdate(null);
    } finally {
      setLoadingLastUpdate(false);
    }
  }, [dbService, isGuestMode]);

  useEffect(() => {
    fetchLastUpdate(selectedPolygonId);
  }, [selectedPolygonId, fetchLastUpdate]);

  const selectedPolygon = polygons.find((p: any) => p.internalId === selectedPolygonId);
  const relatedPoints = points.filter((p: any) => p.fieldInternalId === selectedPolygonId);
  const canEditSelectedPolygon = selectedPolygon
    ? (canEditPolygon ? canEditPolygon(selectedPolygon) : canEdit)
    : canEdit;



  // 選択中圃場が変わったら逆ジオコードィングで地域名取得
  useEffect(() => {
    if (!selectedPolygon?.geometry) {
      setLocalityName('');
      return;
    }
    const centroidCoords = (() => {
      try {
        const c = turf.centroid(turf.feature(selectedPolygon.geometry));
        return c.geometry.coordinates; // [lng, lat]
      } catch { return null; }
    })();
    if (!centroidCoords) return;
    setLocalityLoading(true);
    fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${centroidCoords[1]}&lon=${centroidCoords[0]}&format=json&zoom=14&accept-language=ja`,
      { headers: { 'User-Agent': 'fude-polygon-editor/1.0' } }
    )
      .then(r => r.json())
      .then(data => {
        const a = data.address || {};
        // 大字・町・中山間部落など詳細地名を優先度順に取得
        const locality =
          a.hamlet || a.quarter || a.neighbourhood ||
          a.city_district || a.suburb || a.village ||
          a.town || a.city || '';
        setLocalityName(locality);
      })
      .catch(() => setLocalityName(''))
      .finally(() => setLocalityLoading(false));
  }, [selectedPolygonId]); // いぞそこだけ再取得

  // 最近見た圃場履歴をlocalStorageで管理
  useEffect(() => {
    if (!orgId) return;
    const key = `recentFields_${orgId}`;
    const stored = JSON.parse(localStorage.getItem(key) || '[]');
    setRecentFieldIds(stored);
  }, [orgId]);

  useEffect(() => {
    if (!selectedPolygonId || !orgId) return;
    const key = `recentFields_${orgId}`;
    setRecentFieldIds(prev => {
      const updated = [selectedPolygonId, ...prev.filter(id => id !== selectedPolygonId)].slice(0, 10);
      localStorage.setItem(key, JSON.stringify(updated));
      return updated;
    });
  }, [selectedPolygonId, orgId]);


  const isEdited = (p: any) => p.fieldName || p.producerName || p.cropType || p.notes || p.remarks || points.some((pt: any) => pt.fieldInternalId === p.internalId);
  // DBに未保存（一時ID）かどうかを判定
  const isUnsaved = useCallback((p: any) => !p.internalId || p.internalId.startsWith('poly-') || p.internalId.startsWith('source-') || p.internalId.includes('-group-'), []);
  // 登録済み（UUID）かどうか
  const isRegistered = useCallback((p: any) => !isUnsaved(p), [isUnsaved]);

  // 複数選択モード時に登録済み圃場が混在していないかを監視してエラーを設定
  useEffect(() => {
    if (!isMultiSelectMode) {
      setGroupError(null);
      return;
    }
    const selectedPolys = polygons.filter((p: any) => selectedPolygonIds.includes(p.internalId));
    const hasRegistered = selectedPolys.some(isRegistered);
    if (hasRegistered) {
      setGroupError('登録済み圃場はグループ化できません。登録済み圃場をまとめる場合は『登録済み圃場を統合する』を使ってください。');
    } else {
      setGroupError(null);
    }
  }, [selectedPolygonIds, isMultiSelectMode, polygons, isRegistered]);

  // 検索フィルター（既存のテキスト検索、フィルターは MainApp 経由の filteredPolygonIds で管理）
  const matchSearch = (p: any) => {
    if (!searchQuery) return true;
    return (p.producerName && p.producerName.includes(searchQuery)) || (p.fieldName && p.fieldName.includes(searchQuery));
  };

  // filteredPolygonIds: null = 全件表示、配列 = そのアイテムのみ表示
  const matchFilter = (p: any) => {
    if (!filteredPolygonIds) return true; // フィルターなしは全件
    return filteredPolygonIds.includes(p.internalId);
  };

  const editedPolygons = polygons.filter(isEdited).filter(matchSearch).filter(matchFilter);
  const uneditedPolygons = polygons.filter((p:any) => !isEdited(p)).filter(matchSearch).slice(0, 100);
  const hasAnyEdited = polygons.some(isEdited);

  const savedCount = editedPolygons.filter((p: any) => !isUnsaved(p)).length;
  const unsavedCount = editedPolygons.filter((p: any) => isUnsaved(p)).length;

  // 最近見た圃場
  const recentPolygons = recentFieldIds
    .map(id => polygons.find((p: any) => p.internalId === id))
    .filter(Boolean)
    .slice(0, 10);

  // 圃場名の自動生成（生産者名_面積_地域名）
  const autoGenerateName = () => {
    if (isGuestMode || !canEditSelectedPolygon) return;
    if (!selectedPolygon || !selectedPolygon.producerName) {
      toast.error('先に「生産者名」を入力してください。');
      return;
    }
    const area = calculateArea(selectedPolygon.geometry);
    const locality = localityName || '地域不明';
    const generated = `${selectedPolygon.producerName}_${area}a_${locality}`;
    setPolygons((prev: any) => prev.map((p: any) => p.internalId === selectedPolygonId ? { ...p, fieldName: generated } : p));
    toast.success(`圃場名を生成しました: ${generated}`);
  };

  // Googleマップ用重心算出
  const getCentroid = (polygon: any) => {
    if (!polygon || !polygon.geometry) return null;
    try {
      const cent = turf.centroid(turf.feature(polygon.geometry));
      return cent.geometry.coordinates;
    } catch (e) {
      if (polygon.geometry.coordinates?.[0]?.[0]) {
        return polygon.geometry.coordinates[0][0];
      }
      return null;
    }
  };

  const centroid = getCentroid(selectedPolygon);
  const googleMapUrl = centroid ? `https://www.google.com/maps/search/?api=1&query=${centroid[1]},${centroid[0]}` : '';
  const googleDirUrl = centroid ? `https://www.google.com/maps/dir/?api=1&destination=${centroid[1]},${centroid[0]}` : '';

  // GPS現在地からのピン追加
  const addPointAtGps = () => {
    if (isGuestMode || !canEditSelectedPolygon) return;
    if (!gpsPosition) {
      toast.error('GPS情報を取得できていません。ブラウザの位置情報許可を確認してください。');
      return;
    }

    setPoints((prev: any) => [
      ...prev,
      {
        id: `point-${Date.now()}`,
        fieldInternalId: selectedPolygonId,
        pointType: "入口",
        name: "入口",
        description: "",
        imageUrl: null,
        coordinates: [gpsPosition.lng, gpsPosition.lat]
      }
    ]);
  };

  const handleSourceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const geojson = JSON.parse(event.target?.result as string);
        if (!geojson.features || !Array.isArray(geojson.features)) throw new Error('Invalid GeoJSON');
        setIsSaving(true);
        if (dbService?.uploadSourcePolygons) {
          await dbService.uploadSourcePolygons(geojson.features, (msg: string) => console.log(msg));
          alert('マスターデータのアップロードが完了しました。ページをリロードしてください。');
        }
      } catch (err: any) {
        console.error(err);
        alert('アップロードに失敗しました: ' + err.message);
      } finally {
        setIsSaving(false);
      }
    };
    reader.readAsText(file);
  };

  // 登録済み圃場の統合ボタン処理（merge_fields RPC 使用）
  const handleMergeFields = () => {
    if (!canEdit || selectedPolygonIds.length < 2) return;

    // 登録済み圃場かどうかを確認（未登録ポリゴンと混在した場合はエラー）
    const checkUnsaved = (p: any) =>
      !p?.internalId ||
      p.internalId.startsWith('poly-') ||
      p.internalId.startsWith('source-') ||
      p.internalId.includes('-group-');

    const selectedPolys = polygons.filter((p: any) => selectedPolygonIds.includes(p.internalId));
    const hasUneditable = selectedPolys.some((p: any) => canEditPolygon && !canEditPolygon(p));
    if (hasUneditable) {
      setMergeError('編集権限がない圃場は統合できません。\n自分の組織の登録済み圃場のみを選択してください。');
      return;
    }

    const hasUnregistered = selectedPolys.some((p: any) => checkUnsaved(p));
    if (hasUnregistered) {
      setMergeError('未登録の筆ポリゴンと登録済み圃場を混在した統合はできません。\n登録済み圃場のみを選択してください。');
      return;
    }
    setMergeError(null);
    setShowMergeDialog(true);
  };

  const handleMergeSuccess = async (mergedFieldId: string, _sourceFieldIds: string[]) => {
    setShowMergeDialog(false);
    setSelectedPolygonIds([]);
    setIsMultiSelectMode(false);
    setMergeError(null);
    if (onMergeSuccess) {
      await onMergeSuccess(mergedFieldId);
    }
    toast.success('圃場を統合しました。');
  };

  // 圃場グループ化処理
  const handleGroupPolygons = async () => {
    if (isGuestMode || !canEdit || isGrouping) return;
    if (selectedPolygonIds.length < 2) {
      toast.error('グループ化には、2つ以上の筆ポリゴンを選択してください。');
      return;
    }
    const selectedPolys = polygons.filter((p: any) => selectedPolygonIds.includes(p.internalId));
    if (selectedPolys.some(isRegistered)) {
      toast.error('登録済み圃場はグループ化できません。');
      return;
    }
    if (!groupProducer || !groupFieldName) {
      toast.error('生産者名と圃場名（通称）を入力してください。');
      return;
    }

    setIsGrouping(true);
    try {
      if (dbService) {
        const newField = await dbService.groupPolygons(selectedPolygonIds, {
          producerName: groupProducer,
          fieldName: groupFieldName,
          cropType: groupCrop,
          _localGeometries: polygons.reduce((acc: any, p: any) => {
            acc[p.internalId] = p;
            return acc;
          }, {})
        });

        if (newField) {
          const targets = polygons.filter((p: any) => selectedPolygonIds.includes(p.internalId));
          let mergedGeom = targets[0]?.geometry;
          if (targets.length > 1) {
            try {
              let unioned = turf.feature(targets[0].geometry);
              for (let i = 1; i < targets.length; i++) {
                unioned = turf.union(turf.featureCollection([unioned, turf.feature(targets[i].geometry)])) || unioned;
              }
              mergedGeom = unioned.geometry;
            } catch (e) {}
          }

          const fullNewField = {
            ...newField,
            geometry: mergedGeom,
            areaText: targets.reduce((acc: number, curr: any) => acc + (calculateArea(curr.geometry) || 0), 0).toString()
          };

          setPolygons((prev: any) => [
            ...prev.filter((p: any) => !selectedPolygonIds.includes(p.internalId)),
            fullNewField
          ]);

          setSelectedPolygonId(fullNewField.internalId);
          setActiveTab('edit');
        }

        toast.success('圃場をグループ化して登録しました。');
        setSelectedPolygonIds([]);
        setIsMultiSelectMode(false);
        setShowGroupForm(false);
        setGroupProducer('');
        setGroupFieldName('');
        setGroupCrop('');
      }
    } catch (e: any) {
      console.error(e);
      toast.error('グループ化に失敗しました: ' + e.message);
    } finally {
      setIsGrouping(false);
    }
  };

  const toggleSelectPolygon = (id: string) => {
    if (selectedPolygonIds.includes(id)) {
      setSelectedPolygonIds(selectedPolygonIds.filter((x: string) => x !== id));
    } else {
      setSelectedPolygonIds([...selectedPolygonIds, id]);
    }
  };

  // フィールドをクリア（DBから削除して未着手の状態に戻す）
  const handleClearField = async () => {
    if (!selectedPolygon || isGuestMode || !dbService || !canEditSelectedPolygon) return;

    const label = selectedPolygon.fieldName || selectedPolygon.producerName || '選択中の圃場';
    const hasPoints = relatedPoints.length > 0;

    const lines = [
      `「${label}」の登録情報を削除して未着手の状態に戻します。`,
      hasPoints ? `※ 関連するポイント ${relatedPoints.length} 件も同時に削除されます。` : '',
      '',
      'この操作は元に戻せません。よろしいですか？'
    ].filter(Boolean).join('\n');

    if (!window.confirm(lines)) return;

    setIsSaving(true);
    try {
      // 1. 関連ポイントをDBから削除
      for (const pt of relatedPoints) {
        if (!pt.id.startsWith('point-')) {
          await dbService.deletePoint(pt.id);
        }
      }

      // 2. フィールドをDBから削除（UUID＝保存済みの場合のみ）
      const isRegistered = !isUnsaved(selectedPolygon);
      if (isRegistered) {
        await dbService.deleteField(selectedPolygon.internalId);
      }

      // 3. ローカルのポイントを削除
      setPoints((prev: any) => prev.filter((pt: any) => pt.fieldInternalId !== selectedPolygonId));

      // 4. ポリゴンを未着手（source polygon）状態に差し戻す
      //    - sourceFeatureId がある → source polygon として復元
      //    - ない（完全新規描画など）→ ポリゴン自体を削除して選択解除
      const sourceId = selectedPolygon.sourceFeatureId;
      if (sourceId) {
        const unmappedPolygon = {
          internalId: sourceId,
          sourceFeatureId: sourceId,
          producerName: '',
          fieldName: '',
          cropType: '',
          areaText: selectedPolygon.areaText || '',
          notes: '',
          remarks: '',
          geometry: selectedPolygon.geometry,
          properties: {
            isUnmapped: true,
            originalProperties:
              selectedPolygon.properties?.sourcePolygons?.[0]?.originalProperties ||
              selectedPolygon.properties?.originalProperties ||
              {}
          }
        };
        setPolygons((prev: any) =>
          prev.map((p: any) => p.internalId === selectedPolygonId ? unmappedPolygon : p)
        );
        setSelectedPolygonId(null);
      } else {
        setPolygons((prev: any) => prev.filter((p: any) => p.internalId !== selectedPolygonId));
        setSelectedPolygonId(null);
      }

      // 5. 最終更新者をリセット
      setLastUpdate(null);

      // 6. 一覧タブに戻る
      setActiveTab('list');

      toast.success('圃場情報を削除しました。未着手の状態に戻りました。');
    } catch (e: any) {
      toast.error('クリアに失敗しました: ' + e.message);
    } finally {
      setIsSaving(false);
    }
  };


  const handleSaveField = async () => {
    if (!dbService || isGuestMode || !selectedPolygon || !canEditSelectedPolygon) return;
    setIsSaving(true);
    try {
      const fieldData = {
        ...selectedPolygon,
        _localGeometries: polygons.reduce((acc: any, curr: any) => {
          if (curr.internalId) acc[curr.internalId] = curr;
          return acc;
        }, {})
      };
      const saved = await dbService.saveField(fieldData);

      // 保存したデータでステートを更新
      setPolygons((prev: any) => prev.map((p: any) => p.internalId === selectedPolygonId ? saved : p));

      if (saved.internalId !== selectedPolygonId) {
        setSelectedPolygonId(saved.internalId);
        setPoints((prev: any) => prev.map((pt: any) => pt.fieldInternalId === selectedPolygonId ? { ...pt, fieldInternalId: saved.internalId } : pt));
      }
      toast.success('圃場情報を保存しました。');

      // 最終更新者情報を再取得
      fetchLastUpdate(saved.internalId);

      // 生産者リストも更新しておく
      if (dbService.getProducers) {
        dbService.getProducers().then(setProducers);
      }
    } catch (e: any) {
      toast.error('保存に失敗しました: ' + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSavePoint = async (point: any) => {
    if (!dbService || isGuestMode) return;

    // 紐付く圃場が未保存（poly- や source-）の場合は、先に圃場を保存させる
    if (point.fieldInternalId && (point.fieldInternalId.startsWith('poly-') || point.fieldInternalId.startsWith('source-'))) {
      toast.error('圃場が未保存です。先に「保存」ボタンから圃場を保存してください。');
      return;
    }

    try {
      const saved = await dbService.savePoint(point);
      setPoints((prev: any) => prev.map((p: any) => p.id === point.id ? saved : p));
      toast.success('ポイントを保存しました。');
    } catch (error: any) {
      console.error(error);
      toast.error('ポイントの保存に失敗しました: ' + error.message);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, pointId: string) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    if (!dbService?.uploadPointImage) {
      toast.error('画像アップロード機能が利用できません。');
      return;
    }

    setUploadingImageId(pointId);
    try {
      const options = {
        maxSizeMB: 1, // 最大1MBに圧縮
        maxWidthOrHeight: 1200,
        useWebWorker: true
      };

      const compressedFile = await imageCompression(file, options);
      const url = await dbService.uploadPointImage(compressedFile, pointId);

      // state 更新
      setPoints((prev: any) => prev.map((p: any) => p.id === pointId ? { ...p, imageUrl: url } : p));

      // 画像更新したポイントをすぐに保存する
      const updatedPoint = points.find((p: any) => p.id === pointId);
      if (updatedPoint) {
         dbService.savePoint({ ...updatedPoint, imageUrl: url }).catch(console.error);
      }
    } catch (error: any) {
      console.error(error);
      toast.error('画像のアップロードに失敗しました。');
    } finally {
      setUploadingImageId(null);
    }
  };

  return (
    <>
    <div className="flex flex-col h-full pr-2">

      {/* タブヘッダー (PCでのみ表示、スマホ表示時は下部ナビに一本化するため非表示にする。ゲストモードでも不要なため非表示。) */}
      <div className={`border-b text-xs md:text-sm font-semibold shrink-0 bg-slate-50 border-r ${isMobile || isGuestMode ? 'hidden' : 'flex'}`}>
        <button className={`flex-1 py-3 text-center transition ${sidebarTab === 'list' ? 'border-b-2 border-indigo-600 bg-white text-indigo-600 font-bold' : 'text-gray-500 hover:bg-gray-100'}`} onClick={() => setActiveTab('list')}>一覧</button>
        <button className={`flex-1 py-3 text-center transition ${sidebarTab === 'edit' ? 'border-b-2 border-indigo-600 bg-white text-indigo-600 font-bold' : 'text-gray-500 hover:bg-gray-100 disabled:opacity-40'}`} onClick={() => setActiveTab('edit')} disabled={!selectedPolygonId}>編集</button>
        <button className={`flex-1 py-3 text-center transition ${sidebarTab === 'points' ? 'border-b-2 border-indigo-600 bg-white text-indigo-600 font-bold' : 'text-gray-500 hover:bg-gray-100 disabled:opacity-40'}`} onClick={() => setActiveTab('points')} disabled={!selectedPolygonId}>ポイント</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 md:p-4 border-r bg-white">
            {/* ウィジェット は山田太郎のダミーテキスト、生産者名の入力テキストボックス */}
        <datalist id="producers-list">
          {producers.map((prod: string, i: number) => (
            <option key={i} value={prod} />
          ))}
        </datalist>

        {sidebarTab === 'list' && (
          <div>
            {/* 最近見た圃場セクション（orgIdがあれば常に表示） */}
            {recentPolygons.length > 0 && (
              <div className="mb-4">
                <h3 className="font-extrabold text-xs text-amber-700 tracking-wider mb-2 flex items-center gap-1.5">
                  <Clock size={12} className="text-amber-500" />
                  最近見た圃場
                </h3>
                {recentPolygons.map((p: any) => (
                  <div
                    key={p.internalId}
                    onClick={() => {
                      setSelectedPolygonId(p.internalId);
                      if (isMobile || isGuestMode) setActiveTab('map');
                      else setActiveTab('edit');
                    }}
                    className={`p-2.5 border rounded-xl cursor-pointer mb-1 text-xs transition flex items-center gap-2 ${
                      selectedPolygonId === p.internalId
                        ? 'border-amber-400 bg-amber-50 text-amber-900 font-bold'
                        : 'hover:bg-amber-50/50 text-slate-700 border-slate-100 bg-white'
                    }`}
                  >
                    <Clock size={11} className="text-amber-400 shrink-0" />
                    <span className="truncate">{p.fieldName || (p.producerName ? `${p.producerName}` : '名称未設定')}</span>
                  </div>
                ))}
                <div className="border-b border-slate-100 my-3" />
              </div>
            )}
            {/* 複数選択トグルエリア (ゲスト閲覧時は非表示にします) */}
            {!isGuestMode && (
              <div className="mb-4 flex items-center justify-between bg-slate-50 border rounded-xl p-3 text-xs font-semibold">
                <span className="flex items-center gap-1.5 text-slate-700">
                  <Layers size={14} className="text-indigo-600" />
                  複数筆のグループ化
                </span>
                <button
                  onClick={() => {
                    setIsMultiSelectMode(!isMultiSelectMode);
                    setSelectedPolygonIds([]);
                    setShowGroupForm(false);
                  }}
                  className={`px-3 py-1.5 rounded-lg border shadow-sm transition font-bold ${isMultiSelectMode ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700' : 'bg-white hover:bg-slate-50 text-slate-700'}`}
                >
                  {isMultiSelectMode ? '複数選択中...' : '複数選択モード'}
                </button>
              </div>
            )}

            {/* 複数選択時のグループ化・統合操作パネル */}
            {isMultiSelectMode && !isGuestMode && (
              <div className="mb-4 bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 animate-fade-in text-xs">
                <p className="font-bold text-indigo-900 mb-2">
                  選択中の筆: <span className="text-indigo-700 bg-white border px-2 py-0.5 rounded-full font-extrabold">{selectedPolygonIds.length}</span> 件
                </p>

                {/* 登録済み圃場の統合ボタン（canEdit かつ全て登録済みの場合） */}
                {canEdit && selectedPolygonIds.length >= 2 &&
                  selectedPolygonIds.every((id: string) => {
                    const p = polygons.find((pl: any) => pl.internalId === id);
                    return p && p.internalId && !p.internalId.startsWith('poly-') && !p.internalId.startsWith('source-') && !p.internalId.includes('-group-') && (!canEditPolygon || canEditPolygon(p));
                  }) && (
                  <button
                    onClick={handleMergeFields}
                    className="w-full mb-2 flex items-center justify-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white font-bold py-2 rounded-lg transition shadow-md text-xs"
                  >
                    <GitMerge size={13} />
                    登録済み圃場を統合する
                  </button>
                )}
                {mergeError && (
                  <div className="mb-2 flex items-start gap-1.5 bg-rose-50 border border-rose-200 rounded-xl p-2.5 text-xs text-rose-700">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" />
                    <span className="whitespace-pre-wrap">{mergeError}</span>
                  </div>
                )}

                {/* 未登録ポリゴンのグループ化フォーム */}
                {canEdit && selectedPolygonIds.length >= 2 ? (
                  !showGroupForm ? (
                    <button
                      onClick={() => setShowGroupForm(true)}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded-lg transition shadow-md"
                    >
                      これらの筆を1つの圃場にする
                    </button>
                  ) : (
                    <div className="space-y-3 mt-2 pt-2 border-t border-indigo-100">
                      {groupError && (
                        <div className="flex items-start gap-1.5 bg-rose-50 border border-rose-200 rounded-xl p-2.5 text-xs text-rose-700">
                          <AlertCircle size={13} className="mt-0.5 shrink-0" />
                          <span className="whitespace-pre-wrap">{groupError}</span>
                        </div>
                      )}
                      <div>
                        <label className="block text-slate-600 font-bold mb-1">生産者名 *</label>
                        <input type="text" value={groupProducer} onChange={e => setGroupProducer(e.target.value)} placeholder="例: 山田太郎" className="w-full border p-2 bg-white rounded-lg outline-none focus:border-indigo-500" />
                      </div>
                      <div>
                        <label className="block text-slate-600 font-bold mb-1">圃場名（通称） *</label>
                        <input type="text" value={groupFieldName} onChange={e => setGroupFieldName(e.target.value)} placeholder="例: 上野原" className="w-full border p-2 bg-white rounded-lg outline-none focus:border-indigo-500" />
                      </div>
                      <div>
                        <label className="block text-slate-600 font-bold mb-1">作付作物</label>
                        <input type="text" value={groupCrop} onChange={e => setGroupCrop(e.target.value)} placeholder="例: コシヒカリ" className="w-full border p-2 bg-white rounded-lg outline-none focus:border-indigo-500" />
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={handleGroupPolygons}
                          disabled={isGrouping || !!groupError}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 rounded-lg transition shadow disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isGrouping ? '作成中...' : '作成する'}
                        </button>
                        <button
                          onClick={() => setShowGroupForm(false)}
                          disabled={isGrouping}
                          className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-2 rounded-lg transition disabled:opacity-50"
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <p className="text-slate-500">地図上でまとめたい筆ポリゴンを2箇所以上クリックして選択してください。</p>
                )}
              </div>
            )}

            {/* 検索フィルターバー（生産者・作業項目） */}
            <FieldFilterBar
              producers={producers}
              workTypes={workTypes}
              filter={fieldFilter}
              onChange={onFilterChange ?? (() => {})}
            />

            {/* 圃場検索（テキスト） */}
            <div className="relative mb-2">
              <input type="text" placeholder="圃場名で内部検索..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-8 pr-2 py-2 border rounded-lg text-xs outline-none focus:border-indigo-500 shadow-sm bg-slate-50/50" />
              <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
            </div>

             {hasAnyEdited && (
               <div className="mb-4">
                 <div className="flex items-center justify-between mb-2">
                   <h3 className="font-extrabold text-xs text-indigo-700 tracking-wider">
                     登録済み圃場 ({editedPolygons.filter((p: any) => isRegistered(p)).length})
                   </h3>
                   {unsavedCount > 0 && (
                     <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                       未保存 {unsavedCount}件あり
                     </span>
                   )}
                 </div>
                 {/* 0件空状態 */}
                 {editedPolygons.length === 0 && (
                   <p className="text-xs text-slate-400 italic py-2">条件に一致する圃場がありません。</p>
                 )}
                 {editedPolygons.map((p: any) => (
                   <div
                     key={p.internalId}
                     onClick={() => {
                        if (isMultiSelectMode && !isGuestMode) {
                          toggleSelectPolygon(p.internalId);
                        } else {
                          setSelectedPolygonId(p.internalId);
                          if (isMobile || isGuestMode) {
                            setActiveTab('map');
                          } else {
                            setActiveTab('edit');
                          }
                        }
                     }}
                     className={`p-3 border rounded-xl cursor-pointer mb-1.5 text-xs transition flex items-center justify-between ${
                       isMultiSelectMode && selectedPolygonIds.includes(p.internalId)
                         ? 'border-amber-500 bg-amber-50 shadow-sm'
                         : selectedPolygonId === p.internalId
                           ? 'border-indigo-500 bg-indigo-50/70 shadow-sm font-bold text-indigo-900'
                           : isUnsaved(p)
                             ? 'hover:bg-amber-50 text-slate-800 border-amber-200 bg-amber-50/30'
                             : 'hover:bg-slate-50 text-slate-800 border-slate-100 bg-slate-50/20'
                     }`}
                   >
                     <div className="flex items-center gap-2 min-w-0">
                       {isMultiSelectMode && !isGuestMode && (
                         selectedPolygonIds.includes(p.internalId) ? <CheckSquare size={14} className="text-amber-600 shrink-0" /> : <Square size={14} className="text-slate-400 shrink-0" />
                       )}
                       <span className="truncate">{p.fieldName || (p.producerName ? `${p.producerName} (名称未設定)` : '名称未設定')}</span>
                       {showUndone && (
                         doneFieldIds.includes(p.internalId) ? (
                           <span className="shrink-0 text-[10px] font-bold text-green-700 bg-green-100 border border-green-300 px-1.5 py-0.5 rounded ml-1.5 whitespace-nowrap">実施済み</span>
                         ) : (
                           <span className="shrink-0 text-[10px] font-bold text-red-700 bg-red-100 border border-red-300 px-1.5 py-0.5 rounded ml-1.5 whitespace-nowrap">未実施</span>
                         )
                       )}
                       {isUnsaved(p) && (
                         <span className="shrink-0 text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 px-1 py-0.5 rounded">未保存</span>
                       )}
                     </div>
                     <span className="text-xs font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full shrink-0 ml-1">{calculateArea(p.geometry)}a</span>
                   </div>
                 ))}
               </div>
            )}

            {!isGuestMode && (
              <>
                <h3 className="font-extrabold text-xs text-slate-500 tracking-wider mb-2">未着手筆ポリゴン (最初の100件表示)</h3>
                {uneditedPolygons.length === 0 ? <p className="text-xs text-gray-400">見つかりません</p> : uneditedPolygons.map((p: any) => (
                  <div
                    key={p.internalId}
                    onClick={() => {
                      if (isMultiSelectMode && !isGuestMode) {
                        toggleSelectPolygon(p.internalId);
                      } else {
                        setSelectedPolygonId(p.internalId);
                        if (isMobile) {
                          setActiveTab('map'); // スマホなら自動で地図タブに切り替えて場所を見せる！
                        } else {
                          setActiveTab('edit');
                        }
                      }
                    }}
                    className={`p-2.5 border rounded-xl cursor-pointer mb-1 text-xs transition flex items-center justify-between ${
                      isMultiSelectMode && selectedPolygonIds.includes(p.internalId)
                        ? 'border-amber-500 bg-amber-50 shadow-sm'
                        : selectedPolygonId === p.internalId
                          ? 'border-indigo-500 bg-indigo-50/70 shadow'
                          : 'hover:bg-slate-50 text-slate-500 border-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {isMultiSelectMode && !isGuestMode && (
                        selectedPolygonIds.includes(p.internalId) ? <CheckSquare size={12} className="text-amber-600" /> : <Square size={12} className="text-slate-400" />
                      )}
                      <span>名称未設定</span>
                    </div>
                    <span className="text-xs opacity-75">({calculateArea(p.geometry)}a)</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {sidebarTab === 'edit' && selectedPolygon && (
          <div className="space-y-4">
            {/* スマホ用「地図で場所を確認」ボタン */}
            {isMobile && (
              <button
                onClick={() => { setActiveTab('map'); if (onShowMap) onShowMap(); }}
                className="w-full mb-3 bg-white hover:bg-slate-50 text-indigo-700 font-bold py-2.5 px-4 rounded-xl border border-indigo-200 shadow-sm transition flex items-center justify-center gap-1.5 text-xs active:scale-95"
              >
                <Navigation size={14} className="text-indigo-600 animate-pulse" />
                📍 地図で場所を確認する
              </button>
            )}

            <div className="bg-indigo-50/70 border border-indigo-100 text-indigo-900 p-3.5 rounded-xl text-center font-extrabold mb-3 flex flex-col justify-center">
              <span className="text-xs text-indigo-500 font-bold uppercase tracking-wider">実測面積</span>
              <span className="text-lg">{calculateArea(selectedPolygon.geometry)} a <span className="text-xs font-normal text-slate-500">(アール)</span></span>
            </div>

            {/* 地域情報バッジ */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 mb-4 text-xs">
              <MapPin size={12} className="text-indigo-400 shrink-0" />
              <span className="font-bold text-slate-400">地域:</span>
              {localityLoading ? (
                <span className="text-slate-400 animate-pulse">取得中...</span>
              ) : (
                <span className="font-semibold text-slate-700">{localityName || '未取得'}</span>
              )}
            </div>

            {/* 最終更新者情報 */}
            {(lastUpdate || loadingLastUpdate) && (
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 mb-4 text-xs">
                <Clock size={12} className="text-indigo-400 shrink-0" />
                <span className="font-bold text-slate-400">最終更新:</span>
                {loadingLastUpdate ? (
                  <span className="text-slate-400 animate-pulse">取得中...</span>
                ) : (
                  <span className="font-semibold text-slate-700">
                    {lastUpdate ? `${lastUpdate.displayName} (${lastUpdate.updatedAt})` : 'なし'}
                  </span>
                )}
              </div>
            )}

            {['producerName:生産者名:例：山田太郎', 'fieldName:通称（圃場名）:例：上野原_10a', 'cropType:作物:例：コシヒカリ', 'notes:注意点・作業指示:例：電線に注意', 'remarks:ステータス/備考:active / planned'].map(f => {
              const [key, label, placeholder] = f.split(':');
              return (
                <div key={key}>
                  <label className="block text-xs font-bold text-slate-600 mb-1">{label}</label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={selectedPolygon[key] || ''}
                      placeholder={placeholder}
                      readOnly={!canEditSelectedPolygon}
                      list={key === 'producerName' ? 'producers-list' : undefined}
                      onChange={(e) => canEditSelectedPolygon && setPolygons((prev: any) => prev.map((poly: any) => poly.internalId === selectedPolygonId ? { ...poly, [key]: e.target.value } : poly))}
                      className={`w-full border p-2.5 text-sm rounded-xl outline-none focus:border-indigo-500 ${!canEditSelectedPolygon ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-slate-50/30'}`}
                    />

                    {key === 'fieldName' && canEditSelectedPolygon && (
                      <button onClick={autoGenerateName} className="px-3.5 py-1 bg-slate-100 hover:bg-slate-200 border text-xs font-bold rounded-xl whitespace-nowrap transition shadow-sm">
                        自動入力
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* 明示的な保存ボタン + クリアボタン */}
            {canEditSelectedPolygon && (
              <div className="flex flex-col gap-2 mt-4">
                <button
                  onClick={handleSaveField}
                  disabled={isSaving}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl transition shadow-md flex items-center justify-center disabled:opacity-50"
                >
                  {isSaving ? <Loader2 size={18} className="animate-spin mr-2" /> : <Save size={18} className="mr-2" />}
                  {isSaving ? '保存中...' : 'この圃場を保存する'}
                </button>

                <button
                  onClick={handleClearField}
                  disabled={isSaving}
                  className="w-full bg-white hover:bg-rose-50 text-rose-500 border border-rose-200 hover:border-rose-400 font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 text-sm disabled:opacity-40"
                >
                  <Eraser size={15} />
                  入力内容をクリア
                </button>
              </div>
            )}

            {/* Googleマップ連携ボタンセクション */}
            {centroid && (
              <div className="pt-4 border-t border-slate-100 space-y-2.5">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">外部マップ連携</p>
                <div className="grid grid-cols-2 gap-2">
                  <a
                    href={googleMapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1 bg-white hover:bg-slate-50 text-slate-700 font-bold py-2.5 px-3 border rounded-xl text-xs transition shadow-sm"
                  >
                    <ExternalLink size={12} />
                    マップで開く
                  </a>
                  <a
                    href={googleDirUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold py-2.5 px-3 rounded-xl text-xs transition shadow-sm"
                  >
                    <Navigation size={12} />
                    経路案内
                  </a>
                </div>
              </div>
            )}

            {/* 作業履歴 */}
            <WorkHistory
              fieldId={selectedPolygonId}
              fieldName={selectedPolygon?.fieldName || selectedPolygon?.producerName || ''}
              workTypes={workTypes}
              isReadOnly={!canEditSelectedPolygon}
              dbService={dbService}
              onRecordChanged={onWorkRecordChanged}
              currentUserId={currentUserId ?? null}
              userRole={userRole ?? ''}
            />
          </div>
        )}

        {sidebarTab === 'points' && selectedPolygon && (
          <div className="space-y-4">
            {/* スマホ用「地図で場所を確認」ボタン */}
            {isMobile && (
              <button
                onClick={() => { setActiveTab('map'); if (onShowMap) onShowMap(); }}
                className="w-full mb-3 bg-white hover:bg-slate-50 text-indigo-700 font-bold py-2.5 px-4 rounded-xl border border-indigo-200 shadow-sm transition flex items-center justify-center gap-1.5 text-xs active:scale-95"
              >
                <Navigation size={14} className="text-indigo-600 animate-pulse" />
                📍 地図で場所を確認する
              </button>
            )}

            {/* 地図クリック追加 (canEditでない場合は非表示) */}
            {canEditSelectedPolygon && (
              <>
                <button
                  onClick={() => {
                    const nextAdding = !isAddingPoint;
                    setIsAddingPoint(nextAdding);
                    if (nextAdding && isMobile) {
                      setActiveTab('map');
                    }
                  }}
                  className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center border transition shadow-sm ${
                    isAddingPoint
                      ? 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100'
                      : 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  <Target size={14} className="mr-2" />
                  {isAddingPoint ? '地図クリック待ち（キャンセル）' : '地図上をクリックしてピン追加'}
                </button>

                {/* GPS現在地から追加 */}
                <button
                  onClick={addPointAtGps}
                  disabled={!gpsPosition}
                  className="w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center border bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:hover:bg-emerald-600 transition shadow-sm"
                >
                  <MapPin size={14} className="mr-2" />
                  現在位置にピンを追加
                </button>
                {!gpsPosition && (
                  <p className="text-xs text-slate-400 text-center">※GPS現在地取得（ON）の時のみ有効です</p>
                )}
              </>
            )}

            <div className="pt-2 border-t border-slate-100">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">圃場内の重要地点 ({relatedPoints.length})</p>
              {relatedPoints.length === 0 ? (
                <p className="text-xs text-slate-400 italic">登録済みのピンはありません。</p>
              ) : (
                relatedPoints.map((pt: any) => (
                  <div key={pt.id} className="p-3 bg-slate-50 border border-slate-100 rounded-xl mb-2 hover:shadow-sm transition">
                    <div className="flex justify-between items-center mb-1">
                      {!canEditSelectedPolygon ? (
                        <span className="text-xs font-bold text-indigo-700 bg-white border border-slate-100 rounded px-2 py-0.5">{pt.pointType}</span>
                      ) : (
                        <select
                          value={pt.pointType}
                          onChange={(e) => setPoints((prev: any) => prev.map((p: any) => p.id === pt.id ? {...p, pointType: e.target.value as any} : p))}
                          className="text-xs font-bold text-indigo-700 bg-white border rounded px-1.5 py-0.5 outline-none focus:border-indigo-500"
                        >
                          <option value="入口">入口</option>
                          <option value="駐車場所">駐車場所</option>
                          <option value="水口">水口</option>
                          <option value="落とし">落とし</option>
                          <option value="危険箇所">危険箇所</option>
                          <option value="その他">その他</option>
                        </select>
                      )}
                      {canEditSelectedPolygon && (
                        <button onClick={() => setPoints((prev: any) => prev.filter((p: any) => p.id !== pt.id))} className="text-xs text-rose-500 hover:underline font-semibold">削除</button>
                      )}
                    </div>

                    {pt.imageUrl && (
                      <div className="mb-2 w-full rounded-lg overflow-hidden border border-slate-200">
                        <img src={pt.imageUrl} alt={pt.pointType} className="w-full h-auto object-cover max-h-32" />
                      </div>
                    )}

                    {canEditSelectedPolygon && (
                      <div className="mb-2">
                        <label className="cursor-pointer flex items-center justify-center w-full p-2 border-2 border-dashed border-slate-300 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100 hover:border-slate-400 transition bg-white">
                          {uploadingImageId === pt.id ? (
                            <><Loader2 size={14} className="animate-spin mr-1" /> 画像圧縮・アップロード中...</>
                          ) : (
                            <><Camera size={14} className="mr-1" /> {pt.imageUrl ? '画像を変更' : '写真を追加'}</>
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleImageUpload(e, pt.id)}
                            disabled={uploadingImageId === pt.id}
                          />
                        </label>
                      </div>
                    )}
                    <input
                      type="text"
                      value={pt.description || ''}
                      readOnly={!canEditSelectedPolygon}
                      onChange={(e) => canEditSelectedPolygon && setPoints((prev: any) => prev.map((p: any) => p.id === pt.id ? {...p, description: e.target.value} : p))}
                      className={`w-full text-xs mt-1.5 p-1.5 border rounded-lg bg-white outline-none focus:border-indigo-500 ${!canEditSelectedPolygon ? 'bg-slate-100 border-none text-slate-500' : ''}`}
                      placeholder="補足説明"
                    />

                    {/* 個別のポイント保存ボタン */}
                    {canEditSelectedPolygon && (
                      <button
                        onClick={() => handleSavePoint(pt)}
                        className="w-full mt-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold py-1.5 rounded-lg border border-indigo-200 transition shadow-sm text-xs flex items-center justify-center"
                      >
                        <Save size={12} className="mr-1.5" /> このポイントを保存
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>

    {/* 圃場統合ダイアログ（ルートレベル） */}
    {showMergeDialog && canEdit && (
      <MergeFieldsDialog
        selectedFieldIds={selectedPolygonIds}
        polygons={polygons}
        dbService={dbService}
        onSuccess={handleMergeSuccess}
        onCancel={() => { setShowMergeDialog(false); setMergeError(null); }}
      />
    )}
    </>
  );
}
