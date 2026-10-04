// Batches GET /api/approval-workflows/trail for every visible row of a list
// page into ONE request instead of one-per-row. A list with N rows each
// mounting its own <ApprovalStatusChain> used to fire N concurrent GET
// /trail calls on every render — on a page like Material Request (~36
// rows) that alone was enough to trip the per-user API rate limit, and
// ApprovalStatusChain's own `fallback` prop silently swapped in a plain
// status pill instead of surfacing the error, which looked like the
// richer badge randomly "reverting" rather than being rate-limited.
//
// Usage: const { trails, isLoading } = useApprovalTrailsBulk("MaterialRequests", mrIds);
// then per row: <ApprovalStatusChain preloaded={trails.get(row.MRId) ?? null} preloadedLoading={isLoading} ... />
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { ApprovalTable, TrailData } from "@/components/ApprovalStatusChain";

export function useApprovalTrailsBulk(table: ApprovalTable, ids: Array<number | string | null | undefined>) {
  const cleanIds = [...new Set(ids.filter((id): id is number | string => id != null))].map(String);
  const key = cleanIds.slice().sort().join(",");

  const { data, isLoading } = useQuery({
    queryKey: ["approval-trail-bulk", table, key],
    queryFn: async (): Promise<Record<string, TrailData | null>> => {
      const res = await fetchWithAuth(
        `/api/approval-workflows/trail/bulk?module=${table}&ids=${cleanIds.join(",")}`,
      );
      if (!res.ok) return {};
      const body = await res.json().catch(() => ({}));
      return body && typeof body === "object" ? body : {};
    },
    enabled: cleanIds.length > 0,
    staleTime: 30_000,
  });

  const trails = new Map<string, TrailData | null>();
  if (data) {
    for (const id of cleanIds) {
      const entry = data[id];
      trails.set(id, entry && Array.isArray(entry.steps) ? entry : null);
    }
  }

  return {
    trails,
    isLoading: isLoading && cleanIds.length > 0,
  };
}
