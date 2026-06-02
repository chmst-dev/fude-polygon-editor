'use client';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMapEvents, useMap, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import { v4 as uuidv4 } from 'uuid';
import 'leaflet/dist/leaflet.css';

// 文字列から一意の色（HSL）を生成するユーティリティ関数
function stringToHslColor(str: string, s: number, l: number) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, ${s}%, ${l}%)`;
}

const createCustomIcon = (type: string, color: string = '#3b82f6') => L.divIcon({ 
  className: 'custom-div-icon', 
  html: `<div class="marker-pin shadow-md" style="background-color: ${color}; width: 24px; height: 24px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); display: flex; align-items: center; justify-content: center; border: 2px solid white;"><div style="transform: rotate(45deg); font-weight: bold; font-size: 10px; color: white;">${type.charAt(0)}</div></div>`, 
  iconSize: [24, 24], 
  iconAnchor: [12, 24] 
});

const getPointColor = (type: string) => {
  switch (type) {
    case '入口': return '#10b981';
    case '駐車場所': return '#f59e0b';
    case '水口': return '#3b82f6';
    case '水尻': return '#6366f1';
    case '危険箇所': return '#ef4444';
    default: return '#6b7280';
  }
};

// ポリゴンの大まかな境界ボックスを事前計算するユーティリティ
function getPolygonBbox(geometry: any): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  try {
    const coords: number[][] = [];
    const flatten = (c: any) => {
      if (typeof c[0] === 'number') { coords.push(c); return; }
      c.forEach(flatten);
    };
    flatten(geometry.coordinates);
    if (coords.length === 0) return null;
    return {
      minLng: Math.min(...coords.map(c => c[0])),
      maxLng: Math.max(...coords.map(c => c[0])),
      minLat: Math.min(...coords.map(c => c[1])),
      maxLat: Math.max(...coords.map(c => c[1])),
    };
  } catch {
    return null;
  }
}

// ビューポートカリング + debounce でポリゴンを絞り込むコンポーネント
function ViewportFilter({ polygons, selectedPolygonId, selectedPolygonIds, onFiltered }: {
  polygons: any[];
  selectedPolygonId: string | null;
  selectedPolygonIds: string[];
  onFiltered: (filtered: any[]) => void;
}) {
  const map = useMap();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateFilter = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const bounds = map.getBounds().pad(0.3); // 表示範囲を30%拡張してスクロール先読み
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();

      const filtered = polygons.filter(p => {
        if (!p.geometry) return false;
        // 選択中・複数選択中のポリゴンは範囲外でも必ず含める
        if (p.internalId === selectedPolygonId) return true;
        if (selectedPolygonIds.includes(p.internalId)) return true;

        const bbox = getPolygonBbox(p.geometry);
        if (!bbox) return false;

        // バウンディングボックスの交差判定
        return !(bbox.maxLng < sw.lng || bbox.minLng > ne.lng ||
                 bbox.maxLat < sw.lat || bbox.minLat > ne.lat);
      });

      onFiltered(filtered);
    }, 150); // 150msのdebounce
  }, [map, polygons, selectedPolygonId, selectedPolygonIds, onFiltered]);

  // 地図操作イベントでフィルター更新
  useMapEvents({
    moveend: updateFilter,
    zoomend: updateFilter,
  });

  // polygons・選択状態が変わった時も更新
  useEffect(() => {
    updateFilter();
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, [updateFilter]);

  return null;
}

function MapEvents({ isAddingPoint, setIsAddingPoint, selectedPolygonId, setPoints }: any) {
  useMapEvents({
    click(e) {
      if (isAddingPoint && selectedPolygonId) {
        setPoints((prev: any) => [...prev, { 
          id: uuidv4(), 
          fieldInternalId: selectedPolygonId, 
          pointType: "入口", 
          name: "新規地点", 
          description: "", 
          coordinates: [e.latlng.lng, e.latlng.lat] 
        }]);
        setIsAddingPoint(false);
      }
    }
  }); 
  return null;
}

function MapZoomController({ selectedPolygonId, polygons }: any) {
  const map = useMap();

  useEffect(() => {
    const t1 = setTimeout(() => map.invalidateSize(), 100);
    const t2 = setTimeout(() => map.invalidateSize(), 500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [map]);

  useEffect(() => {
    if (selectedPolygonId) {
      const polygon = polygons.find((p: any) => p.internalId === selectedPolygonId);
      if (polygon?.geometry) {
        try {
          const geoJsonLayer = L.geoJSON(polygon.geometry);
          const bounds = geoJsonLayer.getBounds();
          if (bounds.isValid()) {
            map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 18, duration: 0.5 });
          }
        } catch (e) {}
      }
    }
  }, [selectedPolygonId, polygons, map]);

  return null;
}

// 地図の表示範囲変更をコールバックで通知するコンポーネント（DBビューポート取得に使用）
function BoundsEmitter({ onBoundsChange }: { 
  onBoundsChange: (b: { west: number; south: number; east: number; north: number }) => void 
}) {
  const map = useMap();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emit = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const b = map.getBounds().pad(0.2);
      onBoundsChange({
        west:  b.getWest(),
        south: b.getSouth(),
        east:  b.getEast(),
        north: b.getNorth(),
      });
    }, 400);
  }, [map, onBoundsChange]);

  useMapEvents({ moveend: emit, zoomend: emit });

  useEffect(() => {
    const t = setTimeout(emit, 600); // 初期ロード時（地図確定後）に1回発火
    return () => { clearTimeout(t); if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, [emit]);

  return null;
}

export default function LeafletMap({ 
  polygons, 
  points, 
  selectedPolygonId, 
  setSelectedPolygonId, 
  isAddingPoint, 
  setIsAddingPoint, 
  setPoints,
  selectedPolygonIds = [],
  setSelectedPolygonIds,
  isMultiSelectMode = false,
  gpsPosition = null,
  onBoundsChange,
}: any) {
  // ビューポート内に絞り込まれたポリゴン
  const [visiblePolygons, setVisiblePolygons] = useState<any[]>([]);

  return (
    <MapContainer 
      center={[36.1308, 139.6019]} 
      zoom={15} 
      style={{ height: '100%', width: '100%', cursor: isAddingPoint ? 'crosshair' : 'grab' }} 
      preferCanvas={true}
    >
      <LayersControl position="topright">
        {/* ① Google航空写真 (地名・道路ありハイブリッド) -> デフォルト設定 */}
        <LayersControl.BaseLayer checked name="航空写真 (Google)">
          <TileLayer 
            url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}" 
            maxZoom={20}
            attribution="&copy; Google Maps"
          />
        </LayersControl.BaseLayer>

        {/* ② 標準地図 (OpenStreetMap) */}
        <LayersControl.BaseLayer name="標準地図 (OSM)">
          <TileLayer 
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" 
            maxZoom={19}
            attribution="&copy; OpenStreetMap"
          />
        </LayersControl.BaseLayer>

        {/* ③ 国土地理院 シームレス空中写真 */}
        <LayersControl.BaseLayer name="空中写真 (国土地理院)">
          <TileLayer 
            url="https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg" 
            maxZoom={18}
            attribution="&copy; 国土地理院"
          />
        </LayersControl.BaseLayer>
      </LayersControl>

      {/* ビューポートカリングフィルター（地図操作に連動してvisiblePolygonsを更新） */}
      <ViewportFilter
        polygons={polygons}
        selectedPolygonId={selectedPolygonId}
        selectedPolygonIds={selectedPolygonIds}
        onFiltered={setVisiblePolygons}
      />
      
      {/* 絞り込まれたポリゴンのみ描画 */}
      {visiblePolygons.length > 0 && (
        <GeoJSON 
          key={`map-layer-${visiblePolygons.length}-${selectedPolygonIds.length}-${isMultiSelectMode}-${selectedPolygonId}`} 
          data={{ 
            type: "FeatureCollection", 
            features: visiblePolygons.map((p: any) => ({ 
              type: "Feature", 
              geometry: p.geometry, 
              properties: p 
            })) 
          } as any} 
          style={(f: any) => {
            const isSelected = f.properties.internalId === selectedPolygonId;
            const isMultiSelected = selectedPolygonIds.includes(f.properties.internalId);
            
            let baseColor = '#10b981'; // 登録済み（デフォルト/名称なし）
            let borderColor = '#047857';
            
            if (f.properties.properties?.isUnmapped) {
              baseColor = '#94a3b8'; // 未着手
              borderColor = '#64748b';
            } else if (f.properties.producerName) {
              baseColor = stringToHslColor(f.properties.producerName, 55, 60);
              borderColor = stringToHslColor(f.properties.producerName, 70, 40);
            }

            return {
              fillColor: isSelected ? '#4f46e5' : isMultiSelected ? '#f59e0b' : baseColor, 
              weight: isSelected || isMultiSelected ? 3 : 1, 
              color: isSelected ? '#312e81' : isMultiSelected ? '#d97706' : borderColor, 
              fillOpacity: isSelected ? 0.6 : isMultiSelected ? 0.5 : 0.3
            };
          }} 
          onEachFeature={(f: any, l: any) => l.on({ 
            click: () => {
              if (isMultiSelectMode) {
                const id = f.properties.internalId;
                if (setSelectedPolygonIds) {
                  setSelectedPolygonIds((prev: string[]) => 
                    prev.includes(id) ? prev.filter((x: string) => x !== id) : [...prev, id]
                  );
                }
              } else {
                setSelectedPolygonId(f.properties.internalId);
              }
            } 
          })} 
        />
      )}
      
      {points.map((pt: any) => (
        <Marker key={pt.id} position={[pt.coordinates[1], pt.coordinates[0]]} icon={createCustomIcon(pt.pointType, getPointColor(pt.pointType))}>
          <Popup>
            <div className="font-bold p-1 text-sm">{pt.pointType} {pt.name && pt.name !== pt.pointType ? `(${pt.name})` : ''}</div>
            {pt.imageUrl && (
              <div className="mt-1 w-full max-w-[200px] overflow-hidden rounded shadow-sm border border-slate-200">
                <img src={pt.imageUrl} alt={pt.pointType} className="w-full h-auto object-cover" />
              </div>
            )}
            {pt.description && <div className="text-xs text-slate-600 mt-1.5">{pt.description}</div>}
          </Popup>
        </Marker>
      ))}

      {/* GPS現在地マーカー */}
      {gpsPosition && (
        <Marker position={[gpsPosition.lat, gpsPosition.lng]} icon={L.divIcon({ 
          className: 'gps-marker', 
          html: `<div style="position: relative;"><div style="width: 16px; height: 16px; background-color: #3b82f6; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 10px rgba(59,130,246,0.8); z-index: 100;"></div><div style="position: absolute; top: -4px; left: -4px; width: 24px; height: 24px; background-color: rgba(59,130,246,0.3); border-radius: 50%; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite; z-index: 99;"></div></div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        })}>
          <Popup><div className="text-xs font-bold">現在地</div></Popup>
        </Marker>
      )}

      {onBoundsChange && <BoundsEmitter onBoundsChange={onBoundsChange} />}
      <MapEvents isAddingPoint={isAddingPoint} setIsAddingPoint={setIsAddingPoint} selectedPolygonId={selectedPolygonId} setPoints={setPoints} />
      <MapZoomController selectedPolygonId={selectedPolygonId} polygons={polygons} />
    </MapContainer>
  );
}
