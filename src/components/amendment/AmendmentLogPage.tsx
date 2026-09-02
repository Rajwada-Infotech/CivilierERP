import React, { useEffect, useState } from "react";
import { History, X, FileDiff } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getAmendments,
  getAmendmentDetail,
  type AmendmentModule,
  type AmendmentRecord,
  type AmendmentDetail,
} from "@/api/amendmentLogApi";
import { toast } from "sonner";

// Several doc types (PO, GRN, Material Request, ...) store their line items
// as a JSON-blob column, which the generic full-row diff in amendmentLog.js
// then dumps as raw stringified JSON — unreadable in the audit trail. Detect
// that shape and render it as an item-by-item quantity/rate/amount diff
// instead of the JSON text.
function tryParseItems(value: string | null): any[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.some(
        (p) => p && typeof p === "object" && ("itemDescription" in p || "description" in p) && "amount" in p,
      )
    ) {
      return parsed;
    }
  } catch {
    /* not JSON — falls through to plain text rendering */
  }
  return null;
}

function itemKey(item: any, idx: number): string {
  return item?.itemId || item?.mrItemId || item?.ItemId || String(idx);
}

function numOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

interface ItemDiffEntry {
  key: string;
  name: string;
  unit: string;
  before: { quantity: number | null; rate: number | null; amount: number | null } | null;
  after: { quantity: number | null; rate: number | null; amount: number | null } | null;
}

function diffItems(oldArr: any[] | null, newArr: any[] | null): ItemDiffEntry[] {
  const map = new Map<string, ItemDiffEntry>();
  (oldArr || []).forEach((it, i) => {
    map.set(itemKey(it, i), {
      key: itemKey(it, i),
      name: it.itemDescription || it.description || "—",
      unit: it.unit || "",
      before: { quantity: numOrNull(it.quantity), rate: numOrNull(it.rate), amount: numOrNull(it.amount) },
      after: null,
    });
  });
  (newArr || []).forEach((it, i) => {
    const key = itemKey(it, i);
    const existing = map.get(key);
    const after = { quantity: numOrNull(it.quantity), rate: numOrNull(it.rate), amount: numOrNull(it.amount) };
    if (existing) {
      existing.after = after;
    } else {
      map.set(key, { key, name: it.itemDescription || it.description || "—", unit: it.unit || "", before: null, after });
    }
  });
  return Array.from(map.values());
}

function fmtNum(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function DiffCell({ before, after }: { before: number | null; after: number | null }) {
  if (before == null && after != null) {
    return <td className="px-2.5 py-1.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{fmtNum(after)}</td>;
  }
  if (after == null && before != null) {
    return <td className="px-2.5 py-1.5 text-right tabular-nums text-red-600 dark:text-red-400 line-through">{fmtNum(before)}</td>;
  }
  if (before === after) {
    return <td className="px-2.5 py-1.5 text-right tabular-nums">{fmtNum(after)}</td>;
  }
  return (
    <td className="px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap">
      <span className="text-red-600 dark:text-red-400 line-through">{fmtNum(before)}</span>
      {" → "}
      <span className="text-emerald-600 dark:text-emerald-400 font-medium">{fmtNum(after)}</span>
    </td>
  );
}

function ItemsDiffTable({ entries }: { entries: ItemDiffEntry[] }) {
  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <table className="w-full text-[11px] min-w-[420px]">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left px-2.5 py-1.5 font-medium text-muted-foreground">Item</th>
            <th className="text-right px-2.5 py-1.5 font-medium text-muted-foreground">Quantity</th>
            <th className="text-right px-2.5 py-1.5 font-medium text-muted-foreground">Rate</th>
            <th className="text-right px-2.5 py-1.5 font-medium text-muted-foreground">Amount</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.key} className="border-t border-border/60">
              <td className="px-2.5 py-1.5">
                <div className="font-medium">{e.name}</div>
                {e.unit && <div className="text-[10px] text-muted-foreground">{e.unit}</div>}
              </td>
              <DiffCell before={e.before?.quantity ?? null} after={e.after?.quantity ?? null} />
              <DiffCell before={e.before?.rate ?? null} after={e.after?.rate ?? null} />
              <DiffCell before={e.before?.amount ?? null} after={e.after?.amount ?? null} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Plain (non-items) field values: format numeric-looking strings with
// thousands separators so amounts/rates/quantities read cleanly instead of
// as a raw digit string.
function fmtCellValue(v: string | null): string {
  if (v == null || v === "") return "—";
  if (/^-?\d+(\.\d+)?$/.test(v.trim())) {
    return Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }
  return v;
}

function fmtDateTime(value: string | null) {
  if (!value) return "—";
  // Backend timestamps here come from SQL Server's SYSDATETIME(), which is
  // timezone-naive wall-clock IST — but gets JSON-serialized with a
  // trailing "Z" as if it were UTC. Parsing that at face value would make
  // the browser "correct" it by adding another +5:30 on top of a value
  // that's already IST. Stripping the "Z" makes Date parse it as a plain
  // local wall-clock time instead, so it displays as recorded.
  const naive = value.replace(/Z$/, "");
  const d = new Date(naive);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ShellProps {
  title: string;
  subtitle?: React.ReactNode;
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
}

interface Props {
  module: AmendmentModule;
  title: string;
  Shell: React.ComponentType<ShellProps>;
}

export function AmendmentLogPage({ module, title, Shell }: Props) {
  const [rows, setRows] = useState<AmendmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AmendmentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAmendments(module)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err) => {
        if (!cancelled) toast.error(err.message || "Failed to load amendments.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [module]);

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      const d = await getAmendmentDetail(id);
      setDetail(d);
    } catch (err: any) {
      toast.error(err.message || "Failed to load amendment detail.");
    } finally {
      setDetailLoading(false);
    }
  };

  const columns: ColumnDef<AmendmentRecord, unknown>[] = [
    {
      id: "AmendmentNo",
      accessorKey: "AmendmentNo",
      header: "Amendment No",
      size: 130,
      cell: ({ getValue }) => (
        <span className="font-mono text-xs font-semibold text-violet-600 dark:text-violet-400">
          {String(getValue() || "—")}
        </span>
      ),
    },
    {
      id: "Document",
      accessorFn: (row) => `${row.RefDocLabel} ${row.RefDocNo ?? ""}`,
      header: "Document",
      size: 220,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate">{row.original.RefDocLabel}</p>
          <p className="font-mono text-[11px] text-muted-foreground truncate">
            {row.original.RefDocNo || "—"}
          </p>
        </div>
      ),
    },
    {
      id: "ProjectName",
      accessorKey: "ProjectName",
      header: "Project",
      size: 130,
      cell: ({ getValue }) => (
        <span className="truncate block">{String(getValue() || "—")}</span>
      ),
    },
    {
      id: "Description",
      accessorKey: "Description",
      header: "Summary",
      size: 180,
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-xs truncate block">
          {String(getValue() || "—")}
        </span>
      ),
    },
    {
      id: "Changed",
      accessorFn: (row) => `${row.CreatedBy ?? ""} ${row.CreatedAt}`,
      header: "Changed",
      size: 170,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate text-xs">{row.original.CreatedBy || "—"}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {fmtDateTime(row.original.CreatedAt)}
          </p>
        </div>
      ),
    },
    {
      id: "actions",
      header: () => <div className="text-right">Details</div>,
      size: 70,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => openDetail(row.original.Id)}
            className="p-1.5 rounded-lg text-violet-500 hover:bg-violet-500/10 transition-colors"
            title="View field changes"
          >
            <FileDiff size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <Shell
      title={title}
      subtitle="Audit trail of edits made to already-approved documents."
      icon={History}
    >
      <Breadcrumbs items={[{ label: title }]} />

      <DataTable
        data={rows}
        columns={columns}
        loading={loading}
        searchable
        searchPlaceholder="Search amendments..."
        emptyMessage="No amendments recorded yet."
      />

      <Dialog open={!!detail || detailLoading} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" hideCloseButton>
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="font-mono text-sm">
                {detail?.AmendmentNo || "Loading..."}
              </DialogTitle>
              <button
                onClick={() => setDetail(null)}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
              >
                <X size={16} />
              </button>
            </div>
          </DialogHeader>

          {detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground">Document</p>
                  <p className="font-medium">{detail.RefDocLabel} — {detail.RefDocNo || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Changed By</p>
                  <p className="font-medium">{detail.CreatedBy || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Changed At</p>
                  <p className="font-medium">{fmtDateTime(detail.CreatedAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Project</p>
                  <p className="font-medium">{detail.ProjectName || "—"}</p>
                </div>
              </div>

              <div className="rounded-lg border border-border overflow-x-auto">
                <table className="w-full text-xs min-w-[420px]">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Field</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Before</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.changes.map((c) => {
                      const oldItems = tryParseItems(c.OldValue);
                      const newItems = tryParseItems(c.NewValue);
                      if (oldItems || newItems) {
                        return (
                          <tr key={c.Id} className="border-t border-border">
                            <td className="px-3 py-2 font-medium align-top whitespace-nowrap">
                              {c.FieldLabel || c.FieldName}
                            </td>
                            <td colSpan={2} className="px-3 py-2">
                              <ItemsDiffTable entries={diffItems(oldItems, newItems)} />
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={c.Id} className="border-t border-border">
                          <td className="px-3 py-2 font-medium">{c.FieldLabel || c.FieldName}</td>
                          <td className="px-3 py-2 text-red-600 dark:text-red-400 break-all tabular-nums">
                            {fmtCellValue(c.OldValue)}
                          </td>
                          <td className="px-3 py-2 text-emerald-600 dark:text-emerald-400 break-all tabular-nums">
                            {fmtCellValue(c.NewValue)}
                          </td>
                        </tr>
                      );
                    })}
                    {detail.changes.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">
                          No field changes recorded.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
