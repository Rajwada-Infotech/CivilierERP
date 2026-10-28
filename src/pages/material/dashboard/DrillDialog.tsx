import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SHEET_FRAME_CSS } from "@/components/sheet/Sheet";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";
import { EXP_COLS, GRN_COLS, ISSUE_COLS, ITEM_COLS, PO_COLS, REQUEST_COLS, TRANSFER_COLS, isOpenPO, fmt, fmtDate } from "./shared";

// The pipeline lists all come back in one shape from /api/material-dashboard/pipeline/:key.
const pipeCols = (dueHeader: string, withParty: boolean): ColumnDef<any, unknown>[] => [
  { accessorKey: "DocNo", header: "Doc No", cell: ({ row }: any) => <span className="font-heading text-xs font-semibold tracking-wide whitespace-nowrap">{row.original.DocNo || `#${row.original.Id}`}</span> },
  { accessorKey: "ProjectName", header: "Project", cell: ({ getValue }: any) => <span className="text-xs text-muted-foreground">{(getValue() as string) || "—"}</span> },
  ...(withParty ? [{ accessorKey: "PartyName", header: "Supplier", cell: ({ getValue }: any) => <span className="text-xs text-muted-foreground">{(getValue() as string) || "—"}</span> }] : []),
  { accessorKey: "DocDate", header: "Date", cell: ({ getValue }: any) => <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{fmtDate(getValue() as string)}</span> },
  {
    accessorKey: "DueDate", header: dueHeader,
    cell: ({ getValue }: any) => {
      const v = getValue() as string | null;
      const late = !!v && new Date(v) < new Date(new Date().toDateString());
      return <span className={`text-xs tabular-nums whitespace-nowrap ${late ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{fmtDate(v)}</span>;
    },
  },
  ...(withParty ? [{ accessorKey: "Amount", header: "Amount", cell: ({ getValue }: any) => <span className="font-heading text-xs tabular-nums whitespace-nowrap">{getValue() == null ? "—" : fmt(Number(getValue()))}</span> }] : []),
  { accessorKey: "Status", header: "Status", cell: ({ getValue }: any) => { const s = (getValue() as string) || "Draft"; return <SheetMark text={s} tone={statusTone(s)} />; } },
];
const MR_PIPE = pipeCols("Required by", false);
const PO_PIPE = pipeCols("Expected delivery", true);
const GRN_PIPE = pipeCols("Invoice due by", true);
// A pipeline row opens that record straight in its page's preview (each page reads ?view=<id>).
const OPEN_PATH = { mr: "/material/material-request", po: "/material/purchase-order", grn: "/material/grn" } as const;
const pipe = (key: PipelineKey, title: string, cols: ColumnDef<any, unknown>[], empty: string) =>
  ({ title, url: `/api/material-dashboard/pipeline/${key}`, cols, empty, open: OPEN_PATH[key.split("-")[0] as keyof typeof OPEN_PATH] });

export type PipelineKey =
  | "mr-unapproved" | "mr-pending" | "mr-overdue"
  | "po-unapproved" | "po-pending" | "po-overdue"
  | "grn-unapproved" | "grn-pending" | "grn-overdue";
export type DrillKey = "items" | "grns" | "pos" | "expenses" | "stock" | "issues" | "requests" | PipelineKey;

const rowsOf = (j: any): any[] => (Array.isArray(j) ? j : (j?.data ?? []));

// The list endpoints don't filter by status, so "open" and "pending" are picked out here.
const DRILLS: Record<DrillKey, { title: string; url: string; cols: ColumnDef<any, unknown>[]; pick?: (r: any) => boolean; empty: string; open?: string }> = {
  items: { title: "Item master", url: "/api/item-master", cols: ITEM_COLS, empty: "No items found." },
  grns: { title: "Goods receipts", url: "/api/grns?page=1&limit=200", cols: GRN_COLS, empty: "No GRNs found." },
  pos: { title: "Open purchase orders", url: "/api/purchase-orders?page=1&limit=200", cols: PO_COLS, pick: (r) => isOpenPO(r.Status), empty: "No open purchase orders." },
  expenses: { title: "Pending expenses", url: "/api/expense-booking", cols: EXP_COLS, pick: (r) => (r.EStatus || "") === "Pending", empty: "No expenses waiting for approval." },
  stock: { title: "Stock transfers", url: "/api/stock-transfers?page=1&limit=200", cols: TRANSFER_COLS, empty: "No stock transfers found." },
  issues: { title: "Material issues", url: "/api/material-issues?page=1&limit=200&search=", cols: ISSUE_COLS, empty: "No material issues found." },
  requests: { title: "Material requests", url: "/api/material-requests?page=1&limit=200", cols: REQUEST_COLS, empty: "No material requests found." },
  "mr-unapproved": pipe("mr-unapproved", "Material requests not approved", MR_PIPE, "Every material request is approved."),
  "mr-pending": pipe("mr-pending", "Approved material requests with no purchase order", MR_PIPE, "Every approved request has a purchase order."),
  "mr-overdue": pipe("mr-overdue", "Overdue material requests", MR_PIPE, "No material request is past its required-by date."),
  "po-unapproved": pipe("po-unapproved", "Purchase orders not approved", PO_PIPE, "Every purchase order is approved."),
  "po-pending": pipe("po-pending", "Approved purchase orders with no GRN", PO_PIPE, "Every approved purchase order has a GRN."),
  "po-overdue": pipe("po-overdue", "Overdue purchase orders", PO_PIPE, "No purchase order is past its expected delivery."),
  "grn-unapproved": pipe("grn-unapproved", "GRNs not approved", GRN_PIPE, "Every GRN is approved."),
  "grn-pending": pipe("grn-pending", "Approved GRNs with no invoice", GRN_PIPE, "Every approved GRN has an invoice."),
  "grn-overdue": pipe("grn-overdue", "Overdue GRNs", GRN_PIPE, "No GRN is overdue for its invoice."),
};

const RULE = "1px solid hsl(var(--foreground))";

// The table's search bar stays pinned while the rows scroll under it; the frame clears its background, so it needs
// the paper back here or the rows show through.
const DRILL_CSS = ".md-drill .dt-toolbar { background: hsl(var(--card)) !important; z-index: 2; }";

export function DrillDialog({ open, onClose }: { open: DrillKey | null; onClose: () => void }) {
  const navigate = useNavigate();
  const d = open ? DRILLS[open] : null;
  const { data, isLoading, isError } = useQuery<any[]>({
    queryKey: ["materialDashboard-drill", open],
    queryFn: async () => {
      const res = await fetchWithAuth(d!.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = rowsOf(await res.json().catch(() => []));
      return d!.pick ? rows.filter(d!.pick) : rows;
    },
    enabled: !!d,
    staleTime: 30_000,
  });

  return (
    <Dialog open={open !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sheet-frame md-drill max-w-4xl w-full p-0 gap-0" style={{ margin: 0 }}>
        {/* The dashboard loads only its own sheet styles and this dialog opens outside it, so it brings the frame's
            styles itself: squared search box, ruled schedule table and pager, like every other sheet table. */}
        <style>{SHEET_FRAME_CSS + DRILL_CSS}</style>
        <DialogHeader className="px-6 pt-5 pb-4" style={{ borderBottom: RULE }}>
          <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Material overview</p>
          <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">
            {d?.title}
            {data && <span className="ml-2 font-heading text-sm font-normal tabular-nums text-muted-foreground">{data.length}</span>}
          </DialogTitle>
          <DialogDescription className={d?.open ? "text-xs text-muted-foreground mt-1" : "sr-only"}>
            {d?.open ? "Open a row to see that record." : "The records behind this figure"}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          {isLoading ? (
            <p className="px-6 py-10 text-sm text-muted-foreground">Loading…</p>
          ) : isError ? (
            <p className="px-6 py-10 text-sm text-destructive">Could not load these records.</p>
          ) : !data?.length ? (
            <p className="px-6 py-10 text-sm text-muted-foreground">{d?.empty}</p>
          ) : (
            <DataTable
              data={data}
              columns={d!.cols}
              searchable
              paginated
              emptyMessage={d!.empty}
              onRowClick={d!.open ? (row) => { onClose(); navigate(`${d!.open}?view=${row.original.Id}`); } : undefined}
            />
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
