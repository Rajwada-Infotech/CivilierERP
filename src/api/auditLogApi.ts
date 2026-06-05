import { fetchWithAuth } from "@/lib/fetchWithAuth";

export interface AuditEntry {
  Id: number;
  Module: string;
  RecordId: number;
  RecordNo: string | null;
  Action: string; // Created | Updated | Deleted | Escalated | StepUpdate
  ChangedBy: string;
  ChangedAt: string;
  Changes: AuditChange[] | null;
}

export interface AuditChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export async function fetchAuditLog(
  module: string,
  recordId: number
): Promise<AuditEntry[]> {
  const res = await fetchWithAuth(
    `/api/followup-audit-log?module=${encodeURIComponent(module)}&recordId=${recordId}`
  );
  if (!res.ok) throw new Error("Failed to fetch audit log");
  const data = await res.json();
  // Parse Changes JSON string if needed
  return (data.entries ?? data ?? []).map((e: any) => ({
    ...e,
    Changes:
      typeof e.Changes === "string"
        ? (() => {
            try {
              return JSON.parse(e.Changes);
            } catch {
              return null;
            }
          })()
        : e.Changes ?? null,
  }));
}