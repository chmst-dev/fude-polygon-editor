'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './Sidebar';
import MapArea from './MapArea';
import { parseGeoJSON, exportToCSV, exportToGeoJSON, exportToKML } from '@/lib/utils';

export default function MainApp() {
  const [polygons, setPolygons] = useState<any[]>([]); const [points, setPoints] = useState<any[]>([]);
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(null); const [isAddingPoint, setIsAddingPoint] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null); const wsRef = useRef<HTMLInputElement>(null);

  // サイドバー幅調整用のState
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isDragging = useRef(false);

  const startResizing = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      if (e.clientX > 250 && e.clientX < 800) setSidebarWidth(e.clientX);
    };
    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = 'default';
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); }
  }, []);

  useEffect(() => {
    const edited = polygons.filter((p:any) => p.producerName || p.cropType || p.notes || p.remarks);
    if(edited.length > 0 || points.length > 0) {
      try { localStorage.setItem('fude-state', JSON.stringify({ polygons: edited, points })); } catch(e) {}
    }
  }, [polygons, points]);

  useEffect(() => { const s = localStorage.getItem('fude-state'); if(s){ try{ const p = JSON.parse(s); setPolygons(p.polygons||[]); setPoints(p.points||[]); }catch(e){} } }, []);

  const loadFile = (e: any, type: 'geo'|'ws') => {
    const r = new FileReader();
    r.onload = (ev) => {
      if(type==='geo') {
        setLoadingMsg("データ解析中...");
        setTimeout(() => {
          const parsed = parseGeoJSON(ev.target?.result as string);
          let currentIndex = 0;
          setPolygons([]); 
          const processChunk = () => {
            setPolygons(prev => [...prev, ...parsed.slice(currentIndex, currentIndex + 2000)]);
            currentIndex += 2000;
            if (currentIndex < parsed.length) {
              setLoadingMsg(`読込中... ${Math.min(currentIndex, parsed.length)} / ${parsed.length}`);
              setTimeout(processChunk, 10);
            } else setLoadingMsg(""); 
          };
          processChunk();
        }, 100);
      } else {
        const p = JSON.parse(ev.target?.result as string); setPolygons(p.polygons||[]); setPoints(p.points||[]);
      }
    };
    r.readAsText(e.target.files[0]);
    e.target.value = '';
  };

  const handleKmlExport = () => {
    const producer = window.prompt("特定の生産者のみ出力する場合は名前を入力してください。\n（空欄の場合は入力済みの全件を出力します）");
    if (producer !== null) exportToKML({polygons, points}, producer.trim());
  };

  const saveWs = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({polygons, points})])); a.download = 'workspace.json'; a.click(); };

  return (
    <>
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-4">
          <h1 className="font-bold text-indigo-700">圃場地図整備ツール</h1>
          {loadingMsg && <span className="text-sm font-bold text-red-600 animate-pulse">{loadingMsg}</span>}
        </div>
        <div className="flex space-x-2 text-sm">
          <input type="file" className="hidden" ref={fileRef} accept=".geojson,.json" onChange={e=>loadFile(e,'geo')} />
          <button onClick={()=>fileRef.current?.click()} className="border px-2 py-1 bg-white hover:bg-gray-50 disabled:opacity-50" disabled={!!loadingMsg}>筆ポリゴン読込</button>
          <div className="w-px bg-gray-300 mx-1"></div>
          <input type="file" className="hidden" ref={wsRef} accept=".json" onChange={e=>loadFile(e,'ws')} />
          <button onClick={()=>wsRef.current?.click()} className="border px-2 py-1 bg-white hover:bg-gray-50 disabled:opacity-50" disabled={!!loadingMsg}>作業読込</button>
          <button onClick={saveWs} className="border px-2 py-1 bg-indigo-50 text-indigo-700 font-bold hover:bg-indigo-100 disabled:opacity-50" disabled={!!loadingMsg}>作業保存</button>
          <div className="w-px bg-gray-300 mx-1"></div>
          <button onClick={()=>exportToGeoJSON({polygons,points})} className="border px-2 py-1 bg-blue-50 text-blue-700">GeoJSON</button>
          <button onClick={handleKmlExport} className="border px-2 py-1 bg-green-50 text-green-700 font-bold">KML出力(生産者別)</button>
          <button onClick={()=>exportToCSV({polygons,points})} className="border px-2 py-1 bg-orange-50 text-orange-700">CSV</button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        {/* 幅調整可能なサイドバー */}
        <aside style={{ width: sidebarWidth }} className="bg-white relative shrink-0 flex flex-col">
          <Sidebar polygons={polygons} points={points} setPolygons={setPolygons} setPoints={setPoints} selectedPolygonId={selectedPolygonId} setSelectedPolygonId={setSelectedPolygonId} isAddingPoint={isAddingPoint} setIsAddingPoint={setIsAddingPoint} />
          {/* ドラッグ用ハンドル */}
          <div onMouseDown={startResizing} className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize bg-gray-200 hover:bg-indigo-400 z-50 transition-colors border-r" title="ドラッグで幅を調整" />
        </aside>
        <section className="flex-1 relative"><MapArea polygons={polygons} points={points} selectedPolygonId={selectedPolygonId} setSelectedPolygonId={setSelectedPolygonId} isAddingPoint={isAddingPoint} setIsAddingPoint={setIsAddingPoint} setPoints={setPoints} /></section>
      </div>
    </>
  );
}
