import type { ColumnDef } from "@/components/ui/DataTable";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";

// ─── Data ─────────────────────────────────────────────────────────────────────
export interface StatusRow { Status: string; Count: number; TotalValue: number }
export interface EngineeringDashboardData {
  workOrders: { total: number; open: number; thisMonth: number; totalValue: number };
  boq: { total: number; approved: number; totalValue: number };
  workDone: { total: number; pending: number; certifiedAmount: number };
  projects: { total: number; active: number };
  recentWOs: any[];
  recentBOQs: any[];
  recentWorkDone: any[];
  woStatusBreakdown: StatusRow[];
  workDoneStatusBreakdown: StatusRow[];
  timeline: { date: string; workOrders: number; workDone: number }[];
}

export const normalise = (raw: any): EngineeringDashboardData => ({
  workOrders: { total: 0, open: 0, thisMonth: 0, totalValue: 0, ...raw.workOrders },
  boq: { total: 0, approved: 0, totalValue: 0, ...raw.boq },
  workDone: { total: 0, pending: 0, certifiedAmount: 0, ...raw.workDone },
  projects: { total: 0, active: 0, ...raw.projects },
  recentWOs: raw.recentWOs ?? [],
  recentBOQs: raw.recentBOQs ?? [],
  recentWorkDone: raw.recentWorkDone ?? [],
  woStatusBreakdown: raw.woStatusBreakdown ?? [],
  workDoneStatusBreakdown: raw.workDoneStatusBreakdown ?? [],
  timeline: raw.timeline ?? [],
});

// ─── Format ───────────────────────────────────────────────────────────────────
export const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n ?? 0);
export const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n ?? 0);
export const short = (v: number) =>
  v >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(Math.round(v));
export const share = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0);

// ─── Cells ────────────────────────────────────────────────────────────────────
const docCell = (text: string) => <span className="font-heading text-xs font-semibold tracking-wide text-foreground whitespace-nowrap">{text}</span>;
const mutedCell = (text: string | null | undefined) => <span className="text-xs text-muted-foreground truncate block" style={{ maxWidth: 170 }}>{text || "—"}</span>;
const amountCell = (v: unknown) => <span className="font-heading text-xs font-semibold tabular-nums whitespace-nowrap">{v != null ? fmt(Number(v)) : "—"}</span>;
const mark = (s: unknown) => {
  const t = (s as string) || "Draft";
  return <SheetMark text={t} tone={statusTone(t)} />;
};

export const WO_COLS: ColumnDef<any, unknown>[] = [
  { accessorKey: "DocNo", header: "Doc No", cell: ({ row }: any) => docCell(row.original.DocNo || `#${row.original.Id}`) },
  { accessorKey: "ContractorName", header: "Contractor", cell: ({ getValue }: any) => mutedCell(getValue()) },
  { accessorKey: "Status", header: "Status", cell: ({ getValue }: any) => mark(getValue()) },
  { accessorKey: "TotalAmount", header: "Amount", cell: ({ getValue }: any) => amountCell(getValue()) },
];
export const BOQ_COLS: ColumnDef<any, unknown>[] = [
  { accessorKey: "DocNo", header: "Doc No", cell: ({ row }: any) => docCell(row.original.DocNo || `#${row.original.BoqID}`) },
  { accessorKey: "ProjectName", header: "Project", cell: ({ getValue }: any) => mutedCell(getValue()) },
  { accessorKey: "Status", header: "Status", cell: ({ getValue }: any) => mark(getValue()) },
  { accessorKey: "TotalValue", header: "Value", cell: ({ getValue }: any) => amountCell(getValue()) },
];
export const WD_COLS: ColumnDef<any, unknown>[] = [
  { accessorKey: "DocNo", header: "Doc No", cell: ({ row }: any) => docCell(row.original.DocNo || `#${row.original.ID}`) },
  { accessorKey: "WorkOrderNo", header: "Work order", cell: ({ getValue }: any) => mutedCell(getValue()) },
  { accessorKey: "Status", header: "Status", cell: ({ getValue }: any) => mark(getValue()) },
  { accessorKey: "CertifiedAmount", header: "Certified", cell: ({ getValue }: any) => amountCell(getValue()) },
];
