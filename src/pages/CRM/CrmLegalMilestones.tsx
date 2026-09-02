import React, { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, CheckCircle2, Circle, ExternalLink, Lock, FileCheck, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/crm/legal-milestones";
const BKG_API = "/api/crm/bookings";

// Agreement workflow — 8 steps, most auto-synced from Agreement page actions.
// DirectorMeeting is the only manual step (an in-person meeting with no digital trace).
const AGREEMENT_STEPS = [
  { key: "DocCollection",    label: "Document Collection",      hint: "Verify the customer's Identity Proof on the Agreement page" },
  { key: "LegalReview",      label: "Legal Executive Assigned", hint: "Assign a Legal Executive to the agreement" },
  { key: "Drafting",         label: "Drafting",                 hint: "Upload the Sale Agreement document" },
  { key: "InternalApproval", label: "Internal Approval",        hint: "Get senior approval on the agreement" },
  { key: "DocShared",        label: "Document Shared",          hint: "Send the agreement to the customer" },
  { key: "MutualAgreement",  label: "Customer Approval",        hint: "Customer approves the agreement in their portal" },
  { key: "DirectorMeeting",  label: "Director Meeting",         hint: "" },
  { key: "FinalExecution",   label: "Final Execution",          hint: "Mark the agreement Executed" },
] as const;
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

interface Stage {
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

interface Phase {
  key: string;
  title: string;
  description: string;
  isApplicable: boolean;      // false → phase renders as a "Not applicable" placeholder
  notApplicableReason?: string;
  stages: Stage[];
}

interface WorkflowModel {
  // Physical completion state — informational only (see buildWorkflowModel's
  // doc comment). Never gates Agreement, AFS, NOC, or Pre-Possession.
  isPhysicallyComplete: boolean;
  agreementDone: boolean;
  phases: Phase[];                 // Phase 2 onward — everything after Agreement signing
  progressChecks: { label: string; done: boolean }[];
  journeyLabel: { text: string; done: boolean };
}

// ─── The single source of truth ──────────────────────────────────────────────
//
// Every other part of this page (left-panel card, progress dots, Phase 1
// card, Phase 2+ sections) reads from ONE WorkflowModel built here — one
// computation, consumed everywhere, instead of each place re-deriving its
// own slightly-different copy of the same logic.
//
// The Agreement for Sale, registered at the Sub-Registrar (AFS), is
// MANDATORY for every booking — no project-type exception. (An earlier
// version of this model let a "Ready-to-Move" project skip that step
// entirely, on the theory that ownership legally vests on the Sale Deed
// rather than the Agreement. That was wrong for this business: every sale
// goes through Agreement → AFS Registration → Sale Deed, full stop. Do not
// resurrect a bypass here.)
//
// The only thing that legitimately varies by a project's physical
// completion state (Project Master → General → Type = "ReadyToMove", or
// Timeline → Status = "Completed") is whether Handover must finish before
// the Sale Deed is drafted — see isPhysicallyComplete below, used only for
// that one informational note. It never gates Agreement, AFS, NOC, or
// Pre-Possession.
function buildWorkflowModel(t: any): WorkflowModel {
  const isPhysicallyComplete = t.ProjectType === "ReadyToMove" || t.ProjectStatus === "Completed";

  const agreementDone = t.FinalExecutionStatus === "Completed";

  // The AFS-registration gate that everything downstream keys off.
  const afsRegistered = t.AgreementStatus === "Registered";
  const afsGate = afsRegistered;

  const deedStatus = t.DeedRegistrationNo ? "Registered"
    : t.DeedExecutedBy ? "Executed"
    : t.SalesDeedId ? "Drafted"
    : null;

  const phases: Phase[] = [
    // ── Allotment Letter ──────────────────────────────────────────────────
    {
      key: "allotment",
      title: "Allotment Letter",
      isApplicable: true,
      description: "Issued to the buyer after at least 10% of the total consideration has been received. The buyer signs and returns it; this acknowledgement starts the 30-day Agreement for Sale clock under RERA.",
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

    // ── Sub-Registrar Visit 1 — AFS Registration ─────────────────────────
    {
      key: "afsVisit1",
      title: "Sub-Registrar Visit 1 — Registering the Agreement for Sale",
      isApplicable: true,
      description: "The Agreement for Sale must be registered at the Sub-Registrar's Office before the deal is legally recognised. First the buyer confirms the stamp duty & registration fees (via the AFS Query Payment), then both parties attend in person to register the document.",
      stages: [
        {
          key: "afsQP",
          label: "Agreement Registration Fees",
          sublabel: "Stamp duty & registration fee due before Visit 1",
          path: "/crm/afs-query-payment",
          no: t.AfsQPNo || null,
          status: t.AfsQPStatus || null,
          isDone: t.AfsQPStatus === "Confirmed" || afsRegistered,
          isLocked: !agreementDone,
          unlockedHint: "Unlocks once the Agreement is executed (Phase 1)",
        },
        {
          key: "afsReg",
          label: "Agreement Registration Visit",
          sublabel: "Buyer & seller appear at Sub-Registrar Office (Visit 1) — Agreement becomes Registered",
          path: "/crm/afs-registry",
          no: t.AfsRegNo || null,
          status: t.AfsRegistryStatus || null,
          isDone: afsRegistered,
          isLocked: !agreementDone || (t.AfsQPStatus !== "Confirmed" && !afsRegistered),
          unlockedHint: "Requires Agreement Registration Fees to be Confirmed first",
        },
      ],
    },

    // ── NOC ───────────────────────────────────────────────────────────────
    {
      key: "noc",
      title: "No Objection Certificates",
      isApplicable: true,
      description: "Once the Agreement for Sale is registered, the legal team obtains No Objection Certificates from the bank (for loan-financed buyers, confirming the lender has no objection) and from the developer organisation (confirming no outstanding dues).",
      stages: [
        {
          key: "bankNoc",
          label: "No Objection Certificate — Bank",
          sublabel: "Bank confirms it has no objection to the AFS registration (loan-case NOC)",
          path: "/crm/noc?nocType=Bank",
          no: t.BankNocNo || null,
          status: t.BankNocStatus || null,
          isDone: t.BankNocStatus === "Issued",
          isLocked: !afsGate,
          unlockedHint: "Unlocks once the Agreement for Sale is registered (Visit 1 completed)",
        },
        {
          key: "orgNoc",
          label: "No Objection Certificate — Organisation",
          sublabel: "Developer confirms no outstanding dues or objections",
          path: "/crm/noc?nocType=Organisation",
          no: t.OrgNocNo || null,
          status: t.OrgNocStatus || null,
          isDone: t.OrgNocStatus === "Issued",
          isLocked: !afsGate,
          unlockedHint: "Unlocks once the Agreement for Sale is registered (Visit 1 completed)",
        },
      ],
    },

    // ── Possession & Key Handover ─────────────────────────────────────────
    {
      key: "possession",
      title: "Possession & Key Handover",
      isApplicable: true,
      description: "Once the AFS is registered and the project receives its Occupancy Certificate, the developer schedules a pre-possession inspection, issues a Possession Notice, and hands over keys.",
      stages: [
        {
          key: "ocCc",
          label: "OC / CC",
          sublabel: "Project's Occupancy or Completion Certificate from the authority — a project-level record, not gated on any single booking's progress (the backend has no per-booking gate on this)",
          path: "/crm/oc-cc",
          no: null,
          status: null,
          isDone: t.OcCcReceived === 1,
          isLocked: false,
          unlockedHint: "",
        },
        {
          key: "prePossession",
          label: "Pre-Possession Inspection",
          sublabel: "Site inspection and snag list before offering possession to the buyer",
          path: "/crm/pre-possession",
          no: null,
          status: t.PrePossessionStatus || null,
          isDone: t.PrePossessionStatus === "Ready",
          isLocked: !afsGate || t.OcCcReceived !== 1,
          unlockedHint: "Unlocks once AFS is registered and OC/CC is received",
        },
        {
          key: "possessionNotice",
          label: "Possession Notice",
          sublabel: "Developer issues notice with offered possession date; buyer acknowledges or disputes",
          path: "/crm/possession-notice",
          no: null,
          status: t.PossessionNoticeStatus || null,
          isDone: t.PossessionNoticeStatus === "Acknowledged",
          isLocked: t.PrePossessionStatus !== "Ready",
          unlockedHint: "Unlocks once Pre-Possession Inspection is Ready",
        },
        {
          key: "handover",
          label: "Handover",
          sublabel: isPhysicallyComplete
            ? "Physical key handover — all NOCs issued, no open snags, no outstanding dues. Project already complete, so this can happen same-day as Sale Deed registration."
            : "Physical key handover — all NOCs issued, no open snags, no outstanding dues",
          path: "/crm/handover",
          no: null,
          status: t.HandoverStatus || null,
          isDone: t.HandoverStatus === "Completed",
          // Mirrors crmHandover.js POST / exactly — all 4 real gates, not
          // just Possession Notice. Missing any of these would previously
          // show this stage as unlocked when the actual Handover page
          // would reject the submission.
          isLocked: !afsGate
            || t.PossessionNoticeStatus !== "Acknowledged"
            || ["Pending", "Approved"].includes(t.BankNocStatus)
            || ["Pending", "Approved"].includes(t.OrgNocStatus)
            || t.HasOutstandingDues === 1,
          unlockedHint: !afsGate
            ? "Requires the Agreement for Sale to be Registered"
            : t.PossessionNoticeStatus !== "Acknowledged"
              ? "Unlocks once the Possession Notice is Acknowledged by the customer"
              : ["Pending", "Approved"].includes(t.BankNocStatus)
                ? "Requires the Bank NOC to be Issued first"
                : ["Pending", "Approved"].includes(t.OrgNocStatus)
                  ? "Requires the Organisation NOC to be Issued first"
                  : "Requires all payment milestones to be paid or waived first",
        },
      ],
    },

    // ── Sale Deed ─────────────────────────────────────────────────────────
    {
      key: "saleDeed",
      title: "Sale Deed Preparation",
      isApplicable: true,
      description: "The Sale Deed is the document that legally conveys ownership of the property to the buyer (s.54, Transfer of Property Act 1882). It can be prepared once the Agreement for Sale is registered."
        + (isPhysicallyComplete ? " This project is already complete, so it does not have to wait for Handover to finish first." : " Possession/Handover is a separate, parallel track and does not have to precede it."),
      stages: [
        {
          key: "salesDeed",
          label: "Sale Deed",
          sublabel: "Ownership-transfer document — internal drafting, approvals, execution & registration",
          path: "/crm/sales-deed",
          no: t.DeedNo || null,
          status: deedStatus,
          isDone: !!t.SalesDeedId,
          isLocked: !afsGate,
          unlockedHint: "Unlocks once the Agreement for Sale is registered (Visit 1 completed)",
        },
      ],
    },

    // ── Sub-Registrar Visit 2 — Sale Deed Registration ───────────────────
    {
      key: "afsVisit2",
      title: "Sub-Registrar Visit 2 — Registering the Sale Deed",
      isApplicable: true,
      description: "Once the Sale Deed is Director Approved: confirm the stamp duty & registration fees (net of any AFS credit), then both parties attend in person to register the Sale Deed. After this, ownership is officially and permanently transferred.",
      stages: [
        {
          key: "queryPayment",
          label: "Sale Deed Registration Fees",
          sublabel: "Net stamp duty & registration fee due before Visit 2 (AFS credit applied)",
          path: "/crm/query-payment",
          no: t.QPNo || null,
          status: t.QueryPaymentStatus || null,
          isDone: t.QueryPaymentStatus === "Confirmed",
          isLocked: !t.SalesDeedId || t.DeedDirectorApprovalStatus !== "Approved",
          unlockedHint: "Requires the Sale Deed to be Director Approved first",
        },
        {
          key: "registry",
          label: "Sale Deed Registration Visit",
          sublabel: "Buyer & seller appear at Sub-Registrar Office (Visit 2) — ownership transferred",
          path: "/crm/registry",
          no: t.RegNo || null,
          status: t.RegistryStatus || null,
          isDone: t.RegistryStatus === "Completed",
          isLocked: !t.SalesDeedId || t.QueryPaymentStatus !== "Confirmed",
          unlockedHint: "Requires Sale Deed Registration Fees to be Confirmed first",
        },
      ],
    },

    // ── Post-Registration ─────────────────────────────────────────────────
    {
      key: "mutation",
      title: "Post-Registration",
      isApplicable: true,
      description: "Once the Sale Deed is officially registered, the municipal land records are updated to reflect the new owner (Mutation / Khata Transfer / Dakhil Kharij). This is mandatory under the 2025 government ruling.",
      stages: [
        {
          key: "mutation",
          label: "Property Mutation (Khata Transfer)",
          sublabel: "Municipal land records updated to the new owner — mandatory post Sale Deed registration",
          path: "/crm/mutation",
          no: t.MutationNo || null,
          status: t.MutationStatus || null,
          isDone: t.MutationStatus === "Approved",
          isLocked: t.RegistryStatus !== "Completed",
          unlockedHint: "Requires Sale Deed Registration Visit to be Completed first",
        },
      ],
    },
  ];

  // Flat list of every applicable stage across every applicable phase —
  // the single feed for both the progress dots and the left-panel journey
  // label, so those two views can never drift out of sync with each other
  // or with what the detail panel actually shows.
  const applicableStages = phases.filter((p) => p.isApplicable).flatMap((p) => p.stages);

  const progressChecks = [
    { label: "Agreement signed", done: agreementDone },
    ...applicableStages.map((s) => ({ label: s.label, done: s.isDone })),
  ];

  let journeyLabel: { text: string; done: boolean };
  if (!agreementDone) {
    const stepLabel = AGREEMENT_STEPS[(t.CurrentStep ?? 1) - 1]?.label ?? "Agreement Preparation";
    journeyLabel = { text: `Agreement: ${stepLabel}`, done: false };
  } else {
    const pending = applicableStages.find((s) => !s.isDone);
    journeyLabel = pending ? { text: `${pending.label} pending`, done: false } : { text: "Journey Complete", done: true };
  }

  return { isPhysicallyComplete, agreementDone, phases, progressChecks, journeyLabel };
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
  stage: Stage;
  isLast: boolean;
  bookingId: number;
  navigate: (path: string) => void;
}> = ({ stage, isLast, bookingId, navigate }) => {
  const { isDone, isLocked } = stage;
  const hasRecord = !!stage.status;
  const actionLabel = isDone ? "Open" : hasRecord ? "Continue" : isLocked ? "View" : "Start →";

  return (
    <div className="relative flex gap-4 pb-5 last:pb-0">
      {!isLast && (
        <div className={`absolute left-[15px] top-8 bottom-0 w-0.5 ${isDone ? "bg-green-300" : "bg-border"}`} />
      )}

      <div className="shrink-0 z-10 mt-1">
        {isDone ? (
          <div className="w-8 h-8 rounded-full bg-green-100 border-2 border-green-400 dark:bg-green-900/40 dark:border-green-600 flex items-center justify-center">
            <CheckCircle2 size={16} className="text-green-600 dark:text-green-400" />
          </div>
        ) : isLocked ? (
          <div className="w-8 h-8 rounded-full bg-muted/60 border-2 border-border flex items-center justify-center">
            <Lock size={13} className="text-muted-foreground/50" />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-primary/10 border-2 border-primary flex items-center justify-center">
            <Circle size={12} className="text-primary fill-primary/30" />
          </div>
        )}
      </div>

      <div className={`flex-1 rounded-xl border transition-colors ${
        isDone
          ? "border-green-200 bg-green-500/[0.04] dark:border-green-900/60 dark:bg-green-950/20"
          : isLocked
          ? "border-border bg-muted/20 opacity-70"
          : "border-primary/30 bg-primary/[0.03]"
      }`}>
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-semibold leading-tight ${isLocked ? "text-muted-foreground" : isDone ? "text-green-700 dark:text-green-300" : "text-foreground"}`}>
                {stage.label}
              </span>
              {stage.no && <span className="text-[11px] font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">{stage.no}</span>}
              {stage.status && (
                <span className={`text-[11px] px-2 py-0.5 rounded-lg border font-semibold ${statusColor[stage.status] || ""}`}>
                  {stage.status}
                </span>
              )}
            </div>
            <div className={`text-[12px] mt-0.5 leading-snug ${isLocked ? "text-muted-foreground/60" : "text-muted-foreground"}`}>
              {isLocked
                ? <span className="flex items-center gap-1"><Lock size={9} className="shrink-0" /> Waiting: {stage.unlockedHint}</span>
                : stage.sublabel}
            </div>
          </div>
          <button
            onClick={() => navigate(`${stage.path}${stage.path.includes("?") ? "&" : "?"}bookingId=${bookingId}`)}
            className={`shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
              isDone
                ? "border-green-300 text-green-700 bg-green-50 hover:bg-green-100 dark:bg-green-900/30 dark:border-green-800 dark:text-green-300"
                : isLocked
                ? "border-border text-muted-foreground hover:bg-muted"
                : "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
            }`}
          >
            {actionLabel} <ExternalLink size={11} />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Phase 1 (Agreement Signing) card ─────────────────────────────────────────
// Always applicable — the Agreement for Sale + AFS Registration is mandatory
// for every booking, regardless of project type.

const AgreementPhaseCard: React.FC<{ model: WorkflowModel; t: any; onStepUpdate: (step: string, status: string) => void; canEdit: boolean }> =
  ({ model, t, onStepUpdate, canEdit }) => {
  const { agreementDone } = model;
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className={`px-5 py-3.5 border-b border-border flex items-center justify-between gap-3 ${agreementDone ? "bg-green-500/[0.06]" : "bg-primary/[0.04]"}`}>
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${agreementDone ? "bg-green-100 border-green-300 text-green-700 dark:bg-green-900/30 dark:border-green-700 dark:text-green-400" : "bg-primary/10 border-primary/30 text-primary"}`}>PHASE 1</span>
            <h3 className="text-sm font-bold">Agreement Preparation &amp; Signing</h3>
            {agreementDone && <CheckCircle2 size={14} className="text-green-500" />}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Internal 8-step process to prepare and get the Agreement for Sale signed by both parties</p>
        </div>
        <span className={`shrink-0 text-[11px] px-2.5 py-1 rounded-lg border font-semibold ${agreementDone ? "bg-green-100 border-green-300 text-green-700 dark:bg-green-900/30" : "bg-muted/40 border-border text-muted-foreground"}`}>
          {AGREEMENT_STEPS.filter((s) => t[`${s.key}Status`] === "Completed").length}/{AGREEMENT_STEPS.length} steps
        </span>
      </div>
      <div className="p-5 space-y-0">
        {AGREEMENT_STEPS.map((s, idx) => {
          const stepStatus = t[`${s.key}Status`];
          const done = t[`${s.key}Done`];
          const isDone = stepStatus === "Completed";
          const isCurrent = t.CurrentStep === idx + 1;
          const isLast = idx === AGREEMENT_STEPS.length - 1;
          return (
            <div key={s.key} className="relative flex gap-4 pb-4 last:pb-0">
              {!isLast && (
                <div className={`absolute left-[15px] top-8 bottom-0 w-0.5 ${isDone ? "bg-green-300" : "bg-border"}`} />
              )}
              <div className="shrink-0 z-10 mt-1">
                {isDone ? (
                  <div className="w-8 h-8 rounded-full bg-green-100 border-2 border-green-400 dark:bg-green-900/40 dark:border-green-600 flex items-center justify-center">
                    <CheckCircle2 size={15} className="text-green-600 dark:text-green-400" />
                  </div>
                ) : (
                  <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-[11px] font-bold ${isCurrent ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-border text-muted-foreground/60"}`}>
                    {idx + 1}
                  </div>
                )}
              </div>
              <div className={`flex-1 rounded-xl border px-4 py-2.5 flex items-center justify-between gap-3 ${
                isDone ? "border-green-200 bg-green-500/[0.04] dark:border-green-900/50"
                : isCurrent ? "border-primary/40 bg-primary/[0.04]"
                : "border-border bg-muted/10 opacity-60"
              }`}>
                <div>
                  <div className={`text-sm font-semibold ${isDone ? "text-green-700 dark:text-green-300" : isCurrent ? "text-foreground" : "text-muted-foreground"}`}>
                    {s.label}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {isDone
                      ? <span className="text-green-600 dark:text-green-400">{done ? `Completed ${String(done).slice(0, 10)}` : "Completed"}</span>
                      : isCurrent
                      ? <span className="text-primary flex items-center gap-1"><ChevronRight size={10} /> {s.hint || "In progress"}</span>
                      : "Not started yet"}
                  </div>
                </div>
                {canEdit && !isDone && MANUAL_STEPS.has(s.key) && isCurrent && (
                  <button
                    onClick={() => onStepUpdate(s.key, "Completed")}
                    className="text-xs px-3 py-1.5 bg-primary text-primary-foreground border border-primary rounded-lg font-semibold hover:bg-primary/90 whitespace-nowrap shrink-0"
                  >
                    Mark Done
                  </button>
                )}
                {!isDone && !MANUAL_STEPS.has(s.key) && isCurrent && (
                  <span className="text-[10px] text-muted-foreground bg-muted/60 border border-border rounded px-2 py-1 whitespace-nowrap shrink-0">Auto-synced</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

const CrmLegalMilestones: React.FC = () => {
  const rights = usePageRights("crm-legal-milestones");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
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

  // Auto-select from ?bookingId= URL param (deep-link from stage buttons on this page)
  useEffect(() => {
    const urlBookingId = sp.get("bookingId");
    if (!urlBookingId || !(trackers as any[]).length) return;
    const match = (trackers as any[]).find((t: any) => String(t.BookingId) === urlBookingId);
    if (match) setSelectedId(match.Id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, trackers]);

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

  const model = selected ? buildWorkflowModel(selected) : null;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Legal Journey Overview"]} />
      <CrmShell
        title="Legal Journey Overview"
        subtitle="The complete property transaction lifecycle — from Agreement signing to Mutation — for every booking, dynamically laid out per its own project's sale process"
        action={
          <div className="flex items-center gap-3">
            <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
            {rights.canCreate && (
            <button
              onClick={() => setNewDialog(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90"
            >
              <Plus size={14} /> Start Workflow
            </button>
            )}
          </div>
        }
      >
        <div className="flex gap-4 h-[calc(100vh-220px)]">
          {/* ── Left panel: booking list ── */}
          <div className="w-80 shrink-0 overflow-y-auto thin-scroll space-y-1.5">
            {isLoading ? (
              <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
            ) : isError ? (
              <div className="p-4 text-center text-sm text-destructive">{(error as any)?.message || "Failed to load"}</div>
            ) : trackers.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">No legal workflows started</div>
            ) : (trackers as any[]).map((t: any) => {
              const m = buildWorkflowModel(t);
              const { text, done } = m.journeyLabel;
              return (
                <button
                  key={t.Id}
                  onClick={() => { setSelectedId(t.Id); setSp({ bookingId: String(t.BookingId) }, { replace: true }); }}
                  className={`w-full text-left rounded-lg border overflow-hidden transition-colors ${
                    selectedId === t.Id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20"
                  }`}
                >
                  <div className="flex">
                    <div className={`w-[3px] shrink-0 self-stretch ${done ? "bg-green-500" : m.agreementDone ? "bg-blue-500" : "bg-amber-400"}`} />
                    <div className="flex-1 min-w-0 p-3 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <div className="text-sm font-semibold truncate">{t.ApplicantName}</div>
                        {m.isPhysicallyComplete && (
                          <span className="shrink-0 text-[9px] px-1.5 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full font-medium" title="Project already complete — Handover doesn't have to wait on the Sale Deed">Completed</span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{t.BookingNo} · {t.UnitNo}</div>
                      <div className={`text-[11px] font-medium flex items-center gap-1 ${done ? "text-green-600" : "text-muted-foreground"}`}>
                        {done ? <CheckCircle2 size={10} /> : <Circle size={10} />}
                        {text}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── Right panel: journey detail ── */}
          <div className="flex-1 overflow-y-auto thin-scroll">
            {!selected || !model ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                Select a booking on the left to view its legal journey
              </div>
            ) : (
              <div className="space-y-4 pb-6">
                {/* Header */}
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="px-5 py-4 flex items-center justify-between gap-3 border-b border-border bg-muted/20">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-heading font-bold text-[15px] truncate">{selected.ApplicantName}</h2>
                        {model.isPhysicallyComplete && (
                          <span className="shrink-0 text-[10px] px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full font-medium" title="Project already complete — Handover doesn't have to wait on the Sale Deed. Agreement/AFS Registration is still required as normal.">
                            Project Completed
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{selected.BookingNo} · {selected.UnitNo}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      {selected.AllotmentLetterId && (
                        <button
                          onClick={() => navigate(`/crm/allotment-letter?bookingId=${selected.BookingId}`)}
                          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border font-semibold transition-colors ${
                            selected.AllotmentLetterStatus === "Acknowledged"
                              ? "border-green-300 text-green-700 bg-green-50 dark:bg-green-900/30 dark:border-green-800"
                              : "border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:border-amber-800"
                          }`}
                        >
                          <FileCheck size={11} />
                          Allotment Letter · {selected.AllotmentLetterStatus ?? "Issued"}
                        </button>
                      )}
                      <button
                        onClick={() => navigate(`/crm/agreements?bookingId=${selected.BookingId}`)}
                        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted font-semibold"
                      >
                        <ExternalLink size={11} /> View Agreement
                      </button>
                    </div>
                  </div>
                  {/* Overall progress dots — driven entirely by model.progressChecks,
                      which already excludes not-applicable stages, so this can
                      never show a false "AFS pending" pill for a Ready-to-Move booking. */}
                  <div className="px-5 py-3 flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground font-medium shrink-0">Journey progress:</span>
                    <div className="flex items-center gap-1 flex-wrap">
                      {model.progressChecks.map((p) => (
                        <span key={p.label} title={p.label}
                          className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                            p.done ? "bg-green-100 border-green-300 text-green-700 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300" : "bg-muted/40 border-border text-muted-foreground/60"
                          }`}>
                          {p.done ? <CheckCircle2 size={9} /> : <Circle size={9} />}
                          {p.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Phase 1 — Agreement Signing: the full 8-step tracker,
                    driven by the model. Always applicable. */}
                <AgreementPhaseCard model={model} t={selected} onStepUpdate={handleStepUpdate} canEdit={rights.canEdit} />

                {/* Phase 2 onward */}
                {!model.agreementDone ? (
                  <div className="rounded-xl border border-border bg-card p-5 flex items-start gap-3">
                    <div className="w-8 h-8 shrink-0 rounded-full bg-muted/60 border-2 border-border flex items-center justify-center">
                      <Lock size={13} className="text-muted-foreground/50" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-muted-foreground">Phases 2 onward are locked</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Registration, Sale Deed, Mutation and NOC steps will appear here once Phase 1 (Agreement Signing) reaches Final Execution.</p>
                    </div>
                  </div>
                ) : (
                  model.phases.map((phase, sIdx) => (
                    <div key={phase.key} className="rounded-xl border border-border bg-card overflow-hidden">
                      <div className="px-5 py-3.5 border-b border-border bg-muted/20 flex items-start gap-3">
                        <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border mt-0.5 ${
                          phase.isApplicable ? "bg-muted/60 border-border text-muted-foreground" : "bg-emerald-100 border-emerald-300 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700"
                        }`}>PHASE {sIdx + 2}</span>
                        <div>
                          <h3 className="text-sm font-bold">{phase.title}</h3>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                            {phase.isApplicable ? phase.description : phase.notApplicableReason}
                          </p>
                        </div>
                      </div>
                      {phase.isApplicable && (
                        <div className="p-5 space-y-0">
                          {phase.stages.map((stage, idx) => (
                            <StageRow
                              key={stage.key}
                              stage={stage}
                              isLast={idx === phase.stages.length - 1}
                              bookingId={selected.BookingId}
                              navigate={navigate}
                            />
                          ))}
                        </div>
                      )}
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
                  Every booking either already has a legal workflow or has no agreement yet — trackers start automatically once an agreement (or, for Ready-to-Move units, a Sale Deed) is created.
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
