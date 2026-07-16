import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { XCircle, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApprovalActions } from "@/components/ApprovalActions";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/cancellations";
const BKG_API = "/api/crm/bookings";

const PAY_MODES = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Other"];

const statusColor: Record<string, string> = {
  Pending:  "text-orange-600 bg-orange-50 border-orange-200",
  Approved: "text-blue-600 bg-blue-50 border-blue-200",
  Rejected: "text-red-600 bg-red-50 border-red-200",
  Refunded: "text-green-600 bg-green-50 border-green-200",
};

const fmt = (n: number | null | undefined) => n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

async function fetchCancellations(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmCancellations: React.FC = () => {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ BookingId: "", Reason: "", DeductionPercent: "10" });
  const [refundDialog, setRefundDialog] = useState<number | null>(null);
  const [refundForm, setRefundForm] = useState({ RefundDate: "", RefundMode: "", RefundRef: "" });
  const [saving, setSaving] = useState(false);

  const { data: cancellations = [], isLoading } = useQuery({ queryKey: ["crm-cancellations"], queryFn: fetchCancellations, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });

  const activeBookings = useMemo(() =>
    (bookings as any[]).filter((b: any) => b.Status !== "Cancelled"), [bookings]);

  const handleRequest = async () => {
    if (!form.BookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BookingId: parseInt(form.BookingId),
          Reason: form.Reason || null,
          DeductionPercent: parseFloat(form.DeductionPercent) || 10,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Cancellation requested — refund amount: ${fmt(data.refundAmt)}`);
      setDialogOpen(false);
      setForm({ BookingId: "", Reason: "", DeductionPercent: "10" });
      qc.invalidateQueries({ queryKey: ["crm-cancellations"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRefund = async () => {
    if (!refundDialog) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${refundDialog}/mark-refunded`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(refundForm),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Refund recorded");
      setRefundDialog(null);
      setRefundForm({ RefundDate: "", RefundMode: "", RefundRef: "" });
      qc.invalidateQueries({ queryKey: ["crm-cancellations"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "CancellationNo", header: "Cancellation No", size: 130,
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.getValue() as string}</span> },
    { accessorKey: "BookingNo", header: "Booking", size: 110, cell: (i) => <span className="font-mono text-xs">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 150,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.Mobile}</div>
        </div>
      ) },
    { accessorKey: "AmountPaidTillDate", header: "Paid Till Date", size: 110, cell: (i) => <span>{fmt(i.row.original.AmountPaidTillDate)}</span> },
    { id: "deduction", header: "Deduction", size: 130, enableSorting: false,
      cell: (i) => <span className="text-xs">{i.row.original.DeductionPercent}% ({fmt(i.row.original.DeductionAmount)})</span> },
    { accessorKey: "RefundAmount", header: "Refund Amount", size: 120, cell: (i) => <span className="font-semibold text-green-600">{fmt(i.row.original.RefundAmount)}</span> },
    { accessorKey: "Status", header: "Status", size: 100,
      cell: (i) => <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[i.row.original.Status] || ""}`}>{i.row.original.Status}</span> },
    { accessorKey: "RequestedDate", header: "Requested", size: 100,
      cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.RequestedDate ? String(i.row.original.RequestedDate).slice(0, 10) : "—"}</span> },
    { id: "actions", header: "Actions", size: 160, enableSorting: false,
      cell: (i) => {
        const c = i.row.original;
        return (
          <>
            {/* submitOnly: Approve/Reject only ever happen from the Admin
                Approval Inbox (admin/super_admin/marketing_head) */}
            <ApprovalActions
              status={c.Status}
              recordId={c.Id}
              endpoint={API}
              submitOnly
              onSuccess={() => qc.invalidateQueries({ queryKey: ["crm-cancellations"] })}
            />
            {c.Status === "Pending" && <span className="text-xs text-muted-foreground">Pending admin approval</span>}
            {c.Status === "Approved" && (
              <button onClick={() => setRefundDialog(c.Id)} className="text-xs text-primary hover:underline">Record Refund</button>
            )}
            {c.Status === "Refunded" && (
              <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 size={12} /> Refunded</span>
            )}
          </>
        );
      } },
  ];

  return (
    <SalesAutoShell
      title="CRM — Cancellations & Refunds"
      subtitle="Booking cancellation requests with auto-calculated refund"
      action={
        <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <XCircle size={14} /> Request Cancellation
        </button>
      }
    >
      <DataTable
        data={cancellations}
        columns={columns}
        loading={isLoading}
        emptyMessage="No cancellation requests"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Request Cancellation</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
              <select value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {activeBookings.map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Cancellation Charge (%)</label>
              <input type="number" min={0} max={100} step="0.01" value={form.DeductionPercent}
                onChange={(e) => setForm((f) => ({ ...f, DeductionPercent: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Reason</label>
              <textarea value={form.Reason} onChange={(e) => setForm((f) => ({ ...f, Reason: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setDialogOpen(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleRequest} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Submitting..." : "Submit Request"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!refundDialog} onOpenChange={(o) => { if (!o) setRefundDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Record Refund</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Refund Date</label>
              <input type="date" value={refundForm.RefundDate}
                onChange={(e) => setRefundForm((f) => ({ ...f, RefundDate: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Refund Mode</label>
              <select value={refundForm.RefundMode} onChange={(e) => setRefundForm((f) => ({ ...f, RefundMode: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select mode</option>
                {PAY_MODES.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Reference No.</label>
              <input type="text" value={refundForm.RefundRef}
                onChange={(e) => setRefundForm((f) => ({ ...f, RefundRef: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setRefundDialog(null)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleRefund} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Saving..." : "Mark Refunded"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmCancellations;
