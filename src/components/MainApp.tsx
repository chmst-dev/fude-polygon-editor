'use client';
import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './Sidebar';
import MapArea from './MapArea';
import { parseGeoJSON, exportToCSV, exportToGeoJSON, exportToKML } from '@/lib/utils';
export default function MainApp() {
  const [polygons, setPolygons] = useState<any[]>([]); const [points, setPoints] = useState<any[]>([]);
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(null); const [isAddingPoint, setIsAddingPoint] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null); const wsRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const s = localStorage.getItem('fude-state'); if(s){ try{ const p = JSON.parse(s); setPolygons(p.polygons||[]); setPoints(p.points||[]); }catch(e){} } }, []);
  useEffect(() => { if(polygons.length||points.length) localStorage.setItem('fude-state', JSON.stringify({polygons, points})); }, [polygons, points]);

  const loadFile = (e: any, type: 'geo'|'ws') => {
    const r = new FileReader();
    r.onload = (ev) => {
      if(type==='geo') {
        const parsed = parseGeoJSON(ev.target?.result as string);
        alert(`全件(${parsed.length}件)読み込みます。データ量によって地図の操作が重くなる場合があります。`);
        setPolygons(prev => [...prev, ...parsed]);
      } else {
        const p = JSON.parse(ev.target?.result as string); setPolygons(p.polygons||[]); setPoints(p.points||[]);
      }
    };
    r.readAsText(e.target.files[0]);
    e.target.value = '';
  };
  const saveWs = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({polygons, points})])); a.download = 'workspace.json'; a.click(); };

  return (
    <>
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <h1 className="font-bold text-indigo-700">圃場地図整備ツール</h1>
        <div className="flex space-x-2 text-sm">
          <input type="file" className="hidden" ref={fileRef} accept=".geojson,.json" onChange={e=>loadFile(e,'geo')} />
          <button onClick={()=>fileRef.current?.click()} className="border px-2 py-1 bg-white hover:bg-gray-50">GeoJSON読込</button>
          <div className="w-px bg-gray-300 mx-1"></div>
          <input type="file" className="hidden" ref={wsRef} accept=".json" onChange={e=>loadFile(e,'ws')} />
          <button onClick={()=>wsRef.current?.click()} className="border px-2 py-1 bg-white hover:bg-gray-50">作業読込</button>
          <button onClick={saveWs} className="border px-2 py-1 bg-indigo-50 text-indigo-700 font-bold hover:bg-indigo-100">作業保存</button>
          <div className="w-px bg-gray-300 mx-1"></div>
          <button onClick={()=>exportToGeoJSON({polygons,points})} className="border px-2 py-1 bg-blue-50 text-blue-700">出力(GeoJSON)</button>
          <button onClick={()=>exportToKML({polygons,points})} className="border px-2 py-1 bg-green-50 text-green-700">出力(KML)</button>
          <button onClick={()=>exportToCSV({polygons,points})} className="border px-2 py-1 bg-orange-50 text-orange-700">出力(CSV)</button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 border-r bg-white"><Sidebar polygons={polygons} points={points} setPolygons={setPolygons} setPoints={setPoints} selectedPolygonId={selectedPolygonId} setSelectedPolygonId={setSelectedPolygonId} isAddingPoint={isAddingPoint} setIsAddingPoint={setIsAddingPoint} /></aside>
        <section className="flex-1 relative"><MapArea polygons={polygons} points={points} selectedPolygonId={selectedPolygonId} setSelectedPolygonId={setSelectedPolygonId} isAddingPoint={isAddingPoint} setIsAddingPoint={setIsAddingPoint} setPoints={setPoints} /></section>
      </div>
    </>
  );
}
