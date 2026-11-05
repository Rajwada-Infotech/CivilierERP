import React, { useEffect, useState } from "react";
import { fmtIstDateTime } from "@/lib/istTime";
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
    return <td className="px-2.5 py-1.5 text-right tabular-nums font-semibold text-foreground">{fmtNum(after)}</td>;
  }
  if (after == null && before != null) {
    return <td className="px-2.5 py-1.5 text-right tabular-nums text-destructive line-through">{fmtNum(before)}</td>;
  }
  if (before === after) {
    return <td className="px-2.5 py-1.5 text-right tabular-nums text-muted-foreground">{fmtNum(after)}</td>;
  }
  return (
    <td className="px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap">
      <span className="text-destructive line-through">{fmtNum(before)}</span>
      <span className="text-muted-foreground"> → </span>
      <span className="font-semibold text-foreground">{fmtNum(after)}</span>
    </td>
  );
}

const TH = "px-2.5 py-2 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

function ItemsDiffTable({ entries }: { entries: ItemDiffEntry[] }) {
  return (
    <div className="overflow-x-auto" style={{ border: "1px solid hsl(var(--border))" }}>
      <table className="w-full text-[0.6875rem] min-w-[420px]">
        <thead>
          <tr style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
            <th className={`text-left ${TH}`}>Item</th>
            <th className={`text-right ${TH}`}>Quantity</th>
            <th className={`text-right ${TH}`}>Rate</th>
            <th className={`text-right ${TH}`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.key} style={{ borderTop: "1px solid hsl(var(--border) / 0.6)" }}>
              <td className="px-2.5 py-1.5">
                <div className="font-medium">{e.name}</div>
                {e.unit && <div className="text-[0.625rem] text-muted-foreground">{e.unit}</div>}
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

// Timestamps come from the database clock (UTC) — always shown in IST (+5:30).
function fmtDateTime(value: string | null) {
  return fmtIstDateTime(value);
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
        <span className="font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground">{String(getValue() || "—")}</span>
      ),
    },
    {
      id: "Document",
      accessorFn: (row) => `${row.RefDocLabel} ${row.RefDocNo ?? ""}`,
      header: "Document",
      size: 220,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground truncate">{row.original.RefDocLabel}</p>
          <p className="font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground truncate mt-1">{row.original.RefDocNo || "—"}</p>
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
          <p className="truncate text-xs font-medium text-foreground">{row.original.CreatedBy || "—"}</p>
          <p className="text-[0.6875rem] text-muted-foreground truncate tabular-nums mt-0.5">
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
            className="p-1.5 border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
            title="View field changes"
          >
            <FileDiff size={13} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <Shell
      title={title}
      subtitle="Every change made to a document after it was approved: what it was, what it is now, who changed it and when."
      icon={History}
    >
      <Breadcrumbs items={[{ label: title }]} />

      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-4">
          {(() => {
            const month = new Date().toISOString().slice(0, 7);
            return [
              { label: "Amendments", value: rows.length, note: "recorded in all" },
              { label: "This month", value: rows.filter((r) => String(r.CreatedAt || "").slice(0, 7) === month).length, note: "since the 1st" },
              { label: "Documents changed", value: new Set(rows.map((r) => `${r.RefDocLabel}|${r.RefDocNo}`)).size, note: "distinct documents" },
              { label: "People", value: new Set(rows.map((r) => r.CreatedBy).filter(Boolean)).size, note: "made a change" },
            ];
          })().map((x, i) => (
            <div key={x.label} className={i ? "sm:pl-5 sm:border-l sm:border-border" : ""}>
              <p className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{x.label}</p>
              <p className="font-heading text-2xl sm:text-[1.75rem] font-semibold tabular-nums tracking-tight text-foreground leading-none mt-2">{x.value.toLocaleString("en-IN")}</p>
              <p className="text-[0.6875rem] text-muted-foreground mt-1.5">{x.note}</p>
            </div>
          ))}
        </div>
      )}

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
            <div className="flex items-end justify-between gap-3 pb-3" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
              <div className="min-w-0">
                <p className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Amendment{detail ? ` · ${detail.RefDocLabel}` : ""}
                </p>
                <DialogTitle className="font-heading text-lg font-bold tabular-nums tracking-tight mt-1">{detail?.AmendmentNo || "Loading…"}</DialogTitle>
              </div>
              <button onClick={() => setDetail(null)} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Close">
                <X size={16} />
              </button>
            </div>
          </DialogHeader>

          {detail && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-3">
                {[
                  { l: "Document", v: detail.RefDocNo || "—" },
                  { l: "Project", v: detail.ProjectName || "—" },
                  { l: "Changed by", v: detail.CreatedBy || "—" },
                  { l: "Changed at", v: fmtDateTime(detail.CreatedAt) },
                ].map((x) => (
                  <div key={x.l} className="min-w-0">
                    <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{x.l}</p>
                    <p className="text-[0.8125rem] font-medium text-foreground mt-1 break-words">{x.v}</p>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto" style={{ border: "1px solid hsl(var(--foreground))" }}>
                <table className="w-full text-xs min-w-[420px]">
                  <thead>
                    <tr style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
                      <th className={`text-left ${TH}`} style={{ paddingLeft: 12 }}>Field</th>
                      <th className={`text-left ${TH}`}>Was</th>
                      <th className={`text-left ${TH}`}>Now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.changes.map((c) => {
                      const oldItems = tryParseItems(c.OldValue);
                      const newItems = tryParseItems(c.NewValue);
                      if (oldItems || newItems) {
                        return (
                          <tr key={c.Id} style={{ borderTop: "1px solid hsl(var(--border) / 0.6)" }}>
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
                        <tr key={c.Id} style={{ borderTop: "1px solid hsl(var(--border) / 0.6)" }}>
                          <td className="px-3 py-2 font-medium">{c.FieldLabel || c.FieldName}</td>
                          <td className="px-3 py-2 text-destructive line-through decoration-destructive/60 break-all tabular-nums">
                            {fmtCellValue(c.OldValue)}
                          </td>
                          <td className="px-3 py-2 font-semibold text-foreground break-all tabular-nums">
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
