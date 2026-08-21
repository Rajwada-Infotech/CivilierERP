import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { Plus, AlertTriangle, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { promptNextStep } from "@/lib/workflowNav";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const API = "/api/crm/possession-notice";
const BKG_API = "/api/crm/bookings";

const DELIVERY_MODES = ["Post", "Email", "Courier", "InPerson"];
const statusColor: Record<string, string> = {
  Draft: "text-muted-foreground bg-muted/50 border-border",
  Sent: "text-blue-600 bg-blue-50 border-blue-200",
  Acknowledged: "text-green-600 bg-green-50 border-green-200",
  Disputed: "text-red-600 bg-red-50 border-red-200",
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const deadlineISO = () => { const d = new Date(); d.setDate(d.getDate() + 15); return d.toISOString().slice(0, 10); };
const EMPTY_FORM = { BookingId: "", OfferedDate: todayISO(), ResponseDeadline: deadlineISO(), DeliveryMode: "Email" };

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmPossessionNotice: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  usePageRights("crm-possession-notice");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [disputeDialog, setDisputeDialog] = useState<number | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [retractDialog, setRetractDialog] = useState<number | null>(null);
  const [retractReason, setRetractReason] = useState("");

  const { data: notices = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["crm-possession-notice"], queryFn: fetchAll, staleTime: 30_000 });
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
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
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
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
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
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleMarkDisputed = async () => {
    if (!disputeDialog || !disputeReason.trim()) { toast.error("Dispute reason is required"); return; }
    try {
      const res = await fetchWithAuth(`${API}/${disputeDialog}/mark-disputed`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ DisputeReason: disputeReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Notice marked Disputed");
      setDisputeDialog(null);
      setDisputeReason("");
      qc.invalidateQueries({ queryKey: ["crm-possession-notice"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleRetractDispute = async () => {
    if (!retractDialog || !retractReason.trim()) { toast.error("Retract reason is required"); return; }
    try {
      const res = await fetchWithAuth(`${API}/${retractDialog}/retract-dispute`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ RetractReason: retractReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Dispute retracted — notice returned to Draft. You can now re-send it.");
      setRetractDialog(null);
      setRetractReason("");
      qc.invalidateQueries({ queryKey: ["crm-possession-notice"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
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
    { id: "actions", header: "Actions", size: 200, enableSorting: false,
      cell: (i) => {
        const n = i.row.original;
        return (
          <div className="flex items-center gap-2 flex-wrap">
            {n.Status === "Draft" && (
              <button onClick={() => handleMarkSent(n.Id)} className="text-xs text-primary hover:underline">Mark Sent</button>
            )}
            {n.Status === "Sent" && (
              <>
                <button onClick={() => handleMarkAcknowledged(n.Id)} className="text-xs text-primary hover:underline">Acknowledge</button>
                <button onClick={() => { setDisputeDialog(n.Id); setDisputeReason(""); }} className="text-xs text-red-600 hover:underline">Dispute</button>
              </>
            )}
            {n.Status === "Disputed" && (
              <button onClick={() => { setRetractDialog(n.Id); setRetractReason(""); }}
                className="flex items-center gap-1 text-xs text-amber-700 hover:underline">
                <RotateCcw size={11} /> Retract Dispute
              </button>
            )}
          </div>
        );
      } },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Possession Notice"]} />
      <CrmShell
        title="CRM — Possession Notice"
      subtitle="Formal notice issuance to buyers offering possession"
      action={
          <div className="flex items-center gap-3">
          <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
          <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> New Notice
        </button>
        </div>
      }
    >
      {!isLoading && (notices as any[]).length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-border bg-muted/20 space-y-2 text-center">
          <div className="text-2xl">📋</div>
          <p className="text-sm font-medium text-foreground">No possession notices yet</p>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
            A possession notice is issued once pre-possession inspection is cleared and the unit is ready to hand over.
          </p>
          <button onClick={() => setDialogOpen(true)} className="mt-1 text-xs text-primary hover:underline font-medium">
            Issue First Notice →
          </button>
        </div>
      ) : (
        <DataTable
          data={notices as any[]}
          columns={noticeColumns}
          loading={isLoading}
          emptyMessage="No possession notices"
          className="rounded-xl border border-border overflow-hidden bg-card"
        />
      )}

      {/* Dispute reason dialog */}
      <Dialog open={!!disputeDialog} onOpenChange={(o) => { if (!o) { setDisputeDialog(null); setDisputeReason(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-500" /> Mark Notice Disputed
            </DialogTitle>
          </DialogHeader>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Dispute Reason *</label>
            <textarea value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)}
              rows={3} placeholder="Describe the customer's objection or dispute..."
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDisputeDialog(null); setDisputeReason(""); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleMarkDisputed} disabled={!disputeReason.trim()}
              className="px-4 py-1.5 text-sm bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-40">
              Mark Disputed
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Retract dispute dialog — Disputed → Draft */}
      <Dialog open={!!retractDialog} onOpenChange={(o) => { if (!o) { setRetractDialog(null); setRetractReason(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <RotateCcw size={16} className="text-amber-600" /> Retract Dispute
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This returns the notice to Draft so it can be revised and re-sent. Describe how the dispute was resolved.</p>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Resolution / Retract Reason *</label>
            <textarea value={retractReason} onChange={(e) => setRetractReason(e.target.value)}
              rows={3} placeholder="How was the customer's dispute resolved?"
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setRetractDialog(null); setRetractReason(""); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleRetractDispute} disabled={!retractReason.trim()}
              className="px-4 py-1.5 text-sm bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:opacity-40">
              Retract &amp; Return to Draft
            </button>
          </div>
        </DialogContent>
      </Dialog>

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
      </CrmShell>
    </>
  );
};

export default CrmPossessionNotice;
