import React, { createContext, useState, useEffect, useCallback } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";

// A single attachment as returned by GET /api/records — already normalized
// across every source module (Ticket, Vehicle In/Out, Document Vault, and
// any future module that registers itself in backend/routes/recordsRoutes.js).
export type UnifiedRecord = {
  /** Composite key: `${source}-${sourceId}`, stable for the DataTable's getRowId */
  id: string;
  source: string; // "ticket" | "vehicle" | "vault" | ...
  sourceId: number;
  module: string; // human-readable module name, e.g. "Ticket"
  docRef: string; // e.g. "TKT-104", "VEH-2026-00031", "DV000012"
  docLabel: string; // e.g. ticket subject, vehicle number, document name
  filename: string;
  mimeType: string;
  size: number;
  uploadedBy: string | null;
  uploadedAt: string; // ISO string
  url: string; // streams the file from its original module's endpoint
  /** True when the source document has been deleted and this file is
   *  inside its 7-day grace window before recordsRetentionService.js
   *  purges it for good (currently only set for Contract). */
  pendingDeletion?: boolean;
  /** ISO string — when this file will actually be purged, if pendingDeletion. */
  purgeAt?: string | null;
};

// Kept for backward compatibility with any code still importing the old
// localStorage-based attachment shape — no longer used internally.
export type RecordFileAttachment = {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  uploadedAt: string;
};

type RawRecord = {
  source: string;
  sourceId: number;
  module: string;
  docRef: string;
  docLabel: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedBy: string | null;
  uploadedAt: string;
  url: string;
  pendingDeletion?: boolean;
  purgeAt?: string | null;
};

type RecordsContextType = {
  records: UnifiedRecord[];
  loading: boolean;
  error: string | null;
  refreshRecords: () => void;
};

const RecordsContext = createContext<RecordsContextType | null>(null);

function mapRecord(r: RawRecord): UnifiedRecord {
  return {
    id: `${r.source}-${r.sourceId}`,
    source: r.source,
    sourceId: r.sourceId,
    module: r.module,
    docRef: r.docRef,
    docLabel: r.docLabel,
    filename: r.filename,
    mimeType: r.mimeType,
    size: r.size,
    uploadedBy: r.uploadedBy,
    uploadedAt: r.uploadedAt,
    url: r.url,
    pendingDeletion: r.pendingDeletion,
    purgeAt: r.purgeAt,
  };
}

export function RecordsProvider({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const [records, setRecords] = useState<UnifiedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!currentUser) {
      setRecords([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchWithAuth("/api/records", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body.error || `Failed to load records (${res.status})`,
          );
        }
        return res.json().catch(() => ({}));
      })
      .then((json) => {
        const rows: RawRecord[] = Array.isArray(json)
          ? json
          : (json.data ?? []);
        setRecords(rows.map(mapRecord));
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError(err.message ?? "Failed to load records");
        setLoading(false);
      });

    return () => controller.abort();
  }, [tick, currentUser]);

  const refreshRecords = useCallback(() => setTick((t) => t + 1), []);

  return (
    <RecordsContext.Provider
      value={{ records, loading, error, refreshRecords }}
    >
      {children}
    </RecordsContext.Provider>
  );
}

export { RecordsContext };

// useRecords moved to src/hooks/useRecords.ts for HMR compatibility
// import { useRecords } from '@/hooks/useRecords'
