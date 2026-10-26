import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { SheetShell, SheetMark, statusTone } from "@/components/sheet/Sheet";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Check, ExternalLink, Info, Lock, Plus, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";

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

// ─── Status tone ──────────────────────────────────────────────────────────────
// Settled (registered, confirmed, issued, approved, completed) is solid; in hand (drafted, info sent, scheduled,
// applied, pending) is hatched.
const SETTLED = new Set(["Registered", "Executed", "Confirmed", "Completed", "Issued", "Approved", "Acknowledged", "Ready"]);
const stageTone = (s: string): "done" | "waiting" | "stopped" => (SETTLED.has(s) ? "done" : statusTone(s));

// Today's date where the user is: toISOString gives the UTC date, a day behind before 05:30 IST.
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// ─── Stage row component ──────────────────────────────────────────────────────
// The one row type for EVERY stage in the journey (Agreement's own 8 sub-steps through Mutation), so the whole page
// reads as one continuous timeline. Square ink marks: done solid, current outlined, locked faint, not applicable dashed.

const Mark: React.FC<{ kind: "done" | "current" | "locked" | "na" }> = ({ kind }) => (
  <div className={`shrink-0 z-10 w-[22px] h-[22px] flex items-center justify-center mt-0.5 ${
    kind === "done" ? "bg-foreground text-card border border-foreground"
    : kind === "current" ? "bg-card border-2 border-foreground"
    : kind === "na" ? "bg-card border border-dashed border-foreground/30"
    : "bg-card border border-foreground/20"}`}>
    {kind === "done" ? <Check size={12} /> : kind === "locked" ? <Lock size={9} className="text-muted-foreground/50" /> : kind === "current" ? <i className="w-2 h-2 bg-foreground" /> : null}
  </div>
);
const Rail: React.FC<{ show: boolean; solid?: boolean }> = ({ show, solid }) =>
  show ? <div className={`absolute left-[10.5px] top-6 bottom-0 w-px ${solid ? "bg-foreground" : "bg-foreground/20"}`} /> : null;

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
  const actionLabel = isManual ? "Mark done" : isAuto ? null : isDone ? "Open" : hasRecord ? "Continue" : isLocked ? null : "Start";

  const handleClick = () => {
    if (isLocked) return;                              // locked steps are read-only — no navigation
    if (action.kind === "manual") { action.onAction(); return; }
    if (action.kind === "navigate") {
      navigate(`${action.path}${action.path.includes("?") ? "&" : "?"}bookingId=${bookingId}`);
    }
  };
  const refs = (
    <>
      {stage.no && <span className="font-heading text-[0.625rem] tabular-nums text-muted-foreground">{stage.no}</span>}
      {stage.status && <SheetMark text={stage.status} tone={stageTone(stage.status)} />}
    </>
  );
  const title = (muted?: boolean) => `font-heading text-[0.6875rem] font-bold uppercase tracking-[0.1em] ${muted ? "text-muted-foreground/60" : "text-foreground"}`;

  if (stage.isApplicable === false) {
    return (
      <div className="relative flex gap-3 pb-3 last:pb-0">
        <Rail show={!isLast} />
        <Mark kind="na" />
        <div className="flex-1 py-0.5 opacity-50"><span className={`${title(true)} line-through`}>{stage.label}</span></div>
      </div>
    );
  }

  if (isDone) {
    return (
      <div className="relative flex gap-3 pb-3 last:pb-0">
        <Rail show={!isLast} solid />
        <Mark kind="done" />
        <div className="flex-1 flex items-center justify-between gap-2 min-w-0 py-0.5">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className={title()}>{stage.label}</span>
            {refs}
          </div>
          {action.kind === "navigate" && (
            <button onClick={handleClick} className="shrink-0 text-[0.625rem] text-muted-foreground hover:text-foreground flex items-center gap-1 whitespace-nowrap">
              <ExternalLink size={10} /> Open
            </button>
          )}
        </div>
      </div>
    );
  }

  // Locked: shows what it is waiting for (it was hidden on hover only).
  if (isLocked) {
    return (
      <div className="relative flex gap-3 pb-3 last:pb-0">
        <Rail show={!isLast} />
        <Mark kind="locked" />
        <div className="flex-1 py-0.5 min-w-0">
          <span className={title(true)}>{stage.label}</span>
          {stage.unlockedHint && <p className="text-[0.6875rem] text-muted-foreground/70 mt-0.5">{stage.unlockedHint}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex gap-3 pb-4 last:pb-0">
      <Rail show={!isLast} />
      <Mark kind="current" />
      <div className="flex-1 px-3 py-2.5 flex items-center justify-between gap-3 min-w-0 bg-card" style={{ border: RULE_SOFT, borderLeft: "3px solid hsl(var(--foreground))" }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={title()}>{stage.label}</span>
            {refs}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{stage.sublabel}</p>
        </div>
        {isAuto ? (
          <span className="shrink-0 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground" title="Ticks itself from the agreement's own actions">Automatic</span>
        ) : (isManual && !canEdit) || actionLabel === null ? null : (
          <button onClick={handleClick} className={`${KEY_INK} h-8 px-3 shrink-0`}>
            {actionLabel} {!isManual && <ExternalLink size={10} />}
          </button>
        )}
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
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => updateFilter(setSearch)(v));

  const listFilters: LegalMilestoneListFilters = useMemo(
    () => ({ search, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    [search, cpb]
  );
  const { data: listResult, isLoading, isFetching, refetch, isError, error } = useQuery({
    queryKey: ["crm-legal-milestones", listFilters, page],
    queryFn: () => fetchLegalMilestonesList(listFilters, page),
    staleTime: 30_000,
  });
  const trackers = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;
  const { data: bookings = [], isLoading: loadingBookings } = useQuery({
    queryKey: ["crm-legal-milestones-eligible-bookings"],
    queryFn: fetchEligibleBookings,
    staleTime: 60_000,
    enabled: newDialog,
  });

  // ?bookingId= opens that booking's journey; resolved through the dedicated lookup since the list is paged.
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

  // The list's fresh copy wins over the one kept from the click / deep link: after Mark done the list refetches,
  // and the open journey used to keep showing the old state until another row was clicked.
  const selected = (trackers as any[]).find((t: any) => t.Id === selectedId)
    ?? (selectedTracker && selectedTracker.Id === selectedId ? selectedTracker : null);
  const selectRow = (t: any) => { setSelectedId(t.Id); setSelectedTracker(t); setSp({ bookingId: String(t.BookingId) }, { replace: true }); };
  const reloadSelected = async (bkId: number | string) => {
    const t = await fetchTrackerByBooking(String(bkId));
    if (t) { setSelectedId(t.Id); setSelectedTracker(t); setSp({ bookingId: String(t.BookingId) }, { replace: true }); }
  };

  const trackerModels = useMemo(
    () => (trackers as any[]).map((t: any) => ({ t, m: buildWorkflowModel(t) })),
    [trackers],
  );

  // /eligible-bookings already applies the real POST gate (Approved, active, not frozen, has an Agreement, no tracker).
  const startableBookings = bookings as any[];

  const handleStart = async () => {
    if (!bookingId) return void toast.error("Select a booking.");
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BookingId: parseInt(bookingId) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not start the legal workflow.");
      toast.success("Legal workflow started");
      setNewDialog(false);
      ["crm-legal-milestones", "crm-legal-milestones-eligible-bookings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      // Open the journey just started (it stayed on whatever was open).
      await reloadSelected(bookingId);
      setBookingId("");
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleStepUpdate = async (step: string, status: string) => {
    if (selectedId == null || !selected) return;
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/${step}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: status, Done: status === "Completed" ? todayLocal() : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not update the step.");
      toast.success("Step marked done");
      qc.invalidateQueries({ queryKey: ["crm-legal-milestones"] });
      await reloadSelected(selected.BookingId);
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const model = selected ? buildWorkflowModel(selected, (step) => handleStepUpdate(step, "Completed")) : null;
  const pct = model && model.totalCount ? Math.round((model.doneCount / model.totalCount) * 100) : 0;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Legal Milestones"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Pre-sale"
        title="Legal Milestones"
        subtitle="Every booking's legal journey in one line, from agreement signing through both Sub-Registrar visits to mutation."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {rights.canCreate && <button onClick={() => setNewDialog(true)} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> Start workflow</button>}
          </div>
        }
      >
        <div className="flex flex-col md:flex-row gap-4 md:h-[calc(100vh-220px)]">
          {/* ── Left panel: booking list ── */}
          <div className="w-full md:w-80 shrink-0 flex flex-col bg-card min-h-0" style={{ border: RULE }}>
            <div className="p-3 space-y-2" style={{ borderBottom: RULE }}>
              <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") updateFilter(setSearch)(searchInput); }}
                placeholder="Search customer or booking…"
                className="h-9 w-full border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
              <CrmCompanyProjectBlockFilter stacked value={cpb} onChange={updateFilter(setCpb)} />
            </div>
            <div className="flex-1 overflow-y-auto thin-scroll max-h-[45vh] md:max-h-none">
              {isLoading ? (
                <p className="p-4 text-center text-muted-foreground text-sm">Loading…</p>
              ) : isError ? (
                <p className="p-4 text-center text-sm text-destructive">{(error as Error)?.message || "Could not load the legal workflows."}</p>
              ) : trackers.length === 0 ? (
                <p className="p-4 text-center text-muted-foreground text-sm">{search || cpb.projectId ? "No workflow matches." : "No legal workflow started yet."}</p>
              ) : trackerModels.map(({ t, m }) => {
                const on = selectedId === t.Id;
                const p = m.totalCount ? Math.round((m.doneCount / m.totalCount) * 100) : 0;
                return (
                  <button key={t.Id} onClick={() => selectRow(t)}
                    className={`w-full text-left px-3 py-2.5 transition-colors ${on ? "bg-foreground text-card" : "hover:bg-primary/5"}`}
                    style={{ borderBottom: RULE_SOFT }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold truncate"><ApplicantNames name={t.ApplicantName} bookingId={t.BookingId} applicationId={t.ApplicationId} /></span>
                      <span className={`font-heading text-[0.625rem] font-bold tabular-nums shrink-0 ${on ? "" : "text-muted-foreground"}`}>{m.doneCount}/{m.totalCount}</span>
                    </div>
                    <div className={`mt-0.5 text-[0.6875rem] tabular-nums ${on ? "opacity-80" : "text-muted-foreground"}`}>
                      {[t.BookingNo, t.UnitNo].filter(Boolean).join(" · ")}{m.isPhysicallyComplete ? " · project ready" : ""}
                    </div>
                    <div className="mt-1.5 h-1 w-full" style={{ background: on ? "hsl(var(--card) / 0.25)" : "hsl(var(--foreground) / 0.12)" }}>
                      <div className={`h-full ${on ? "bg-card" : "bg-foreground"}`} style={{ width: `${p}%` }} />
                    </div>
                    <div className={`mt-1 text-[0.6875rem] font-semibold ${on ? "" : m.journeyLabel.done ? "text-foreground" : "text-muted-foreground"}`}>{m.journeyLabel.text}</div>
                  </button>
                );
              })}
            </div>
            <div style={{ borderTop: RULE_SOFT }}><CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} /></div>
          </div>

          {/* ── Right panel: journey detail ── */}
          <div className="flex-1 min-w-0 overflow-y-auto thin-scroll">
            {!selected || !model ? (
              <div className="h-full min-h-[200px] flex items-center justify-center text-muted-foreground text-sm bg-card" style={{ border: RULE_SOFT }}>
                Pick a booking on the left to see its legal journey.
              </div>
            ) : (
              <div className="space-y-4 pb-6">
                <div className="bg-card" style={{ border: RULE }}>
                  <div className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: RULE }}>
                    <div className="min-w-0">
                      <span className={`block ${LBL}`}>Legal journey</span>
                      <h2 className="font-heading font-bold text-lg text-foreground truncate"><ApplicantNames name={selected.ApplicantName} bookingId={selected.BookingId} applicationId={selected.ApplicationId} /></h2>
                      <div className="text-[0.6875rem] text-muted-foreground mt-0.5 tabular-nums">
                        {[selected.BookingNo, selected.UnitNo].filter(Boolean).join(" · ")}
                        {model.isPhysicallyComplete && <span title="The project is already complete (ready to move): Handover need not wait for the Sale Deed. Agreement and AFS registration still apply."> · project ready</span>}
                      </div>
                    </div>
                    <button onClick={() => navigate(`/crm/agreements?bookingId=${selected.BookingId}`)} className={`${KEY_LINE} h-9 px-3`}>
                      <ExternalLink size={12} /> Open agreement
                    </button>
                  </div>
                  <div className="px-5 py-3 space-y-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className={LBL}>Overall</span>
                      <span className="font-heading text-sm font-bold tabular-nums">{model.doneCount} of {model.totalCount} steps · {pct}%</span>
                    </div>
                    <div className="h-2 w-full" style={{ border: RULE_SOFT }}>
                      <div className="h-full bg-foreground transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    {/* One square per section; hover for its name. */}
                    <div className="flex items-center gap-1 pt-0.5">
                      {model.progressChecks.map((p, i) => (
                        <span key={p.label} title={p.label}
                          className={`inline-flex items-center justify-center w-5 h-5 font-heading text-[0.5625rem] font-bold tabular-nums ${p.done ? "bg-foreground text-card border border-foreground" : "bg-card text-muted-foreground border border-foreground/25"}`}>
                          {p.done ? <Check size={10} /> : i + 1}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {model.sections.map((section) => (
                  <section key={section.key} className="bg-card" style={{ border: RULE }}>
                    <div className="px-4 py-2.5 flex items-center justify-between gap-2" style={{ borderBottom: RULE }}>
                      <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">{section.title}</span>
                      {section.isApplicable
                        ? <span title={section.description} className="text-muted-foreground hover:text-foreground cursor-help"><Info size={12} /></span>
                        : <span className="text-[0.6875rem] text-muted-foreground">{section.notApplicableReason}</span>}
                    </div>
                    {section.isApplicable && (
                      <div className="px-4 py-3">
                        {section.stages.map((stage, idx) => (
                          <StageRow key={stage.key} stage={stage} isLast={idx === section.stages.length - 1}
                            bookingId={selected.BookingId} navigate={navigate} canEdit={rights.canEdit} />
                        ))}
                      </div>
                    )}
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetShell>

      <Dialog open={newDialog} onOpenChange={(o) => { if (!o) setNewDialog(false); }}>
        <DialogContent className="max-w-sm p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <DialogHeader><DialogTitle className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.14em]">Start legal workflow</DialogTitle></DialogHeader>
          <label className="block space-y-1">
            <span className={`block ${LBL}`}>Booking *</span>
            <SearchableSelect value={bookingId} onChange={setBookingId}
              placeholder={loadingBookings ? "Loading bookings…" : startableBookings.length ? "Select booking" : "No booking is eligible"}
              searchPlaceholder="Search booking or customer…"
              options={startableBookings.map((b: any) => ({ value: String(b.Id), label: `${b.BookingNo} · ${b.ApplicantName}` }))} />
            {!loadingBookings && startableBookings.length === 0 && (
              <span className="block text-xs text-muted-foreground pt-1">
                A booking needs to be approved, active, not frozen, have an agreement on file, and no legal workflow yet.
              </span>
            )}
          </label>
          <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
            <button onClick={() => setNewDialog(false)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={handleStart} disabled={saving || !bookingId} className={`${KEY_INK} h-9 px-4`}>{saving ? "Starting…" : "Start"}</button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CrmLegalMilestones;
