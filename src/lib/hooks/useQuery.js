'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Minimal data hook: runs `fetcher` when `key` changes and exposes loading/error/empty state.
 * `setData` allows optimistic updates; `reload` refetches without clearing current data.
 *
 * @template T
 * @param {string | null} key  null skips the request
 * @param {() => Promise<T>} fetcher
 */
export function useQuery(key, fetcher) {
  const [state, setState] = useState({ data: undefined, error: null, loading: Boolean(key) });
  const fetcherRef = useRef(fetcher);
  const requestId = useRef(0);
  fetcherRef.current = fetcher;

  const run = useCallback(async ({ keepData } = {}) => {
    const id = ++requestId.current;
    setState((s) => ({ data: keepData ? s.data : undefined, error: null, loading: true }));
    try {
      const data = await fetcherRef.current();
      if (id === requestId.current) setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      if (id === requestId.current) setState((s) => ({ data: keepData ? s.data : undefined, error, loading: false }));
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (key === null) return;
    run();
  }, [key, run]);

  const setData = useCallback((updater) => {
    setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater }));
  }, []);

  const reload = useCallback(() => run({ keepData: true }), [run]);

  return { ...state, setData, reload };
}
