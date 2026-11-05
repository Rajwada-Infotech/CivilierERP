import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// A single attachment as returned by GET /api/records — already normalized across every source module (Ticket,
// Vehicle In/Out, GRN, Loan, Contract, Personal Vault, and any future module registered in
// backend/routes/recordsRoutes.js).
export type UnifiedRecord = {
  /** Composite key: `${source}-${sourceId}` */
  id: string;
  source: string; // "ticket" | "vehicle" | "grn" | "loan-noc" | "loan-document" | "contract" | "personal"
  sourceId: number;
  module: string; // human-readable module name, e.g. "Ticket"
  docRef: string; // e.g. "TKT-104", "VEH-2026-00031"
  docLabel: string; // e.g. ticket subject, vehicle number
  filename: string;
  mimeType: string;
  size: number;
  uploadedBy: string | null;
  uploadedAt: string; // ISO string
  url: string; // streams the file from its original module's endpoint
  /** True when the source document was deleted and this file is in its 7-day grace window (Contract only). */
  pendingDeletion?: boolean;
  /** ISO string — when this file will actually be purged, if pendingDeletion. */
  purgeAt?: string | null;
};

type RecordsPayload = { records: UnifiedRecord[]; failed: string[] };

const KEY = ["records"];

// Loaded only while the Records page is open (it used to be fetched for every user on every app load by a
// provider wrapped around the whole app, though nothing else read it).
export function useRecords() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<RecordsPayload>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/records");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load records (${res.status})`);
      const rows: Omit<UnifiedRecord, "id">[] = Array.isArray(body) ? body : (body.data ?? []);
      return {
        records: rows.map((r) => ({ ...r, id: `${r.source}-${r.sourceId}` })),
        // Sources that failed on the server (the rest still load) — shown, not swallowed.
        failed: Array.isArray(body.partialFailure) ? body.partialFailure : [],
      };
    },
    staleTime: 30_000,
  });
  return {
    records: data?.records ?? [],
    failedSources: data?.failed ?? [],
    loading: isLoading,
    error: error ? (error as Error).message : null,
    refreshRecords: () => queryClient.invalidateQueries({ queryKey: KEY }),
  };
}
