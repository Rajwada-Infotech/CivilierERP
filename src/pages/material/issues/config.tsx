// Constants, types, small parts (field, godown badge, work-order comparison) shared by the Material Issues page and its parts.
import * as issuesApi from "@/api/issuesApi";
import { generateUUID } from "../../../utils/cryptoPolyfill";
import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Warehouse, ClipboardList } from "lucide-react";
import { type ExportColumn } from "@/lib/export";

export const ISSUES_EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Doc No", accessor: "DocNo" },
  // The issues list sends the date as "Date" (the page's own table reads that too); "IssueDate" is kept as a fallback.
  { header: "Date", accessor: (r) => {
    const d = (r.Date ?? r.IssueDate) as string | null | undefined;
    return d ? new Date(d).toLocaleDateString("en-IN") : "";
  } },
  { header: "Company", accessor: "CompanyName" },
  { header: "Project", accessor: "ProjectName" },
  { header: "Godown", accessor: "GodownName" },
  { header: "Status", accessor: "Status" },
];

// ─── Sheet styles ────────────────────────────────────────────────────────────────────────────────────────

export const inputCls =
  "w-full px-3 py-2.5 text-sm font-body bg-card border border-foreground/40 transition-colors focus:outline-none focus:border-foreground text-foreground placeholder:text-muted-foreground/60 disabled:opacity-60 [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:cursor-pointer";

export const selectCls =
  "w-full px-3 py-2.5 pr-8 text-sm font-body bg-card border border-foreground/40 transition-colors focus:outline-none focus:border-foreground text-foreground appearance-none disabled:opacity-60";

export const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
export const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
export const RULE = "1px solid hsl(var(--foreground))";
export const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
export const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
export const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
export const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground transition-colors disabled:opacity-40";
export const chip = (on: boolean) =>
  `${KEY} h-7 px-2.5 border ${on ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"}`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CartItem {
  _key: string;
  ItemId: string;
  UOMCode: string;
  Quantity: string;
  Remarks: string;
  ItemName?: string;
  AvailableStock?: number;
  DefaultUOM?: string;
  // From the selected item's own Item Master tag (M_CostCenterId) — same
  // auto-fill convention Purchase Order's line items already use.
  CostCenterId?: string;
}

export interface IssueHeader {
  companyId: string;
  projectId: string;
  finYearId: string;
  date: string;
  reason: string;
  remarks: string;
  godownId: string;
  docTypeId: number | null;
  docNoPreview: string;
  issuedTo: string;
  costCenter: string;
  blockId: string;
  floorNo: string;
  /** Work order this issue is tagged to ("" = none), and its number for display. */
  workOrderId: string;
  workOrderDocNo: string;
}

export const defaultHeader: IssueHeader = {
  companyId: "",
  projectId: "",
  finYearId: "",
  date: new Date().toISOString().slice(0, 10),
  reason: "",
  remarks: "",
  godownId: "",
  docTypeId: null,
  docNoPreview: "",
  issuedTo: "",
  costCenter: "",
  blockId: "",
  floorNo: "",
  workOrderId: "",
  workOrderDocNo: "",
};

export const blankCartItem = (): CartItem => ({
  _key: generateUUID(),
  ItemId: "",
  UOMCode: "",
  Quantity: "",
  Remarks: "",
});

// ─── Small sub-components ─────────────────────────────────────────────────────

export const Field = ({
  label,
  required,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={className}>
    <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
      {label}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
    {children}
  </div>
);

// ─── Godown stock badge shown in the header ───────────────────────────────────

export function GodownBadge({
  name,
  code,
  isMain,
}: {
  name: string;
  code?: string;
  isMain?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-card text-foreground text-xs font-semibold border border-foreground/40">
      <Warehouse size={11} />
      {name}
      {code && (
        <span className="font-heading text-[0.625rem] text-foreground">({code})</span>
      )}
      {isMain && (
        <span className="px-1 py-0 bg-card text-[0.5625rem] font-bold uppercase tracking-wider">
          Main
        </span>
      )}
    </span>
  );
}

// What the tagged work order listed against what is being issued: the work order's quantity, what other
// issues tagged to it have already issued, what is in this issue's cart, and what is left. Informational —
// it never blocks saving.
export const fmtQty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function WorkOrderComparePanel({
  woId,
  docNo,
  excludeIssueId,
  cart,
}: {
  woId: number;
  docNo: string;
  excludeIssueId: number | null;
  cart: CartItem[];
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["issue-work-order-compare", woId, excludeIssueId],
    queryFn: () => issuesApi.getWorkOrderCompare(woId, excludeIssueId),
    staleTime: 30_000,
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const keyOf = (id: string, uom: string | null | undefined) => `${String(id).toLowerCase()}|${uom || ""}`;
    type Row = { key: string; itemId: string; name: string; uom: string; woQty: number; issuedQty: number; thisQty: number };
    const map = new Map<string, Row>();
    for (const i of data.items) {
      map.set(keyOf(i.itemId, i.uomCode), {
        key: keyOf(i.itemId, i.uomCode),
        itemId: i.itemId,
        name: i.itemName || i.itemId,
        uom: i.uomName || i.uomCode || "—",
        woQty: i.woQty,
        issuedQty: i.issuedQty,
        thisQty: 0,
      });
    }
    for (const ci of cart) {
      const qty = Number(ci.Quantity);
      if (!ci.ItemId || !(qty > 0)) continue;
      const k = keyOf(ci.ItemId, ci.UOMCode);
      const row = map.get(k) ?? {
        key: k,
        itemId: ci.ItemId,
        name: ci.ItemName || ci.ItemId,
        uom: ci.UOMCode || "—",
        woQty: 0,
        issuedQty: 0,
        thisQty: 0,
      };
      row.thisQty += qty;
      map.set(k, row);
    }
    const listedItems = new Set(data.items.filter((i) => i.woQty > 0).map((i) => String(i.itemId).toLowerCase()));
    return [...map.values()]
      .map((r) => {
        const balance = r.woQty - r.issuedQty - r.thisQty;
        let state: "over" | "done" | "left" | "unit" | "extra";
        if (r.woQty === 0) state = listedItems.has(r.itemId.toLowerCase()) ? "unit" : "extra";
        else state = balance < 0 ? "over" : balance === 0 ? "done" : "left";
        return { ...r, balance, state };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, cart]);

  const listed = rows.filter((r) => r.woQty > 0);
  const covered = listed.filter((r) => r.issuedQty + r.thisQty > 0).length;

  return (
    <div className="bg-card" style={{ border: RULE }}>
      <div className="px-5 py-4 flex flex-row items-center justify-between" style={{ borderBottom: RULE }}>
        <div className="flex items-center gap-2.5">
          <ClipboardList size={15} className="text-foreground" />
          <h3 className={HEAD}>Work order comparison</h3>
          <span className="px-2 py-0.5 bg-card text-foreground text-xs font-semibold">{docNo}</span>
        </div>
        {!isLoading && !error && listed.length > 0 && (
          <span className="text-[0.6875rem] text-muted-foreground">
            {covered} of {listed.length} work order items issued so far
          </span>
        )}
      </div>
      <div className="p-0">
        {isLoading ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">Loading the work order's items…</p>
        ) : error ? (
          <p className="px-5 py-4 text-sm text-destructive">{(error as Error).message}</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">This work order lists no material items.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[0.625rem] uppercase tracking-[0.12em] text-muted-foreground bg-card">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Item</th>
                  <th className="px-4 py-2 text-left font-semibold">Unit</th>
                  <th className="px-4 py-2 text-right font-semibold">Work order</th>
                  <th className="px-4 py-2 text-right font-semibold">Issued earlier</th>
                  <th className="px-4 py-2 text-right font-semibold">This issue</th>
                  <th className="px-4 py-2 text-right font-semibold">Balance</th>
                  <th className="px-4 py-2 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/10">
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="px-4 py-2.5 font-medium text-foreground">{r.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.uom}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.woQty > 0 ? fmtQty(r.woQty) : "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{fmtQty(r.issuedQty)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmtQty(r.thisQty)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${r.balance < 0 ? "text-destructive" : ""}`}>
                      {r.woQty > 0 ? fmtQty(r.balance) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.state === "over" && <span className="text-xs font-medium text-destructive">Over by {fmtQty(-r.balance)}</span>}
                      {r.state === "done" && <span className="text-xs font-medium text-foreground">Fully issued</span>}
                      {r.state === "left" && <span className="text-xs text-muted-foreground">{fmtQty(r.balance)} still to issue</span>}
                      {r.state === "unit" && <span className="text-xs font-medium text-foreground">Different unit from the work order</span>}
                      {r.state === "extra" && <span className="text-xs font-medium text-foreground">Not in the work order</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
