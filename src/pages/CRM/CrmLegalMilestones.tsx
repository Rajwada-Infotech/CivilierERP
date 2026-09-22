import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, CheckCircle2, Circle, ExternalLink, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";

const API = "/api/crm/legal-milestones";

// Agreement workflow — 8 steps, most auto-synced from Agreement page actions.
// DirectorMeeting is the only manual step (an in-person meeting with no digital trace).
const AGREEMENT_STEPS = [
  { key: "DocCollection",    label: "Document Collection",      hint: "Verify the customer's Identity Proof on the Agreement page" },
  { key: "LegalReview",      label: "Legal Executive Assigned", hint: "Assign a Legal Executive to the agreement" },
  { key: "Drafting",         label: "Drafting",                 hint: "Upload the Sale Agreement document" },
  { key: "InternalApproval", label: "Internal Approval",        hint: "Get senior approval on the agreement" },
  { key: "DocShared",        label: "Document Shared",          hint: "Send the agreement to the customer" },
  { key: "MutualAgreement",  label: "Customer Approval",        hint: "Customer approves the agreement in their portal" },
  { key: "DirectorMeeting",  label: "Director Meeting",         hint: "Hold the in-person director meeting, then mark it done here" },
  { key: "FinalExecution",   label: "Final Execution",          hint: "Mark the agreement Executed" },
] as const;
const MANUAL_STEPS = new Set(["DirectorMeeting"]);

async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `Failed to load legal workflows (HTTP ${r.status})`);
  return r.json();
}

const PAGE_SIZE = 20;
interface LegalMilestoneListFilters {
  search: string;
  companyId: string;
  projectId: string;
  blockId: string;
}
async function fetchLegalMilestonesList(filters: LegalMilestoneListFilters, page: number): Promise<{ rows: any[]; total: number }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.search) params.set("search", filters.search);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.blockId) params.set("blockId", filters.blockId);
  const r = await fetchWithAuth(`${API}?${params}`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `Failed to load legal workflows (HTTP ${r.status})`);
  const data = await r.json();
  return { rows: data.rows || [], total: data.total || 0 };
}
async function fetchEligibleBookings(): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/eligible-bookings`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `Failed to load bookings (HTTP ${r.status})`);
  return r.json();
}
async function fetchTrackerByBooking(bookingId: string): Promise<any | null> {
  try {
    const r = await fetchWithAuth(`${API}/booking/${bookingId}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

// ─── Types ───────────────────────────────────────────────────────────────────
//
// One flat "Stage" shape for EVERY step in the journey — Agreement's own 8
// sub-steps included. The old page rendered Agreement as a visually distinct
// numbered-circle tracker and everything after it as a different-looking set
// of "phase cards" with a different action model (navigate-only). Reading it
// felt like two unrelated trackers bolted together, and it was genuinely easy
// to misread where one ended and the next began — that's the "confusing
// layout / wrong order" complaint. Now every stage, from Document Collection
// through Mutation, renders through the exact same StageRow component in one
// continuous connected timeline, split only by light section headers.

type StageAction =
  | { kind: "navigate"; path: string }   // clicking routes to the owning feature page
  | { kind: "manual"; onAction: () => void } // an in-app action with no dedicated page (e.g. Director Meeting)
  | { kind: "auto" };                    // ticks itself from another page's action — nothing to click here

interface Stage {
  key: string;
  label: string;
  sublabel: string;
  no: string | null;
  status: string | null;
  isDone: boolean;
  isLocked: boolean;
  unlockedHint: string;
  isApplicable?: boolean;         // false → renders as a dimmed "Not applicable" row instead of a normal action row
  notApplicableReason?: string;
  action: StageAction;
}

interface Section {
  key: string;
  title: string;
  description: string;
  isApplicable: boolean;      // false → section renders as a "Not applicable" placeholder
  notApplicableReason?: string;
  stages: Stage[];
}

interface WorkflowModel {
  // Physical completion state — informational only (see buildWorkflowModel's
  // doc comment). Never gates Agreement, AFS, NOC, or Pre-Possession.
  isPhysicallyComplete: boolean;
  agreementDone: boolean;
  sections: Section[];             // the ENTIRE journey, Agreement Signing included as sections[0]
  progressChecks: { label: string; done: boolean }[];
  journeyLabel: { text: string; done: boolean };
  doneCount: number;
  totalCount: number;
}

// ─── The single source of truth ──────────────────────────────────────────────
//
// Every other part of this page (left-panel card, progress bar/dots, the
// section timeline) reads from ONE WorkflowModel built here — one
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
function buildWorkflowModel(t: any, onManualStep?: (step: string) => void): WorkflowModel {
  const isPhysicallyComplete = t.ProjectType === "ReadyToMove" || t.ProjectStatus === "Completed";

  const agreementDone = t.FinalExecutionStatus === "Completed";
  const agreementCurrentStep = t.CurrentStep ?? 1;

  // Agreement's own 8 sub-steps, now expressed as ordinary Stage objects so
  // they render through the exact same timeline row as everything after
  // them — no more visually distinct "numbered circle" tracker bolted onto
  // the front of a different-looking phase list.
  const agreementStages: Stage[] = AGREEMENT_STEPS.map((s, idx) => {
    const stepStatus = t[`${s.key}Status`];
    const stepDone = t[`${s.key}Done`];
    const isDone = stepStatus === "Completed";
    const isCurrent = agreementCurrentStep === idx + 1;
    const isLocked = idx + 1 > agreementCurrentStep;
    const isManual = MANUAL_STEPS.has(s.key);
    const action: StageAction = isManual && isCurrent && !isDone
      ? { kind: "manual", onAction: () => onManualStep?.(s.key) }
      : !isManual && isCurrent && !isDone
      ? { kind: "auto" }
      : { kind: "navigate", path: "/crm/agreements" };
    return {
      key: s.key,
      label: s.label,
      sublabel: isDone
        ? (stepDone ? `Completed ${String(stepDone).slice(0, 10)}` : "Completed")
        : (s.hint || "Not started yet"),
      no: null,
      status: isDone ? "Completed" : null,
      isDone,
      isLocked,
      unlockedHint: "Complete the previous step first",
      action,
    };
  });

  // The AFS-registration gate that everything downstream keys off.
  const afsRegistered = t.AgreementStatus === "Registered";
  const afsGate = afsRegistered;

  // No Objection Certificate is a SINGLE step per booking — the bank's NOC
  // and the developer's NOC serve the same purpose (clearing the booking for
  // Possession/Handover); a booking only ever needs one, never both. Which
  // one is resolved server-side (see resolveNocType in crmWorkflowGuards.js /
  // the NocResolvedType column in LM_SELECT) and mirrored here as a single
  // "noc" stage rather than two separate rows.
  const nocType: "Bank" | "Organisation" = t.NocResolvedType === "Bank" ? "Bank" : "Organisation";
  const isLoanFinanced = nocType === "Bank";
  const nocNo     = nocType === "Bank" ? t.BankNocNo     : t.OrgNocNo;
  const nocStatus = nocType === "Bank" ? t.BankNocStatus : t.OrgNocStatus;

  const deedStatus = t.DeedRegistrationNo ? "Registered"
    : t.DeedExecutedBy ? "Executed"
    : t.SalesDeedId != null ? "Drafted"
    : null;

  const sections: Section[] = [
    // ── Agreement Preparation & Signing ───────────────────────────────────
    {
      key: "agreement",
      title: "Agreement Preparation & Signing",
      isApplicable: true,
      description: "Internal 8-step process to prepare and get the Agreement for Sale signed by both parties.",
      stages: agreementStages,
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
          no: t.AfsQPNo || null,
          status: t.AfsQPStatus || null,
          isDone: t.AfsQPStatus === "Confirmed" || afsRegistered,
          isLocked: !agreementDone,
          unlockedHint: "Unlocks once the Agreement is Executed (previous section)",
          action: { kind: "navigate", path: "/crm/agreements?tab=afs-payment" },
        },
        {
          key: "afsReg",
          label: "Agreement Registration Visit",
          sublabel: "Buyer & seller appear at Sub-Registrar Office (Visit 1) — Agreement becomes Registered",
          no: t.AfsRegNo || null,
          status: t.AfsRegistryStatus || null,
          isDone: afsRegistered,
          isLocked: !agreementDone || (t.AfsQPStatus !== "Confirmed" && !afsRegistered),
          unlockedHint: "Requires Agreement Registration Fees to be Confirmed first",
          action: { kind: "navigate", path: "/crm/agreements?tab=afs-registry" },
        },
      ],
    },

    // ── NOC — a single step; Bank or Organisation, never both ──────────────
    {
      key: "noc",
      title: "No Objection Certificate",
      isApplicable: true,
      description: isLoanFinanced
        ? "Once the Agreement for Sale is registered, the legal team obtains a No Objection Certificate from the bank — confirming the lender has no objection, since this booking is loan-financed."
        : "Once the Agreement for Sale is registered, the legal team obtains a No Objection Certificate from the developer organisation — confirming no outstanding dues, since this booking is self-funded.",
      stages: [
        {
          key: "noc",
          label: isLoanFinanced ? "No Objection Certificate — Bank" : "No Objection Certificate — Organisation",
          sublabel: isLoanFinanced
            ? "Bank confirms it has no objection to the AFS registration (loan-case NOC)"
            : "Developer confirms no outstanding dues or objections (self-funded case NOC)",
          no: nocNo || null,
          status: nocStatus || null,
          isDone: nocStatus === "Issued",
          isLocked: !afsGate,
          unlockedHint: "Unlocks once the Agreement for Sale is registered (Visit 1 completed)",
          action: { kind: "navigate", path: `/crm/noc?nocType=${nocType}` },
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
          no: null,
          status: null,
          isDone: t.OcCcReceived === 1,
          isLocked: false,
          unlockedHint: "",
          action: { kind: "navigate", path: "/crm/oc-cc" },
        },
        {
          key: "prePossession",
          label: "Pre-Possession Inspection",
          sublabel: "Site inspection and snag list before offering possession to the buyer",
          no: null,
          status: t.PrePossessionStatus || null,
          isDone: t.PrePossessionStatus === "Ready",
          isLocked: !afsGate || t.OcCcReceived !== 1,
          unlockedHint: "Unlocks once AFS is registered and OC/CC is received",
          action: { kind: "navigate", path: "/crm/pre-possession" },
        },
        {
          key: "possessionNotice",
          label: "Possession Notice",
          sublabel: "Developer issues notice with offered possession date; buyer acknowledges or disputes",
          no: null,
          status: t.PossessionNoticeStatus || null,
          isDone: t.PossessionNoticeStatus === "Acknowledged",
          isLocked: t.PrePossessionStatus !== "Ready",
          unlockedHint: "Unlocks once Pre-Possession Inspection is Ready",
          action: { kind: "navigate", path: "/crm/possession-notice" },
        },
        {
          key: "handover",
          label: "Handover",
          sublabel: isPhysicallyComplete
            ? "Physical key handover — NOC issued, no open snags, no outstanding dues. Project already complete, so this can happen same-day as Sale Deed registration."
            : "Physical key handover — NOC issued, no open snags, no outstanding dues",
          no: null,
          status: t.HandoverStatus || null,
          isDone: t.HandoverStatus === "Completed",
          // Mirrors crmHandover.js POST / exactly — all 4 real gates, not
          // just Possession Notice. Missing any of these would previously
          // show this stage as unlocked when the actual Handover page
          // would reject the submission.
          isLocked: !afsGate
            || t.PossessionNoticeStatus !== "Acknowledged"
            || ["Pending", "Approved"].includes(nocStatus)
            || t.HasOutstandingDues === 1,
          unlockedHint: !afsGate
            ? "Requires the Agreement for Sale to be Registered"
            : t.PossessionNoticeStatus !== "Acknowledged"
              ? "Unlocks once the Possession Notice is Acknowledged by the customer"
              : ["Pending", "Approved"].includes(nocStatus)
                ? `Requires the ${nocType} NOC to be Issued first`
                : "Requires all payment milestones to be paid or waived first",
          action: { kind: "navigate", path: "/crm/handover" },
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
          no: t.DeedNo || null,
          status: deedStatus,
          isDone: t.SalesDeedId != null,
          isLocked: !afsGate,
          unlockedHint: "Unlocks once the Agreement for Sale is registered (Visit 1 completed)",
          action: { kind: "navigate", path: "/crm/sales-deed" },
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
          label: "Query Payment (Stamp Duty & Reg. Fee)",
          sublabel: "Net stamp duty & registration fee due before Visit 2 (AFS credit applied)",
          no: t.QPNo || null,
          status: t.QueryPaymentStatus || null,
          isDone: t.QueryPaymentStatus === "Confirmed",
          isLocked: t.SalesDeedId == null || t.DeedDirectorApprovalStatus !== "Approved",
          unlockedHint: "Requires the Sale Deed to be Director Approved first",
          action: { kind: "navigate", path: "/crm/sales-deed?tab=Query+Payment" },
        },
        {
          key: "registry",
          label: "Registry (Sub-Registrar Visit)",
          sublabel: "Buyer & seller appear at Sub-Registrar Office (Visit 2) — ownership transferred",
          no: t.RegNo || null,
          status: t.RegistryStatus || null,
          isDone: t.RegistryStatus === "Completed",
          isLocked: t.SalesDeedId == null || t.QueryPaymentStatus !== "Confirmed",
          unlockedHint: "Requires Query Payment to be Confirmed first",
          action: { kind: "navigate", path: "/crm/sales-deed?tab=Registry" },
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
          no: t.MutationNo || null,
          status: t.MutationStatus || null,
          isDone: t.MutationStatus === "Approved",
          isLocked: t.RegistryStatus !== "Completed",
          unlockedHint: "Requires Sale Deed Registration Visit to be Completed first",
          action: { kind: "navigate", path: "/crm/mutation" },
        },
      ],
    },
  ];

  // Flat list of every applicable stage across every applicable section —
  // the single feed for the progress bar, progress dots, and the left-panel
  // journey label, so none of those views can ever drift out of sync with
  // each other or with what the detail panel actually shows. A stage marked
  // isApplicable: false (e.g. Bank NOC for a self-funded booking) is
  // excluded here too — it must never count as a pending item blocking
  // "Journey Complete" for a step that was never going to happen.
  const applicableStages = sections.filter((sec) => sec.isApplicable).flatMap((sec) => sec.stages).filter((s) => s.isApplicable !== false);
  const doneCount = applicableStages.filter((s) => s.isDone).length;
  const totalCount = applicableStages.length;

  // One progress dot per SECTION (not per stage) — a section counts as done
  // only when every one of its own applicable stages is done. Keeps the
  // header readable (7 dots, not 16) while staying perfectly consistent
  // with the detail timeline below it.
  const progressChecks = sections.filter((sec) => sec.isApplicable).map((sec) => {
    const secStages = sec.stages.filter((s) => s.isApplicable !== false);
    return { label: sec.title, done: secStages.length > 0 && secStages.every((s) => s.isDone) };
  });

  const pending = applicableStages.find((s) => !s.isDone);
  const journeyLabel: { text: string; done: boolean } = pending
    ? { text: `${pending.label} pending`, done: false }
    : { text: "Journey Complete", done: true };

  return { isPhysicallyComplete, agreementDone, sections, progressChecks, journeyLabel, doneCount, totalCount };
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
// The one row type for EVERY stage in the journey — Agreement's own 8
// sub-steps render through this exact same component as AFS/NOC/Possession/
// Sale Deed/Registry/Mutation, so the whole page reads as one continuous,
// consistently-styled timeline instead of two visually different trackers.

const StageRow: React.FC<{
  stage: Stage;
  isLast: boolean;
  bookingId: number;
  navigate: (path: string) => void;
  canEdit: boolean;
}> = ({ stage, isLast, bookingId, navigate, canEdit }) => {
  const { isDone, isLocked, action } = stage;
  const hasRecord = !!stage.status;
  const isAuto = action.kind === "auto";
  const isManual = action.kind === "manual";
  const actionLabel = isManual ? "Mark Done" : isAuto ? "Auto-synced" : isDone ? "Open" : hasRecord ? "Continue" : isLocked ? "View" : "Start →";

  const handleClick = () => {
    if (action.kind === "manual") { action.onAction(); return; }
    if (action.kind === "navigate") {
      navigate(`${action.path}${action.path.includes("?") ? "&" : "?"}bookingId=${bookingId}`);
    }
  };

  // Not applicable to this specific booking (e.g. Bank NOC for a self-funded
  // purchase) — render as a plainly dimmed, non-actionable row instead of a
  // normal Start/Continue action, so staff never gets an inviting "Start →"
  // button for a step that will never happen for this booking.
  if (stage.isApplicable === false) {
    return (
      <div className="relative flex gap-4 pb-5 last:pb-0">
        {!isLast && <div className="absolute left-[15px] top-8 bottom-0 w-0.5 bg-border" />}
        <div className="shrink-0 z-10 mt-1">
          <div className="w-8 h-8 rounded-full bg-muted/40 border-2 border-dashed border-border flex items-center justify-center">
            <span className="text-muted-foreground/50 text-xs">—</span>
          </div>
        </div>
        <div className="flex-1 rounded-xl border border-dashed border-border bg-muted/10 px-4 py-3 opacity-70">
          <span className="text-sm font-semibold text-muted-foreground line-through decoration-muted-foreground/40">{stage.label}</span>
          <div className="text-[12px] text-muted-foreground mt-0.5">Not applicable — {stage.notApplicableReason}</div>
        </div>
      </div>
    );
  }

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
          {isAuto ? (
            <span className="shrink-0 text-[10px] text-muted-foreground bg-muted/60 border border-border rounded-lg px-2.5 py-1.5 whitespace-nowrap">Auto-synced</span>
          ) : (isManual && !canEdit) ? null : (
            <button
              onClick={handleClick}
              className={`shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
                isDone
                  ? "border-green-300 text-green-700 bg-green-50 hover:bg-green-100 dark:bg-green-900/30 dark:border-green-800 dark:text-green-300"
                  : isLocked
                  ? "border-border text-muted-foreground hover:bg-muted"
                  : "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
              }`}
            >
              {actionLabel} {!isManual && <ExternalLink size={11} />}
            </button>
          )}
        </div>
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
  const [selectedTracker, setSelectedTracker] = useState<any | null>(null);
  const [newDialog, setNewDialog] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [page, setPage] = useState(1);
  function updateFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }

  const listFilters: LegalMilestoneListFilters = useMemo(
    () => ({ search, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    [search, cpb]
  );
  const { data: listResult, isLoading, isFetching, dataUpdatedAt, refetch, isError, error } = useQuery({
    queryKey: ["crm-legal-milestones", listFilters, page],
    queryFn: () => fetchLegalMilestonesList(listFilters, page),
    staleTime: 30_000,
  });
  const trackers = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;
  const { data: bookings = [] } = useQuery({
    queryKey: ["crm-legal-milestones-eligible-bookings"],
    queryFn: fetchEligibleBookings,
    staleTime: 60_000,
    enabled: newDialog,
  });

  // Auto-select from ?bookingId= URL param (deep-link from stage buttons on
  // this page). Resolved via the dedicated /booking/:bookingId lookup
  // rather than scanning `trackers` — that list is now paginated, so the
  // deep-linked tracker could easily not be on the current page (same class
  // of bug fixed on CrmHandover.tsx earlier this rollout).
  const [deepLinkResolved, setDeepLinkResolved] = useState(false);
  useEffect(() => {
    const urlBookingId = sp.get("bookingId");
    if (!urlBookingId || deepLinkResolved) return;
    setDeepLinkResolved(true);
    fetchTrackerByBooking(urlBookingId).then((t) => {
      if (t) { setSelectedId(t.Id); setSelectedTracker(t); }
      else { setSp((prev) => { prev.delete("bookingId"); return prev; }, { replace: true }); }
    });
  }, [sp, deepLinkResolved]);

  // A regular row click sets both the id and the full row object directly
  // (selectRow below) so selection never depends on the object still being
  // present in the current page/filter — only the deep-link path above
  // needs the dedicated lookup.
  const selected = selectedTracker && selectedTracker.Id === selectedId
    ? selectedTracker
    : (trackers as any[]).find((t: any) => t.Id === selectedId);
  const selectRow = (t: any) => { setSelectedId(t.Id); setSelectedTracker(t); setSp({ bookingId: String(t.BookingId) }, { replace: true }); };
  // /eligible-bookings already applies the real POST gate (Approved, active,
  // not frozen, has an Agreement, no tracker yet) — no client-side filtering needed.
  const startableBookings = bookings as any[];

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
      qc.invalidateQueries({ queryKey: ["crm-legal-milestones-eligible-bookings"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleStepUpdate = async (step: string, status: string) => {
    if (selectedId == null) return;
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

  const model = selected ? buildWorkflowModel(selected, (step) => handleStepUpdate(step, "Completed")) : null;

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
          <div className="w-80 shrink-0 flex flex-col gap-2">
          <div className="relative">
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") updateFilter(setSearch)(searchInput); }}
              placeholder="Search customer, booking... (Enter to search)"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <CrmCompanyProjectBlockFilter value={cpb} onChange={updateFilter(setCpb)} />
          <div className="flex-1 overflow-y-auto thin-scroll space-y-1.5">
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
                  onClick={() => selectRow(t)}
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
                          // Bare "Completed" here read as if THIS BOOKING'S journey
                          // were done — sitting right next to a "Document Collection
                          // pending" line one row below made that reading actively
                          // contradictory. This flag is about the PROJECT (Ready-to-
                          // Move / physically finished construction), not this
                          // booking's own progress — labelled accordingly.
                          <span className="shrink-0 text-[9px] px-1.5 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full font-medium" title="This booking's PROJECT is already physically complete (Ready-to-Move) — Handover doesn't have to wait on the Sale Deed. Does not mean this booking's own legal journey is finished.">Project Ready</span>
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
          <CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
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
                      <button
                        onClick={() => navigate(`/crm/agreements?bookingId=${selected.BookingId}`)}
                        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted font-semibold"
                      >
                        <ExternalLink size={11} /> View Agreement
                      </button>
                    </div>
                  </div>
                  {/* One continuous progress bar (doneCount/totalCount, every
                      applicable stage across the WHOLE journey) plus a row of
                      per-section dots underneath — replaces the old two
                      different progress indicators (Phase-1-only step count +
                      a separate Phase-2+ dot row) that made it easy to think
                      the journey was further along, or less along, than it
                      really was. */}
                  <div className="px-5 py-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] text-muted-foreground font-medium">Overall journey progress</span>
                      <span className="text-[11px] font-semibold text-foreground">{model.doneCount}/{model.totalCount} steps</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${model.journeyLabel.done ? "bg-green-500" : "bg-primary"}`}
                        style={{ width: `${model.totalCount ? Math.round((model.doneCount / model.totalCount) * 100) : 0}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-1 flex-wrap pt-0.5">
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

                {/* The ENTIRE journey — Agreement's 8 sub-steps included — as
                    one continuous list of sections, every section using the
                    exact same StageRow component. No separate "Phase 1 card"
                    with different visuals, and nothing hidden behind a locked
                    placeholder: a section not yet reachable simply shows its
                    stages as locked rows (with the real reason why), so
                    staff can always see the full remaining journey at a
                    glance instead of it appearing to vanish. */}
                {model.sections.map((section) => (
                  <div key={section.key} className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-border bg-muted/20 flex items-start gap-3">
                      <div>
                        <h3 className="text-sm font-bold">{section.title}</h3>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                          {section.isApplicable ? section.description : section.notApplicableReason}
                        </p>
                      </div>
                    </div>
                    {section.isApplicable && (
                      <div className="p-5 space-y-0">
                        {section.stages.map((stage, idx) => (
                          <StageRow
                            key={stage.key}
                            stage={stage}
                            isLast={idx === section.stages.length - 1}
                            bookingId={selected.BookingId}
                            navigate={navigate}
                            canEdit={rights.canEdit}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <Dialog open={newDialog} onOpenChange={(o) => { if (!o) setNewDialog(false); }}>
          <DialogContent accent="crm" className="max-w-sm">
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
                  No booking is eligible right now — a booking needs to be fully Approved, active, unfrozen, have an Agreement on file, and not already have a legal workflow tracker.
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
