import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { promptNextStep } from "@/lib/workflowNav";

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
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 text-left">
              {["Notice No", "Customer", "Offered Date", "Response Deadline", "Mode", "Status", "Actions"].map((h) => (
                <th key={h} className="px-4 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading...</td></tr>
            ) : notices.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No possession notices</td></tr>
            ) : (notices as any[]).map((n: any) => (
              <tr key={n.Id} className="border-t border-border hover:bg-muted/10 transition-colors">
                <td className="px-4 py-3 font-mono text-xs font-semibold text-primary">{n.NoticeNo}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{n.ApplicantName}</div>
                  <div className="text-xs text-muted-foreground">{n.BookingNo} · {n.UnitNo}</div>
                </td>
                <td className="px-4 py-3 text-xs">{n.OfferedDate ? String(n.OfferedDate).slice(0,10) : "—"}</td>
                <td className="px-4 py-3 text-xs">{n.ResponseDeadline ? String(n.ResponseDeadline).slice(0,10) : "—"}</td>
                <td className="px-4 py-3 text-xs">{n.DeliveryMode || "—"}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[n.Status] || ""}`}>{n.Status}</span>
                </td>
                <td className="px-4 py-3 flex items-center gap-2">
                  {n.Status === "Draft" && (
                    <button onClick={() => handleMarkSent(n.Id)} className="text-xs text-primary hover:underline">Mark Sent</button>
                  )}
                  {n.Status === "Sent" && (
                    <>
                      <button onClick={() => handleMarkAcknowledged(n.Id)} className="text-xs text-primary hover:underline">Acknowledge</button>
                      <button onClick={() => handleMarkDisputed(n.Id)} className="text-xs text-red-600 hover:underline">Dispute</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
