import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, CheckCircle2, Circle, ArrowRight, ExternalLink, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/crm/legal-milestones";
const BKG_API = "/api/crm/bookings";

// The "what actually completes this step" text a stuck auto-synced step was
// missing entirely (just said "Auto-synced" with no way to act on it) — see
// syncLegalMilestoneStep / syncLegalMilestoneFromDocument in
// crmWorkflowGuards.js for the real trigger each of these describes.
const STEPS = [
  { key: "DocCollection",     label: "Document Collection", hint: "Verify the customer's Identity Proof document on the Agreement page" },
  { key: "LegalReview",       label: "Legal Executive Assigned", hint: "Assign a Legal Executive to the agreement" },
  { key: "Drafting",          label: "Drafting", hint: "Upload the Sale Agreement document" },
  { key: "InternalApproval",  label: "Internal Approval", hint: "Get senior approval on the agreement" },
  { key: "DocShared",         label: "Document Shared", hint: "Send the agreement to the customer" },
  { key: "MutualAgreement",   label: "Mutual Agreement", hint: "Customer approves the agreement in their portal" },
  { key: "DirectorMeeting",   label: "Director Meeting", hint: "" },
  { key: "FinalExecution",    label: "Final Execution", hint: "Mark the agreement Executed" },
];

// Every step but DirectorMeeting now auto-ticks the instant its real-world
// equivalent happens on the Agreement page (see syncLegalMilestoneStep /
// syncLegalMilestoneFromDocument in crmWorkflowGuards.js) — a manual
// "Mark Complete" for those would just be a way to fake a step that hasn't
// actually happened yet. DirectorMeeting has no digital trace (a literal
// in-person meeting), so it stays the one manual checkbox on this page.
const MANUAL_STEPS = new Set(["DirectorMeeting"]);

async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `Failed to load legal workflows (HTTP ${r.status})`);
  return r.json();
}
async function fetchBookings(): Promise<any[]> {
  const r = await fetchWithAuth(BKG_API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `Failed to load bookings (HTTP ${r.status})`);
  return r.json();
}

// The real journey doesn't stop at Final Execution — it continues through
// Sales Deed, Query Payment (the customer-to-government stamp
// duty/registration payment, tracked here because we send the customer all
// the paperwork and confirm they've paid), Registry, and finally Bank NOC.
// Each stage is gated on the one before it (see crmSalesDeed.js /
// crmQueryPayment.js / crmRegistry.js / crmNoc.js) and owns its own
// create/update UI on its dedicated page — this page only summarizes +
// links out, it never duplicates that logic.
function buildPostAgreementStages(t: any) {
  const deedStatus = t.DeedRegistrationNo ? "Registered" : t.DeedExecutedBy ? "Executed" : t.SalesDeedId ? "Drafted" : null;
  return [
    {
      key: "salesDeed",
      label: "Sales Deed",
      path: "/crm/sales-deed",
      no: t.DeedNo,
      status: deedStatus,
      isDone: !!t.SalesDeedId,
      unlockedHint: "Mark the agreement Executed (step 8) to enable drafting the Sales Deed",
    },
    {
      key: "queryPayment",
      label: "Query Payment",
      path: "/crm/query-payment",
      no: t.QPNo,
      status: t.QueryPaymentStatus || null,
      isDone: t.QueryPaymentStatus === "Confirmed",
      unlockedHint: "Requires the Sales Deed to exist first",
    },
    {
      key: "registry",
      label: "Registry",
      path: "/crm/registry",
      no: t.RegNo,
      status: t.RegistryStatus || null,
      isDone: t.RegistryStatus === "Completed",
      unlockedHint: "Requires Query Payment to be Confirmed first",
    },
    {
      key: "bankNoc",
      label: "Bank NOC",
      path: "/crm/noc",
      no: t.BankNocNo,
      status: t.BankNocStatus || null,
      isDone: t.BankNocStatus === "Issued",
      unlockedHint: "Requires the Sales Deed to exist first",
    },
  ];
}

const stageStatusColor: Record<string, string> = {
  Registered: "text-green-700 bg-green-50 border-green-200",
  Executed:   "text-blue-700 bg-blue-50 border-blue-200",
  Drafted:    "text-orange-700 bg-orange-50 border-orange-200",
  Confirmed:  "text-green-700 bg-green-50 border-green-200",
  InfoSent:   "text-blue-700 bg-blue-50 border-blue-200",
  Pending:    "text-orange-700 bg-orange-50 border-orange-200",
  Completed:  "text-green-700 bg-green-50 border-green-200",
  Scheduled:  "text-blue-700 bg-blue-50 border-blue-200",
  Issued:     "text-green-700 bg-green-50 border-green-200",
  Approved:   "text-blue-700 bg-blue-50 border-blue-200",
};

const CrmLegalMilestones: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newDialog, setNewDialog] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: trackers = [], isLoading, isFetching, dataUpdatedAt, refetch, isError, error } = useQuery({ queryKey: ["crm-legal-milestones"], queryFn: fetchAll, staleTime: 30_000 });
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
      toast.error(translateError(e.message));
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
      toast.error(translateError(e.message));
    }
  };

  const agreementDone = selected?.FinalExecutionStatus === "Completed";
  const postStages = selected ? buildPostAgreementStages(selected) : [];

  return (
    <CrmShell
      title="CRM — Legal Milestones"
      subtitle="Agreement through registration: the full post-booking legal journey in one place"
      action={
          <div className="flex items-center gap-3">
          <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
          <button onClick={() => setNewDialog(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> Start Workflow
        </button>
        </div>
      }
    >
      <div className="flex gap-4 h-[calc(100vh-220px)]">
        <div className="w-80 shrink-0 overflow-y-auto space-y-1.5">
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
          ) : isError ? (
            <div className="p-4 text-center text-sm text-destructive">{(error as any)?.message || "Failed to load legal workflows"}</div>
          ) : trackers.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm">No legal workflows started</div>
          ) : (trackers as any[]).map((t: any) => {
            const stages = buildPostAgreementStages(t);
            const allPostDone = stages.every((s) => s.isDone);
            const agrDone = t.FinalExecutionStatus === "Completed";
            return (
              <button key={t.Id} onClick={() => setSelectedId(t.Id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedId === t.Id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20"}`}>
                <div className="text-sm font-medium truncate">{t.ApplicantName}</div>
                <div className="text-xs text-muted-foreground">{t.BookingNo} · {t.UnitNo}</div>
                <div className="text-xs mt-1 flex items-center gap-1.5">
                  {!agrDone ? (
                    <span>Agreement · Step {t.CurrentStep}/8</span>
                  ) : allPostDone ? (
                    <span className="text-green-700 font-medium">Fully Registered</span>
                  ) : (
                    <span>{stages.find((s) => !s.isDone)?.label} pending</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Select a workflow</div>
          ) : (
            <div className="space-y-5 pb-6">
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="font-heading font-bold text-lg">{selected.ApplicantName}</h2>
                    <div className="text-xs text-muted-foreground">{selected.BookingNo} · {selected.UnitNo}</div>
                  </div>
                  <button
                    onClick={() => navigate(`/crm/agreements?bookingId=${selected.BookingId}`)}
                    className="flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                  >
                    View Agreement <ExternalLink size={11} />
                  </button>
                </div>

                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Agreement Workflow</div>
                <div className="relative pl-1">
                  {STEPS.map((s, idx) => {
                    const status = selected[`${s.key}Status`];
                    const due = selected[`${s.key}Due`];
                    const done = selected[`${s.key}Done`];
                    const isDone = status === "Completed";
                    const isCurrent = selected.CurrentStep === idx + 1;
                    const isLast = idx === STEPS.length - 1;
                    return (
                      <div key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
                        {!isLast && (
                          <div className={`absolute left-[9px] top-6 bottom-0 w-px ${isDone ? "bg-green-300" : "bg-border"}`} />
                        )}
                        <div className="shrink-0 mt-0.5 z-10">
                          {isDone ? (
                            <CheckCircle2 size={19} className="text-green-600 bg-card" />
                          ) : (
                            <Circle size={19} className={isCurrent ? "text-primary bg-card" : "text-muted-foreground/40 bg-card"} />
                          )}
                        </div>
                        <div className={`flex-1 flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 ${isCurrent ? "bg-primary/5 border border-primary/30" : ""}`}>
                          <div>
                            <div className="text-sm font-medium">{s.label}</div>
                            <div className="text-xs text-muted-foreground">
                              {isDone
                                ? <>{due ? `Due ${String(due).slice(0,10)}` : ""} {done ? `· Done ${String(done).slice(0,10)}` : ""}</>
                                : s.hint && <span className="flex items-center gap-1"><ArrowRight size={10} /> {s.hint}</span>}
                            </div>
                          </div>
                          {!isDone && (
                            MANUAL_STEPS.has(s.key) ? (
                              <button onClick={() => handleStepUpdate(s.key, "Completed")}
                                className="text-xs px-2 py-1 border border-border rounded-lg hover:bg-muted transition-colors whitespace-nowrap shrink-0">
                                Mark Complete
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">Auto-synced</span>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Post-Agreement</div>
                <div className="text-xs text-muted-foreground mb-4">Sales Deed → Query Payment → Registry → Bank NOC — each stage gated on the one before it</div>
                {!agreementDone ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                    <Lock size={14} /> Unlocks once the Agreement Workflow above reaches Final Execution
                  </div>
                ) : (
                  <div className="relative pl-1">
                    {postStages.map((s, idx) => {
                      const isLast = idx === postStages.length - 1;
                      const prevDone = idx === 0 || postStages[idx - 1].isDone;
                      const isLocked = !s.status && !prevDone;
                      return (
                        <div key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
                          {!isLast && (
                            <div className={`absolute left-[9px] top-6 bottom-0 w-px ${s.isDone ? "bg-green-300" : "bg-border"}`} />
                          )}
                          <div className="shrink-0 mt-0.5 z-10">
                            {s.isDone ? (
                              <CheckCircle2 size={19} className="text-green-600 bg-card" />
                            ) : isLocked ? (
                              <Lock size={14} className="text-muted-foreground/40 bg-card ml-[2px] mt-[2px]" />
                            ) : (
                              <Circle size={19} className="text-primary bg-card" />
                            )}
                          </div>
                          <div className="flex-1 flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{s.label}</span>
                                {s.no && <span className="text-xs font-mono text-muted-foreground">{s.no}</span>}
                                {s.status && (
                                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full border font-medium ${stageStatusColor[s.status] || ""}`}>{s.status}</span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {isLocked && <span className="flex items-center gap-1"><ArrowRight size={10} /> {s.unlockedHint}</span>}
                              </div>
                            </div>
                            <button
                              onClick={() => navigate(`${s.path}?bookingId=${selected.BookingId}`)}
                              className="flex items-center gap-1 text-xs text-primary hover:underline whitespace-nowrap shrink-0"
                            >
                              {s.status ? "Open" : isLocked ? "View" : "Start"} <ExternalLink size={11} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
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
    </CrmShell>
  );
};

export default CrmLegalMilestones;
