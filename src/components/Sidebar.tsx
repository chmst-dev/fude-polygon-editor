'use client';
import React, { useState } from 'react';
import { Target } from 'lucide-react';

export default function Sidebar({ polygons, points, setPolygons, setPoints, selectedPolygonId, setSelectedPolygonId, isAddingPoint, setIsAddingPoint }: any) {
  const [activeTab, setActiveTab] = useState<'list' | 'edit' | 'points'>('list');
  const selectedPolygon = polygons.find((p: any) => p.internalId === selectedPolygonId);
  const relatedPoints = points.filter((p: any) => p.fieldInternalId === selectedPolygonId);

  // 編集済みの判定
  const isEdited = (p: any) => p.producerName !== '' || p.cropType !== '' || p.notes !== '' || p.remarks !== '' || points.some((pt: any) => pt.fieldInternalId === p.internalId);
  const editedPolygons = polygons.filter(isEdited);
  const uneditedPolygons = polygons.filter((p:any) => !isEdited(p)).slice(0, 100); // 動作を軽くするため未着手は100件だけ表示

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b text-sm font-medium">
        <button className={`flex-1 py-3 text-center ${activeTab === 'list' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`} onClick={() => setActiveTab('list')}>一覧</button>
        <button className={`flex-1 py-3 text-center ${activeTab === 'edit' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`} onClick={() => setActiveTab('edit')} disabled={!selectedPolygonId}>編集</button>
        <button className={`flex-1 py-3 text-center ${activeTab === 'points' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`} onClick={() => setActiveTab('points')} disabled={!selectedPolygonId}>ポイント</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'list' && (
          <div>
            <div className="text-xs text-gray-500 mb-4 bg-gray-50 p-2 rounded">
              ※地図からポリゴンをクリックして探してください。動作軽減のため未着手の圃場は一部のみ表示しています。
            </div>
            
            {editedPolygons.length > 0 && (
               <div className="mb-4">
                 <h3 className="font-bold text-sm text-indigo-600 mb-2">作業済みの圃場 ({editedPolygons.length})</h3>
                 {editedPolygons.map((p: any) => (
                   <div key={p.internalId} onClick={() => { setSelectedPolygonId(p.internalId); setActiveTab('edit'); }} className={`p-2 border rounded cursor-pointer mb-1 text-sm font-bold ${selectedPolygonId === p.internalId ? 'border-indigo-500 bg-indigo-50' : 'hover:bg-gray-50'}`}>{p.fieldName || '名称未設定'}</div>
                 ))}
               </div>
            )}
            
            <h3 className="font-bold text-sm text-gray-600 mb-2">未着手の圃場 (一部表示)</h3>
            {uneditedPolygons.map((p: any) => (
              <div key={p.internalId} onClick={() => { setSelectedPolygonId(p.internalId); setActiveTab('edit'); }} className={`p-2 border rounded cursor-pointer mb-1 text-xs text-gray-500 ${selectedPolygonId === p.internalId ? 'border-indigo-500 bg-indigo-50' : 'hover:bg-gray-50'}`}>{p.fieldName || '名称未設定'}</div>
            ))}
          </div>
        )}
        {activeTab === 'edit' && selectedPolygon && (
          <div className="space-y-4">
            {['fieldName:通称', 'producerName:生産者名', 'cropType:作物', 'areaText:面積等', 'notes:注意点', 'remarks:備考'].map(f => {
              const [key, label] = f.split(':');
              return (
                <div key={key}>
                  <label className="block text-xs text-gray-600 mb-1">{label}</label>
                  <input type="text" value={selectedPolygon[key] || ''} onChange={(e) => setPolygons((prev: any) => prev.map((poly: any) => poly.internalId === selectedPolygonId ? { ...poly, [key]: e.target.value } : poly))} className="w-full border p-2 text-sm rounded-md" />
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
