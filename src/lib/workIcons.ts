/**
 * 作業アイコン・状況カラー定義
 *
 * icon_key はDBの work_types.icon_key と対応する安定したキー。
 * Leaflet の DivIcon は React コンポーネントを直接描画できないため、
 * SVG パスを HTML 文字列として組み立てる。
 * ユーザー入力値を HTML に直接埋め込まない（XSS 対策）。
 */
import type { WorkStatus } from '@/types';

// ────────────────────────────────────────────────────────────
// アイコン SVG パス（icon_key → SVG path d 属性）
// lucide-react のSVGパスを参照（24×24 viewBox）
// ────────────────────────────────────────────────────────────
const ICON_PATHS: Record<string, string> = {
  shovel:
    'M2 22l10-10M15.5 2.1l6.4 6.4a1 1 0 0 1 0 1.4l-3.8 3.8a1 1 0 0 1-1.4 0l-6.4-6.4a1 1 0 0 1 0-1.4l3.8-3.8a1 1 0 0 1 1.4 0z',
  waves:
    'M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1',
  seed:
    'M2 22V12a10 10 0 0 1 10-10h0a10 10 0 0 1 10 10v10M6 22v-4a6 6 0 0 1 6-6h0a6 6 0 0 1 6 6v4',
  sprout:
    'M7 20h10M10 20c5.5-2.5.8-6.4 3-10M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8zM14.1 6a7 7 0 0 1 1.7 4.4c-1.5.1-3 0-4-.5C10.9 9.3 10.2 8 10 7c2.1-1 4.2-.9 4.1-1z',
  flask:
    'M10 2v7.31L5.5 22h13L14 9.31V2M8.5 2h7M5 8h14',
  spray:
    'M3 3h4v11H3zM7 8h3M13 3h4v11h-4zM17 8h3M3 21h18M12 3v5M12 11v10',
  scissors:
    'M6 3a3 3 0 0 1 0 6 3 3 0 0 1 0-6zM18 3a3 3 0 0 1 0 6 3 3 0 0 1 0-6zM8.5 8.5l7 7M6 21l7.5-7.5M17 21l-7.5-7.5',
  droplet:
    'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z',
  wheat:
    'M2 22l10-10M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94zM7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94zM11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94zM20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4zM20 8v6M20 22v-4M20 18a2 2 0 0 0 2-2v-2h-4v2a2 2 0 0 0 2 2z',
  'circle-ellipsis':
    'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 12h.01M8 12h.01M16 12h.01',
  // フォールバック（汎用円形）
  default:
    'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z',
};

// ────────────────────────────────────────────────────────────
// 作業状況カラー定義
// ────────────────────────────────────────────────────────────
export interface WorkStatusStyle {
  label: string;
  bg: string;       // CSS background-color
  border: string;   // CSS border-color
  badge: string;    // バッジ背景色
  badgeText: string;
  emoji: string;
}

export const WORK_STATUS_STYLES: Record<WorkStatus, WorkStatusStyle> = {
  planned: {
    label: '予定',
    bg: '#dbeafe',
    border: '#3b82f6',
    badge: '#3b82f6',
    badgeText: '#ffffff',
    emoji: '📅',
  },
  in_progress: {
    label: '作業中',
    bg: '#fef9c3',
    border: '#eab308',
    badge: '#eab308',
    badgeText: '#ffffff',
    emoji: '⚙️',
  },
  completed: {
    label: '完了',
    bg: '#dcfce7',
    border: '#22c55e',
    badge: '#22c55e',
    badgeText: '#ffffff',
    emoji: '✅',
  },
  cancelled: {
    label: '中止',
    bg: '#f1f5f9',
    border: '#94a3b8',
    badge: '#94a3b8',
    badgeText: '#ffffff',
    emoji: '⛔',
  },
};

// ────────────────────────────────────────────────────────────
// Leaflet DivIcon 用 HTML 生成
// ユーザー入力値を直接 HTML に埋め込まない
// ────────────────────────────────────────────────────────────

/**
 * iconKey から SVG パスを取得（未知のキーはフォールバック）
 */
function getSvgPath(iconKey: string): string {
  return ICON_PATHS[iconKey] ?? ICON_PATHS.default;
}

/**
 * 作業アイコン用 DivIcon HTML 文字列を生成する。
 * - ユーザー入力値を直接埋め込まない（iconKey・status は既知の定義値のみ使用）
 * - innerColor: 作業種別の色（work_types.color）
 * - statusStyle: 状態に応じた枠・バッジ
 */
export function getWorkDivIconHtml(
  iconKey: string,
  status: WorkStatus,
  color: string = '#64748b',
): string {
  // iconKey を既知のセットに限定（XSS対策: ホワイトリスト）
  const safePath = getSvgPath(iconKey);
  const style = WORK_STATUS_STYLES[status] ?? WORK_STATUS_STYLES.planned;

  const size = 36;
  const borderWidth = 3;
  const badgeSize = 12;

  // SVG を data URI ではなく inline HTML として描画
  return `
<div style="
  position: relative;
  width: ${size}px;
  height: ${size}px;
  background: ${style.bg};
  border: ${borderWidth}px solid ${style.border};
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  cursor: pointer;
">
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="${color}"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="display:block;"
  >
    <path d="${safePath}" />
  </svg>
  <div style="
    position: absolute;
    top: -4px;
    right: -4px;
    width: ${badgeSize}px;
    height: ${badgeSize}px;
    background: ${style.badge};
    border-radius: 50%;
    border: 1.5px solid white;
  "></div>
</div>`;
}

/**
 * 作業アイコンのアンカー設定（中心がcentroidに来るよう）
 */
export const WORK_ICON_SIZE: [number, number] = [36, 36];
export const WORK_ICON_ANCHOR: [number, number] = [18, 18];
