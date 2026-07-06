'use client';
import React, { useState } from 'react';
import { Loader2, Plus, AlertCircle, RefreshCw, ClipboardList } from 'lucide-react';
import type { FieldService } from '@/lib/db';
import type { WorkType, WorkStatus, NewWorkRecord } from '@/types';
import { WORK_STATUS_STYLES } from '@/lib/workIcons';
import { useFieldWorkRecords } from '@/hooks/useWorkRecords';

interface WorkHistoryProps {
  fieldId: string | null;
  fieldName: string;
  workTypes: WorkType[];
  isReadOnly: boolean;
  dbService: FieldService | null;
  /** 作業履歴が更新されたときに呼ぶコールバック（地図アイコンの更新に使用） */
  onRecordChanged?: () => void;
}

const STATUS_OPTIONS: { value: WorkStatus; label: string }[] = [
  { value: 'planned', label: '予定' },
  { value: 'in_progress', label: '作業中' },
  { value: 'completed', label: '完了' },
  { value: 'cancelled', label: '中止' },
];

/**
 * 作業履歴セクション。
 * - 権限のあるユーザーのみ登録フォームを表示
 * - 履歴は新着順に表示
 * - ローディング・空状態・エラー/再試行を実装
 * - 未保存圃場（poly- / source- 始まり）には登録不可
 */
export default function WorkHistory({
  fieldId,
  fieldName,
  workTypes,
  isReadOnly,
  dbService,
  onRecordChanged,
}: WorkHistoryProps) {
  const isUnsavedField =
    !fieldId ||
    fieldId.startsWith('poly-') ||
    fieldId.startsWith('source-') ||
    fieldId.includes('-group-');

  const { records, loading, error, refresh } = useFieldWorkRecords(
    dbService,
    isUnsavedField ? null : fieldId,
  );

  // 登録フォーム
  const [showForm, setShowForm] = useState(false);
  const [formWorkTypeId, setFormWorkTypeId] = useState('');
  const [formStatus, setFormStatus] = useState<WorkStatus>('planned');
  const [formDate, setFormDate] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const resetForm = () => {
    setFormWorkTypeId(workTypes[0]?.id ?? '');
    setFormStatus('planned');
    setFormDate('');
    setFormNotes('');
    setSaveError(null);
    setShowForm(false);
  };

  const handleSave = async () => {
    if (!dbService || !fieldId || !formWorkTypeId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const record: NewWorkRecord = {
        fieldId,
        workTypeId: formWorkTypeId,
        status: formStatus,
        workedOn: formDate || null,
        notes: formNotes.trim() || null,
      };
      await dbService.saveWorkRecord(record);
      // DB保存成功後にローカル状態を更新（楽観更新はしない）
      refresh();
      onRecordChanged?.();
      resetForm();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '保存に失敗しました。';
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

  // フォームを開くときにデフォルト値をセット
  const handleOpenForm = () => {
    setFormWorkTypeId(workTypes[0]?.id ?? '');
    setFormStatus('planned');
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormNotes('');
    setSaveError(null);
    setShowForm(true);
  };

  // 登録済み圃場かどうか
  if (isUnsavedField) {
    return (
      <div className="mt-4 pt-4 border-t border-slate-100">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
          <ClipboardList size={12} /> 作業履歴
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700 font-medium">
          圃場を保存してから作業を登録できます。
          <br />先に「この圃場を保存する」ボタンを押してください。
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
          <ClipboardList size={12} /> 作業履歴
        </p>
        {!isReadOnly && !showForm && (
          <button
            onClick={handleOpenForm}
            className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg transition shadow-sm"
          >
            <Plus size={12} /> 作業を追加
          </button>
        )}
      </div>

      {/* 登録フォーム */}
      {!isReadOnly && showForm && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-3 space-y-2.5 text-xs">
          <div>
            <label className="block font-bold text-slate-600 mb-1">作業項目 *</label>
            <select
              value={formWorkTypeId}
              onChange={(e) => setFormWorkTypeId(e.target.value)}
              className="w-full border p-2 rounded-lg bg-white outline-none focus:border-indigo-500 text-xs"
            >
              <option value="">選択してください</option>
              {workTypes.map((wt) => (
                <option key={wt.id} value={wt.id}>
                  {wt.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-bold text-slate-600 mb-1">状況 *</label>
            <select
              value={formStatus}
              onChange={(e) => setFormStatus(e.target.value as WorkStatus)}
              className="w-full border p-2 rounded-lg bg-white outline-none focus:border-indigo-500 text-xs"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-bold text-slate-600 mb-1">日付</label>
            <input
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              className="w-full border p-2 rounded-lg bg-white outline-none focus:border-indigo-500 text-xs"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-600 mb-1">メモ</label>
            <textarea
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              rows={2}
              placeholder="例: 全量施肥完了"
              className="w-full border p-2 rounded-lg bg-white outline-none focus:border-indigo-500 text-xs resize-none"
            />
          </div>

          {saveError && (
            <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 rounded-lg p-2 text-rose-700 text-xs font-medium">
              <AlertCircle size={12} className="shrink-0" />
              {saveError}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || !formWorkTypeId}
              className="flex-1 flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded-lg transition disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              {saving ? '保存中...' : '登録する'}
            </button>
            <button
              onClick={resetForm}
              className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-2 rounded-lg transition"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* ローディング */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-3">
          <Loader2 size={13} className="animate-spin" />
          履歴を取得中...
        </div>
      )}

      {/* エラー */}
      {error && !loading && (
        <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-700 font-medium">
          <AlertCircle size={13} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={refresh}
            className="flex items-center gap-1 text-rose-700 hover:text-rose-900 font-bold"
          >
            <RefreshCw size={11} /> 再試行
          </button>
        </div>
      )}

      {/* 空状態 */}
      {!loading && !error && records.length === 0 && (
        <p className="text-xs text-slate-400 italic py-2">
          作業履歴はまだありません。
        </p>
      )}

      {/* 履歴一覧（新着順） */}
      {!loading && !error && records.length > 0 && (
        <div className="space-y-2">
          {records.map((record) => {
            const style = WORK_STATUS_STYLES[record.status] ?? WORK_STATUS_STYLES.planned;
            const dateStr = record.workedOn
              ? new Date(record.workedOn).toLocaleDateString('ja-JP', {
                  year: 'numeric', month: '2-digit', day: '2-digit',
                })
              : '日付未定';
            const createdAtStr = new Date(record.createdAt).toLocaleString('ja-JP', {
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit',
            });

            return (
              <div
                key={record.id}
                className="bg-white border rounded-xl p-3 shadow-sm space-y-1.5"
                style={{ borderLeftWidth: 4, borderLeftColor: style.border }}
              >
                {/* 作業名・状況 */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs text-slate-800">
                      {record.workTypeName}
                    </span>
                    <span
                      className="px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white whitespace-nowrap"
                      style={{ backgroundColor: style.badge }}
                    >
                      {style.emoji} {style.label}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 shrink-0">{dateStr}</span>
                </div>

                {/* メモ */}
                {record.notes && (
                  <p className="text-xs text-slate-600 leading-snug">{record.notes}</p>
                )}

                {/* 登録者・日時 */}
                <p className="text-[10px] text-slate-400">
                  登録者: {record.creatorName ?? '不明'} ／ {createdAtStr}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {fieldName && (
        <p className="text-[10px] text-slate-300 mt-2 text-right truncate">
          圃場: {fieldName}
        </p>
      )}
    </div>
  );
}
