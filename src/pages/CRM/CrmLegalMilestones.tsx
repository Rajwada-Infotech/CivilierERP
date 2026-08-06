import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, CheckCircle2, Circle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/crm/legal-milestones";
const BKG_API = "/api/crm/bookings";

const STEPS = [
  { key: "DocCollection",     label: "Document Collection" },
  { key: "LegalReview",       label: "Legal Executive Assigned" },
  { key: "Drafting",          label: "Drafting" },
  { key: "InternalApproval",  label: "Internal Approval" },
  { key: "DocShared",         label: "Document Shared" },
  { key: "MutualAgreement",   label: "Mutual Agreement" },
  { key: "DirectorMeeting",   label: "Director Meeting" },
  { key: "FinalExecution",    label: "Final Execution" },
];

// Every step but DirectorMeeting now auto-ticks the instant its real-world
// equivalent happens on the Agreement page (see syncLegalMilestoneStep /
// syncLegalMilestoneFromDocument in crmWorkflowGuards.js) — a manual
// "Mark Complete" for those would just be a way to fake a step that hasn't
// actually happened yet. DirectorMeeting has no digital trace (a literal
// in-person meeting), so it stays the one manual checkbox on this page.
const MANUAL_STEPS = new Set(["DirectorMeeting"]);

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmLegalMilestones: React.FC = () => {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newDialog, setNewDialog] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: trackers = [], isLoading } = useQuery({ queryKey: ["crm-legal-milestones"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });

  const selected = (trackers as any[]).find((t: any) => t.Id === selectedId);

  // Legal Milestone trackers are now auto-started the moment a booking's
  // agreement is created (see maybeAutoCreateLegalMilestone), so this
  // manual dialog is only ever needed as a fallback for a booking that
  // somehow doesn't have one yet — never to start a second tracker for a
  // booking that already has one (the backend already 409s on that, but
  // the dropdown shouldn't even offer it).
  const trackedBookingIds = new Set((trackers as any[]).map((t: any) => t.BookingId));
  const startableBookings = (bookings as any[]).filter((b: any) => !trackedBookingIds.has(b.Id));

  const handleStart = async () => {
    if (!bookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BookingId: parseInt(bookingId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Legal workflow started");
      setNewDialog(false);
      setBookingId("");
      qc.invalidateQueries({ queryKey: ["crm-legal-milestones"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStepUpdate = async (step: string, status: string) => {
    if (!selectedId) return;
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/${step}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: status, Done: status === "Completed" ? new Date().toISOString().slice(0, 10) : undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      qc.invalidateQueries({ queryKey: ["crm-legal-milestones"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <SalesAutoShell
      title="CRM — Legal Milestones"
      subtitle="8-step legal workflow: document collection through final execution"
      action={
        <button onClick={() => setNewDialog(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> Start Workflow
        </button>
      }
    >
      <div className="flex gap-4 h-[calc(100vh-220px)]">
        <div className="w-80 shrink-0 overflow-y-auto space-y-1.5">
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
          ) : trackers.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm">No legal workflows started</div>
          ) : (trackers as any[]).map((t: any) => (
            <button key={t.Id} onClick={() => setSelectedId(t.Id)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedId === t.Id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20"}`}>
              <div className="text-sm font-medium truncate">{t.ApplicantName}</div>
              <div className="text-xs text-muted-foreground">{t.BookingNo} · {t.UnitNo}</div>
              <div className="text-xs mt-1">Step {t.CurrentStep}/8 · {t.OverallStatus}</div>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Select a workflow</div>
          ) : (
            <div className="rounded-xl border border-border p-4 space-y-1">
              <h2 className="font-bold mb-3">{selected.ApplicantName} — {selected.BookingNo}</h2>
              {STEPS.map((s, idx) => {
                const status = selected[`${s.key}Status`];
                const due = selected[`${s.key}Due`];
                const done = selected[`${s.key}Done`];
                const isDone = status === "Completed";
                const isCurrent = selected.CurrentStep === idx + 1;
                return (
                  <div key={s.key} className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${isCurrent ? "border-primary bg-primary/5" : "border-border"}`}>
                    <div className="flex items-center gap-2">
                      {isDone ? <CheckCircle2 size={16} className="text-green-600" /> : <Circle size={16} className="text-muted-foreground" />}
                      <div>
                        <div className="text-sm font-medium">{idx + 1}. {s.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {due ? `Due ${String(due).slice(0,10)}` : ""} {done ? `· Done ${String(done).slice(0,10)}` : ""}
                        </div>
                      </div>
                    </div>
                    {!isDone && (
                      MANUAL_STEPS.has(s.key) ? (
                        <button onClick={() => handleStepUpdate(s.key, "Completed")}
                          className="text-xs px-2 py-1 border border-border rounded-lg hover:bg-muted transition-colors whitespace-nowrap">
                          Mark Complete
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">Auto-synced</span>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog open={newDialog} onOpenChange={(o) => { if (!o) setNewDialog(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Start Legal Workflow</DialogTitle></DialogHeader>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
            <select value={bookingId} onChange={(e) => setBookingId(e.target.value)}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
              <option value="">Select booking</option>
              {startableBookings.map((b: any) => (
                <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
              ))}
            </select>
            {startableBookings.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">Every booking either already has a legal workflow or has no agreement yet — trackers now start automatically once an agreement is created.</p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setNewDialog(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleStart} disabled={saving || startableBookings.length === 0}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Starting..." : "Start"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmLegalMilestones;
