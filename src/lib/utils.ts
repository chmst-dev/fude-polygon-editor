import * as turf from '@turf/turf';

export function calculateArea(geometry: any): number {
  try {
    const areaSqMeters = turf.area(turf.feature(geometry));
    return Math.round(areaSqMeters / 100); // ㎡をアール(a)に変換して四捨五入
  } catch (e) {
    return 0;
  }
}

export function parseGeoJSON(jsonStr: string): any[] {
  try {
    const geo = JSON.parse(jsonStr);
    const features = geo.features || [];
    return features.map((f: any, idx: number) => ({
      internalId: f.properties?.id || f.properties?.FID || `poly-${idx}-${Date.now()}`,
      geometry: f.geometry,
      producerName: f.properties?.producerName || f.properties?.['生産者名'] || "",
      cropType: f.properties?.cropType || f.properties?.['作付'] || "",
      notes: f.properties?.notes || "",
      remarks: f.properties?.remarks || "",
      originalProperties: f.properties || {}
    }));
  } catch (e) {
    return [];
  }
}

export function exportToGeoJSON(state: { polygons: any[], points: any[] }) {
  const editedPolygons = state.polygons.filter(p => p.fieldName || p.producerName || p.cropType || p.notes || p.remarks);
  const geojson = {
    type: "FeatureCollection",
    features: [
      ...editedPolygons.map(p => ({
        type: "Feature", geometry: p.geometry,
        properties: { id: p.internalId, producerName: p.producerName, fieldName: p.fieldName, cropType: p.cropType, notes: p.notes, remarks: p.remarks, ...p.originalProperties }
      })),
      ...state.points.map(pt => ({
        type: "Feature", geometry: { type: "Point", coordinates: pt.coordinates },
        properties: { id: pt.id, name: pt.name, pointType: pt.pointType, description: pt.description }
      }))
    ]
  };
  downloadFile(JSON.stringify(geojson, null, 2), 'fields_edited.geojson', 'application/json');
}

export function exportToKML(state: { polygons: any[], points: any[] }, targetProducer?: string) {
  let editedPolygons = state.polygons.filter(p => p.fieldName || p.producerName || p.cropType || p.notes || p.remarks);
  
  // 生産者名で絞り込み
  if (targetProducer) {
    editedPolygons = editedPolygons.filter(p => p.producerName && p.producerName.includes(targetProducer));
  }
  
  let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>圃場マップ(${targetProducer || '全体'})</name>\n`;

  editedPolygons.forEach(p => {
    const name = p.fieldName || (p.producerName ? `${p.producerName}_${calculateArea(p.geometry)}a` : '名称未設定');
    kml += `    <Placemark>\n      <name>${name}</name>\n      <description><![CDATA[生産者: ${p.producerName}\n作付: ${p.cropType}\n面積: ${calculateArea(p.geometry)}a\nメモ: ${p.notes}\n備考: ${p.remarks}]]></description>\n`;
    
    if (p.geometry && p.geometry.type === 'Polygon') {
      kml += `      <Polygon>\n        <outerBoundaryIs>\n          <LinearRing>\n            <coordinates>\n`;
      p.geometry.coordinates[0].forEach((coord: number[]) => { kml += `              ${coord[0]},${coord[1]},0\n`; });
      kml += `            </coordinates>\n          </LinearRing>\n        </outerBoundaryIs>\n      </Polygon>\n`;
    } else if (p.geometry && p.geometry.type === 'MultiPolygon') {
      kml += `      <MultiGeometry>\n`;
      p.geometry.coordinates.forEach((poly: any) => {
        kml += `        <Polygon>\n          <outerBoundaryIs>\n            <LinearRing>\n              <coordinates>\n`;
        poly[0].forEach((coord: number[]) => { kml += `                ${coord[0]},${coord[1]},0\n`; });
        kml += `              </coordinates>\n            </LinearRing>\n          </outerBoundaryIs>\n        </Polygon>\n`;
      });
      kml += `      </MultiGeometry>\n`;
    }
    kml += `    </Placemark>\n`;
  });

  state.points.forEach(pt => {
    kml += `    <Placemark>\n      <name>${pt.name} [${pt.pointType}]</name>\n      <description>${pt.description || ''}</description>\n      <Point>\n        <coordinates>${pt.coordinates[0]},${pt.coordinates[1]},0</coordinates>\n      </Point>\n    </Placemark>\n`;
  });

  kml += `  </Document>\n</kml>`;
  
  const fileName = targetProducer ? `fields_${targetProducer}.kml` : 'fields_edited.kml';
  downloadFile(kml, fileName, 'application/vnd.google-earth.kml+xml');
}

export function exportToCSV(state: { polygons: any[], points: any[] }) {
  const editedPolygons = state.polygons.filter(p => p.fieldName || p.producerName || p.cropType || p.notes || p.remarks);
  let csv = "ID,生産者名,圃場名,作付種別,面積(a),メモ,備考,タイプ,座標(中心目安)\n";
  
  editedPolygons.forEach(p => {
    let lng = 0, lat = 0;
    if (p.geometry && p.geometry.type === 'Polygon') {
      const c = p.geometry.coordinates[0][0]; lng = c[0]; lat = c[1];
    }
    csv += `"${p.internalId}","${p.producerName || ''}","${p.fieldName || ''}","${p.cropType || ''}","${calculateArea(p.geometry)}","${p.notes || ''}","${p.remarks || ''}","圃場","${lng}/${lat}"\n`;
  });
  
  downloadFile(new Uint8Array([0xEF, 0xBB, 0xBF]), 'fields_summary.csv', 'text/csv'); 
  downloadFile(csv, 'fields_summary.csv', 'text/csv');
}

function downloadFile(content: any, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName; a.click();
}
