import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Key, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/crm/handover";
const BKG_API = "/api/crm/bookings";
const SA_LEADS_API = "/api/sa/leads";

const SNAG_CATEGORIES = ["Electrical", "Plumbing", "Civil", "Paint", "Carpentry", "Other"];
const HO_STATUSES = ["Scheduled", "SnagInspection", "SnagPending", "Completed", "Cancelled"];

const statusColor: Record<string, string> = {
  Scheduled:      "text-blue-600 bg-blue-50 border-blue-200",
  SnagInspection: "text-purple-600 bg-purple-50 border-purple-200",
  SnagPending:    "text-orange-600 bg-orange-50 border-orange-200",
  Completed:      "text-green-600 bg-green-50 border-green-200",
  Cancelled:      "text-red-600 bg-red-50 border-red-200",
};

async function fetchHandovers(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchDetail(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  if (!r.ok) throw new Error("Failed to load handover");
  return r.json();
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchUsers(): Promise<{ value: string; label: string }[]> {
  try {
    const r = await fetchWithAuth(`${SA_LEADS_API}/users`);
    if (!r.ok) return [];
    const d: any[] = await r.json();
    return d.map((u) => ({ value: String(u.Id), label: u.Name }));
  } catch { return []; }
}

const CrmHandover: React.FC = () => {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newDialog, setNewDialog] = useState(false);
  const [snagDialog, setSnagDialog] = useState(false);
  const [newForm, setNewForm] = useState({ BookingId: "", ScheduledDate: "", Notes: "" });
  const [snagForm, setSnagForm] = useState({ Category: "Electrical", Description: "", PhotoUrl: "" });
  const [saving, setSaving] = useState(false);

  const { data: handovers = [], isLoading } = useQuery({ queryKey: ["crm-handovers"], queryFn: fetchHandovers, staleTime: 60_000 });
  const { data: detail } = useQuery({
    queryKey: ["crm-handover-detail", selectedId],
    queryFn: () => fetchDetail(selectedId!),
    enabled: !!selectedId,
    staleTime: 30_000,
  });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });

  const handleSchedule = async () => {
    if (!newForm.BookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BookingId: parseInt(newForm.BookingId),
          ScheduledDate: newForm.ScheduledDate || null,
          Notes: newForm.Notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Handover scheduled");
      setNewDialog(false);
      setNewForm({ BookingId: "", ScheduledDate: "", Notes: "" });
      qc.invalidateQueries({ queryKey: ["crm-handovers"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddSnag = async () => {
    if (!selectedId || !snagForm.Description.trim()) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/snags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snagForm),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Snag item raised");
      setSnagDialog(false);
      setSnagForm({ Category: "Electrical", Description: "", PhotoUrl: "" });
      qc.invalidateQueries({ queryKey: ["crm-handover-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-handovers"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleResolveSnag = async (snagId: number) => {
    if (!selectedId) return;
    try {
      await fetchWithAuth(`${API}/${selectedId}/snags/${snagId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: "Resolved" }),
      });
      qc.invalidateQueries({ queryKey: ["crm-handover-detail", selectedId] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleUpdateStatus = async (status: string) => {
    if (!selectedId) return;
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Handover status updated to ${status}`);
      qc.invalidateQueries({ queryKey: ["crm-handover-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-handovers"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <SalesAutoShell
      title="CRM — Possession & Handover"
      subtitle="Snag inspection and key handover workflow"
      action={
        <button onClick={() => setNewDialog(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Key size={14} /> Schedule Handover
        </button>
      }
    >
      <div className="flex gap-4 h-[calc(100vh-220px)]">
        <div className="w-80 shrink-0 overflow-y-auto space-y-1.5">
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
          ) : handovers.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm">No handovers scheduled</div>
          ) : (handovers as any[]).map((h: any) => (
            <button key={h.Id} onClick={() => setSelectedId(h.Id)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedId === h.Id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">{h.ApplicantName}</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${statusColor[h.Status] || ""}`}>{h.Status}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{h.BookingNo} · {h.UnitNo}</div>
              {h.OpenSnagCount > 0 && (
                <div className="text-xs text-orange-600 flex items-center gap-1 mt-1">
                  <AlertTriangle size={10} /> {h.OpenSnagCount} open snag(s)
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-4">
          {!selectedId ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Select a handover</div>
          ) : !detail ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
          ) : (
            <>
              <div className="rounded-xl border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="font-bold">{detail.handover.ApplicantName}</h2>
                    <p className="text-xs text-muted-foreground">{detail.handover.BookingNo} · {detail.handover.UnitNo}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[detail.handover.Status] || ""}`}>
                    {detail.handover.Status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                  <div><span className="text-xs text-muted-foreground">Scheduled: </span>{detail.handover.ScheduledDate ? String(detail.handover.ScheduledDate).slice(0,10) : "—"}</div>
                  <div><span className="text-xs text-muted-foreground">Actual: </span>{detail.handover.ActualHandoverDate ? String(detail.handover.ActualHandoverDate).slice(0,10) : "—"}</div>
                  <div><span className="text-xs text-muted-foreground">Dues Cleared: </span>{detail.handover.FinalDuesCleared ? "Yes" : "No"}</div>
                  <div><span className="text-xs text-muted-foreground">Acknowledged: </span>{detail.handover.CustomerAcknowledged ? "Yes" : "No"}</div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {HO_STATUSES.filter((s) => s !== detail.handover.Status).map((s) => (
                    <button key={s} onClick={() => handleUpdateStatus(s)}
                      className="text-xs px-2 py-1 border border-border rounded-lg hover:bg-muted transition-colors">
                      → {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Snag / Defect List ({detail.snags?.length || 0})</h3>
                  <button onClick={() => setSnagDialog(true)} className="flex items-center gap-1 text-xs text-primary hover:underline">
                    <Plus size={12} /> Raise Snag
                  </button>
                </div>
                {!detail.snags?.length ? (
                  <div className="p-4 text-center text-muted-foreground text-sm">No snag items</div>
                ) : (detail.snags as any[]).map((s: any) => (
                  <div key={s.Id} className="px-4 py-3 border-b border-border last:border-0 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{s.Category}</div>
                      <div className="text-xs text-muted-foreground">{s.Description}</div>
                      {s.RaisedByName && <div className="text-xs text-muted-foreground">Raised by {s.RaisedByName}</div>}
                    </div>
                    {s.Status === "Resolved" ? (
                      <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 size={12} /> Resolved</span>
                    ) : (
                      <button onClick={() => handleResolveSnag(s.Id)} className="text-xs text-primary hover:underline whitespace-nowrap">
                        Mark Resolved
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={newDialog} onOpenChange={(o) => { if (!o) setNewDialog(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">Schedule Handover</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking * (must have an executed agreement)</label>
              <select value={newForm.BookingId} onChange={(e) => setNewForm((f) => ({ ...f, BookingId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {(bookings as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Scheduled Date</label>
              <input type="date" value={newForm.ScheduledDate}
                onChange={(e) => setNewForm((f) => ({ ...f, ScheduledDate: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <textarea value={newForm.Notes} onChange={(e) => setNewForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setNewDialog(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSchedule} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Scheduling..." : "Schedule"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={snagDialog} onOpenChange={(o) => { if (!o) setSnagDialog(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Raise Snag Item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Category</label>
              <select value={snagForm.Category} onChange={(e) => setSnagForm((f) => ({ ...f, Category: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                {SNAG_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Description *</label>
              <textarea value={snagForm.Description} onChange={(e) => setSnagForm((f) => ({ ...f, Description: e.target.value }))}
                rows={3} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Photo URL</label>
              <input type="text" value={snagForm.PhotoUrl} onChange={(e) => setSnagForm((f) => ({ ...f, PhotoUrl: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setSnagDialog(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleAddSnag} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Adding..." : "Raise Snag"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmHandover;
