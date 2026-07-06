'use client';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMapEvents, useMap, LayersControl, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { v4 as uuidv4 } from 'uuid';
import { Search, MapPin } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import * as turf from '@turf/turf';
import { getWorkDivIconHtml, WORK_ICON_SIZE, WORK_ICON_ANCHOR, WORK_STATUS_STYLES } from '@/lib/workIcons';
import type { WorkStatus } from '@/types';


// 文字列から一意の色（HSL）を生成するユーティリティ関数
// ビット演算のオーバーフローを避けるため、モジュロ算術で安全に色相を計算する
function stringToHslColor(str: string, s: number, l: number) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    // 黄金角比（137/360）を用いた乗算で、近い文字列でも色相が大きく離れるよう分散させる
    // ビット演算を使わず通常の加算でオーバーフローを回避
    hash = (hash * 31 + str.charCodeAt(i)) % 360;
  }
  // 黄金角(137.508°)を掛けてさらに分散させ、よく似た名前でも異なる色になるようにする
  const h = (hash * 137.508) % 360;
  return `hsl(${Math.floor(h)}, ${s}%, ${l}%)`;
}

// ポリゴン配列の状態（IDと生産者名）から簡易ハッシュを生成し、状態変化時にGeoJSONを強制再描画させる
function getPolygonsHash(polygons: any[]): number {
  let hash = 0;
  for (let i = 0; i < polygons.length; i++) {
    const p = polygons[i];
    const str = `${p.internalId}:${p.producerName || ''}`;
    for (let j = 0; j < str.length; j++) {
      hash = (hash << 5) - hash + str.charCodeAt(j);
      hash |= 0;
    }
  }
  return hash;
}

const createCustomIcon = (type: string, color: string = '#3b82f6') => L.divIcon({
  className: 'custom-div-icon',
  html: `<div class="marker-pin shadow-md" style="background-color: ${color}; width: 24px; height: 24px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); display: flex; align-items: center; justify-content: center; border: 2px solid white;"><div style="transform: rotate(45deg); font-weight: bold; font-size: 10px; color: white;">${type.charAt(0)}</div></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 24]
});

const getPointColor = (type: string) => {
  switch (type) {
    case '入口': return '#059669'; // 濃いグリーン
    case '駐車場所': return '#d97706'; // 濃いアンバー
    case '水口': return '#1d4ed8'; // 濃いブルー
    case '水尻': return '#4f46e5'; // 濃いインディゴ
    case '危険箇所': return '#dc2626'; // 濃いレッド
    default: return '#4b5563';
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
function ViewportFilter({ polygons, selectedPolygonId, selectedPolygonIds, filteredPolygonIds, onFiltered }: {
  polygons: any[];
  selectedPolygonId: string | null;
  selectedPolygonIds: string[];
  filteredPolygonIds: string[] | null;
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

      let filtered = polygons.filter(p => {
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

      if (filteredPolygonIds !== null) {
        filtered = filtered.filter(p => filteredPolygonIds.includes(p.internalId));
      }

      onFiltered(filtered);
    }, 150); // 150msのdebounce
  }, [map, polygons, selectedPolygonId, selectedPolygonIds, filteredPolygonIds, onFiltered]);

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
          id: `point-${uuidv4()}`,
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
  // 前回フライトした圃場IDを記録し、同じIDへの不要な再フライトを防ぐ
  const lastFlownIdRef = useRef<string | null>(null);

  useEffect(() => {
    const t1 = setTimeout(() => map.invalidateSize(), 100);
    const t2 = setTimeout(() => {
      map.invalidateSize();
      map.fire('moveend'); // ViewportFilter も再実行してポリゴンを確実に表示
    }, 500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [map]);

  useEffect(() => {
    // selectedPolygonId が変わった時だけフライトする（polygons の更新では再発火しない）
    if (!selectedPolygonId) {
      lastFlownIdRef.current = null;
      return;
    }
    if (lastFlownIdRef.current === selectedPolygonId) {
      // 同じ圃場のまま polygons 配列だけ更新された場合はスキップ
      return;
    }
    const polygon = polygons.find((p: any) => p.internalId === selectedPolygonId);
    if (polygon?.geometry) {
      try {
        const geoJsonLayer = L.geoJSON(polygon.geometry);
        const bounds = geoJsonLayer.getBounds();
        if (bounds.isValid()) {
          lastFlownIdRef.current = selectedPolygonId;
          map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 18, duration: 0.5 });
        }
      } catch (e) {}
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
      const zoom = map.getZoom();
      // ズームレベル15未満（広域）の場合はDBからのフェッチを完全にスキップして超高速化！
      if (zoom < 15) {
        console.log('[DEBUG] Zoom level < 15, skipping DB fetch');
        return;
      }

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

// ズームレベルをリアルタイムに監視するヘルパーコンポーネント
function ZoomWatcher({ onZoomChange }: { onZoomChange: (z: number) => void }) {
  const map = useMap();
  useMapEvents({
    zoomend() {
      onZoomChange(map.getZoom());
    }
  });
  useEffect(() => {
    onZoomChange(map.getZoom());
  }, [map, onZoomChange]);
  return null;
}

// display:none から表示に戻ったとき（タブ切り替えなど）に強制再描画するコンポーネント
// visibility:hidden → visible の切り替え後も確実に再描画させるため
// invalidateSize だけでなく moveend も発火して ViewportFilter（ポリゴン描画）も再実行する
function InvalidateSizeOnForceRefresh({ forceRefresh }: { forceRefresh: number }) {
  const map = useMap();
  useEffect(() => {
    if (!forceRefresh) return; // 初期値(0)では発火しない
    // CSSの visibility 変更→レイアウト確定→Leaflet再描画を段階的に実行
    const refresh = () => {
      map.invalidateSize({ animate: false });
      map.fire('moveend'); // ViewportFilter を再実行させてポリゴンを再表示
    };
    const t1 = setTimeout(refresh, 50);   // 即時
    const t2 = setTimeout(refresh, 200);  // CSS transition 完了後
    const t3 = setTimeout(refresh, 600);  // 念のため最終フォールバック
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [forceRefresh, map]);
  return null;
}

import type { Geometry } from 'geojson';
import type { FieldPolygon, FieldPoint, FieldWorkRecord } from '@/types';

// ポリゴンの重心 (centroid) を計算するヘルパー関数
function getPolygonCentroid(geometry: unknown): [number, number] | null {
  try {
    const feat = turf.feature(geometry as Geometry);
    const cent = turf.centroid(feat);
    if (cent.geometry?.coordinates) {
      return [cent.geometry.coordinates[1], cent.geometry.coordinates[0]]; // lat, lng
    }
  } catch (e) {
    console.error('Centroid calculation failed', e);
  }
  return null;
}

interface LeafletMapProps {
  polygons: FieldPolygon[];
  points: FieldPoint[];
  selectedPolygonId: string | null;
  setSelectedPolygonId: (id: string | null) => void;
  isAddingPoint: boolean;
  setIsAddingPoint: (adding: boolean) => void;
  setPoints: React.Dispatch<React.SetStateAction<FieldPoint[]>>;
  selectedPolygonIds?: string[];
  setSelectedPolygonIds?: React.Dispatch<React.SetStateAction<string[]>>;
  isMultiSelectMode?: boolean;
  gpsPosition?: { lat: number; lng: number } | null;
  onBoundsChange?: (bounds: { west: number; south: number; east: number; north: number }) => void;
  forceRefresh?: number;
  isGuestMode?: boolean;
  onGuestFieldClick?: (id: string) => void;
  onGuestPointClick?: (point: FieldPoint) => void;
  setActiveTab?: (tab: 'list' | 'edit' | 'points' | 'map') => void;
  latestWorkRecords?: Map<string, FieldWorkRecord>;
  filteredPolygonIds?: string[] | null;
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
  forceRefresh = 0,
  isGuestMode = false,
  onGuestFieldClick,
  onGuestPointClick,
  setActiveTab,
  latestWorkRecords = new Map(),
  filteredPolygonIds = null,
}: LeafletMapProps) {
  // ビューポート内に絞り込まれたポリゴン
  const [visiblePolygons, setVisiblePolygons] = useState<FieldPolygon[]>([]);
  const [currentZoom, setCurrentZoom] = useState(15);

  const selectedPolygon = polygons.find((p) => p.internalId === selectedPolygonId);

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={[36.0954, 139.5816]}
        zoom={15}
        style={{ height: '100%', width: '100%', cursor: isAddingPoint ? 'crosshair' : 'grab' }}
        preferCanvas={true}
      >
        <ZoomWatcher onZoomChange={setCurrentZoom} />

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
          filteredPolygonIds={filteredPolygonIds}
          onFiltered={setVisiblePolygons}
        />

        {/* 絞り込まれたポリゴンのみ描画 */}
        {visiblePolygons.length > 0 && (
          <GeoJSON
            key={`map-layer-${visiblePolygons.length}-${selectedPolygonIds.length}-${isMultiSelectMode}-${selectedPolygonId}-${getPolygonsHash(visiblePolygons)}`}
            data={{
              type: "FeatureCollection",
              features: visiblePolygons.map((p: FieldPolygon) => ({
                type: "Feature",
                geometry: p.geometry,
                properties: p
              }))
            } as import('geojson').FeatureCollection}
            style={(feature) => {
              if (!feature || !feature.properties) return {};
              const properties = feature.properties as FieldPolygon;
              const isSelected = properties.internalId === selectedPolygonId;
              const isMultiSelected = selectedPolygonIds.includes(properties.internalId);

              let baseColor = '#059669'; // 登録済み（デフォルト/名称なし）: 濃いめのグリーン
              let borderColor = '#022c22'; // 非常に濃いグリーンで境界線を強調

              if (properties.properties?.isUnmapped) {
                baseColor = '#ea580c'; // 未着手: 屋外でもはっきり見える濃いオレンジ
                borderColor = '#431407'; // 非常に濃い茶褐色で境界線を強調
              } else if (properties.producerName) {
                // 彩度(S)を85%、輝度(L)を42%に設定し、屋外でも映える強めの鮮やかな色味に
                baseColor = stringToHslColor(properties.producerName, 85, 42);
                borderColor = stringToHslColor(properties.producerName, 90, 22); // 境界は同色系の非常に濃い暗色
              }

              return {
                fillColor: isSelected ? '#2563eb' : isMultiSelected ? '#d97706' : baseColor,
                weight: isSelected ? 4.5 : isMultiSelected ? 3.5 : properties.properties?.isUnmapped ? 2.5 : 2,
                color: isSelected ? '#1e3a8a' : isMultiSelected ? '#78350f' : borderColor,
                dashArray: properties.properties?.isUnmapped ? '4, 4' : undefined, // 未登録は分かりやすい破線に！
                // 日差しの下でもはっきりと視認できるよう、不透明度を大幅に引き上げ
                fillOpacity: isSelected ? 0.6 : isMultiSelected ? 0.65 : 0.5
              };
            }}
            onEachFeature={(feature, layer) => layer.on({
              click: () => {
                if (!feature || !feature.properties) return;
                const properties = feature.properties as FieldPolygon;
                if (isGuestMode && onGuestFieldClick) {
                  onGuestFieldClick(properties.internalId);
                } else if (isMultiSelectMode) {
                  const id = properties.internalId;
                  if (setSelectedPolygonIds) {
                    setSelectedPolygonIds((prev: string[]) =>
                     prev.includes(id) ? prev.filter((x: string) => x !== id) : [...prev, id]
                    );
                  }
                } else {
                  setSelectedPolygonId(properties.internalId);
                }
              }
            })}
          />
        )}

        {/* 選択中のポリゴンの超ハイライトレイヤー ＆ 圃場名の地図上常時表示ラベル */}
        {selectedPolygon?.geometry && (
          <GeoJSON
            key={`selected-highlight-layer-${selectedPolygonId}`}
            data={selectedPolygon.geometry}
            style={{
              fillColor: '#4f46e5',
              fillOpacity: 0.3,
              weight: 6, // さらに極太に！
              color: '#0891b2', // 濃いめのアクアブルー
            }}
          >
            <Tooltip permanent direction="center" className="font-extrabold border-2 border-indigo-600 bg-white/95 text-indigo-900 rounded-xl px-3 py-1.5 shadow-2xl select-none text-xs">
              📌 {selectedPolygon.fieldName || (selectedPolygon.producerName ? `${selectedPolygon.producerName} (名称未設定)` : '名称未設定')}
            </Tooltip>
          </GeoJSON>
        )}

        {points.map((pt: FieldPoint) => (
          <Marker
            key={pt.id}
            position={[pt.coordinates[1], pt.coordinates[0]]}
            icon={createCustomIcon(pt.pointType, getPointColor(pt.pointType))}
            eventHandlers={isGuestMode && onGuestPointClick ? {
              click: () => onGuestPointClick(pt)
            } : undefined}
          >
            {!isGuestMode && (
              <Popup>
                <div className="font-bold p-1 text-sm">{pt.pointType} {pt.name && pt.name !== pt.pointType ? `(${pt.name})` : ''}</div>
                {pt.imageUrl && (
                  <div className="mt-1 w-full max-w-[200px] overflow-hidden rounded shadow-sm border border-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pt.imageUrl} alt={pt.pointType} className="w-full h-auto object-cover" />
                  </div>
                )}
                {pt.description && <div className="text-xs text-slate-600 mt-1.5">{pt.description}</div>}
                {(() => {
                  const field = polygons.find((p) => p.internalId === pt.fieldInternalId);
                  if (!field) return null;
                  return (
                    <div className="mt-2 pt-2 border-t border-slate-105 flex items-center justify-between text-[11px] gap-2">
                      <span className="text-slate-500 font-bold max-w-[110px] truncate">
                        圃場: {field.fieldName || field.producerName || '名称未設定'}
                      </span>
                      <button
                        onClick={() => {
                          setSelectedPolygonId(pt.fieldInternalId);
                          if (setActiveTab) {
                            setActiveTab('edit'); // 編集タブへ切り替え
                          }
                        }}
                        className="text-indigo-600 hover:text-indigo-850 font-extrabold hover:underline whitespace-nowrap"
                      >
                        圃場情報へ →
                      </button>
                    </div>
                  );
                })()}
              </Popup>
            )}
          </Marker>
        ))}

        {/* 各圃場の最新作業履歴アイコンを重心に表示 */}
        {visiblePolygons.map((p: FieldPolygon) => {
          // フィルタリングが有効かつ該当しない圃場なら表示しない
          if (filteredPolygonIds !== null && !filteredPolygonIds.includes(p.internalId)) {
            return null;
          }

          const record = latestWorkRecords.get(p.internalId);
          if (!record) return null;

          const centroid = getPolygonCentroid(p.geometry);
          if (!centroid) return null;

          // workIconsユーティリティでHTMLを組み立て
          const html = getWorkDivIconHtml(record.workTypeIconKey, record.status as WorkStatus, record.workTypeColor);
          const icon = L.divIcon({
            className: 'work-history-map-icon',
            html: html,
            iconSize: WORK_ICON_SIZE,
            iconAnchor: WORK_ICON_ANCHOR,
          });

          const statusStyle = WORK_STATUS_STYLES[record.status as WorkStatus] || WORK_STATUS_STYLES.planned;
          const dateStr = record.workedOn
            ? new Date(record.workedOn).toLocaleDateString('ja-JP', {
                year: 'numeric', month: '2-digit', day: '2-digit',
              })
            : '日付未定';

          return (
            <Marker
              key={`work-marker-${p.internalId}-${record.id}`}
              position={centroid}
              icon={icon}
              zIndexOffset={500} // 一般のポイントマーカーより手前に表示
            >
              <Popup>
                <div className="space-y-1.5 p-1 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-extrabold text-sm text-slate-900 truncate max-w-[130px]">
                      {p.fieldName || '名称未設定'}
                    </span>
                    <span
                      className="px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white whitespace-nowrap"
                      style={{ backgroundColor: statusStyle.badge }}
                    >
                      {statusStyle.emoji} {statusStyle.label}
                    </span>
                  </div>
                  {p.producerName && (
                    <div className="text-[10px] text-slate-500 font-bold">
                      生産者: {p.producerName}
                    </div>
                  )}
                  <div className="border-t border-slate-100 pt-1.5">
                    <div className="font-bold text-slate-700">
                      最新作業: {record.workTypeName}
                    </div>
                    {record.notes && (
                      <p className="text-slate-600 bg-slate-50 border border-slate-100 p-1.5 rounded-lg mt-1 text-[11px] leading-snug">
                        {record.notes}
                      </p>
                    )}
                    <div className="text-[10px] text-slate-400 mt-1">
                      作業日: {dateStr} ／ 登録者: {record.creatorName || '不明'}
                    </div>
                  </div>
                  <div className="pt-1.5 flex justify-end">
                    <button
                      onClick={() => {
                        setSelectedPolygonId(p.internalId);
                        if (setActiveTab) {
                          setActiveTab('edit');
                        }
                      }}
                      className="text-indigo-600 hover:text-indigo-800 font-extrabold text-[11px] hover:underline"
                    >
                      詳細・履歴をみる →
                    </button>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

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
        <InvalidateSizeOnForceRefresh forceRefresh={forceRefresh} />
        <MapEvents isAddingPoint={isAddingPoint} setIsAddingPoint={setIsAddingPoint} selectedPolygonId={selectedPolygonId} setPoints={setPoints} />
        <MapZoomController selectedPolygonId={selectedPolygonId} polygons={polygons} />
      </MapContainer>

      {/* ズーム警告フローティングバナー */}
      {currentZoom < 15 && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000] bg-amber-50/95 backdrop-blur-md border border-amber-200 shadow-2xl px-5 py-2.5 rounded-2xl flex items-center gap-2 text-xs font-bold text-amber-800 transition-all">
          <Search size={14} className="text-amber-600 animate-pulse" />
          地図をズームインすると筆ポリゴンが表示されます
        </div>
      )}

      {/* ピン追加モード案内フローティングバー */}
      {isAddingPoint && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000] bg-indigo-600/95 backdrop-blur-md shadow-2xl px-6 py-3 rounded-2xl flex items-center gap-2.5 text-xs font-bold text-white border border-indigo-400/30 animate-pulse">
          <MapPin size={14} className="animate-bounce text-indigo-200" />
          地図をクリックしてピンを打ってください（打つと自動で入力画面に戻ります）
        </div>
      )}

      {/* 作業状況の凡例 */}
      <div className="absolute bottom-4 left-4 z-[1000] bg-white/90 backdrop-blur-md border border-slate-200 shadow-xl px-4 py-3 rounded-2xl space-y-1.5 select-none text-[11px]">
        <p className="font-extrabold text-slate-600 uppercase tracking-wider text-[10px] border-b pb-1 mb-1.5">
          作業状況 凡例
        </p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {Object.entries(WORK_STATUS_STYLES).map(([status, style]) => (
            <div key={status} className="flex items-center gap-1.5">
              <span
                className="w-3 h-3 rounded-full border shadow-sm shrink-0"
                style={{
                  backgroundColor: style.bg,
                  borderColor: style.border,
                  borderWidth: 2,
                }}
              />
              <span className="font-bold text-slate-700">
                {style.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
