// 筆ポリゴンデータをSupabaseのsource_polygonsテーブルに一括インポートするスクリプト
// 実行方法: node scripts/import_fude.mjs <SERVICE_ROLE_KEY>
//   ※ SERVICE_ROLE_KEY は Supabase Dashboard > Settings > API > service_role から取得

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// .env.local から環境変数を手動読み込み
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const [key, ...rest] = line.split('=');
  if (key && rest.length > 0) {
    process.env[key.trim()] = rest.join('=').trim();
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// コマンドライン引数 or 環境変数 SUPABASE_SERVICE_ROLE_KEY で指定
const SERVICE_ROLE_KEY = process.argv[2] || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error('❌ .env.local に NEXT_PUBLIC_SUPABASE_URL が必要です');
  process.exit(1);
}
if (!SERVICE_ROLE_KEY) {
  console.error('❌ Service Role Key が必要です。');
  console.error('   実行方法: node scripts/import_fude.mjs <SERVICE_ROLE_KEY>');
  console.error('   取得先: Supabase Dashboard > Settings > API > service_role');
  process.exit(1);
}

// Service Role Key を使うことでRLSをバイパスできる
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});
console.log('🔑 Service Role Key でSupabaseに接続（RLSバイパス）');

// GeoJSONファイルを読み込む
const GEOJSON_PATH = join(__dirname, '..', 'fude_kazo.json');
console.log(`📂 読み込み中: ${GEOJSON_PATH}`);
const rawData = readFileSync(GEOJSON_PATH, 'utf-8');
const geojson = JSON.parse(rawData);
const features = geojson.features || [];
console.log(`✅ 読み込み完了: ${features.length} 件`);

// 既存のレコード数を確認
const { count: existingCount } = await supabase
  .from('source_polygons')
  .select('*', { count: 'exact', head: true });
console.log(`📊 現在のDB件数: ${existingCount ?? 0} 件`);

// 500件ずつupsert（大量データを高速処理）
const CHUNK_SIZE = 500;
let successCount = 0;
let errorCount = 0;

for (let i = 0; i < features.length; i += CHUNK_SIZE) {
  const chunk = features.slice(i, i + CHUNK_SIZE);

  const rows = chunk.map(feature => {
    const props = feature.properties || {};
    // IDは polygon_uuid を使用。なければ自動生成
    const id = props.polygon_uuid || `kazo-${i}-${Math.random().toString(36).slice(2)}`;
    
    return {
      id,
      geom: feature.geometry,           // GeoJSONジオメトリをそのまま
      area_sqm: props.area ?? null,
      original_properties: props,
    };
  });

  const { error } = await supabase
    .from('source_polygons')
    .upsert(rows, { onConflict: 'id' });

  if (error) {
    console.error(`❌ チャンク ${i}〜${i + CHUNK_SIZE} エラー:`, error.message);
    errorCount += chunk.length;
  } else {
    successCount += chunk.length;
  }

  // 進捗表示
  const progress = Math.min(i + CHUNK_SIZE, features.length);
  process.stdout.write(`\r⬆️  アップロード中... ${progress} / ${features.length} (${Math.round(progress / features.length * 100)}%)`);
}

console.log(`\n\n🎉 完了！ 成功: ${successCount} 件 / エラー: ${errorCount} 件`);

if (errorCount > 0) {
  console.log('\n⚠️  エラーが発生した場合:');
  console.log('  1. Supabase Dashboard → SQL Editor で add_auth_trigger.sql を実行しているか確認');
  console.log('  2. source_polygons テーブルの RLS ポリシーを確認');
  console.log('  3. ログインしたユーザーのトークンでスクリプトを実行する必要がある場合は');
  console.log('     SUPABASE_SERVICE_ROLE_KEY を使ってください');
}
