'use client';
import React, { useState, useEffect } from 'react';
import { Target, Search, CheckSquare, Square, Layers, Navigation, ExternalLink, MapPin, Camera, Save, Loader2, UploadCloud } from 'lucide-react';
import { calculateArea } from '@/lib/utils';
import * as turf from '@turf/turf';
import imageCompression from 'browser-image-compression';

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
  activeTabOverride,
  setActiveTabOverride
}: any) {
  const [localActiveTab, setLocalActiveTab] = useState<'list' | 'edit' | 'points'>('list');
  
  // スマホの下部ナビとタブの状態を同期
  const activeTab = activeTabOverride || localActiveTab;
  const sidebarTab = activeTab === 'map' ? 'list' : activeTab;
  const setActiveTab = setActiveTabOverride ? (tab: any) => setActiveTabOverride(tab) : setLocalActiveTab;

  const [searchQuery, setSearchQuery] = useState('');
  
  // グループ化時のフォーム入力用
  const [groupProducer, setGroupProducer] = useState('');
  const [groupFieldName, setGroupFieldName] = useState('');
  const [groupCrop, setGroupCrop] = useState('');
  const [showGroupForm, setShowGroupForm] = useState(false);

  // 生産者名サジェスト用
  const [producers, setProducers] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingImageId, setUploadingImageId] = useState<string | null>(null);

  useEffect(() => {
    if (dbService?.getProducers && !dbService.isReadOnly()) {
      dbService.getProducers().then(setProducers).catch(console.error);
    }
  }, [dbService]);

  const selectedPolygon = polygons.find((p: any) => p.internalId === selectedPolygonId);
  const relatedPoints = points.filter((p: any) => p.fieldInternalId === selectedPolygonId);

  // ゲスト閲覧専用モードかチェック
  const isGuestMode = dbService?.isReadOnly() || false;

  const isEdited = (p: any) => p.producerName || p.cropType || p.notes || p.remarks || points.some((pt: any) => pt.fieldInternalId === p.internalId);
  
  // 検索フィルター
  const matchSearch = (p: any) => {
    if (!searchQuery) return true;
    return (p.producerName && p.producerName.includes(searchQuery)) || (p.fieldName && p.fieldName.includes(searchQuery));
  };

  const editedPolygons = polygons.filter(isEdited).filter(matchSearch);
  const uneditedPolygons = polygons.filter((p:any) => !isEdited(p)).filter(matchSearch).slice(0, 100);

  // 圃場名の自動生成
  const autoGenerateName = () => {
    if (isGuestMode) return;
    if (!selectedPolygon || !selectedPolygon.producerName) {
      alert("先に「生産者名」を入力してください。"); return;
    }
    const area = calculateArea(selectedPolygon.geometry);
    setPolygons((prev: any) => prev.map((p: any) => p.internalId === selectedPolygonId ? { ...p, fieldName: `${selectedPolygon.producerName}_${area}a` } : p));
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
    if (isGuestMode) return;
    if (!gpsPosition) {
      alert("GPS情報を取得できていません。ブラウザの位置情報許可を確認してください。");
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

  // 圃場グループ化処理
  const handleGroupPolygons = async () => {
    if (isGuestMode) return;
    if (selectedPolygonIds.length < 2) {
      alert('グループ化するには、2つ以上の筆ポリゴンを選択してください。');
      return;
    }
    if (!groupProducer || !groupFieldName) {
      alert('生産者名と圃場名（通称）を入力してください。');
      return;
    }

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

        alert('圃場をグループ化して新規登録しました。');
        setSelectedPolygonIds([]);
        setIsMultiSelectMode(false);
        setShowGroupForm(false);
        setGroupProducer('');
        setGroupFieldName('');
        setGroupCrop('');
      }
    } catch (e: any) {
      console.error(e);
      alert('グループ化に失敗しました: ' + e.message);
    }
  };

  const toggleSelectPolygon = (id: string) => {
    if (selectedPolygonIds.includes(id)) {
      setSelectedPolygonIds(selectedPolygonIds.filter((x: string) => x !== id));
    } else {
      setSelectedPolygonIds([...selectedPolygonIds, id]);
    }
  };

  const handleSaveField = async () => {
    if (!dbService || isGuestMode || !selectedPolygon) return;
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
      alert('圃場情報を保存しました。');
      
      // 生産者リストも更新しておく
      if (dbService.getProducers) {
        dbService.getProducers().then(setProducers);
      }
    } catch (e: any) {
      alert('保存に失敗しました: ' + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSavePoint = async (point: any) => {
    if (!dbService || isGuestMode) return;
    
    // 紐付く圃場が未保存（poly-）の場合は、先に圃場を保存させる
    if (point.fieldInternalId && point.fieldInternalId.startsWith('poly-')) {
      alert('先に圃場本体を保存してください。');
      return;
    }

    try {
      const saved = await dbService.savePoint(point);
      setPoints((prev: any) => prev.map((p: any) => p.id === point.id ? saved : p));
      alert('ポイントを保存しました。');
    } catch (error: any) {
      console.error(error);
      alert('ポイントの保存に失敗しました: ' + error.message);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, pointId: string) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    if (!dbService?.uploadPointImage) {
      alert('画像アップロード機能が利用できません。');
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
      alert('画像のアップロードに失敗しました。');
    } finally {
      setUploadingImageId(null);
    }
  };

  return (
    <div className="flex flex-col h-full pr-2">
      {/* 開発者用アップロードボタン */}
      {!isGuestMode && dbService && (
        <div className="mb-4 bg-slate-50 p-2 rounded-xl border border-slate-200">
          <label className="text-xs font-bold text-slate-500 flex items-center justify-center gap-2 cursor-pointer">
            <UploadCloud size={14} /> マスタデータ (GeoJSON) アップロード
            <input type="file" accept=".geojson,.json" className="hidden" onChange={handleSourceUpload} disabled={isSaving} />
          </label>
        </div>
      )}

      {/* タブヘッダー (PCでは常に表示、スマホ時は下部タブナビと連動するため折りたたまれてもよいが、上部切り替えとしても機能させます) */}
      <div className="flex border-b text-xs md:text-sm font-semibold shrink-0 bg-slate-50 border-r">
        <button className={`flex-1 py-3 text-center transition ${sidebarTab === 'list' ? 'border-b-2 border-indigo-600 bg-white text-indigo-600 font-bold' : 'text-gray-500 hover:bg-gray-100'}`} onClick={() => setActiveTab('list')}>一覧</button>
        <button className={`flex-1 py-3 text-center transition ${sidebarTab === 'edit' ? 'border-b-2 border-indigo-600 bg-white text-indigo-600 font-bold' : 'text-gray-500 hover:bg-gray-100 disabled:opacity-40'}`} onClick={() => setActiveTab('edit')} disabled={!selectedPolygonId}>編集</button>
        <button className={`flex-1 py-3 text-center transition ${sidebarTab === 'points' ? 'border-b-2 border-indigo-600 bg-white text-indigo-600 font-bold' : 'text-gray-500 hover:bg-gray-100 disabled:opacity-40'}`} onClick={() => setActiveTab('points')} disabled={!selectedPolygonId}>ポイント</button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-3 md:p-4 border-r bg-white">
        {/* datalist (オートコンプリート用) */}
        <datalist id="producers-list">
          {producers.map((prod, i) => (
            <option key={i} value={prod} />
          ))}
        </datalist>

        {sidebarTab === 'list' && (
          <div>
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

            {/* 複数選択時のグループ化操作パネル */}
            {isMultiSelectMode && !isGuestMode && (
              <div className="mb-4 bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 animate-fade-in text-xs">
                <p className="font-bold text-indigo-900 mb-2">
                  選択中の筆: <span className="text-indigo-700 bg-white border px-2 py-0.5 rounded-full font-extrabold">{selectedPolygonIds.length}</span> 件
                </p>
                {selectedPolygonIds.length >= 2 ? (
                  !showGroupForm ? (
                    <button 
                      onClick={() => setShowGroupForm(true)}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded-lg transition shadow-md"
                    >
                      これらの筆を1つの圃場にする
                    </button>
                  ) : (
                    <div className="space-y-3 mt-2 pt-2 border-t border-indigo-100">
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
                        <button onClick={handleGroupPolygons} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 rounded-lg transition shadow">作成する</button>
                        <button onClick={() => setShowGroupForm(false)} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-2 rounded-lg transition">キャンセル</button>
                      </div>
                    </div>
                  )
                ) : (
                  <p className="text-slate-500">地図上でまとめたい筆ポリゴンを2箇所以上クリックして選択してください。</p>
                )}
              </div>
            )}

            <div className="relative mb-4">
              <input type="text" placeholder="生産者名・圃場名で検索..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-8 pr-2 py-2 border rounded-lg text-sm outline-none focus:border-indigo-500 shadow-sm bg-slate-50/50" />
              <Search size={16} className="absolute left-2.5 top-3 text-gray-400" />
            </div>
            
            {editedPolygons.length > 0 && (
               <div className="mb-4">
                 <h3 className="font-extrabold text-xs text-indigo-700 tracking-wider mb-2">登録済み圃場 ({editedPolygons.length})</h3>
                 {editedPolygons.map((p: any) => (
                   <div 
                     key={p.internalId} 
                     onClick={() => {
                       if (isMultiSelectMode && !isGuestMode) {
                         toggleSelectPolygon(p.internalId);
                       } else {
                         setSelectedPolygonId(p.internalId); 
                         setActiveTab('edit'); 
                       }
                     }} 
                     className={`p-3 border rounded-xl cursor-pointer mb-1.5 text-xs transition flex items-center justify-between ${
                       isMultiSelectMode && selectedPolygonIds.includes(p.internalId)
                         ? 'border-amber-500 bg-amber-50 shadow-sm'
                         : selectedPolygonId === p.internalId
                           ? 'border-indigo-500 bg-indigo-50/70 shadow-sm font-bold text-indigo-900'
                           : 'hover:bg-slate-50 text-slate-800 border-slate-100 bg-slate-50/20'
                     }`}
                   >
                     <div className="flex items-center gap-2">
                       {isMultiSelectMode && !isGuestMode && (
                         selectedPolygonIds.includes(p.internalId) ? <CheckSquare size={14} className="text-amber-600" /> : <Square size={14} className="text-slate-400" />
                       )}
                       <span>{p.fieldName || (p.producerName ? `${p.producerName} (名称未設定)` : '名称未設定')}</span>
                     </div>
                     <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">{calculateArea(p.geometry)}a</span>
                   </div>
                 ))}
               </div>
            )}
            
            <h3 className="font-extrabold text-xs text-slate-500 tracking-wider mb-2">未着手筆ポリゴン (最初の100件表示)</h3>
            {uneditedPolygons.length === 0 ? <p className="text-xs text-gray-400">見つかりません</p> : uneditedPolygons.map((p: any) => (
              <div 
                key={p.internalId} 
                onClick={() => {
                  if (isMultiSelectMode && !isGuestMode) {
                    toggleSelectPolygon(p.internalId);
                  } else {
                    setSelectedPolygonId(p.internalId); 
                    setActiveTab('edit'); 
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
                <span className="text-[10px] opacity-75">({calculateArea(p.geometry)}a)</span>
              </div>
            ))}
          </div>
        )}

        {sidebarTab === 'edit' && selectedPolygon && (
          <div className="space-y-4">
            <div className="bg-indigo-50/70 border border-indigo-100 text-indigo-900 p-3.5 rounded-xl text-center font-extrabold mb-4 flex flex-col justify-center">
              <span className="text-[10px] text-indigo-500 font-bold uppercase tracking-wider">実測面積</span>
              <span className="text-lg">{calculateArea(selectedPolygon.geometry)} a <span className="text-xs font-normal text-slate-500">(アール)</span></span>
            </div>

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
                      readOnly={isGuestMode}
                      list={key === 'producerName' ? 'producers-list' : undefined}
                      onChange={(e) => setPolygons((prev: any) => prev.map((poly: any) => poly.internalId === selectedPolygonId ? { ...poly, [key]: e.target.value } : poly))} 
                      className={`w-full border p-2.5 text-sm rounded-xl outline-none focus:border-indigo-500 ${isGuestMode ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-slate-50/30'}`} 
                    />
                    
                    {key === 'fieldName' && !isGuestMode && (
                      <button onClick={autoGenerateName} className="px-3.5 py-1 bg-slate-100 hover:bg-slate-200 border text-xs font-bold rounded-xl whitespace-nowrap transition shadow-sm">
                        自動入力
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* 明示的な保存ボタン */}
            {!isGuestMode && (
              <button 
                onClick={handleSaveField}
                disabled={isSaving}
                className="w-full mt-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl transition shadow-md flex items-center justify-center disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={18} className="animate-spin mr-2" /> : <Save size={18} className="mr-2" />}
                {isSaving ? '保存中...' : 'この圃場を保存する'}
              </button>
            )}

            {/* Googleマップ連携ボタンセクション */}
            {centroid && (
              <div className="pt-4 border-t border-slate-100 space-y-2.5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">外部マップ連携</p>
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
          </div>
        )}

        {sidebarTab === 'points' && selectedPolygon && (
          <div className="space-y-4">
            {/* 地図クリック追加 (ゲストは非表示) */}
            {!isGuestMode && (
              <>
                <button 
                  onClick={() => setIsAddingPoint(!isAddingPoint)} 
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
                  <p className="text-[10px] text-slate-400 text-center">※GPS現在地取得（ON）の時のみ有効です</p>
                )}
              </>
            )}

            <div className="pt-2 border-t border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">圃場内の重要地点 ({relatedPoints.length})</p>
              {relatedPoints.length === 0 ? (
                <p className="text-xs text-slate-400 italic">登録済みのピンはありません。</p>
              ) : (
                relatedPoints.map((pt: any) => (
                  <div key={pt.id} className="p-3 bg-slate-50 border border-slate-100 rounded-xl mb-2 hover:shadow-sm transition">
                    <div className="flex justify-between items-center mb-1">
                      {isGuestMode ? (
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
                      {!isGuestMode && (
                        <button onClick={() => setPoints((prev: any) => prev.filter((p: any) => p.id !== pt.id))} className="text-[10px] text-rose-500 hover:underline font-semibold">削除</button>
                      )}
                    </div>
                    
                    {/* 地点名称のフリーテキスト入力を削除し、代わりに画像表示/アップロード枠に変更 */}
                    {pt.imageUrl && (
                      <div className="mb-2 w-full rounded-lg overflow-hidden border border-slate-200">
                        <img src={pt.imageUrl} alt={pt.pointType} className="w-full h-auto object-cover max-h-32" />
                      </div>
                    )}
                    
                    {!isGuestMode && (
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
                      readOnly={isGuestMode}
                      onChange={(e) => setPoints((prev: any) => prev.map((p: any) => p.id === pt.id ? {...p, description: e.target.value} : p))} 
                      className={`w-full text-[10px] mt-1.5 p-1.5 border rounded-lg bg-white outline-none focus:border-indigo-500 ${isGuestMode ? 'bg-slate-100 border-none text-slate-500' : ''}`} 
                      placeholder="補足説明" 
                    />

                    {/* 個別のポイント保存ボタン */}
                    {!isGuestMode && (
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
  );
}
