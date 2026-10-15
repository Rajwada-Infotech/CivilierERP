import type { ColumnDef } from "@/components/ui/DataTable";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface DashboardData {
  items: { count: number; groupCount: number };
  grns: { total: number; thisMonth: number; today: number; totalValue: number; thisMonthValue: number };
  purchaseOrders: { total: number; open: number; approved: number; pending: number; totalValue: number; openValue: number };
  expenses: { total: number; pending: number; approved: number; totalAmount: number; pendingAmount: number };
  stock: { totalEntries: number; totalIn: number; totalOut: number; uniqueItems: number };
  uom: { total: number };
  materialIssues: { total: number; thisMonth: number; today: number; totalQty: number };
  materialRequests: { total: number; pending: number; approved: number; draft: number; ordered: number; partiallyOrdered: number; thisMonth: number };
  recentGRNs: any[];
  recentPOs: any[];
  recentExpenses: any[];
  recentIssues: any[];
  recentRequests: any[];
  poStatusBreakdown: { Status: string; Count: number; TotalValue: number }[];
  topItems: { ItemID: string; ItemName: string | null; TotalIn: number; TotalOut: number; NetStock: number }[];
  timeline: { date: string; grn: number; po: number }[];
}

export const normalise = (raw: any): DashboardData => ({
  items: raw.items ?? { count: 0, groupCount: 0 },
  grns: { total: 0, thisMonth: 0, today: 0, totalValue: 0, thisMonthValue: 0, ...raw.grns },
  purchaseOrders: raw.purchaseOrders ?? { total: 0, open: 0, approved: 0, pending: 0, totalValue: 0, openValue: 0 },
  expenses: raw.expenses ?? { total: 0, pending: 0, approved: 0, totalAmount: 0, pendingAmount: 0 },
  stock: raw.stock ?? { totalEntries: 0, totalIn: 0, totalOut: 0, uniqueItems: 0 },
  uom: raw.uom ?? { total: 0 },
  materialIssues: raw.materialIssues ?? { total: 0, thisMonth: 0, today: 0, totalQty: 0 },
  materialRequests: raw.materialRequests ?? { total: 0, pending: 0, approved: 0, draft: 0, ordered: 0, partiallyOrdered: 0, thisMonth: 0 },
  recentGRNs: raw.recentGRNs ?? [],
  recentPOs: raw.recentPOs ?? [],
  recentExpenses: raw.recentExpenses ?? [],
  recentIssues: raw.recentIssues ?? [],
  recentRequests: raw.recentRequests ?? [],
  poStatusBreakdown: raw.poStatusBreakdown ?? [],
  topItems: raw.topItems ?? [],
  timeline: raw.timeline ?? [],
});

// ─── Format ───────────────────────────────────────────────────────────────────
export const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n ?? 0);
export const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n ?? 0);
export const short = (v: number) =>
  v >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(Math.round(v));
export const share = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0);
export const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** A purchase order is still open until it is fully received, closed, rejected or cancelled. */
export const isOpenPO = (status: string | null | undefined) => !["Closed", "Rejected", "Received", "Cancelled"].includes(status || "");

// ─── Cells ────────────────────────────────────────────────────────────────────
const docCell = (text: string) => <span className="font-heading text-xs font-semibold tracking-wide text-foreground whitespace-nowrap">{text}</span>;
const mutedCell = (text: string | null | undefined, max = 160) => (
  <span className="text-xs text-muted-foreground truncate block" style={{ maxWidth: max }}>{text || "—"}</span>
);
const mark = (status: string | null | undefined, fallback = "Draft") => {
  const s = status || fallback;
  return <SheetMark text={s} tone={statusTone(s)} />;
};

function docCols(docNo: string, fallbackId: string, party: string, partyHeader: string, date: string, amount: string, status: string, defaultStatus = "Draft"): ColumnDef<any, unknown>[] {
  return [
    { accessorKey: docNo, header: "Doc No", cell: ({ row }: any) => docCell(row.original[docNo] || `#${row.original[fallbackId]}`) },
    { accessorKey: party, header: partyHeader, cell: ({ getValue }: any) => mutedCell(getValue() as string) },
    { accessorKey: date, header: "Date", cell: ({ getValue }: any) => <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{fmtDate(getValue() as string)}</span> },
    {
      accessorKey: amount,
      header: "Amount",
      cell: ({ getValue }: any) => {
        const v = getValue() as number | null;
        return <span className="font-heading text-xs font-semibold tabular-nums whitespace-nowrap">{v != null ? fmt(v) : "—"}</span>;
      },
    },
    { accessorKey: status, header: "Status", cell: ({ getValue }: any) => mark(getValue() as string, defaultStatus) },
  ];
}

export const GRN_COLS = docCols("GRNNo", "GRNID", "SupplierName", "Supplier", "GRNDate", "TotalAmount", "Status");
export const PO_COLS = docCols("PurchaseOrderNo", "PurchaseOrderID", "SupplierName", "Supplier", "PODate", "TotalAmount", "Status");
export const EXP_COLS = docCols("EDocNo", "Eid", "EProjectName", "Project", "EDocDate", "EAmount", "EStatus", "Pending");

export const ISSUE_COLS: ColumnDef<any, unknown>[] = [
  { accessorKey: "DocNo", header: "Doc No", cell: ({ row }: any) => docCell(row.original.DocNo || `#${row.original.IssueId}`) },
  { accessorKey: "ProjectName", header: "Project", cell: ({ getValue }: any) => mutedCell(getValue() as string) },
  { accessorKey: "IssueDate", header: "Date", cell: ({ getValue }: any) => <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{fmtDate(getValue() as string)}</span> },
  { accessorKey: "ItemCount", header: "Items", cell: ({ getValue }: any) => <span className="font-heading text-xs font-semibold tabular-nums">{getValue() as number}</span> },
  { accessorKey: "Status", header: "Status", cell: ({ getValue }: any) => mark(getValue() as string) },
];

export const REQUEST_COLS: ColumnDef<any, unknown>[] = [
  { accessorKey: "DocNo", header: "Doc No", cell: ({ row }: any) => docCell(row.original.DocNo || `#${row.original.MRId}`) },
  { accessorKey: "ProjectName", header: "Project", cell: ({ getValue }: any) => mutedCell(getValue() as string, 140) },
  { accessorKey: "RequestDate", header: "Date", cell: ({ getValue }: any) => <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{fmtDate(getValue() as string)}</span> },
  {
    accessorKey: "Priority",
    header: "Priority",
    cell: ({ getValue }: any) => {
      const p = (getValue() as string) || "Normal";
      // Urgent / high priority is the one thing in red.
      const hot = p === "High" || p === "Urgent";
      return (
        <span className={`inline-flex font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap ${hot ? "text-destructive border-destructive" : "text-muted-foreground border-foreground/40"}`}>
          {p}
        </span>
      );
    },
  },
  { accessorKey: "Status", header: "Status", cell: ({ getValue }: any) => mark(getValue() as string) },
];

export const ITEM_COLS: ColumnDef<any, unknown>[] = [
  { accessorKey: "M_code", header: "Code", cell: ({ getValue }: any) => docCell((getValue() as string) || "—") },
  { accessorKey: "M_Name", header: "Item Name", cell: ({ getValue }: any) => <span className="text-xs font-medium text-foreground">{getValue() as string}</span> },
  { accessorKey: "M_Group", header: "Group", cell: ({ getValue }: any) => mutedCell(getValue() as string) },
  { accessorKey: "M_Type", header: "Type", cell: ({ getValue }: any) => mutedCell(getValue() as string) },
  { accessorKey: "M_UOM", header: "UOM", cell: ({ getValue }: any) => mutedCell(getValue() as string) },
  { accessorKey: "M_HSN", header: "HSN", cell: ({ getValue }: any) => mutedCell(getValue() as string) },
];

const transferItemCount = (items: unknown) => {
  const arr = Array.isArray(items)
    ? items
    : typeof items === "string" && items.trim()
      ? (() => { try { return JSON.parse(items); } catch { return []; } })()
      : [];
  return arr.length as number;
};

export const TRANSFER_COLS: ColumnDef<any, unknown>[] = [
  { accessorKey: "DocNo", header: "Doc No", cell: ({ getValue }: any) => docCell((getValue() as string) || "—") },
  { accessorKey: "TransferDate", header: "Date", cell: ({ getValue }: any) => <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{fmtDate(getValue() as string)}</span> },
  { accessorKey: "FromGodownName", header: "From Godown", cell: ({ getValue }: any) => <span className="text-xs font-medium">{(getValue() as string) || "—"}</span> },
  { accessorKey: "ToGodownName", header: "To Godown", cell: ({ getValue }: any) => <span className="text-xs font-medium">{(getValue() as string) || "—"}</span> },
  {
    accessorKey: "TransferItems",
    header: "Items",
    cell: ({ getValue }: any) => {
      const n = transferItemCount(getValue());
      return <span className="text-xs text-muted-foreground">{n} {n === 1 ? "item" : "items"}</span>;
    },
  },
  { accessorKey: "Status", header: "Status", cell: ({ getValue }: any) => mark(getValue() as string, "—") },
  { accessorKey: "CreatedBy", header: "Created By", cell: ({ getValue }: any) => mutedCell(getValue() as string) },
];
