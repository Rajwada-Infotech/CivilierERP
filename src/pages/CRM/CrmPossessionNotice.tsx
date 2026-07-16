import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { promptNextStep } from "@/lib/workflowNav";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/possession-notice";
const BKG_API = "/api/crm/bookings";

const DELIVERY_MODES = ["Post", "Email", "Courier", "InPerson"];
const statusColor: Record<string, string> = {
  Draft: "text-muted-foreground bg-muted/50 border-border",
  Sent: "text-blue-600 bg-blue-50 border-blue-200",
  Acknowledged: "text-green-600 bg-green-50 border-green-200",
  Disputed: "text-red-600 bg-red-50 border-red-200",
};

const EMPTY_FORM = { BookingId: "", OfferedDate: "", ResponseDeadline: "", DeliveryMode: "Email" };

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmPossessionNotice: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const { data: notices = [], isLoading } = useQuery({ queryKey: ["crm-possession-notice"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });

  const handleCreate = async () => {
    if (!form.BookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, BookingId: parseInt(form.BookingId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Notice ${data.NoticeNo} created`);
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["crm-possession-notice"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleMarkSent = async (id: number) => {
    try {
      const res = await fetchWithAuth(`${API}/${id}/mark-sent`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Notice marked Sent");
      qc.invalidateQueries({ queryKey: ["crm-possession-notice"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleMarkAcknowledged = async (id: number) => {
    try {
      const res = await fetchWithAuth(`${API}/${id}/mark-acknowledged`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Notice marked Acknowledged");
      promptNextStep(navigate, "Possession notice acknowledged — handover can now be scheduled.", "/crm/handover", "Go to Handover");
      qc.invalidateQueries({ queryKey: ["crm-possession-notice"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleMarkDisputed = async (id: number) => {
    const reason = window.prompt("Reason for dispute:");
    if (!reason) return;
    try {
      const res = await fetchWithAuth(`${API}/${id}/mark-disputed`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ DisputeReason: reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Notice marked Disputed");
      qc.invalidateQueries({ queryKey: ["crm-possession-notice"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const noticeColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "NoticeNo", header: "Notice No", size: 110,
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 150,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BookingNo} · {i.row.original.UnitNo}</div>
        </div>
      ) },
    { accessorKey: "OfferedDate", header: "Offered Date", size: 110,
      cell: (i) => <span className="text-xs">{i.row.original.OfferedDate ? String(i.row.original.OfferedDate).slice(0, 10) : "—"}</span> },
    { accessorKey: "ResponseDeadline", header: "Response Deadline", size: 130,
      cell: (i) => <span className="text-xs">{i.row.original.ResponseDeadline ? String(i.row.original.ResponseDeadline).slice(0, 10) : "—"}</span> },
    { accessorKey: "DeliveryMode", header: "Mode", size: 90,
      cell: (i) => <span className="text-xs">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "Status", header: "Status", size: 100,
      cell: (i) => <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[i.row.original.Status] || ""}`}>{i.row.original.Status}</span> },
    { id: "actions", header: "Actions", size: 160, enableSorting: false,
      cell: (i) => {
        const n = i.row.original;
        return (
          <div className="flex items-center gap-2">
            {n.Status === "Draft" && (
              <button onClick={() => handleMarkSent(n.Id)} className="text-xs text-primary hover:underline">Mark Sent</button>
            )}
            {n.Status === "Sent" && (
              <>
                <button onClick={() => handleMarkAcknowledged(n.Id)} className="text-xs text-primary hover:underline">Acknowledge</button>
                <button onClick={() => handleMarkDisputed(n.Id)} className="text-xs text-red-600 hover:underline">Dispute</button>
              </>
            )}
          </div>
        );
      } },
  ];

  return (
    <SalesAutoShell
      title="CRM — Possession Notice"
      subtitle="Formal notice issuance to buyers offering possession"
      action={
        <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> New Notice
        </button>
      }
    >
      <DataTable
        data={notices as any[]}
        columns={noticeColumns}
        loading={isLoading}
        emptyMessage="No possession notices"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">New Possession Notice</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
              <select value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {(bookings as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Offered Date</label>
                <input type="date" value={form.OfferedDate} onChange={(e) => setForm((f) => ({ ...f, OfferedDate: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Response Deadline</label>
                <input type="date" value={form.ResponseDeadline} onChange={(e) => setForm((f) => ({ ...f, ResponseDeadline: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Delivery Mode</label>
              <select value={form.DeliveryMode} onChange={(e) => setForm((f) => ({ ...f, DeliveryMode: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                {DELIVERY_MODES.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmPossessionNotice;
