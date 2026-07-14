'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { FieldService } from '@/lib/db';
import type { FieldWorkRecord } from '@/types';

/**
 * 複数圃場の最新作業を一括取得するフック（N+1クエリ禁止）。
 * - fieldIds が空のときは何もしない
 * - fieldIds が変わったときのみ再取得（debounce 付き）
 * - Map<fieldId, FieldWorkRecord> として返す
 */
export function useLatestWorkRecords(
  dbService: FieldService | null,
  fieldIds: string[],
): {
  recordMap: Map<string, FieldWorkRecord>;
  loading: boolean;
  refresh: () => void;
} {
  const [recordMap, setRecordMap] = useState<Map<string, FieldWorkRecord>>(new Map());
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  // 登録済み圃場（UUIDのみ）から安定したキー文字列を導出する。
  // 配列の identity ではなく内容で比較することで、親の再レンダーごとに
  // エフェクトが再実行されて取得中のフェッチが破棄されるのを防ぐ。
  const registeredKey = fieldIds
    .filter(
      (id) =>
        id &&
        !id.startsWith('poly-') &&
        !id.startsWith('source-') &&
        !id.includes('-group-'),
    )
    .sort()
    .join(',');

  useEffect(() => {
    if (!dbService || registeredKey === '') {
      Promise.resolve().then(() => {
        setRecordMap((prev) => prev.size === 0 ? prev : new Map());
      });
      return;
    }

    const registeredIds = registeredKey.split(',');

    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setLoading((prev) => (prev ? prev : true));
    });

    dbService
      .getWorkRecords(registeredIds)
      .then((records) => {
        if (cancelled) return;
        const map = new Map<string, FieldWorkRecord>();
        records.forEach((r) => map.set(r.fieldId, r));
        setRecordMap(map);
      })
      .catch((e) => {
        console.error('[useLatestWorkRecords] fetch error:', e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dbService, registeredKey, refreshTick]);

  return { recordMap, loading, refresh };
}

/**
 * 特定圃場の全作業履歴を取得するフック（WorkHistoryコンポーネント用）。
 */
export function useFieldWorkRecords(
  dbService: FieldService | null,
  fieldId: string | null,
): {
  records: FieldWorkRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [records, setRecords] = useState<FieldWorkRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevFieldIdRef = useRef<string>('');
  const lastRefreshTickRef = useRef(0);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (
      !dbService ||
      !fieldId ||
      fieldId.startsWith('poly-') ||
      fieldId.startsWith('source-') ||
      fieldId.includes('-group-')
    ) {
      Promise.resolve().then(() => {
        setRecords((prev) => prev.length === 0 ? prev : []);
        setError((prev) => prev === null ? prev : null);
      });
      return;
    }

    const isRefreshTrigger = refreshTick !== lastRefreshTickRef.current;
    lastRefreshTickRef.current = refreshTick;

    if (fieldId === prevFieldIdRef.current && !isRefreshTrigger) return;
    prevFieldIdRef.current = fieldId;

    let cancelled = false;
    setLoading((prev) => prev ? prev : true);
    setError((prev) => prev === null ? prev : null);

    const svc = dbService as unknown as {
      getFieldWorkRecords?: (id: string) => Promise<FieldWorkRecord[]>;
    };
    const promise = svc.getFieldWorkRecords
      ? svc.getFieldWorkRecords(fieldId)
      : dbService.getWorkRecords([fieldId]);

    promise
      .then((data: FieldWorkRecord[]) => {
        if (cancelled) return;
        setRecords(Array.isArray(data) ? data : []);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message || '履歴の取得に失敗しました。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dbService, fieldId, refreshTick]);

  return { records, loading, error, refresh };
}
