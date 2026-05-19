'use client';
import React, { useState } from 'react';
import { Target, Search } from 'lucide-react';
import { calculateArea } from '@/lib/utils';

export default function Sidebar({ polygons, points, setPolygons, setPoints, selectedPolygonId, setSelectedPolygonId, isAddingPoint, setIsAddingPoint }: any) {
  const [activeTab, setActiveTab] = useState<'list' | 'edit' | 'points'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  
  const selectedPolygon = polygons.find((p: any) => p.internalId === selectedPolygonId);
  const relatedPoints = points.filter((p: any) => p.fieldInternalId === selectedPolygonId);

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
    if (!selectedPolygon.producerName) {
      alert("先に「生産者名」を入力してください。"); return;
    }
    const area = calculateArea(selectedPolygon.geometry);
    setPolygons((prev: any) => prev.map((p: any) => p.internalId === selectedPolygonId ? { ...p, fieldName: `${selectedPolygon.producerName}_${area}a` } : p));
  };

  return (
    <div className="flex flex-col h-full pr-2">
      <div className="flex border-b text-sm font-medium shrink-0">
        <button className={`flex-1 py-3 text-center ${activeTab === 'list' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`} onClick={() => setActiveTab('list')}>一覧</button>
        <button className={`flex-1 py-3 text-center ${activeTab === 'edit' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`} onClick={() => setActiveTab('edit')} disabled={!selectedPolygonId}>編集</button>
        <button className={`flex-1 py-3 text-center ${activeTab === 'points' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`} onClick={() => setActiveTab('points')} disabled={!selectedPolygonId}>ポイント</button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'list' && (
          <div>
            <div className="relative mb-4">
              <input type="text" placeholder="生産者名・圃場名で検索..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-8 pr-2 py-2 border rounded text-sm outline-none focus:border-indigo-500" />
              <Search size={16} className="absolute left-2 top-2.5 text-gray-400" />
            </div>
            
            {editedPolygons.length > 0 && (
               <div className="mb-4">
                 <h3 className="font-bold text-sm text-indigo-600 mb-2">作業済み ({editedPolygons.length})</h3>
                 {editedPolygons.map((p: any) => (
                   <div key={p.internalId} onClick={() => { setSelectedPolygonId(p.internalId); setActiveTab('edit'); }} className={`p-2 border rounded cursor-pointer mb-1 text-sm font-bold ${selectedPolygonId === p.internalId ? 'border-indigo-500 bg-indigo-50' : 'hover:bg-gray-50'}`}>
                     {p.fieldName || (p.producerName ? `${p.producerName} (名称未設定)` : '名称未設定')}
                     <span className="text-xs font-normal text-gray-500 ml-2">{calculateArea(p.geometry)}a</span>
                   </div>
                 ))}
               </div>
            )}
            
            <h3 className="font-bold text-sm text-gray-600 mb-2">未着手 (一部表示)</h3>
            {uneditedPolygons.length === 0 ? <p className="text-xs text-gray-400">見つかりません</p> : uneditedPolygons.map((p: any) => (
              <div key={p.internalId} onClick={() => { setSelectedPolygonId(p.internalId); setActiveTab('edit'); }} className={`p-2 border rounded cursor-pointer mb-1 text-xs text-gray-500 ${selectedPolygonId === p.internalId ? 'border-indigo-500 bg-indigo-50' : 'hover:bg-gray-50'}`}>
                 名称未設定 <span className="ml-1 opacity-70">({calculateArea(p.geometry)}a)</span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'edit' && selectedPolygon && (
          <div className="space-y-4">
            <div className="bg-indigo-50 text-indigo-800 p-2 rounded text-sm text-center font-bold mb-4">
              概算面積: {calculateArea(selectedPolygon.geometry)} a (アール)
            </div>

            {['producerName:生産者名', 'fieldName:通称（圃場名）', 'cropType:作物', 'notes:注意点', 'remarks:備考'].map(f => {
              const [key, label] = f.split(':');
              return (
                <div key={key}>
                  <label className="block text-xs text-gray-600 mb-1">{label}</label>
                  <div className="flex space-x-2">
                    <input type="text" value={selectedPolygon[key] || ''} onChange={(e) => setPolygons((prev: any) => prev.map((poly: any) => poly.internalId === selectedPolygonId ? { ...poly, [key]: e.target.value } : poly))} className="w-full border p-2 text-sm rounded-md outline-none focus:border-indigo-500" />
                    
                    {/* 圃場名の自動入力ボタン */}
                    {key === 'fieldName' && (
                      <button onClick={autoGenerateName} className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-xs rounded-md whitespace-nowrap transition-colors border shadow-sm">
                        自動入力
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'points' && selectedPolygon && (
          <div className="space-y-4">
            <button onClick={() => setIsAddingPoint(!isAddingPoint)} className={`w-full py-2 px-4 rounded-md text-sm font-medium flex items-center justify-center border transition-colors ${isAddingPoint ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
              <Target size={16} className="mr-2" /> {isAddingPoint ? 'キャンセル（地図クリック待ち）' : '地図上でポイント追加'}
            </button>
            {relatedPoints.map((pt: any) => (
              <div key={pt.id} className="p-3 bg-gray-50 border rounded-md mb-2">
                <div className="font-bold text-sm mb-2 text-indigo-700">{pt.pointType}</div>
                <input type="text" value={pt.name} onChange={(e) => setPoints((prev: any) => prev.map((p: any) => p.id === pt.id ? {...p, name: e.target.value} : p))} className="w-full text-xs p-1.5 border rounded mb-2" placeholder="名称" />
                <div className="text-right">
                  <button onClick={() => setPoints((prev: any) => prev.filter((p: any) => p.id !== pt.id))} className="text-xs text-red-500 hover:underline">削除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
