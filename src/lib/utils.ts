import { v4 as uuidv4 } from 'uuid';

export const parseGeoJSON = (geoJsonStr: string): any[] => {
  try {
    const data = JSON.parse(geoJsonStr);
    if (!data.features) return [];
    return data.features
      .filter((f: any) => f.geometry && f.geometry.coordinates)
      .map((feature: any) => ({
        internalId: uuidv4(),
        sourceFeatureId: feature.properties?.id || feature.id || null,
        producerName: '', fieldName: feature.properties?.name || '', cropType: '', areaText: '', notes: '', remarks: '',
        geometry: feature.geometry, properties: feature.properties,
      }));
  } catch(e) {
    alert('ファイルの解析に失敗しました。');
    return [];
  }
};

const isEdited = (p: any, points: any[]) => {
  return p.producerName !== '' || p.cropType !== '' || p.notes !== '' || p.remarks !== '' || points.some((pt: any) => pt.fieldInternalId === p.internalId);
};

export const exportToCSV = ({ polygons, points }: any) => {
  const editedPolygons = polygons.filter((p: any) => isEdited(p, points));
  const header = ['ID', '生産者名', '通称', '作物', '面積', '注意点', '備考'];
  const rows = editedPolygons.map((p: any) => [ p.internalId, p.producerName, p.fieldName, p.cropType, p.areaText, p.notes, p.remarks ].map(field => `"${(field || '').replace(/"/g, '""')}"`).join(','));
  downloadFile("data:text/csv;charset=utf-8,\uFEFF" + [header.join(','), ...rows].join('\n'), 'fields_edited.csv');
};

export const exportToGeoJSON = ({ polygons, points }: any) => {
  const editedPolygons = polygons.filter((p: any) => isEdited(p, points));
  const features = editedPolygons.map((p: any) => ({
    type: "Feature", geometry: p.geometry,
    properties: { id: p.internalId, producerName: p.producerName, fieldName: p.fieldName, cropType: p.cropType, notes: p.notes, points: points.filter((pt: any) => pt.fieldInternalId === p.internalId) }
  }));
  downloadFile("data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ type: "FeatureCollection", features }, null, 2)), 'fields_edited.geojson');
};

export const exportToKML = ({ polygons, points }: any) => {
  const editedPolygons = polygons.filter((p: any) => isEdited(p, points));
  let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>圃場マップ(入力済)</name>\n`;
  editedPolygons.forEach((p: any) => {
    kml += `    <Placemark>\n      <name>${p.fieldName || '名称未設定'}</name>\n      <description><![CDATA[生産者: ${p.producerName}<br>作物: ${p.cropType}<br>注意点: ${p.notes}]]></description>\n      ${createKMLGeometry(p.geometry)}\n    </Placemark>\n`;
  });
  points.forEach((pt: any) => {
    kml += `    <Placemark>\n      <name>${pt.pointType}: ${pt.name}</name>\n      <description>${pt.description}</description>\n      <Point><coordinates>${pt.coordinates[0]},${pt.coordinates[1]},0</coordinates></Point>\n    </Placemark>\n`;
  });
  downloadFile("data:application/vnd.google-earth.kml+xml;charset=utf-8," + encodeURIComponent(kml + `  </Document>\n</kml>`), 'fields_edited.kml');
};

const createKMLGeometry = (geometry: any) => {
  if (geometry.type === 'Polygon') return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${geometry.coordinates[0].map((c: any) => `${c[0]},${c[1]},0`).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
  if (geometry.type === 'MultiPolygon') return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${geometry.coordinates[0][0].map((c: any) => `${c[0]},${c[1]},0`).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
  return '';
};

const downloadFile = (content: string, fileName: string) => {
  const link = document.createElement("a"); link.href = encodeURI(content); link.download = fileName; link.click();
};
