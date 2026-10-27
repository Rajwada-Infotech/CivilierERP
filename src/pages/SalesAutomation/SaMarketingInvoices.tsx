import React, { useMemo, useState } from "react";
import { fmtIstIso } from "@/lib/istTime";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { SalesAutoShell, SalesAutoGlassCard } from "@/components/sa/SalesAutoShell";
import { SaTabs } from "@/components/sa/SaTabs";
import { MoneyView, moneyText, StatusCell, TitleCell } from "@/components/sa/saCells";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import { MasterPage, type DataChangeEvent, type RecordWithId, type FieldDef } from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { CheckCircle2, XCircle, Clock, Wallet, AlertTriangle, Receipt } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/sa/marketing-invoices";

async function fetchInvoices(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch invoices");
  return res.json().catch(() => ({}));
}
async function fetchCampaignOptions(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth("/api/sa/campaigns/dropdown");
    if (!res.ok) return [];
    const data: any[] = await res.json();
    return data.map((c) => ({ value: String(c.Id), label: `${c.CampaignCode} - ${c.Name}` }));
  } catch { return []; }
}
async function fetchAdOptions(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth("/api/sa/ads/dropdown");
    if (!res.ok) return [];
    const data: any[] = await res.json();
    return data.map((a) => ({
      value: String(a.Id),
      label: [a.CampaignCode, a.Name].filter(Boolean).join(" - "),
    }));
  } catch { return []; }
}

const fields: FieldDef[] = [
  { name: "InvoiceNumber", label: "Invoice Number", type: "text", required: true, placeholder: "As printed on the vendor's bill" },
  { name: "VendorName", label: "Vendor", type: "text", placeholder: "Agency, Meta, Google…" },
  { name: "InvoiceDate", label: "Invoice Date", type: "date" },
  { name: "CampaignId", label: "Campaign", type: "select", asyncOptions: fetchCampaignOptions },
  { name: "AdId", label: "Ad", type: "select", asyncOptions: fetchAdOptions },
  { name: "DueDate", label: "Due Date", type: "date" },
  { name: "Amount", label: "Amount (before GST)", type: "number", prefix: "₹" },
  { name: "GstAmount", label: "GST", type: "number", prefix: "₹" },
  { name: "PaymentStatus", label: "Payment Status", type: "select", options: ["Pending", "Paid", "Partial", "Cancelled"], defaultValue: "Pending" },
  { name: "Notes", label: "Notes", type: "textarea", fullWidth: true },
];

const columns = [
  { key: "InvoiceNumber", label: "Invoice" },
  { key: "CampaignName", label: "For", hideOnMobile: true },
  { key: "TotalAmount", label: "Total" },
  { key: "DueDate", label: "Due", hideOnMobile: true },
  { key: "PaymentStatus", label: "Payment" },
  { key: "ApprovalStatus", label: "Approval", hideOnMobile: true },
];

const OPEN_PAYMENT = ["Pending", "Partial"];
const todayYmd = () => new Date().toISOString().slice(0, 10);
const isOverdue = (r: RecordWithId) =>
  !!r.DueDate && String(r.DueDate) < todayYmd() && OPEN_PAYMENT.includes(String(r.PaymentStatus)) && r.ApprovalStatus !== "Rejected";
const fmtDay = (d: unknown) =>
  d ? new Date(String(d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const FILTERS = [
  { key: "all", label: "All", test: (_: RecordWithId) => true },
  { key: "approval", label: "Awaiting approval", test: (r: RecordWithId) => r.ApprovalStatus === "Pending" },
  { key: "unpaid", label: "Approved, unpaid", test: (r: RecordWithId) => r.ApprovalStatus === "Approved" && OPEN_PAYMENT.includes(String(r.PaymentStatus)) },
  { key: "overdue", label: "Overdue", test: isOverdue },
  { key: "paid", label: "Paid", test: (r: RecordWithId) => r.PaymentStatus === "Paid" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const exportColumns: ExportColumn[] = [
  { header: "Invoice #", accessor: "InvoiceNumber" },
  { header: "Vendor", accessor: "VendorName" },
  { header: "Campaign", accessor: "CampaignName" },
  { header: "Ad", accessor: "AdName" },
  { header: "Invoice Date", accessor: "InvoiceDate" },
  { header: "Amount", accessor: "Amount" },
  { header: "GST", accessor: "GstAmount" },
  { header: "Total", accessor: "TotalAmount" },
  { header: "Due Date", accessor: "DueDate" },
  { header: "Payment Status", accessor: "PaymentStatus" },
  { header: "Notes", accessor: "Notes" },
];

const SaMarketingInvoices: React.FC = () => {
  usePageRights("sa-marketing-invoices");
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();
  const [approvalDialog, setApprovalDialog] = useState<{ id: string; action: "approve" | "reject"; invoiceNumber: string } | null>(null);
  const [approvalNotes, setApprovalNotes] = useState("");
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");

  const handleApproval = async () => {
    if (!approvalDialog) return;
    setApprovalLoading(true);
    try {
      const endpoint = approvalDialog.action === "approve" ? "approve" : "reject";
      const res = await fetchWithAuth(`${API}/${approvalDialog.id}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ApprovalNotes: approvalNotes || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast.success(approvalDialog.action === "approve" ? "Invoice approved!" : "Invoice rejected");
      setApprovalDialog(null);
      setApprovalNotes("");
      await queryClient.invalidateQueries({ queryKey: ["sa-marketing-invoices"] });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    } finally {
      setApprovalLoading(false);
    }
  };
  const { data: invoices, isLoading, isFetching, dataUpdatedAt, refetch, error } = useQuery({ queryKey: ["sa-marketing-invoices"], queryFn: fetchInvoices, staleTime: 30_000 });

  const mappedData: RecordWithId[] = useMemo(() => {
    if (!Array.isArray(invoices)) return [];
    return invoices.map((i) => ({
      _id: String(i.Id),
      InvoiceNumber: i.InvoiceNumber ?? "",
      VendorName: i.VendorName ?? "",
      CampaignId: String(i.CampaignId ?? ""),
      CampaignName: i.CampaignName ?? "",
      AdId: String(i.AdId ?? ""),
      AdName: i.AdName ?? "",
      InvoiceDate: i.InvoiceDate ? String(i.InvoiceDate).slice(0, 10) : "",
      Amount: i.Amount ?? 0,
      GstAmount: i.GstAmount ?? 0,
      TotalAmount: i.TotalAmount ?? 0,
      DueDate: i.DueDate ? String(i.DueDate).slice(0, 10) : "",
      PaymentStatus: i.PaymentStatus ?? "Pending",
      Notes: i.Notes ?? "",
      ApprovalStatus: i.ApprovalStatus ?? "Pending",
      ApprovalNotes: i.ApprovalNotes ?? "",
      ApproverName: i.ApproverName ?? "",
      ApprovedAt: i.ApprovedAt ? fmtIstIso(i.ApprovedAt) : "",
    }));
  }, [invoices]);

  const toPayload = (r: Record<string, any>) => ({
    InvoiceNumber: r.InvoiceNumber?.trim() || null,
    VendorName: r.VendorName || null,
    CampaignId: r.CampaignId ? parseInt(r.CampaignId) : null,
    AdId: r.AdId ? parseInt(r.AdId) : null,
    InvoiceDate: r.InvoiceDate || null,
    Amount: r.Amount ? parseFloat(r.Amount) : 0,
    GstAmount: r.GstAmount ? parseFloat(r.GstAmount) : 0,
    TotalAmount: (parseFloat(r.Amount) || 0) + (parseFloat(r.GstAmount) || 0),
    DueDate: r.DueDate || null,
    PaymentStatus: r.PaymentStatus || "Pending",
    Notes: r.Notes || null,
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      const res = await fetchWithAuth(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toPayload(event.record)) });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to add invoice");
      toast.success("Invoice added!");
    }
    if (event.action === "update") {
      const res = await fetchWithAuth(`${API}/${event.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toPayload(event.record)) });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update invoice");
      toast.success("Invoice updated!");
    }
    if (event.action === "delete") {
      const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to delete invoice");
      toast.success("Invoice deleted!");
    }
    await queryClient.invalidateQueries({ queryKey: ["sa-marketing-invoices"] });
  };

  if (isLoading || error) return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Finance", "Invoices"]} title="Marketing Invoices">
      <div className={`p-6 text-sm ${error ? "text-red-500" : "text-muted-foreground"}`}>
        {error ? "Couldn't load invoices. Refresh the page to try again." : "Loading invoices…"}
      </div>
    </SalesAutoShell>
  );

  const sumOf = (rows: RecordWithId[]) => rows.reduce((s, r) => s + Number(r.TotalAmount || 0), 0);
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, mappedData.filter(f.test)])) as Record<FilterKey, RecordWithId[]>;
  const shown = counts[filter];
  const monthKey = todayYmd().slice(0, 7);
  const thisMonth = mappedData.filter((r) => String(r.InvoiceDate).startsWith(monthKey) && r.ApprovalStatus !== "Rejected" && r.PaymentStatus !== "Cancelled");

  return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Finance", "Invoices"]} title="Marketing Invoices"
      subtitle="Bills from agencies and ad platforms. Every invoice that isn't cancelled or rejected counts toward its campaign's and ad's spend."
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SalesAutoGlassCard label="Awaiting approval" value={formatINR(sumOf(counts.approval))} sub={`${counts.approval.length} invoice${counts.approval.length === 1 ? "" : "s"}`} icon={Clock} accentColor="#d97706" onClick={() => setFilter("approval")} />
          <SalesAutoGlassCard label="Approved, unpaid" value={formatINR(sumOf(counts.unpaid))} sub={`${counts.unpaid.length} to pay`} icon={Wallet} accentColor="#2563eb" onClick={() => setFilter("unpaid")} />
          <SalesAutoGlassCard label="Overdue" value={formatINR(sumOf(counts.overdue))} sub={counts.overdue.length ? `${counts.overdue.length} past due date` : "nothing overdue"} icon={AlertTriangle} accentColor={counts.overdue.length ? "#dc2626" : "#64748b"} onClick={() => setFilter("overdue")} />
          <SalesAutoGlassCard label="Billed this month" value={formatINR(sumOf(thisMonth))} sub={`${thisMonth.length} invoice${thisMonth.length === 1 ? "" : "s"}`} icon={Receipt} accentColor="#7c3aed" />
        </div>
        <SaTabs
          tabs={FILTERS.map((f) => ({ key: f.key, label: `${f.label} (${counts[f.key].length})` }))}
          active={filter}
          onChange={(key) => setFilter(key as FilterKey)}
        />
        <MasterPage
          title="Invoice"
          fields={fields}
          columns={columns}
          collapsibleAddForm
          gridCols={3}
          canCreate={canDoAction("sa-marketing-invoices", "create")}
          canEdit={canDoAction("sa-marketing-invoices", "edit")}
          canDelete={canDoAction("sa-marketing-invoices", "delete")}
          initialData={shown}
          onDataEvent={handleDataEvent}
          columnRenderers={{
            InvoiceNumber: (v, row) => TitleCell(v, [row.VendorName, row.InvoiceDate ? fmtDay(row.InvoiceDate) : ""].filter(Boolean).join(" · ")),
            CampaignName: (v, row) => (v || row.AdName ? TitleCell(v || "—", row.AdName) : <span className="text-muted-foreground">—</span>),
            TotalAmount: (v, row) => (
              <div className="tabular-nums">
                <div className="font-medium">{moneyText(v)}</div>
                {Number(row.GstAmount) > 0 && <div className="text-xs text-muted-foreground">incl. {moneyText(row.GstAmount)} GST</div>}
              </div>
            ),
            DueDate: (v, row) => (
              <span className={`text-sm whitespace-nowrap ${isOverdue(row) ? "text-red-600 font-medium" : ""}`}>
                {fmtDay(v)}{isOverdue(row) ? " · overdue" : ""}
              </span>
            ),
            PaymentStatus: (value) => StatusCell(value),
            ApprovalStatus: (value) => StatusCell(value),
          }}
          exportConfig={{ title: "Marketing Invoices", filename: "marketing-invoices", columns: exportColumns }}
          rowActions={(row) => {
            const status = String(row.ApprovalStatus ?? "Pending");
            // The Approval column already shows the status — only offer actions.
            if (status !== "Pending" || !canDoAction("sa-marketing-invoices", "edit")) return null;
            return (
              <>
                <button
                  type="button"
                  onClick={() => setApprovalDialog({ id: row._id, action: "approve", invoiceNumber: String(row.InvoiceNumber) })}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-emerald-500 hover:bg-emerald-500/10 transition-colors"
                  title="Approve invoice"
                >
                  <CheckCircle2 size={13} /> Approve
                </button>
                <button
                  type="button"
                  onClick={() => setApprovalDialog({ id: row._id, action: "reject", invoiceNumber: String(row.InvoiceNumber) })}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-red-500 hover:bg-red-500/10 transition-colors"
                  title="Reject invoice"
                >
                  <XCircle size={13} /> Reject
                </button>
              </>
            );
          }}
          viewConfig={{
            title: "Invoice Details",
            fields: [
              { key: "InvoiceNumber", label: "Invoice #" },
              { key: "VendorName", label: "Vendor" },
              { key: "CampaignName", label: "Campaign" },
              { key: "AdName", label: "Advertisement" },
              { key: "InvoiceDate", label: "Invoice Date", render: (v) => <p className="text-sm">{fmtDay(v)}</p> },
              { key: "Amount", label: "Amount (before GST)", render: MoneyView },
              { key: "GstAmount", label: "GST", render: MoneyView },
              { key: "TotalAmount", label: "Total", render: MoneyView },
              { key: "DueDate", label: "Due Date", render: (v) => <p className="text-sm">{fmtDay(v)}</p> },
              { key: "PaymentStatus", label: "Payment Status", render: (v) => StatusCell(v) },
              { key: "ApprovalStatus", label: "Approval Status", render: (v) => StatusCell(v) },
              { key: "ApproverName", label: "Approved By" },
              { key: "ApprovedAt", label: "Approved At" },
              { key: "ApprovalNotes", label: "Approval Notes" },
              { key: "Notes", label: "Notes" },
            ],
          }}
        />
        {/* Approval Dialog */}
        <Dialog open={!!approvalDialog} onOpenChange={(o) => { if (!o) { setApprovalDialog(null); setApprovalNotes(""); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-heading text-base">
                {approvalDialog?.action === "approve" ? "Approve Invoice" : "Reject Invoice"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Invoice <span className="font-medium text-foreground">{approvalDialog?.invoiceNumber}</span> will be marked as <span className={approvalDialog?.action === "approve" ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>{approvalDialog?.action === "approve" ? "Approved" : "Rejected"}</span>.
              </p>
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Notes (optional)</label>
                <textarea
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  rows={3}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background resize-none"
                  placeholder="Add a comment..."
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => { setApprovalDialog(null); setApprovalNotes(""); }}
                  className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted transition-colors"
                >Cancel</button>
                <button
                  onClick={handleApproval}
                  disabled={approvalLoading}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-colors ${approvalDialog?.action === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`}
                >{approvalLoading ? "Saving…" : approvalDialog?.action === "approve" ? "Approve" : "Reject"}</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </SalesAutoShell>
  );
};

export default SaMarketingInvoices;
