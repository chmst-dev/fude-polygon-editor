'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, AlertCircle, RefreshCw, ClipboardList, Pencil, Trash2, X, Check } from 'lucide-react';
import type { FieldService } from '@/lib/db';
import type { WorkType, WorkStatus, NewWorkRecord, UpdateWorkRecord, FieldWorkRecord } from '@/types';
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
  /** ログイン中ユーザーのUUID（MainApp の user.id）。未ログイン時は null */
  currentUserId: string | null;
  /** ログイン中ユーザーのロール（'admin' | 'org_admin' | 'viewer' | ''） */
  userRole: string;
}

const STATUS_OPTIONS: { value: WorkStatus; label: string }[] = [
  { value: 'planned', label: '予定' },
  { value: 'in_progress', label: '作業中' },
  { value: 'completed', label: '完了' },
  { value: 'cancelled', label: '中止' },
];

/** エラーメッセージを安全に文字列へ変換 */
function toErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof (e as Record<string, unknown>).message === 'string'
  ) {
    return (e as Record<string, unknown>).message as string;
  }
  return fallback;
}

/**
 * 作業履歴セクション。
 * - 権限のあるユーザーのみ登録フォームを表示
 * - 履歴は新着順に表示
 * - ローディング・空状態・エラー/再試行を実装
 * - 未保存圃場（poly- / source- 始まり）には登録不可
 * - per-record の編集・削除権限を admin / org_admin で分離して表示制御
 */
export default function WorkHistory({
  fieldId,
  fieldName,
  workTypes,
  isReadOnly,
  dbService,
  onRecordChanged,
  currentUserId,
  userRole,
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

  // ────────────────────────────────────────────────────────────
  // フォーム state（新規登録と編集で共用）
  // ────────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  /** null = 新規登録モード、UUID = 編集モード */
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [formWorkTypeId, setFormWorkTypeId] = useState('');
  const [formStatus, setFormStatus] = useState<WorkStatus>('planned');
  const [formDate, setFormDate] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ────────────────────────────────────────────────────────────
  // 削除 state
  // ────────────────────────────────────────────────────────────
  /** 削除確認を表示しているレコードID */
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ────────────────────────────────────────────────────────────
  // 圃場切り替え時に全編集状態をリセット
  // useCallback に切り出して useEffect のルール違反を回避
  const resetAllFormState = useCallback(() => {
    setShowForm(false);
    setEditingRecordId(null);
    setFormWorkTypeId('');
    setFormStatus('planned');
    setFormDate('');
    setFormNotes('');
    setSaving(false);
    setSaveError(null);
    setDeleteConfirmId(null);
    setDeleting(false);
    setDeleteError(null);
  }, []);

  useEffect(() => {
    resetAllFormState(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [fieldId, resetAllFormState]);


  // ────────────────────────────────────────────────────────────
  // per-record の編集・削除表示判定
  // admin     : 全レコード表示
  // org_admin : 自分が作成したレコードのみ表示
  // それ以外  : 表示しない（isReadOnly で制御済みだが念のため）
  // ────────────────────────────────────────────────────────────
  const canEditRecord = useCallback((record: FieldWorkRecord): boolean => {
    if (isReadOnly) return false;
    if (userRole === 'admin') return true;
    if (userRole === 'org_admin') return record.createdBy === currentUserId;
    return false;
  }, [isReadOnly, userRole, currentUserId]);

  // ────────────────────────────────────────────────────────────
  // フォームリセット
  // ────────────────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    setFormWorkTypeId(workTypes[0]?.id ?? '');
    setFormStatus('planned');
    setFormDate('');
    setFormNotes('');
    setSaveError(null);
    setShowForm(false);
    setEditingRecordId(null);
  }, [workTypes]);

  // ────────────────────────────────────────────────────────────
  // 新規登録フォームを開く
  // ────────────────────────────────────────────────────────────
  const handleOpenNewForm = () => {
    setEditingRecordId(null);
    setFormWorkTypeId(workTypes[0]?.id ?? '');
    setFormStatus('planned');
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormNotes('');
    setSaveError(null);
    setDeleteConfirmId(null);
    setShowForm(true);
  };

  // ────────────────────────────────────────────────────────────
  // 編集フォームを開く
  // ────────────────────────────────────────────────────────────
  const handleOpenEditForm = (record: FieldWorkRecord) => {
    setEditingRecordId(record.id);
    setFormWorkTypeId(record.workTypeId);
    setFormStatus(record.status);
    setFormDate(record.workedOn ?? '');
    setFormNotes(record.notes ?? '');
    setSaveError(null);
    setDeleteConfirmId(null);
    setShowForm(true);
  };

  // ────────────────────────────────────────────────────────────
  // 保存（新規 or 更新）
  // ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!dbService || !fieldId || !formWorkTypeId) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editingRecordId) {
        // 更新
        const updatePayload: UpdateWorkRecord = {
          id: editingRecordId,
          workTypeId: formWorkTypeId,
          status: formStatus,
          workedOn: formDate || null,
          notes: formNotes.trim() || null,
        };
        await dbService.updateWorkRecord(updatePayload);
      } else {
        // 新規登録
        const newPayload: NewWorkRecord = {
          fieldId,
          workTypeId: formWorkTypeId,
          status: formStatus,
          workedOn: formDate || null,
          notes: formNotes.trim() || null,
        };
        await dbService.saveWorkRecord(newPayload);
      }
      // DB成功後に authoritative 再取得（楽観更新せず）
      refresh();
      onRecordChanged?.();
      resetForm();
    } catch (e: unknown) {
      // 失敗時はフォームを閉じず入力値を保持してエラーを表示
      setSaveError(toErrorMessage(e, '保存に失敗しました。'));
    } finally {
      setSaving(false);
    }
  };

  // ────────────────────────────────────────────────────────────
  // 削除確認開始
  // ────────────────────────────────────────────────────────────
  const handleOpenDeleteConfirm = (record: FieldWorkRecord) => {
    setDeleteConfirmId(record.id);
    setDeleteError(null);
  };

  const handleCancelDelete = () => {
    setDeleteConfirmId(null);
    setDeleteError(null);
  };

  // ────────────────────────────────────────────────────────────
  // 削除実行
  // ────────────────────────────────────────────────────────────
  const handleDeleteConfirm = async (record: FieldWorkRecord) => {
    if (!dbService || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await dbService.deleteWorkRecord(record.id);
      // 削除したレコードが編集中だった場合はフォームもリセット
      if (editingRecordId === record.id) {
        resetForm();
      }
      setDeleteConfirmId(null);
      // DB成功後に authoritative 再取得
      refresh();
      onRecordChanged?.();
    } catch (e: unknown) {
      // 失敗時は履歴をそのまま維持してエラー表示
      setDeleteError(toErrorMessage(e, '削除に失敗しました。'));
    } finally {
      setDeleting(false);
    }
  };

  // ────────────────────────────────────────────────────────────
  // 未保存圃場の場合は作業登録不可メッセージ
  // ────────────────────────────────────────────────────────────
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
            onClick={handleOpenNewForm}
            className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg transition shadow-sm"
          >
            <Plus size={12} /> 作業を追加
          </button>
        )}
      </div>

      {/* ────────────────────────────────────────────────────────
          登録フォーム（新規・編集共用）
      ──────────────────────────────────────────────────────── */}
      {!isReadOnly && showForm && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-3 space-y-2.5 text-xs">
          {/* 編集モードの場合はヘッダーで対象を明示 */}
          {editingRecordId && (
            <div className="flex items-center gap-1.5 text-indigo-700 font-bold pb-1 border-b border-indigo-100">
              <Pencil size={11} className="shrink-0" />
              <span>作業を編集中</span>
            </div>
          )}

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
              {saving ? <Loader2 size={12} className="animate-spin" /> : (editingRecordId ? <Check size={12} /> : <Plus size={12} />)}
              {saving ? '保存中...' : (editingRecordId ? '変更を保存' : '登録する')}
            </button>
            <button
              onClick={resetForm}
              disabled={saving}
              className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-2 rounded-lg transition disabled:opacity-50"
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

      {/* ────────────────────────────────────────────────────────
          履歴一覧（新着順）
      ──────────────────────────────────────────────────────── */}
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

            const isEditable = canEditRecord(record);
            const isThisDeleteConfirm = deleteConfirmId === record.id;
            const isEditingThis = editingRecordId === record.id && showForm;

            return (
              <div
                key={record.id}
                className={`bg-white border rounded-xl p-3 shadow-sm space-y-1.5 transition ${isEditingThis ? 'ring-2 ring-indigo-300' : ''}`}
                style={{ borderLeftWidth: 4, borderLeftColor: style.border }}
              >
                {/* 作業名・状況・日付 */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    <span className="font-bold text-xs text-slate-800 truncate">
                      {record.workTypeName}
                    </span>
                    <span
                      className="px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white whitespace-nowrap shrink-0"
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

                {/* ────────────────────────────────────────────────
                    削除確認エリア（インライン表示）
                ──────────────────────────────────────────────── */}
                {isThisDeleteConfirm && (
                  <div className="mt-2 pt-2 border-t border-rose-100 space-y-2">
                    <p className="text-xs font-bold text-rose-700">
                      「{record.workTypeName}（{dateStr}）」を削除しますか？
                    </p>
                    <p className="text-[10px] text-rose-600">
                      この操作は元に戻せません。
                    </p>
                    {deleteError && (
                      <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 rounded-lg p-2 text-rose-700 text-xs font-medium">
                        <AlertCircle size={11} className="shrink-0" />
                        {deleteError}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDeleteConfirm(record)}
                        disabled={deleting}
                        className="flex-1 flex items-center justify-center gap-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold py-1.5 rounded-lg transition disabled:opacity-50"
                      >
                        {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                        {deleting ? '削除中...' : '削除する'}
                      </button>
                      <button
                        onClick={handleCancelDelete}
                        disabled={deleting}
                        className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold py-1.5 rounded-lg transition disabled:opacity-50"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                )}

                {/* ────────────────────────────────────────────────
                    編集・削除ボタン（per-record 権限で表示制御）
                    - 削除確認中は非表示
                    - 編集中の他レコードのボタンは非表示（混乱防止）
                ──────────────────────────────────────────────── */}
                {isEditable && !isThisDeleteConfirm && !showForm && (
                  <div className="flex gap-1.5 pt-1">
                    <button
                      onClick={() => handleOpenEditForm(record)}
                      className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-lg transition border border-indigo-100"
                    >
                      <Pencil size={10} /> 編集
                    </button>
                    <button
                      onClick={() => handleOpenDeleteConfirm(record)}
                      className="flex items-center gap-1 text-[10px] font-bold text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 px-2 py-1 rounded-lg transition border border-rose-100"
                    >
                      <Trash2 size={10} /> 削除
                    </button>
                  </div>
                )}

                {/* 編集中カードのキャンセルリンク（フォームが開いている編集対象カードにのみ表示） */}
                {isEditable && isEditingThis && (
                  <div className="flex items-center gap-1 pt-1">
                    <button
                      onClick={resetForm}
                      disabled={saving}
                      className="flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-slate-700 transition"
                    >
                      <X size={10} /> 編集をキャンセル
                    </button>
                  </div>
                )}
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
