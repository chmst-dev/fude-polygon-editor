'use client';
import React from 'react';
import { Search, X } from 'lucide-react';
import type { WorkType, FieldFilter } from '@/types';

interface FieldFilterBarProps {
  producers: string[];
  workTypes: WorkType[];
  filter: FieldFilter;
  onChange: (filter: FieldFilter) => void;
}

/**
 * 生産者・作業項目の独立フィルターバー。
 * 編集画面・共有閲覧画面の両方で使用する。
 * 両方指定した場合は AND 検索。
 */
export default function FieldFilterBar({
  producers,
  workTypes,
  filter,
  onChange,
}: FieldFilterBarProps) {
  const hasFilter = filter.producerName || filter.workTypeId;

  return (
    <div className="mb-3 space-y-2">
      {/* 生産者フィルター */}
      <div className="relative">
        <input
          type="text"
          id="filter-producer"
          list="filter-producers-list"
          value={filter.producerName}
          onChange={(e) => onChange({ ...filter, producerName: e.target.value })}
          placeholder="生産者で絞り込み..."
          className="w-full pl-8 pr-8 py-2 border rounded-lg text-xs outline-none focus:border-indigo-400 bg-white shadow-sm"
        />
        <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
        {filter.producerName && (
          <button
            onClick={() => onChange({ ...filter, producerName: '' })}
            className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 transition"
            aria-label="生産者フィルターをクリア"
          >
            <X size={13} />
          </button>
        )}
        <datalist id="filter-producers-list">
          {producers.map((p, i) => (
            <option key={i} value={p} />
          ))}
        </datalist>
      </div>

      {/* 作業項目フィルター */}
      <div className="flex gap-2 items-center">
        <select
          id="filter-work-type"
          value={filter.workTypeId}
          onChange={(e) => {
            const nextWorkTypeId = e.target.value;
            onChange({
              ...filter,
              workTypeId: nextWorkTypeId,
              showUndone: nextWorkTypeId ? filter.showUndone : false,
            });
          }}
          className="flex-1 py-2 px-2.5 border rounded-lg text-xs outline-none focus:border-indigo-400 bg-white shadow-sm"
        >
          <option value="">作業項目で絞り込み...</option>
          {workTypes.filter((wt) => wt.isActive).map((wt) => (
            <option key={wt.id} value={wt.id}>
              {wt.name}
            </option>
          ))}
        </select>

        {hasFilter && (
          <button
            onClick={() => onChange({ producerName: '', workTypeId: '', showUndone: false })}
            className="flex items-center gap-1 px-2.5 py-2 text-xs font-bold text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition whitespace-nowrap shadow-sm"
            title="フィルターをすべてクリア"
          >
            <X size={12} />
            クリア
          </button>
        )}
      </div>

      {filter.workTypeId && (
        <div className="flex items-center gap-2 pl-1.5 py-1">
          <label htmlFor="filter-show-undone" className="flex items-center gap-2 cursor-pointer text-xs text-slate-600 select-none">
            <input
              type="checkbox"
              id="filter-show-undone"
              checked={filter.showUndone || false}
              onChange={(e) => onChange({ ...filter, showUndone: e.target.checked })}
              className="w-3.5 h-3.5 border rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            未実施の圃場も表示
          </label>
        </div>
      )}

      {/* フィルター中バッジ */}
      {hasFilter && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {filter.producerName && (
            <span className="flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5 text-[10px] font-bold">
              生産者: {filter.producerName}
              <button
                onClick={() => onChange({ ...filter, producerName: '' })}
                className="ml-0.5 hover:text-indigo-900"
                aria-label="生産者フィルターを削除"
              >
                <X size={10} />
              </button>
            </span>
          )}
          {filter.workTypeId && (() => {
            const wt = workTypes.find((w) => w.id === filter.workTypeId);
            return wt ? (
              <span className="flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 text-[10px] font-bold">
                作業: {wt.name}
                <button
                  onClick={() => onChange({ ...filter, workTypeId: '', showUndone: false })}
                  className="ml-0.5 hover:text-emerald-900"
                  aria-label="作業フィルターを削除"
                >
                  <X size={10} />
                </button>
              </span>
            ) : null;
          })()}
        </div>
      )}
    </div>
  );
}
