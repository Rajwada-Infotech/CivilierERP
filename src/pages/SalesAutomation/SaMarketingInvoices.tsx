import React, { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { MasterPage, type DataChangeEvent, type RecordWithId, type FieldDef } from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { CheckCircle2, XCircle } from "lucide-react";
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
  { name: "InvoiceNumber", label: "Invoice Number", type: "text", required: true },
  { name: "VendorName", label: "Vendor", type: "text" },
  { name: "CampaignId", label: "Campaign", type: "select", asyncOptions: fetchCampaignOptions },
  { name: "AdId", label: "Advertisement", type: "select", asyncOptions: fetchAdOptions },
  { name: "InvoiceDate", label: "Invoice Date", type: "date" },
  { name: "Amount", label: "Amount", type: "number" },
  { name: "GstAmount", label: "GST Amount", type: "number" },
  { name: "DueDate", label: "Due Date", type: "date" },
  { name: "PaymentStatus", label: "Payment Status", type: "select", options: ["Pending", "Paid", "Partial", "Cancelled"], defaultValue: "Pending" },
  { name: "Notes", label: "Notes", type: "textarea", fullWidth: true },
];

const columns = [
  { key: "InvoiceNumber", label: "Invoice #" },
  { key: "VendorName", label: "Vendor" },
  { key: "CampaignName", label: "Campaign", hideOnMobile: true },
  { key: "AdName", label: "Ad", hideOnMobile: true },
  { key: "Amount", label: "Amount" },
  { key: "GstAmount", label: "GST", hideOnMobile: true },
  { key: "TotalAmount", label: "Total" },
  { key: "PaymentStatus", label: "Payment" },
  { key: "ApprovalStatus", label: "Approval" },
  { key: "DueDate", label: "Due Date", hideOnMobile: true },
];

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
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();
  const [approvalDialog, setApprovalDialog] = useState<{ id: string; action: "approve" | "reject"; invoiceNumber: string } | null>(null);
  const [approvalNotes, setApprovalNotes] = useState("");
  const [approvalLoading, setApprovalLoading] = useState(false);

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
  const { data: invoices, isLoading, error, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["sa-marketing-invoices"], queryFn: fetchInvoices, staleTime: 30_000 });

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
      ApprovedAt: i.ApprovedAt ? String(i.ApprovedAt).slice(0, 16).replace("T", " ") : "",
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
    try {
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
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading invoices...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load invoices.</div>;

  return (
    <SalesAutoShell title="Marketing Invoices" subtitle="Track marketing expenses and invoice payments for campaigns and advertisements"
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <div className="space-y-8">
        <MasterPage
          title="Invoice"
          fields={fields}
          columns={columns}
          canCreate={canDoAction("sa-marketing-invoices", "create")}
          canEdit={canDoAction("sa-marketing-invoices", "edit")}
          canDelete={canDoAction("sa-marketing-invoices", "delete")}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{ title: "Marketing Invoices", filename: "marketing-invoices", columns: exportColumns }}
          rowActions={(row) => {
            const status = String(row.ApprovalStatus ?? "Pending");
            if (status === "Approved") {
              return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600">Approved</span>;
            }
            if (status === "Rejected") {
              return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-500">Rejected</span>;
            }
            if (!canDoAction("sa-marketing-invoices", "edit")) {
              return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-500/10 text-yellow-600">Pending</span>;
            }
            return (
              <>
                <button
                  type="button"
                  onClick={() => setApprovalDialog({ id: row._id, action: "approve", invoiceNumber: String(row.InvoiceNumber) })}
                  className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-500/10 transition-colors"
                  title="Approve invoice"
                >
                  <CheckCircle2 size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setApprovalDialog({ id: row._id, action: "reject", invoiceNumber: String(row.InvoiceNumber) })}
                  className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                  title="Reject invoice"
                >
                  <XCircle size={13} />
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
              { key: "InvoiceDate", label: "Invoice Date" },
              { key: "Amount", label: "Amount" },
              { key: "GstAmount", label: "GST" },
              { key: "TotalAmount", label: "Total" },
              { key: "DueDate", label: "Due Date" },
              { key: "PaymentStatus", label: "Payment Status" },
              { key: "ApprovalStatus", label: "Approval Status" },
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
                >{approvalLoading ? "..." : approvalDialog?.action === "approve" ? "Approve" : "Reject"}</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </SalesAutoShell>
  );
};

export default SaMarketingInvoices;
