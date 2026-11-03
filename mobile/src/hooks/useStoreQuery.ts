import { useCallback, useEffect, useState } from 'react';
import type { Services } from '@/lib/services';
import { userMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';

export interface QueryResult<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

interface Settled<T> {
  key: string;
  data: T | undefined;
  error: string | null;
}

/**
 * Runs a read against the on-device store and re-runs it whenever data changes anywhere in the
 * app (`dataVersion`) or `deps` change. Previous data stays visible while a refresh is in
 * flight, so lists don't flash empty during a sync.
 */
export function useStoreQuery<T>(query: (services: Services) => Promise<T>, deps: readonly unknown[]): QueryResult<T> {
  const { state } = useApp();
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const services = state.services;
  const key = `${state.dataVersion}|${nonce}|${JSON.stringify(deps)}`;

  useEffect(() => {
    if (!services) return;
    let cancelled = false;
    query(services).then(
      (data) => {
        if (!cancelled) setSettled({ key, data, error: null });
      },
      (err: unknown) => {
        if (!cancelled) setSettled((prev) => ({ key, data: prev?.data, error: userMessage(err) }));
      },
    );
    return () => {
      cancelled = true;
    };
    // `query` is an inline closure; its inputs are captured by `key` (deps + data version).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const fresh = settled?.key === key;
  return {
    data: settled?.data,
    error: fresh ? (settled?.error ?? null) : null,
    loading: settled === null || (!fresh && settled.data === undefined),
    reload,
  };
}
