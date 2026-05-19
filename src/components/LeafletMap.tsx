'use client';
import React, { useEffect } from 'react';
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { v4 as uuidv4 } from 'uuid';
const createCustomIcon = (type: string) => L.divIcon({ className: 'custom-div-icon', html: `<div class="marker-pin" style="background-color: #3b82f6;">${type.charAt(0)}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
function MapEvents({ isAddingPoint, setIsAddingPoint, selectedPolygonId, setPoints }: any) {
  useMapEvents({
    click(e) {
      if (isAddingPoint && selectedPolygonId) {
        setPoints((prev: any) => [...prev, { id: uuidv4(), fieldInternalId: selectedPolygonId, pointType: "入口", name: "新規", description: "", coordinates: [e.latlng.lng, e.latlng.lat] }]);
        setIsAddingPoint(false);
      }
    }
  }); return null;
}
export default function LeafletMap({ polygons, points, selectedPolygonId, setSelectedPolygonId, isAddingPoint, setIsAddingPoint, setPoints }: any) {
  return (
    <MapContainer center={[35.6812, 139.7671]} zoom={13} style={{ height: '100%', width: '100%', cursor: isAddingPoint ? 'crosshair' : 'grab' }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {polygons.length > 0 && <GeoJSON key={JSON.stringify(polygons.map((p:any)=>p.internalId))+selectedPolygonId} data={{ type: "FeatureCollection", features: polygons.map((p:any) => ({ type: "Feature", geometry: p.geometry, properties: p })) } as any} style={(f: any) => ({ fillColor: f.properties.internalId === selectedPolygonId ? '#4f46e5' : '#10b981', weight: 2, fillOpacity: 0.3 })} onEachFeature={(f: any, l: any) => l.on({ click: () => setSelectedPolygonId(f.properties.internalId) })} />}
      {points.map((pt: any) => (
        <Marker key={pt.id} position={[pt.coordinates[1], pt.coordinates[0]]} icon={createCustomIcon(pt.pointType)}>
          <Popup><div className="font-bold">{pt.name}</div></Popup>
        </Marker>
      ))}
      <MapEvents isAddingPoint={isAddingPoint} setIsAddingPoint={setIsAddingPoint} selectedPolygonId={selectedPolygonId} setPoints={setPoints} />
    </MapContainer>
  );
}
