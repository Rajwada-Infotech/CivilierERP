import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";

export type RecordFileAttachment = {
  name: string;
  type: string;
  size: number;
  dataUrl: string; // base64
  uploadedAt: string;
};

export type UnifiedRecord = {
  id: string;
  docNumber: string;
  date: string;           // ISO string
  entryType: "Payment" | "Expense" | "Receipt";
  project: string;
  amount: number;
  mode?: string;
  docType?: string;
  status: string;
  attachment?: RecordFileAttachment;
};

type RecordsContextType = {
  records: UnifiedRecord[];
  loading: boolean;
  error: string | null;
  attachFile: (id: string, file: RecordFileAttachment) => void;
  refreshRecords: () => void;
};

const RecordsContext = createContext<RecordsContextType | null>(null);

// Walk all pages of a paginated endpoint
async function fetchAllPages(
  baseUrl: string,
  signal: AbortSignal
): Promise<Record<string, unknown>[]> {
  let page = 1;
  let totalPages = 1;
  const all: Record<string, unknown>[] = [];

  while (page <= totalPages) {
    const res = await fetchWithAuth(
      `${baseUrl}?page=${page}&limit=100`,
      { signal }
    );
    if (!res.ok) throw new Error(`${baseUrl} failed: ${res.status}`);
    const json = await res.json();
    const rows = Array.isArray(json) ? json : (json.data ?? []);
    all.push(...rows);
    totalPages = json.totalPages ?? 1;
    page++;
  }
  return all;
}

function mapPayment(p: Record<string, unknown>): UnifiedRecord {
  return {
    id: String(p.PPaymentID ?? ""),
    docNumber: String(p.PPaymentName ?? p.PPaymentID ?? ""),
    date: String(p.PDate ?? ""),
    entryType: "Payment",
    project: String(p.PProject ?? ""),
    amount: Number(p.PAmount ?? 0),
    mode: p.PMode ? String(p.PMode) : undefined,
    docType: p.PDocType ? String(p.PDocType) : undefined,
    status: "pending",
  };
}

function mapExpense(e: Record<string, unknown>): UnifiedRecord {
  return {
    id: String(e.Eid ?? ""),
    docNumber: String(e.EDocNo ?? e.Eid ?? ""),
    date: String(e.EDocDate ?? ""),
    entryType: "Expense",
    project: String(e.EProjectName ?? ""),
    amount: Number(e.EAmount ?? 0),
    docType: e.EDocumentType ? String(e.EDocumentType) : undefined,
    status: String(e.EStatus ?? "pending"),
  };
}

export function RecordsProvider({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  // Only fetch for roles that have Finance module access.
  // Others (customer, engineer, site_engineer, etc.) get 403 on these endpoints.
  const FINANCE_ROLES = ["admin", "super_admin", "dba", "finance_manager", "branch_manager"];
  const isCustomer = !currentUser || !FINANCE_ROLES.includes(currentUser.role);
  const [records, setRecords] = useState<UnifiedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (isCustomer) {
      setRecords([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    // Load saved attachments (still local — blob storage is task #26)
    const attachments: Record<string, RecordFileAttachment> = JSON.parse(
      localStorage.getItem("recordAttachments") || "{}"
    );

    Promise.all([
      fetchAllPages("/api/new-payment", controller.signal),
      fetchAllPages("/api/expense-booking", controller.signal),
    ])
      .then(([payments, expenses]) => {
        const merged: UnifiedRecord[] = [
          ...payments.map((p) => mapPayment(p as Record<string, unknown>)),
          ...expenses.map((e) => mapExpense(e as Record<string, unknown>)),
        ]
          .map((r) =>
            attachments[r.id] ? { ...r, attachment: attachments[r.id] } : r
          )
          .sort(
            (a, b) =>
              new Date(b.date).getTime() - new Date(a.date).getTime()
          );

        setRecords(merged);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError(err.message ?? "Failed to load records");
        setLoading(false);
      });

    return () => controller.abort();
  }, [tick, isCustomer]);

  const refreshRecords = useCallback(() => setTick((t) => t + 1), []);

  const attachFile = useCallback((id: string, file: RecordFileAttachment) => {
    const attachments: Record<string, RecordFileAttachment> = JSON.parse(
      localStorage.getItem("recordAttachments") || "{}"
    );
    attachments[id] = file;
    localStorage.setItem("recordAttachments", JSON.stringify(attachments));
    setRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, attachment: file } : r))
    );
  }, []);

  return (
    <RecordsContext.Provider
      value={{ records, loading, error, attachFile, refreshRecords }}
    >
      {children}
    </RecordsContext.Provider>
  );
}

export { RecordsContext }
  
// useRecords moved to src/hooks/useRecords.ts for HMR compatibility
// import { useRecords } from '@/hooks/useRecords'


