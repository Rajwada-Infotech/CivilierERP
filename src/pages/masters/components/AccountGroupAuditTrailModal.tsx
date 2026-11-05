import { useEffect, useState } from "react";
import { fmtIstDateTime } from "@/lib/istTime";
import { SheetMark } from "@/components/sheet/Sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { getAuditTrail, type AuditTrailEntry } from "@/api/auditTrailApi";
import { toast } from "sonner";

// SYSUTCDATETIME() serialised with a "Z" — read as UTC, shown in IST (+5:30).
function fmtDateTime(value: string) {
  return fmtIstDateTime(value, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const ACTION_META: Record<AuditTrailEntry["Action"], { label: string; tone: "done" | "waiting" | "stopped" }> = {
  CREATE: { label: "Created", tone: "done" },
  UPDATE: { label: "Updated", tone: "waiting" },
  DELETE: { label: "Deleted", tone: "stopped" },
};

function summarizeDetails(entry: AuditTrailEntry): string {
  if (!entry.Details) return "—";
  try {
    const parsed = JSON.parse(entry.Details);
    if (entry.Action === "UPDATE" && parsed?.before && parsed?.after) {
      const changed: string[] = [];
      for (const key of Object.keys(parsed.after)) {
        const beforeVal = parsed.before[key];
        const afterVal = parsed.after[key];
        if (String(beforeVal ?? "") !== String(afterVal ?? "")) {
          changed.push(`${key}: ${beforeVal ?? "—"} → ${afterVal ?? "—"}`);
        }
      }
      return changed.length ? changed.join("; ") : "No field changes";
    }
    if (entry.Action === "CREATE" || entry.Action === "DELETE") {
      return `Name: ${parsed.Name ?? "—"}, Code: ${parsed.Code ?? "—"}`;
    }
    return JSON.stringify(parsed);
  } catch {
    return entry.Details;
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
}

// Audit trail lives inside Account Group Master itself, not as its own
// menu entry — opened from a button on the page rather than navigated to.
export function AccountGroupAuditTrailModal({ open, onClose }: Props) {
  const [rows, setRows] = useState<AuditTrailEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getAuditTrail("AccountGroup")
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err) => {
        if (!cancelled) toast.error(err.message || "Failed to load audit trail.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const columns: ColumnDef<AuditTrailEntry, unknown>[] = [
    {
      id: "Action",
      accessorKey: "Action",
      header: "Action",
      size: 110,
      cell: ({ getValue }) => {
        const action = getValue() as AuditTrailEntry["Action"];
        const meta = ACTION_META[action];
        return <SheetMark text={meta.label} tone={meta.tone} />;
      },
    },
    {
      id: "EntityName",
      accessorKey: "EntityName",
      header: "Account Group",
      size: 160,
      cell: ({ getValue }) => <span className="font-medium truncate block">{String(getValue() || "—")}</span>,
    },
    {
      id: "Details",
      header: "What changed",
      size: 300,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground break-words">{summarizeDetails(row.original)}</span>
      ),
    },
    {
      id: "UserName",
      accessorKey: "UserName",
      header: "User",
      size: 140,
      cell: ({ getValue }) => <span className="truncate block">{String(getValue() || "—")}</span>,
    },
    {
      id: "CreatedAt",
      accessorKey: "CreatedAt",
      header: "Date & Time",
      size: 170,
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(String(getValue()))}</span>
      ),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sheet-frame sm:max-w-4xl max-h-[85vh] overflow-y-auto" style={{ margin: 0 }}>
        <DialogHeader>
          <div className="pb-3" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
            <p className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Account groups</p>
            <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Audit trail</DialogTitle>
          </div>
        </DialogHeader>

        <DataTable
          data={rows}
          columns={columns}
          loading={loading}
          searchable
          searchPlaceholder="Search by group name, user..."
          emptyMessage="No account group activity recorded yet."
        />
      </DialogContent>
    </Dialog>
  );
}
