import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

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
  mode?: string;          // payment mode (Cash, UPI, etc.)
  docType?: string;       // expense doc type (Invoice, Bill, etc.)
  status: string;
  attachment?: RecordFileAttachment;
};

type RecordsContextType = {
  records: UnifiedRecord[];
  attachFile: (id: string, file: RecordFileAttachment) => void;
  refreshRecords: () => void;
};

const RecordsContext = createContext<RecordsContextType | null>(null);

function mergeRecords(): UnifiedRecord[] {
  const result: UnifiedRecord[] = [];

  // --- Payment records ---
  try {
    const raw = localStorage.getItem("paymentData");
    if (raw) {
      const payments = JSON.parse(raw);
      for (const p of payments) {
        result.push({
          id: p.id,
          docNumber: p.id,
          date: p.docDate,
          entryType: "Payment",
          project: p.projectName || "",
          amount: p.amount || 0,
          mode: p.mode,
          status: p.status || "pending",
        });
      }
    }
  } catch {}

  // --- Expense records ---
  try {
    const raw = localStorage.getItem("expenseBookingData");
    if (raw) {
      const expenses = JSON.parse(raw);
      for (const e of expenses) {
        result.push({
          id: e.id,
          docNumber: e.id,
          date: e.docDate,
          entryType: "Expense",
          project: e.projectName || "",
          amount: e.amount || 0,
          docType: e.docType,
          status: e.status || "pending",
        });
      }
    }
  } catch {}

  // Sort newest first
  return result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function RecordsProvider({ children }: { children: React.ReactNode }) {
  const [records, setRecords] = useState<UnifiedRecord[]>([]);

  const refreshRecords = useCallback(() => {
    const merged = mergeRecords();
    // Merge in any existing attachments stored separately
    const attachments: Record<string, RecordFileAttachment> = JSON.parse(
      localStorage.getItem("recordAttachments") || "{}"
    );
    const withAttachments = merged.map((r) =>
      attachments[r.id] ? { ...r, attachment: attachments[r.id] } : r
    );
    setRecords(withAttachments);
  }, []);

  useEffect(() => {
    refreshRecords();
  }, [refreshRecords]);

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
    <RecordsContext.Provider value={{ records, attachFile, refreshRecords }}>
      {children}
    </RecordsContext.Provider>
  );
}

export function useRecords() {
  const ctx = useContext(RecordsContext);
  if (!ctx) throw new Error("useRecords must be used inside RecordsProvider");
  return ctx;
}
