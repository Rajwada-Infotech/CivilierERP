import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { promptNextStep } from "@/lib/workflowNav";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { Plus, Key, AlertTriangle, CheckCircle2, User } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const API        = "/api/crm/handover";
const SA_LEADS_API = "/api/sa/leads";

// ─── State machine ────────────────────────────────────────────────────────────
// Backend enforces this; the frontend mirrors it so we never show a button that
// will be rejected by the server.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  Scheduled:      ["SnagInspection", "Cancelled"],
  SnagInspection: ["SnagPending", "Cancelled"],
  SnagPending:    ["Completed", "Cancelled"],
  Completed:      [],
  Cancelled:      [],
};

const SNAG_CATEGORIES = ["Electrical", "Plumbing", "Civil", "Paint", "Carpentry", "Other"];

const statusColor: Record<string, string> = {
  Scheduled:      "text-blue-600 bg-blue-50 border-blue-200",
  SnagInspection: "text-purple-600 bg-purple-50 border-purple-200",
  SnagPending:    "text-orange-600 bg-orange-50 border-orange-200",
  Completed:      "text-green-600 bg-green-50 border-green-200",
  Cancelled:      "text-red-600 bg-red-50 border-red-200",
};

const statusLabel: Record<string, string> = {
  SnagInspection: "Start Inspection",
  SnagPending:    "Snag Pending",
  Completed:      "Complete Handover",
  Cancelled:      "Cancel",
};

// ─── API helpers ─────────────────────────────────────────────────────────────
async function fetchHandovers(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchDetail(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  if (!r.ok) throw new Error("Failed to load handover");
  return r.json();
}
async function fetchEligibleBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/eligible-bookings`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchUsers(): Promise<{ value: string; label: string }[]> {
  try {
    const r = await fetchWithAuth(`${SA_LEADS_API}/users`);
    if (!r.ok) return [];
    const d: any[] = await r.json();
    return d.map((u) => ({ value: String(u.Id), label: u.Name }));
  } catch { return []; }
}

// ─── Component ────────────────────────────────────────────────────────────────
const CrmHandover: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [selectedId, setSelectedId]     = useState<number | null>(null);
  const [newDialog, setNewDialog]       = useState(false);
  const [snagDialog, setSnagDialog]     = useState(false);
  const [completeDialog, setCompleteDialog] = useState(false);
  const [saving, setSaving]             = useState(false);

  const defaultScheduled = () => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); };
  const [newForm, setNewForm] = useState({ BookingId: "", ScheduledDate: defaultScheduled(), Notes: "" });
  const [snagForm, setSnagForm] = useState({ Category: "Electrical", Description: "" });

  // Completion form — collects all 4 mandatory backend fields
  const [completeForm, setCompleteForm] = useState({
    ActualHandoverDate: "",
    KeyHandoverBy: "",
    FinalDuesCleared: false,
    CustomerAcknowledged: false,
  });

  const { data: handovers = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: ["crm-handovers"], queryFn: fetchHandovers, staleTime: 30_000,
  });
  const { data: detail } = useQuery({
    queryKey: ["crm-handover-detail", selectedId],
    queryFn: () => fetchDetail(selectedId!),
    enabled: !!selectedId,
    staleTime: 30_000,
  });
  // Only bookings that pass every handover prerequisite gate
  const { data: eligibleBookings = [] } = useQuery({
    queryKey: ["crm-handover-eligible"],
    queryFn: fetchEligibleBookings,
    staleTime: 2 * 60_000,
    enabled: newDialog,
  });
  const { data: users = [] } = useQuery({
    queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000,
  });

  // ── Schedule handover ──────────────────────────────────────────────────────
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
      qc.invalidateQueries({ queryKey: ["crm-handover-eligible"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  // ── Raise snag ─────────────────────────────────────────────────────────────
  const handleAddSnag = async () => {
    if (!selectedId || !snagForm.Description.trim()) { toast.error("Description is required"); return; }
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
      setSnagForm({ Category: "Electrical", Description: "" });
      qc.invalidateQueries({ queryKey: ["crm-handover-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-handovers"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  // ── Resolve snag ───────────────────────────────────────────────────────────
  const handleResolveSnag = async (snagId: number) => {
    if (!selectedId) return;
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/snags/${snagId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: "Resolved" }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Snag resolved");
      qc.invalidateQueries({ queryKey: ["crm-handover-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-handovers"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  // ── Status transition (non-Completed) ──────────────────────────────────────
  const handleTransition = async (targetStatus: string) => {
    if (!selectedId) return;
    if (targetStatus === "Completed") {
      // Completed requires the full completion dialog
      setCompleteForm({ ActualHandoverDate: "", KeyHandoverBy: "", FinalDuesCleared: false, CustomerAcknowledged: false });
      setCompleteDialog(true);
      return;
    }
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: targetStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Handover moved to ${targetStatus}`);
      qc.invalidateQueries({ queryKey: ["crm-handover-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-handovers"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  // ── Complete handover (with all mandatory fields) ──────────────────────────
  const handleComplete = async () => {
    if (!selectedId) return;
    if (!completeForm.ActualHandoverDate) { toast.error("Actual handover date is required"); return; }
    if (!completeForm.KeyHandoverBy) { toast.error("Select the staff member who handed the key"); return; }
    if (!completeForm.FinalDuesCleared) { toast.error("Confirm that all final dues are cleared"); return; }
    if (!completeForm.CustomerAcknowledged) { toast.error("Confirm that the customer has acknowledged possession"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Status: "Completed",
          ActualHandoverDate: completeForm.ActualHandoverDate,
          KeyHandoverBy: parseInt(completeForm.KeyHandoverBy),
          FinalDuesCleared: true,
          CustomerAcknowledged: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Handover completed");
      setCompleteDialog(false);
      qc.invalidateQueries({ queryKey: ["crm-handover-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-handovers"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      // Completed handover changes dashboard KPIs immediately
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
      promptNextStep(
        navigate,
        "Handover completed — raise after-sales service tickets for any warranty or follow-up issues.",
        "/crm/service-tickets",
        "Go to Service Tickets"
      );
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const currentStatus = detail?.handover?.Status ?? "";
  const allowedNextStatuses = ALLOWED_TRANSITIONS[currentStatus] ?? [];

  usePageRights("crm-handover");

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Handover"]} />
      <CrmShell
        title="CRM — Possession & Handover"
      subtitle="Snag inspection and key handover workflow"
      action={
          <div className="flex items-center gap-3">
          <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
          <button onClick={() => setNewDialog(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Key size={14} /> Schedule Handover
        </button>
        </div>
      }
    >
      <div className="flex gap-4 h-[calc(100vh-220px)]">
        {/* ── List panel ─────────────────────────────────────────────────── */}
        <div className="w-80 shrink-0 overflow-y-auto space-y-1.5">
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
          ) : (handovers as any[]).length === 0 ? (
            <div className="p-5 rounded-xl border border-dashed border-border bg-muted/20 space-y-2 text-center">
              <div className="text-2xl">🔑</div>
              <p className="text-sm font-medium text-foreground">No handovers scheduled</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Handover can be scheduled once the Sales Deed is approved by both the customer and the Director, and all NOCs have been issued.
              </p>
              <button onClick={() => setNewDialog(true)}
                className="mt-1 text-xs text-primary hover:underline font-medium">
                Schedule First Handover →
              </button>
            </div>
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

        {/* ── Detail panel ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto space-y-4">
          {!selectedId ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Select a handover</div>
          ) : !detail ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
          ) : (
            <>
              {/* Handover header card */}
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

                {/* Dates & flags */}
                <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                  <div><span className="text-xs text-muted-foreground">Scheduled: </span>{detail.handover.ScheduledDate ? String(detail.handover.ScheduledDate).slice(0, 10) : "—"}</div>
                  <div><span className="text-xs text-muted-foreground">Actual: </span>{detail.handover.ActualHandoverDate ? String(detail.handover.ActualHandoverDate).slice(0, 10) : "—"}</div>
                  <div>
                    <span className="text-xs text-muted-foreground">Dues Cleared: </span>
                    {detail.handover.FinalDuesCleared
                      ? <span className="text-green-600 font-medium">✓ Yes</span>
                      : <span className="text-muted-foreground">No</span>}
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Customer Ack: </span>
                    {detail.handover.CustomerAcknowledged
                      ? <span className="text-green-600 font-medium">✓ Yes</span>
                      : <span className="text-muted-foreground">No</span>}
                  </div>
                  {detail.handover.KeyHandoverByName && (
                    <div className="col-span-2 flex items-center gap-1">
                      <User size={12} className="text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Key handed by: </span>
                      <span className="text-xs font-medium">{detail.handover.KeyHandoverByName}</span>
                    </div>
                  )}
                </div>

                {/* State-machine-aware transition buttons */}
                {allowedNextStatuses.length > 0 && (
                  <div className="flex gap-2 flex-wrap pt-2 border-t border-border">
                    {allowedNextStatuses.map((s) => (
                      <button key={s} onClick={() => handleTransition(s)}
                        className={`text-xs px-3 py-1.5 border rounded-lg font-medium transition-colors ${
                          s === "Completed"
                            ? "border-green-300 text-green-700 hover:bg-green-50"
                            : s === "Cancelled"
                            ? "border-red-200 text-red-600 hover:bg-red-50"
                            : "border-border hover:bg-muted"
                        }`}>
                        → {statusLabel[s] ?? s}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Snag list */}
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Snag / Defect List ({detail.snags?.length || 0})</h3>
                  {!["Completed", "Cancelled"].includes(currentStatus) && (
                    <button onClick={() => setSnagDialog(true)} className="flex items-center gap-1 text-xs text-primary hover:underline">
                      <Plus size={12} /> Raise Snag
                    </button>
                  )}
                </div>
                {!detail.snags?.length ? (
                  <div className="p-4 text-center text-muted-foreground text-sm">No snag items</div>
                ) : (detail.snags as any[]).map((s: any) => (
                  <div key={s.Id} className="px-4 py-3 border-b border-border last:border-0 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{s.Category}</div>
                      <div className="text-xs text-muted-foreground">{s.Description}</div>
                      {s.RaisedByName && <div className="text-xs text-muted-foreground">Raised by {s.RaisedByName}</div>}
                      {s.ResolvedByName && <div className="text-xs text-muted-foreground">Resolved by {s.ResolvedByName}</div>}
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

      {/* ── Schedule Handover dialog ─────────────────────────────────────── */}
      <Dialog open={newDialog} onOpenChange={(o) => { if (!o) setNewDialog(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">Schedule Handover</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Booking *{" "}
                <span className="text-[10px] text-primary">(only eligible bookings shown — agreement executed, deed approved by both sides, all NOCs issued)</span>
              </label>
              <select value={newForm.BookingId} onChange={(e) => setNewForm((f) => ({ ...f, BookingId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {(eligibleBookings as any[]).length === 0 && (
                  <option disabled value="">— No eligible bookings —</option>
                )}
                {(eligibleBookings as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName} ({b.UnitNo})</option>
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
          <DialogFooter>
            <button onClick={() => setNewDialog(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSchedule} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Scheduling..." : "Schedule"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Raise Snag dialog ────────────────────────────────────────────── */}
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
          </div>
          <DialogFooter>
            <button onClick={() => setSnagDialog(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleAddSnag} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Adding..." : "Raise Snag"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Complete Handover dialog ─────────────────────────────────────── */}
      {/* Collecting all 4 mandatory fields the backend requires for Completed:
          ActualHandoverDate, KeyHandoverBy, FinalDuesCleared, CustomerAcknowledged */}
      <Dialog open={completeDialog} onOpenChange={(o) => { if (!o) setCompleteDialog(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Complete Handover</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            All fields below are mandatory — they form the permanent record of the physical key handover event.
          </p>
          <div className="space-y-3 pt-1">
            <div>
              <label className="text-xs font-medium block mb-1">Actual Handover Date *</label>
              <input type="date" value={completeForm.ActualHandoverDate}
                onChange={(e) => setCompleteForm((f) => ({ ...f, ActualHandoverDate: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Key Handed Over By (Staff Member) *</label>
              <select value={completeForm.KeyHandoverBy}
                onChange={(e) => setCompleteForm((f) => ({ ...f, KeyHandoverBy: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">— Select staff member —</option>
                {(users as any[]).map((u: any) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
            <div className="rounded-lg border border-border p-3 space-y-2.5">
              <p className="text-xs font-semibold text-foreground">Handover Confirmations *</p>
              <label className="flex items-start gap-2.5 cursor-pointer group">
                <input type="checkbox" checked={completeForm.FinalDuesCleared}
                  onChange={(e) => setCompleteForm((f) => ({ ...f, FinalDuesCleared: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 rounded accent-primary" />
                <span className="text-sm text-foreground">
                  All final dues have been cleared — no outstanding payment demands remain against this booking.
                </span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer group">
                <input type="checkbox" checked={completeForm.CustomerAcknowledged}
                  onChange={(e) => setCompleteForm((f) => ({ ...f, CustomerAcknowledged: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 rounded accent-primary" />
                <span className="text-sm text-foreground">
                  Customer has physically acknowledged possession and received the keys.
                </span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setCompleteDialog(false)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">
              Cancel
            </button>
            <button onClick={handleComplete} disabled={saving}
              className="px-4 py-1.5 text-sm bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-40">
              {saving ? "Completing..." : "Confirm & Complete"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CrmShell>
  );
};

export default CrmHandover;
