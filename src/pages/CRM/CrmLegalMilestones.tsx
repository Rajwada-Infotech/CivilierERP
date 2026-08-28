import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, CheckCircle2, Circle, ArrowRight, ExternalLink, Lock, FileCheck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/crm/legal-milestones";
const BKG_API = "/api/crm/bookings";

// Agreement workflow — 8 steps, most auto-synced from Agreement page actions.
// DirectorMeeting is the only manual step (an in-person meeting with no digital trace).
const STEPS = [
  { key: "DocCollection",    label: "Document Collection",      hint: "Verify the customer's Identity Proof on the Agreement page" },
  { key: "LegalReview",      label: "Legal Executive Assigned", hint: "Assign a Legal Executive to the agreement" },
  { key: "Drafting",         label: "Drafting",                 hint: "Upload the Sale Agreement document" },
  { key: "InternalApproval", label: "Internal Approval",        hint: "Get senior approval on the agreement" },
  { key: "DocShared",        label: "Document Shared",          hint: "Send the agreement to the customer" },
  { key: "MutualAgreement",  label: "Customer Approval",        hint: "Customer approves the agreement in their portal" },
  { key: "DirectorMeeting",  label: "Director Meeting",         hint: "" },
  { key: "FinalExecution",   label: "Final Execution",          hint: "Mark the agreement Executed" },
];
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

// ─── Types ───────────────────────────────────────────────────────────────────

interface PostStage {
  key: string;
  label: string;
  sublabel: string;
  path: string;
  no: string | null;
  status: string | null;
  isDone: boolean;
  isLocked: boolean;
  unlockedHint: string;
}

interface JourneySection {
  title: string;
  description: string;
  stages: PostStage[];
}

// ─── Journey builder ─────────────────────────────────────────────────────────

// Builds the full post-agreement journey as clearly-labeled sections so
// any team member — not just legal staff — can follow what happens and why.
function buildJourneySections(t: any, agrDone: boolean): JourneySection[] {
  const deedStatus = t.DeedRegistrationNo ? "Registered"
    : t.DeedExecutedBy ? "Executed"
    : t.SalesDeedId ? "Drafted"
    : null;

  return [
    {
      title: "Allotment Letter",
      description:
        "Issued to the buyer after at least 10% of the total consideration has been received. The buyer signs and returns it; this acknowledgement starts the 30-day Agreement for Sale clock under RERA.",
      stages: [
        {
          key: "allotmentLetter",
          label: "Allotment Letter",
          sublabel: "Issued after 10% payment; buyer acknowledges receipt",
          path: "/crm/allotment-letter",
          no: t.AlNo || null,
          status: t.AllotmentLetterStatus || null,
          isDone: t.AllotmentLetterStatus === "Acknowledged",
          isLocked: false,
          unlockedHint: "",
        },
      ],
    },
    {
      title: "Sub-Registrar Visit 1 — Registering the Agreement for Sale",
      description:
        "Before the property deal is legally recognised, the Agreement for Sale must be registered at the Sub-Registrar's Office. First the buyer confirms the stamp duty & registration fees, then both parties attend in person to register the document.",
      stages: [
        {
          key: "afsQP",
          label: "Agreement Registration Fees",
          sublabel: "Stamp duty & registration fee due before Visit 1",
          path: "/crm/afs-query-payment",
          no: t.AfsQPNo || null,
          status: t.AfsQPStatus || null,
          isDone: t.AfsQPStatus === "Confirmed",
          isLocked: !agrDone,
          unlockedHint: "Unlocks once the Agreement is executed (step 8 above)",
        },
        {
          key: "afsReg",
          label: "Agreement Registration Visit",
          sublabel: "Buyer & seller appear at Sub-Registrar Office (Visit 1)",
          path: "/crm/afs-registry",
          no: t.AfsRegNo || null,
          status: t.AfsRegistryStatus || null,
          isDone: t.AfsRegistryStatus === "Completed",
          isLocked: !agrDone || t.AfsQPStatus !== "Confirmed",
          unlockedHint: "Requires Agreement Registration Fees to be Confirmed first",
        },
      ],
    },
    {
      title: "Sale Deed Preparation",
      description:
        "After the Agreement for Sale is registered, the legal team prepares the Sale Deed — the document that legally transfers ownership of the property to the buyer. This is typically done closer to the handover date.",
      stages: [
        {
          key: "salesDeed",
          label: "Sale Deed",
          sublabel: "Ownership-transfer document prepared by the legal team",
          path: "/crm/sales-deed",
          no: t.DeedNo || null,
          status: deedStatus,
          isDone: !!t.SalesDeedId,
          isLocked: !agrDone,
          unlockedHint: "Unlocks once the Agreement is executed (step 8 above)",
        },
      ],
    },
    {
      title: "Sub-Registrar Visit 2 — Registering the Sale Deed",
      description:
        "Once the Sale Deed is ready, the same process as Visit 1 repeats for the Sale Deed: confirm the stamp duty & registration fees, then attend in person to register the Sale Deed. After this, the property is legally transferred.",
      stages: [
        {
          key: "queryPayment",
          label: "Sale Deed Registration Fees",
          sublabel: "Stamp duty & registration fee due before Visit 2",
          path: "/crm/query-payment",
          no: t.QPNo || null,
          status: t.QueryPaymentStatus || null,
          isDone: t.QueryPaymentStatus === "Confirmed",
          isLocked: !t.SalesDeedId,
          unlockedHint: "Requires the Sale Deed to be created first",
        },
        {
          key: "registry",
          label: "Sale Deed Registration Visit",
          sublabel: "Buyer & seller appear at Sub-Registrar Office (Visit 2)",
          path: "/crm/registry",
          no: t.RegNo || null,
          status: t.RegistryStatus || null,
          isDone: t.RegistryStatus === "Completed",
          isLocked: !t.SalesDeedId || t.QueryPaymentStatus !== "Confirmed",
          unlockedHint: "Requires Sale Deed Registration Fees to be Confirmed first",
        },
      ],
    },
    {
      title: "Post-Registration Formalities",
      description:
        "Once the Sale Deed is officially registered at the Sub-Registrar's Office, the municipal records are updated to reflect the new owner (Mutation/Khata Transfer) and any outstanding Bank or Organisation approvals are obtained.",
      stages: [
        {
          key: "mutation",
          label: "Property Mutation (Khata Transfer)",
          sublabel: "Municipal land records updated to the new owner's name",
          path: "/crm/mutation",
          no: t.MutationNo || null,
          status: t.MutationStatus || null,
          isDone: t.MutationStatus === "Approved",
          isLocked: t.RegistryStatus !== "Completed",
          unlockedHint: "Requires Sale Deed Registration Visit to be Completed first",
        },
        {
          key: "bankNoc",
          label: "No Objection Certificate — Bank",
          sublabel: "Bank confirms it has no objection to the transfer (loan-case NOC)",
          path: "/crm/noc",
          no: t.BankNocNo || null,
          status: t.BankNocStatus || null,
          isDone: t.BankNocStatus === "Issued",
          isLocked: !t.SalesDeedId,
          unlockedHint: "Requires the Sale Deed to exist first",
        },
        {
          key: "orgNoc",
          label: "No Objection Certificate — Organisation",
          sublabel: "Developer confirms no outstanding dues or objections",
          path: "/crm/noc",
          no: t.OrgNocNo || null,
          status: t.OrgNocStatus || null,
          isDone: t.OrgNocStatus === "Issued",
          isLocked: false,
          unlockedHint: "",
        },
      ],
    },
    {
      title: "Possession & Key Handover",
      description:
        "Once all registrations and formalities are complete, the developer issues a Possession Notice to the buyer with the offered possession date. The buyer acknowledges receipt to confirm key handover.",
      stages: [
        {
          key: "possessionNotice",
          label: "Possession Notice",
          sublabel: "Developer issues notice; buyer acknowledges or disputes",
          path: "/crm/possession-notice",
          no: null,
          status: t.PossessionNoticeStatus || null,
          isDone: t.PossessionNoticeStatus === "Acknowledged",
          isLocked: t.RegistryStatus !== "Completed",
          unlockedHint: "Requires Sale Deed Registration Visit to be Completed first",
        },
      ],
    },
  ];
}

// ─── Left-panel card status ───────────────────────────────────────────────────

function getJourneyLabel(t: any): { text: string; done: boolean } {
  const agrDone = t.FinalExecutionStatus === "Completed";
  if (!agrDone) {
    const stepLabel = STEPS[(t.CurrentStep ?? 1) - 1]?.label ?? "Agreement Preparation";
    return { text: `Agreement: ${stepLabel}`, done: false };
  }
  const postChecks = [
    { label: "Agreement Registration Fees",  done: t.AfsQPStatus === "Confirmed" },
    { label: "Agreement Registration Visit", done: t.AfsRegistryStatus === "Completed" },
    { label: "Sale Deed",                    done: !!t.SalesDeedId },
    { label: "Sale Deed Registration Fees",  done: t.QueryPaymentStatus === "Confirmed" },
    { label: "Sale Deed Registration Visit", done: t.RegistryStatus === "Completed" },
    { label: "Property Mutation",            done: t.MutationStatus === "Approved" },
    { label: "Bank NOC",                     done: t.BankNocStatus === "Issued" },
    { label: "Organisation NOC",             done: t.OrgNocStatus === "Issued" },
  ];
  const pending = postChecks.find((c) => !c.done);
  if (!pending) return { text: "Journey Complete", done: true };
  return { text: `${pending.label} pending`, done: false };
}

// ─── Status colour map ────────────────────────────────────────────────────────

const statusColor: Record<string, string> = {
  Registered: "text-green-700 bg-green-50 border-green-200",
  Executed:   "text-blue-700 bg-blue-50 border-blue-200",
  Drafted:    "text-orange-700 bg-orange-50 border-orange-200",
  Confirmed:  "text-green-700 bg-green-50 border-green-200",
  InfoSent:   "text-blue-700 bg-blue-50 border-blue-200",
  Pending:    "text-orange-700 bg-orange-50 border-orange-200",
  Completed:  "text-green-700 bg-green-50 border-green-200",
  Scheduled:  "text-blue-700 bg-blue-50 border-blue-200",
  Issued:     "text-green-700 bg-green-50 border-green-200",
  Approved:   "text-green-700 bg-green-50 border-green-200",
  Applied:    "text-orange-700 bg-orange-50 border-orange-200",
  Draft:      "text-orange-700 bg-orange-50 border-orange-200",
};

// ─── Stage row component ──────────────────────────────────────────────────────

const StageRow: React.FC<{
  stage: PostStage;
  isLast: boolean;
  bookingId: number;
  navigate: (path: string) => void;
}> = ({ stage, isLast, bookingId, navigate }) => {
  const { isDone, isLocked } = stage;
  const hasRecord = !!stage.status;

  return (
    <div className="relative flex gap-3 pb-4 last:pb-0">
      {!isLast && (
        <div className={`absolute left-[9px] top-6 bottom-0 w-px ${isDone ? "bg-green-300" : "bg-border"}`} />
      )}
      <div className="shrink-0 mt-0.5 z-10">
        {isDone ? (
          <CheckCircle2 size={19} className="text-green-600 bg-card" />
        ) : isLocked ? (
          <Lock size={14} className="text-muted-foreground/40 bg-card ml-[2px] mt-[2px]" />
        ) : (
          <Circle size={19} className="text-primary bg-card" />
        )}
      </div>
      <div className="flex-1 flex items-start justify-between gap-3 rounded-lg px-2.5 py-1.5">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-medium ${isLocked ? "text-muted-foreground" : ""}`}>{stage.label}</span>
            {stage.no && <span className="text-xs font-mono text-muted-foreground">{stage.no}</span>}
            {stage.status && (
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full border font-medium ${statusColor[stage.status] || ""}`}>
                {stage.status}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {isLocked
              ? <span className="flex items-center gap-1"><ArrowRight size={10} /> {stage.unlockedHint}</span>
              : stage.sublabel}
          </div>
        </div>
        <button
          onClick={() => navigate(`${stage.path}?bookingId=${bookingId}`)}
          className="flex items-center gap-1 text-xs text-primary hover:underline whitespace-nowrap shrink-0 mt-0.5"
        >
          {isDone ? "Open" : hasRecord ? "Continue" : isLocked ? "View" : "Start"} <ExternalLink size={11} />
        </button>
      </div>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

const CrmLegalMilestones: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newDialog, setNewDialog] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: trackers = [], isLoading, isFetching, dataUpdatedAt, refetch, isError, error } = useQuery({
    queryKey: ["crm-legal-milestones"],
    queryFn: fetchAll,
    staleTime: 30_000,
  });
  const { data: bookings = [] } = useQuery({
    queryKey: ["crm-bookings"],
    queryFn: fetchBookings,
    staleTime: 5 * 60_000,
  });

  const selected = (trackers as any[]).find((t: any) => t.Id === selectedId);
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

  const agrDone = selected?.FinalExecutionStatus === "Completed";
  const journeySections = selected ? buildJourneySections(selected, agrDone) : [];

  usePageRights("crm-legal-milestones");

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Legal Journey Overview"]} />
      <CrmShell
        title="Legal Journey Overview"
        subtitle="The complete property transaction lifecycle — from Agreement signing to Mutation — for every booking"
        action={
          <div className="flex items-center gap-3">
            <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
            <button
              onClick={() => setNewDialog(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90"
            >
              <Plus size={14} /> Start Workflow
            </button>
          </div>
        }
      >
        <div className="flex gap-4 h-[calc(100vh-220px)]">
          {/* ── Left panel: booking list ── */}
          <div className="w-80 shrink-0 overflow-y-auto space-y-1.5">
            {isLoading ? (
              <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
            ) : isError ? (
              <div className="p-4 text-center text-sm text-destructive">{(error as any)?.message || "Failed to load"}</div>
            ) : trackers.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">No legal workflows started</div>
            ) : (trackers as any[]).map((t: any) => {
              const { text, done } = getJourneyLabel(t);
              return (
                <button
                  key={t.Id}
                  onClick={() => setSelectedId(t.Id)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedId === t.Id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20"
                  }`}
                >
                  <div className="text-sm font-medium truncate">{t.ApplicantName}</div>
                  <div className="text-xs text-muted-foreground">{t.BookingNo} · {t.UnitNo}</div>
                  <div className={`text-xs mt-1 ${done ? "text-green-700 font-medium" : "text-muted-foreground"}`}>{text}</div>
                </button>
              );
            })}
          </div>

          {/* ── Right panel: journey detail ── */}
          <div className="flex-1 overflow-y-auto">
            {!selected ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                Select a booking to view its legal journey
              </div>
            ) : (
              <div className="space-y-4 pb-6">
                {/* Header */}
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-heading font-bold text-lg">{selected.ApplicantName}</h2>
                      <div className="text-xs text-muted-foreground">{selected.BookingNo} · {selected.UnitNo}</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {selected.AllotmentLetterId && (
                        <button
                          onClick={() => navigate(`/crm/allotment-letter?bookingId=${selected.BookingId}`)}
                          className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${
                            selected.AllotmentLetterStatus === "Issued"
                              ? "border-green-300 text-green-700 bg-green-50"
                              : "border-orange-300 text-orange-700 bg-orange-50"
                          }`}
                        >
                          <FileCheck size={11} />
                          Allotment Letter · {selected.AllotmentLetterStatus ?? "Draft"}
                        </button>
                      )}
                      <button
                        onClick={() => navigate(`/crm/agreements?bookingId=${selected.BookingId}`)}
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        View Agreement <ExternalLink size={11} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Section: Agreement Signing Workflow (8 steps) */}
                <div className="rounded-xl border border-border bg-card p-5">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
                    Agreement Signing Workflow
                  </div>
                  <div className="text-xs text-muted-foreground mb-4">
                    8-step internal process from document collection to final execution of the Agreement for Sale
                  </div>
                  <div className="relative pl-1">
                    {STEPS.map((s, idx) => {
                      const stepStatus = selected[`${s.key}Status`];
                      const due = selected[`${s.key}Due`];
                      const done = selected[`${s.key}Done`];
                      const isDone = stepStatus === "Completed";
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
                                  ? <>{due ? `Due ${String(due).slice(0, 10)}` : ""}{due && done ? " · " : ""}{done ? `Done ${String(done).slice(0, 10)}` : ""}</>
                                  : s.hint && <span className="flex items-center gap-1"><ArrowRight size={10} /> {s.hint}</span>}
                              </div>
                            </div>
                            {!isDone && (
                              MANUAL_STEPS.has(s.key) ? (
                                <button
                                  onClick={() => handleStepUpdate(s.key, "Completed")}
                                  className="text-xs px-2 py-1 border border-border rounded-lg hover:bg-muted transition-colors whitespace-nowrap shrink-0"
                                >
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

                {/* Post-agreement sections */}
                {!agrDone ? (
                  <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Lock size={14} />
                      The rest of the journey (Registration, Sale Deed, Mutation, NOC) unlocks once the Agreement Signing Workflow above reaches Final Execution
                    </div>
                  </div>
                ) : (
                  journeySections.map((section) => (
                    <div key={section.title} className="rounded-xl border border-border bg-card p-5">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
                        {section.title}
                      </div>
                      <div className="text-xs text-muted-foreground mb-4 leading-relaxed">
                        {section.description}
                      </div>
                      <div className="relative pl-1">
                        {section.stages.map((stage, idx) => (
                          <StageRow
                            key={stage.key}
                            stage={stage}
                            isLast={idx === section.stages.length - 1}
                            bookingId={selected.BookingId}
                            navigate={navigate}
                          />
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <Dialog open={newDialog} onOpenChange={(o) => { if (!o) setNewDialog(false); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="font-heading">Start Legal Workflow</DialogTitle></DialogHeader>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
              <select
                value={bookingId}
                onChange={(e) => setBookingId(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
              >
                <option value="">Select booking</option>
                {startableBookings.map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
                ))}
              </select>
              {startableBookings.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Every booking either already has a legal workflow or has no agreement yet — trackers start automatically once an agreement is created.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button onClick={() => setNewDialog(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
              <button
                onClick={handleStart}
                disabled={saving || startableBookings.length === 0}
                className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40"
              >
                {saving ? "Starting..." : "Start"}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </CrmShell>
    </>
  );
};

export default CrmLegalMilestones;
