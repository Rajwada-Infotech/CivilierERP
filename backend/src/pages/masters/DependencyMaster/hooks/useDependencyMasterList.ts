import { useState, useCallback } from "react";
import { getDependencyMaster, type DependencyMasterDetail } from "@/api/dependencyMasterApi";

/** Expand/collapse state for the list rows, plus a per-id cache of the full
 * detail (with activity chain) — a row's chain is only ever fetched once,
 * re-toggling collapse/expand afterwards reads straight from cache. */
export function useDependencyMasterList() {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [cache, setCache] = useState<Map<number, DependencyMasterDetail>>(new Map());
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const toggle = useCallback(
    async (id: number) => {
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(id);
      if (cache.has(id)) return; // already fetched — render from cache

      setLoadingId(id);
      try {
        const detail = await getDependencyMaster(id);
        setCache((prev) => new Map(prev).set(id, detail));
      } catch {
        // leave uncached — the row shows a load-failed state and can retry
        // on the next toggle
        setExpandedId(null);
      } finally {
        setLoadingId(null);
      }
    },
    [expandedId, cache],
  );

  // Drop a row from cache (e.g. after it's edited) so the next expand
  // re-fetches fresh data instead of showing the stale chain.
  const invalidate = useCallback((id: number) => {
    setCache((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  return {
    expandedId,
    toggle,
    loadingId,
    getCached: (id: number) => cache.get(id) ?? null,
    invalidate,
  };
}
