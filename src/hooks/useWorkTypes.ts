'use client';
import { useState, useEffect } from 'react';
import type { FieldService } from '@/lib/db';
import type { WorkType } from '@/types';

/**
 * work_types をアプリ起動時に1回だけ取得してキャッシュするフック。
 * dbService が変わったとき（ログイン/ログアウト時）のみ再取得する。
 */
export function useWorkTypes(dbService: FieldService | null): {
  workTypes: WorkType[];
  loading: boolean;
} {
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!dbService) return;
    let cancelled = false;

    Promise.resolve().then(() => {
      if (!cancelled) setLoading(true);
    });
    dbService
      .getWorkTypes()
      .then((types) => {
        if (!cancelled) setWorkTypes(types);
      })
      .catch((e) => {
        console.error('[useWorkTypes] fetch error:', e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dbService]);

  return { workTypes, loading };
}
