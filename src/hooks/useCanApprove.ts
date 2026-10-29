import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

/**
 * May the signed-in user approve in this module — and, with a recordId, act
 * on that record right now? Approval Setup is the only source of approvers,
 * so this asks the server (GET /api/approval-workflows/can-act) instead of
 * keeping role lists in the frontend. Without a recordId the answer is "named
 * on any step of the module". False while loading or when `enabled` is off.
 */
export function useCanApprove(module: string | undefined, recordId?: string | number, enabled = true): boolean {
  const { data = false } = useQuery({
    queryKey: ["approval-can-act", module, recordId == null ? "" : String(recordId)],
    queryFn: async () => {
      const qs = new URLSearchParams({ module: module! });
      if (recordId != null && recordId !== "") qs.set("recordId", String(recordId));
      const r = await fetchWithAuth(`/api/approval-workflows/can-act?${qs}`);
      return r.ok ? Boolean((await r.json()).canAct) : false;
    },
    enabled: enabled && !!module,
    staleTime: 30_000,
  });
  return data;
}
