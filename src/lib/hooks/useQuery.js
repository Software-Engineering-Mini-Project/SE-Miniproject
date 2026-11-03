'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const queryCache = new Map();
const inFlight = new Map();
let cacheVersion = 0;

export function clearQueryCache() {
  cacheVersion += 1;
  queryCache.clear();
  inFlight.clear();
}

export function prefetchQuery(key, fetcher) {
  return fetchQuery(key, fetcher);
}

function fetchQuery(key, fetcher) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const version = cacheVersion;
  const request = Promise.resolve().then(fetcher).then((data) => {
    if (version === cacheVersion) queryCache.set(key, data);
    return data;
  }).finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

/**
 * Minimal data hook: runs `fetcher` when `key` changes and exposes loading/error/empty state.
 * `setData` allows optimistic updates; `reload` refetches without clearing current data.
 *
 * @template T
 * @param {string | null} key  null skips the request
 * @param {() => Promise<T>} fetcher
 */
export function useQuery(key, fetcher) {
  const [state, setState] = useState(() => ({
    key,
    data: key === null ? undefined : queryCache.get(key),
    error: null,
    loading: Boolean(key && !queryCache.has(key)),
  }));
  const requestId = useRef(0);
  const keyRef = useRef(key);
  const currentFetcherRef = useRef(fetcher);
  currentFetcherRef.current = fetcher;
  keyRef.current = key;

  const run = useCallback(async ({ keepData } = {}) => {
    const currentKey = keyRef.current;
    const id = ++requestId.current;
    if (currentKey === null) return undefined;
    const version = cacheVersion;
    const cached = queryCache.get(currentKey);
    setState((s) => ({
      key: currentKey,
      data: keepData ? (s.key === currentKey ? s.data : cached) : cached,
      error: null,
      loading: !queryCache.has(currentKey),
    }));
    try {
      const data = await fetchQuery(currentKey, () => currentFetcherRef.current());
      if (id === requestId.current && version === cacheVersion) setState({ key: currentKey, data, error: null, loading: false });
      return data;
    } catch (error) {
      if (id === requestId.current && version === cacheVersion) setState((s) => ({
        key: currentKey,
        data: s.key === currentKey ? s.data : queryCache.get(currentKey),
        error,
        loading: false,
      }));
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (key === null) return;
    run();
  }, [key, run]);

  const setData = useCallback((updater) => {
    const currentKey = keyRef.current;
    setState((s) => {
      const currentData = s.key === currentKey ? s.data : queryCache.get(currentKey);
      const data = typeof updater === 'function' ? updater(currentData) : updater;
      if (currentKey !== null) queryCache.set(currentKey, data);
      return { ...s, key: currentKey, data };
    });
  }, []);

  const reload = useCallback(() => run({ keepData: true }), [run]);

  const visibleState = state.key === key
    ? state
    : { key, data: key === null ? undefined : queryCache.get(key), error: null, loading: Boolean(key && !queryCache.has(key)) };
  return { data: visibleState.data, error: visibleState.error, loading: visibleState.loading, setData, reload };
}
