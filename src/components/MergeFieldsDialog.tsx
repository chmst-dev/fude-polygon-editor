'use client';
import React, { useState, useMemo } from 'react';
import { Loader2, AlertCircle, GitMerge, ChevronDown } from 'lucide-react';
import type { FieldService } from '@/lib/db';
import type { FieldPolygon, MergeFieldsParams } from '@/types';

interface MergeFieldsDialogProps {
  /** 複数選択された圃場IDの配列（登録済み圃場のみであることをSidebar側で検証済み） */
  selectedFieldIds: string[];
  polygons: FieldPolygon[];
  dbService: FieldService | null;
  onSuccess: (mergedFieldId: string, sourceFieldIds: string[]) => void;
  onCancel: () => void;
}

/**
 * 登録済み圃場統合ダイアログ。
 * - 統合先圃場を選択（初期値: 最初に選択した圃場）
 * - 統合後のメタデータを確認・編集
 * - 実行前に確認ダイアログを表示
 * - 未登録ポリゴン混在チェックは呼び出し側（Sidebar）で実施済み
 * - DBへの統合は mergeFields RPC（単一トランザクション）で実行
 */
export default function MergeFieldsDialog({
  selectedFieldIds,
  polygons,
  dbService,
  onSuccess,
  onCancel,
}: MergeFieldsDialogProps) {
  const selectedPolygons = useMemo(
    () => polygons.filter((p) => selectedFieldIds.includes(p.internalId)),
    [polygons, selectedFieldIds],
  );

  const [targetFieldId, setTargetFieldId] = useState<string>(selectedFieldIds[0] ?? '');
  const [producerName, setProducerName] = useState<string>(
    () => selectedPolygons.find((p) => p.internalId === selectedFieldIds[0])?.producerName ?? '',
  );
  const [fieldName, setFieldName] = useState<string>(
    () => selectedPolygons.find((p) => p.internalId === selectedFieldIds[0])?.fieldName ?? '',
  );
  const [cropType, setCropType] = useState<string>(
    () => selectedPolygons.find((p) => p.internalId === selectedFieldIds[0])?.cropType ?? '',
  );
  const [notes, setNotes] = useState<string>(
    () => selectedPolygons.find((p) => p.internalId === selectedFieldIds[0])?.notes ?? '',
  );
  const [status] = useState<string>('active');

  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const targetPolygon = selectedPolygons.find((p) => p.internalId === targetFieldId);
  const sourceFieldIds = selectedFieldIds.filter((id) => id !== targetFieldId);

  const getFieldLabel = (p: Partial<FieldPolygon>) => {
    return p.fieldName || (p.producerName ? `${p.producerName} (名称未設定)` : '名称未設定');
  };

  // 統合先が変わったときにデフォルト値を更新
  const handleTargetChange = (newTargetId: string) => {
    setTargetFieldId(newTargetId);
    const p = selectedPolygons.find((poly) => poly.internalId === newTargetId);
    if (p) {
      setProducerName(p.producerName ?? '');
      setFieldName(p.fieldName ?? '');
      setCropType(p.cropType ?? '');
      setNotes(p.notes ?? '');
    }
  };

  const handleMerge = async () => {
    if (!dbService || !targetFieldId || sourceFieldIds.length === 0) return;
    setMerging(true);
    setMergeError(null);
    try {
      const params: MergeFieldsParams = {
        targetFieldId,
        sourceFieldIds,
        fieldData: { producerName, fieldName, cropType, notes, status },
      };
      const { mergedFieldId } = await dbService.mergeFields(params);
      onSuccess(mergedFieldId, sourceFieldIds);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '統合に失敗しました。';
      setMergeError(msg);
    } finally {
      setMerging(false);
      setShowConfirm(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* ヘッダー */}
        <div className="bg-indigo-600 px-5 py-4">
          <div className="flex items-center gap-2 text-white">
            <GitMerge size={18} />
            <h2 className="font-extrabold text-sm">圃場の統合</h2>
          </div>
          <p className="text-indigo-200 text-xs mt-1">
            選択した {selectedFieldIds.length} 件の登録済み圃場を統合します。
          </p>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
          {/* 統合元圃場一覧 */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              対象圃場
            </p>
            <div className="space-y-1.5">
              {selectedPolygons.map((p) => (
                <div
                  key={p.internalId}
                  className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl border ${
                    p.internalId === targetFieldId
                      ? 'bg-indigo-50 border-indigo-300 font-bold text-indigo-900'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  <span className="flex-1 truncate">{getFieldLabel(p)}</span>
                  {p.internalId === targetFieldId && (
                    <span className="shrink-0 text-[10px] bg-indigo-600 text-white px-1.5 py-0.5 rounded-full font-bold">
                      統合先
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 統合先選択 */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">
              統合先圃場 <span className="text-rose-500">*</span>
              <span className="text-slate-400 font-normal ml-1">（残す圃場）</span>
            </label>
            <div className="relative">
              <select
                value={targetFieldId}
                onChange={(e) => handleTargetChange(e.target.value)}
                className="w-full border border-slate-300 rounded-xl py-2.5 pl-3 pr-8 text-xs outline-none focus:border-indigo-500 bg-white appearance-none"
              >
                {selectedPolygons.map((p) => (
                  <option key={p.internalId} value={p.internalId}>
                    {getFieldLabel(p)}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-3 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              統合後の情報（確認・編集）
            </p>

            {[
              { label: '生産者名', value: producerName, setter: setProducerName, ph: '例: 山田太郎' },
              { label: '圃場名（通称）', value: fieldName, setter: setFieldName, ph: '例: 上野原' },
              { label: '作物', value: cropType, setter: setCropType, ph: '例: コシヒカリ' },
              { label: '注意点・メモ', value: notes, setter: setNotes, ph: '例: 電線注意' },
            ].map(({ label, value, setter, ph }) => (
              <div key={label} className="mb-3">
                <label className="block text-xs font-bold text-slate-600 mb-1">{label}</label>
                <input
                  type="text"
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                  placeholder={ph}
                  className="w-full border border-slate-200 rounded-xl py-2 px-3 text-xs outline-none focus:border-indigo-500 bg-slate-50"
                />
              </div>
            ))}
          </div>

          {mergeError && (
            <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-700 font-medium">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              {mergeError}
            </div>
          )}

          {/* 注意事項 */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
            <p className="font-bold mb-1">⚠️ 統合後の変更点</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>統合元圃場（{sourceFieldIds.length}件）は削除されます</li>
              <li>すべての筆ポリゴン・ポイント・作業履歴は統合先へ移動します</li>
              <li>この操作は元に戻せません</li>
            </ul>
          </div>
        </div>

        {/* フッター */}
        <div className="px-5 py-4 border-t border-slate-100 flex gap-2.5">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 font-bold text-xs hover:bg-slate-50 transition"
          >
            キャンセル
          </button>
          <button
            onClick={() => setShowConfirm(true)}
            disabled={merging || !targetFieldId || sourceFieldIds.length === 0}
            className="flex-2 flex-[2] py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <GitMerge size={13} />
            統合を実行する
          </button>
        </div>
      </div>

      {/* 最終確認ダイアログ */}
      {showConfirm && (
        <div className="fixed inset-0 z-[3100] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
            <h3 className="font-extrabold text-sm text-slate-900 mb-3">
              最終確認
            </h3>
            <p className="text-xs text-slate-700 mb-4 leading-relaxed">
              以下の圃場を
              <span className="font-bold text-indigo-700">
                「{getFieldLabel(targetPolygon ?? {})}」
              </span>
              に統合します。
              <br />
              <span className="text-rose-600 font-bold">
                統合元の {sourceFieldIds.length} 件は削除されます。
              </span>
              この操作は元に戻せません。
            </p>
            <div className="mb-4 space-y-1">
              {selectedPolygons
                .filter((p) => sourceFieldIds.includes(p.internalId))
                .map((p) => (
                  <div
                    key={p.internalId}
                    className="text-xs text-slate-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-1.5 font-medium"
                  >
                    🗑 {getFieldLabel(p)}
                  </div>
                ))}
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 font-bold text-xs hover:bg-slate-50 transition"
              >
                戻る
              </button>
              <button
                onClick={handleMerge}
                disabled={merging}
                className="flex-[2] py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {merging ? (
                  <><Loader2 size={12} className="animate-spin" /> 統合中...</>
                ) : (
                  '実行する'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
