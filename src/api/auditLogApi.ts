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

// Raw flat row as returned by the backend (one row per field change)
interface RawAuditRow {
  Id: number;
  Module: string;
  RecordId: number;
  RecordNo: string | null;
  Action: string;
  FieldName: string | null;
  OldValue: string | null;
  NewValue: string | null;
  StepName: string | null;
  Notes: string | null;
  ChangedBy: string;
  ChangedAt: string;
}

/**
 * The backend stores one row per field change (flat model).
 * We group rows by (Action + ChangedBy + ChangedAt) to produce
 * one AuditEntry per event with a Changes[] array.
 */
function groupRawRows(rows: RawAuditRow[]): AuditEntry[] {
  // Use a Map keyed by "Action|ChangedBy|ChangedAt" to preserve insertion order.
  // The query returns rows DESC so the first row seen for a group is the one
  // with the lowest Id — we keep that as the representative Id for the entry.
  const map = new Map<string, AuditEntry>();

  for (const row of rows) {
    const key = `${row.Action}|${row.ChangedBy}|${row.ChangedAt}`;
    if (!map.has(key)) {
      map.set(key, {
        Id: row.Id,
        Module: row.Module,
        RecordId: row.RecordId,
        RecordNo: row.RecordNo,
        Action: row.Action,
        ChangedBy: row.ChangedBy,
        ChangedAt: row.ChangedAt,
        Changes: [],
      });
    }
    // Append field-level change if present
    if (row.FieldName) {
      map.get(key)!.Changes!.push({
        field: row.FieldName,
        oldValue: row.OldValue,
        newValue: row.NewValue,
      });
    }
  }

  // Collapse entries with no field changes to Changes: null
  return Array.from(map.values()).map((e) => ({
    ...e,
    Changes: e.Changes && e.Changes.length > 0 ? e.Changes : null,
  }));
}

export async function fetchAuditLog(
  module: string,
  recordId: number
): Promise<AuditEntry[]> {
  const res = await fetchWithAuth(
    `/api/followup-audit-log?module=${encodeURIComponent(module)}&recordId=${recordId}`
  );
  if (!res.ok) throw new Error("Failed to fetch audit log");
  const data = await res.json().catch(() => ({}));

  // Backend returns { data: RawAuditRow[], pagination: {...} }
  const rows: RawAuditRow[] = Array.isArray(data.data) ? data.data : [];
  return groupRawRows(rows);
}