import { useEffect, useState } from "react";
import { History, PlusCircle, Pencil, Trash2 } from "lucide-react";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import { getAuditTrail, type AuditTrailEntry } from "@/api/auditTrailApi";
import { toast } from "sonner";

function fmtDateTime(value: string) {
  // Backend timestamps come from SQL Server's SYSUTCDATETIME() but are
  // JSON-serialized with a trailing "Z" — stripping it makes Date parse it
  // as the plain wall-clock time it actually is, matching the rest of the
  // app's amendment/audit displays.
  const naive = value.replace(/Z$/, "");
  const d = new Date(naive);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const ACTION_META: Record<AuditTrailEntry["Action"], { label: string; icon: typeof PlusCircle; className: string }> = {
  CREATE: { label: "Created", icon: PlusCircle, className: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" },
  UPDATE: { label: "Updated", icon: Pencil, className: "text-amber-600 dark:text-amber-400 bg-amber-500/10" },
  DELETE: { label: "Deleted", icon: Trash2, className: "text-red-600 dark:text-red-400 bg-red-500/10" },
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
    if (entry.Action === "CREATE") {
      return `Name: ${parsed.Name ?? "—"}, Code: ${parsed.Code ?? "—"}`;
    }
    if (entry.Action === "DELETE") {
      return `Name: ${parsed.Name ?? "—"}, Code: ${parsed.Code ?? "—"}`;
    }
    return JSON.stringify(parsed);
  } catch {
    return entry.Details;
  }
}

export default function AccountGroupAuditTrail() {
  usePageRights("account-group-audit-trail");
  const [rows, setRows] = useState<AuditTrailEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, []);

  const columns: ColumnDef<AuditTrailEntry, unknown>[] = [
    {
      id: "Action",
      accessorKey: "Action",
      header: "Action",
      size: 110,
      cell: ({ getValue }) => {
        const action = getValue() as AuditTrailEntry["Action"];
        const meta = ACTION_META[action];
        const Icon = meta.icon;
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.className}`}>
            <Icon size={11} /> {meta.label}
          </span>
        );
      },
    },
    {
      id: "EntityName",
      accessorKey: "EntityName",
      header: "Account Group",
      size: 180,
      cell: ({ getValue }) => <span className="font-medium truncate block">{String(getValue() || "—")}</span>,
    },
    {
      id: "Details",
      header: "What changed",
      size: 320,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground break-words">{summarizeDetails(row.original)}</span>
      ),
    },
    {
      id: "UserName",
      accessorKey: "UserName",
      header: "User",
      size: 150,
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
    <FinanceShell
      title="Audit Trail"
      subtitle="Who created, edited, or deleted an Account Group entry, and when."
      icon={History}
    >
      <Breadcrumbs items={[{ label: "Account Group" }, { label: "Audit Trail" }]} />

      <DataTable
        data={rows}
        columns={columns}
        loading={loading}
        searchable
        searchPlaceholder="Search by group name, user..."
        emptyMessage="No account group activity recorded yet."
      />
    </FinanceShell>
  );
}
