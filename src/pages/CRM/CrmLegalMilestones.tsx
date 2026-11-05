import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";
import { ArrowLeft, Check, CircleDot, ExternalLink, Home, Info, Lock, Plus, RefreshCw, RotateCcw, Scale, ScrollText } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import {
  CrmAppPage, GridHighlights, GridProgress, GridRelated, GridSearch, GridSegment, GridStatusPill, GridTabs,
  GridFooter, GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_LABEL, GRID_PAGE_SIZES,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, useSticky, listParams } from "@/hooks/useCrmListState";
import { SearchableSelect } from "@/components/SearchableSelect";

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
  // When each step is done and when it is locked is decided on the server (routes/crmLegalMilestones.js, LM_STAGES)
  // and comes on the row as D_<step> / L_<step>; this model only arranges and words them.
  const done = (key: string) => t[`D_${key}`] === 1;
  const locked = (key: string) => t[`L_${key}`] === 1;

  const agreementDone = done("FinalExecution");
  const agreementCurrentStep = t.CurrentStep ?? 1;

  // Agreement's own 8 sub-steps, now expressed as ordinary Stage objects so
  // they render through the exact same timeline row as everything after
  // them — no more visually distinct "numbered circle" tracker bolted onto
  // the front of a different-looking phase list.
  const agreementStages: Stage[] = AGREEMENT_STEPS.map((s, idx) => {
    const stepDone = t[`${s.key}Done`];
    const isDone = done(s.key);
    const isCurrent = agreementCurrentStep === idx + 1;
    const isLocked = locked(s.key);
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
  const afsGate = done("afsReg");

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
          isDone: done("afsQP"),
          isLocked: locked("afsQP"),
          unlockedHint: "Unlocks once the Agreement is Executed (previous section)",
          action: { kind: "navigate", path: "/crm/agreements?tab=afs-payment" },
        },
        {
          key: "afsReg",
          label: "Agreement Registration Visit",
          sublabel: "Buyer & seller appear at Sub-Registrar Office (Visit 1) — Agreement becomes Registered",
          no: t.AfsRegNo || null,
          status: t.AfsRegistryStatus || null,
          isDone: done("afsReg"),
          isLocked: locked("afsReg"),
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
          isDone: done("noc"),
          isLocked: locked("noc"),
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
          isDone: done("ocCc"),
          isLocked: locked("ocCc"),
          unlockedHint: "",
          action: { kind: "navigate", path: "/crm/oc-cc" },
        },
        {
          key: "prePossession",
          label: "Pre-Possession Inspection",
          sublabel: "Site inspection and snag list before offering possession to the buyer",
          no: null,
          status: t.PrePossessionStatus || null,
          isDone: done("prePossession"),
          isLocked: locked("prePossession"),
          unlockedHint: "Unlocks once AFS is registered and OC/CC is received",
          action: { kind: "navigate", path: "/crm/pre-possession" },
        },
        {
          key: "possessionNotice",
          label: "Possession Notice",
          sublabel: "Developer issues notice with offered possession date; buyer acknowledges or disputes",
          no: null,
          status: t.PossessionNoticeStatus || null,
          isDone: done("possessionNotice"),
          isLocked: locked("possessionNotice"),
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
          isDone: done("handover"),
          // Handover's own four gates (crmHandover.js POST /), decided on the server.
          isLocked: locked("handover"),
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
          isDone: done("salesDeed"),
          isLocked: locked("salesDeed"),
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
          isDone: done("queryPayment"),
          isLocked: locked("queryPayment"),
          unlockedHint: "Requires the Sale Deed to be Director Approved first",
          action: { kind: "navigate", path: "/crm/sales-deed?tab=Query+Payment" },
        },
        {
          key: "registry",
          label: "Registry (Sub-Registrar Visit)",
          sublabel: "Buyer & seller appear at Sub-Registrar Office (Visit 2) — ownership transferred",
          no: t.RegNo || null,
          status: t.RegistryStatus || null,
          isDone: done("registry"),
          isLocked: locked("registry"),
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
          isDone: done("mutation"),
          isLocked: locked("mutation"),

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

// Today's date where the user is: toISOString gives the UTC date, a day behind before 05:30 IST.
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// ─── Phase state ──────────────────────────────────────────────────────────────
// Every view below (the gate summary, each booking's lane, the record's metro line) reads a phase's state from the same
// WorkflowModel: done when all its steps are done, open when one of its steps can be worked now, waiting when every step
// left is still locked behind another phase.
type PhaseState = "done" | "open" | "waiting";
const phaseState = (sec: Section): PhaseState => {
  const st = sec.stages.filter((s) => s.isApplicable !== false);
  if (st.length && st.every((s) => s.isDone)) return "done";
  return st.some((s) => !s.isDone && !s.isLocked) ? "open" : "waiting";
};
const phaseNext = (sec: Section) => sec.stages.find((s) => s.isApplicable !== false && !s.isDone && !s.isLocked);
const PHASE_SHORT: Record<string, string> = {
  agreement: "Agreement", afsVisit1: "AFS registration", noc: "NOC", possession: "Possession",
  saleDeed: "Sale deed", afsVisit2: "Deed registration", mutation: "Mutation",
};
const PHASE_CELL: Record<PhaseState, string> = {
  done: "bg-emerald-500/15 border-emerald-500/30 text-emerald-800 dark:text-emerald-200",
  open: "bg-primary/10 border-primary/40 text-foreground",
  waiting: "bg-muted/50 border-border text-muted-foreground",
};
const SEG: Record<"done" | "open" | "locked", string> = { done: "bg-emerald-600", open: "bg-primary", locked: "bg-border" };
const segOf = (s: Stage): "done" | "open" | "locked" => (s.isDone ? "done" : s.isLocked ? "locked" : "open");

/** One phase of a booking's lane: its steps as segments, and what can be worked now. */
const PhaseCell: React.FC<{ sec: Section; onOpen: () => void }> = ({ sec, onOpen }) => {
  const state = phaseState(sec);
  const steps = sec.stages.filter((s) => s.isApplicable !== false);
  const next = phaseNext(sec);
  const done = steps.filter((s) => s.isDone).length;
  return (
    <button type="button" onClick={onOpen}
      title={`${PHASE_SHORT[sec.key] ?? sec.title}: ${done} of ${steps.length} done${next ? ` · now: ${next.label}` : ""}`}
      className={cn("w-full h-12 rounded-md border px-2 py-1.5 text-left flex flex-col justify-between transition-colors hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", PHASE_CELL[state])}>
      <span className="flex gap-0.5">
        {steps.map((s) => <span key={s.key} className={cn("h-1.5 flex-1 rounded-full", SEG[segOf(s)])} />)}
      </span>
      <span className="text-[0.6875rem] leading-tight truncate font-medium">
        {state === "done" ? <span className="inline-flex items-center gap-1"><Check size={11} /> Done</span>
          : state === "open" ? (next?.label ?? "Open")
          : <span className="inline-flex items-center gap-1"><Lock size={10} /> Waiting</span>}
      </span>
    </button>
  );
};

/** A circular gauge: the share of journeys that have cleared a gate. */
const Gauge: React.FC<{ value: number; total: number; label: string; tone: string; onClick?: () => void; active?: boolean }> = ({ value, total, label, tone, onClick, active }) => {
  const pct = total ? Math.round((value / total) * 100) : 0;
  const r = 22, c = 2 * Math.PI * r;
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn("flex flex-col items-center gap-1.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", active && "bg-primary/10 ring-1 ring-primary/30")}>
      <svg width="56" height="56" viewBox="0 0 56 56" role="img" aria-label={`${label}: ${value} of ${total}`}>
        <circle cx="28" cy="28" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
        <circle cx="28" cy="28" r={r} fill="none" strokeWidth="6" strokeLinecap="round" className={tone}
          stroke="currentColor" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 28 28)" />
        <text x="28" y="31" textAnchor="middle" className="fill-foreground" style={{ fontSize: 12, fontWeight: 700 }}>{pct}%</text>
      </svg>
      <span className="text-[0.6875rem] font-semibold text-center leading-tight">{label}</span>
      <span className="text-[0.6875rem] text-muted-foreground tabular-nums">{value.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}</span>
    </button>
  );
};

// ─── The record: one booking's journey ────────────────────────────────────────
const StageLine: React.FC<{ stage: Stage; bookingId: number; navigate: (path: string) => void; canEdit: boolean; last: boolean }> = ({ stage, bookingId, navigate, canEdit, last }) => {
  const { isDone, isLocked, action } = stage;
  const na = stage.isApplicable === false;
  const isAuto = action.kind === "auto";
  const isManual = action.kind === "manual";
  const open = () => {
    if (isLocked) return;
    if (action.kind === "manual") { action.onAction(); return; }
    if (action.kind === "navigate") navigate(`${action.path}${action.path.includes("?") ? "&" : "?"}bookingId=${bookingId}`);
  };
  const actionLabel = isManual ? "Mark done" : isAuto ? null : isDone ? "Open" : stage.status ? "Continue" : isLocked ? null : "Start";
  const dot = na ? "border-dashed border-border bg-card" : isDone ? "bg-emerald-600 border-emerald-600 text-white" : isLocked ? "bg-muted border-border text-muted-foreground" : "bg-card border-primary border-2 text-primary";
  return (
    <li className="relative pl-9 pb-4 last:pb-0">
      {!last && <span className={cn("absolute left-[11px] top-6 bottom-0 w-0.5 rounded-full", isDone ? "bg-emerald-500/60" : "bg-border")} />}
      <span className={cn("absolute left-0 top-0.5 w-6 h-6 rounded-full border flex items-center justify-center", dot)}>
        {isDone ? <Check size={13} /> : isLocked ? <Lock size={10} /> : na ? null : <span className="w-2 h-2 rounded-full bg-primary" />}
      </span>
      <div className={cn("rounded-lg px-3 py-2.5", !isDone && !isLocked && !na ? "bg-primary/5 border border-primary/25" : "")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex flex-wrap items-center gap-2">
            <span className={cn("text-[0.8125rem] font-semibold", (isLocked || na) && "text-muted-foreground", na && "line-through")}>{stage.label}</span>
            {stage.no && <span className="text-[0.6875rem] tabular-nums text-muted-foreground">{stage.no}</span>}
            {stage.status && <GridStatusPill status={stage.status} />}
          </div>
          {!na && (isAuto ? (
            <span className="flex items-center gap-2">
              <span className="text-[0.6875rem] text-muted-foreground" title="Ticks itself from the agreement's own actions">Automatic</span>
              <button type="button" onClick={() => navigate(`/crm/agreements?bookingId=${bookingId}`)} className={cn(GRID_BTN, "h-7")}>Open agreement <ExternalLink size={11} /></button>
            </span>
          ) : (isManual && !canEdit) || actionLabel === null ? null : (
            <button type="button" onClick={open} className={cn(isDone ? GRID_BTN : GRID_BTN_BRAND, "h-7")}>
              {actionLabel} {!isManual && <ExternalLink size={11} />}
            </button>
          ))}
        </div>
        <p className={cn("text-xs mt-0.5", isDone ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>
          {na ? stage.notApplicableReason : isLocked ? stage.unlockedHint : stage.sublabel}
        </p>
      </div>
    </li>
  );
};

const JourneyRecord: React.FC<{ t: any; model: WorkflowModel; canEdit: boolean; navigate: (p: string) => void }> = ({ t, model, canEdit, navigate }) => {
  const pct = model.totalCount ? Math.round((model.doneCount / model.totalCount) * 100) : 0;
  const nowOpen = model.sections.flatMap((sec) => { const n = phaseNext(sec); return n ? [{ sec, n }] : []; });
  const jump = (key: string) => document.getElementById(`lm-phase-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className="space-y-4">
      <GridHighlights icon={Scale} object="Legal journey"
        title={<ApplicantNames name={t.ApplicantName} bookingId={t.BookingId} applicationId={t.ApplicationId} />}
        status={model.journeyLabel.done ? <GridStatusPill status="Completed" label="Journey complete" /> : <GridStatusPill status="Pending" label={model.journeyLabel.text} />}
        sub={<>{[t.BookingNo, [t.ProjectName, t.UnitNo].filter(Boolean).join(" · ")].filter(Boolean).join(" · ")}
          {model.isPhysicallyComplete && <span title="The project is already complete (ready to move): Handover need not wait for the Sale Deed."> · project ready</span>}</>}
        actions={<>
          <button type="button" onClick={() => navigate(`/crm/agreements?bookingId=${t.BookingId}`)} className={GRID_BTN}><ScrollText size={13} /> Agreement</button>
          <button type="button" onClick={() => navigate(`/crm/bookings?view=${t.BookingId}`)} className={GRID_BTN}><Home size={13} /> Booking</button>
        </>}
        fields={[
          { label: "Progress", value: <span className="inline-flex items-center gap-2"><GridProgress done={model.doneCount} total={model.totalCount} /><span className="text-xs text-muted-foreground">{pct}%</span></span> },
          { label: "Phases done", value: `${model.progressChecks.filter((p) => p.done).length} of ${model.progressChecks.length}` },
          { label: "Can be worked now", value: nowOpen.length ? nowOpen.map((x) => x.n.label).join(", ") : "—" },
          { label: "Financing", value: t.NocResolvedType === "Bank" ? "Home loan (bank NOC)" : "Self-funded (developer NOC)" },
          { label: "OC / CC", value: t.OcCcReceived === 1 ? "Received" : "Not yet" },
          { label: "Dues", value: t.HasOutstandingDues === 1 ? <span className="text-destructive font-semibold">Outstanding</span> : "Clear" },
        ]} />

      {/* The metro line: every phase as a station; click one to go to it. */}
      <section className={cn(GRID_CARD, "px-4 py-5 overflow-x-auto")}>
        <ol className="flex items-start min-w-[44rem]" aria-label="Phases">
          {model.sections.map((sec, i) => {
            const st = phaseState(sec);
            const steps = sec.stages.filter((s) => s.isApplicable !== false);
            const done = steps.filter((s) => s.isDone).length;
            return (
              <li key={sec.key} className="flex-1 relative flex flex-col items-center text-center">
                {i > 0 && <span className={cn("absolute top-[15px] right-1/2 w-full h-1 -z-0", phaseState(model.sections[i - 1]) === "done" ? "bg-emerald-500" : "bg-border")} />}
                <button type="button" onClick={() => jump(sec.key)} title={sec.description}
                  className={cn("relative z-10 w-8 h-8 rounded-full border-4 flex items-center justify-center bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    st === "done" ? "border-emerald-500 bg-emerald-500 text-white" : st === "open" ? "border-primary text-primary" : "border-border text-muted-foreground")}>
                  {st === "done" ? <Check size={14} /> : st === "waiting" ? <Lock size={11} /> : <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse motion-reduce:animate-none" />}
                </button>
                <button type="button" onClick={() => jump(sec.key)} className="mt-2 text-xs font-semibold hover:text-primary">{PHASE_SHORT[sec.key] ?? sec.title}</button>
                <span className="text-[0.6875rem] text-muted-foreground tabular-nums">{done}/{steps.length}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] items-start">
        <div className="space-y-4 min-w-0">
          {model.sections.map((sec) => {
            const st = phaseState(sec);
            return (
              <section key={sec.key} id={`lm-phase-${sec.key}`} className={cn(GRID_CARD, "overflow-hidden scroll-mt-4")}>
                <header className={cn("px-4 py-3 border-b border-border flex items-start gap-3", st === "done" ? "bg-emerald-500/5" : st === "open" ? "bg-primary/5" : "")}>
                  <span className={cn("w-7 h-7 rounded-md flex items-center justify-center shrink-0", st === "done" ? "bg-emerald-600 text-white" : st === "open" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                    {st === "done" ? <Check size={14} /> : st === "open" ? <CircleDot size={14} /> : <Lock size={12} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[0.8125rem] font-bold">{sec.title}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{sec.description}</p>
                  </div>
                  <GridStatusPill status={st === "done" ? "Completed" : st === "open" ? "InProgress" : "Draft"} label={st === "done" ? "Done" : st === "open" ? "In progress" : "Waiting"} />
                </header>
                {sec.isApplicable ? (
                  <ol className="px-4 py-4">
                    {sec.stages.map((stage, idx) => (
                      <StageLine key={stage.key} stage={stage} bookingId={t.BookingId} navigate={navigate} canEdit={canEdit} last={idx === sec.stages.length - 1} />
                    ))}
                  </ol>
                ) : <p className="px-4 py-4 text-xs text-muted-foreground">{sec.notApplicableReason}</p>}
              </section>
            );
          })}
        </div>

        <aside className="space-y-4 min-w-0 xl:sticky xl:top-4">
          <GridRelated icon={CircleDot} title="Can be worked now" count={nowOpen.length}>
            {nowOpen.length === 0 ? <p className="px-4 py-4 text-xs text-muted-foreground">{model.journeyLabel.done ? "Every step is done." : "Everything left is waiting on another phase."}</p> : (
              <ul>
                {nowOpen.map(({ sec, n }) => (
                  <li key={n.key}>
                    <button type="button" onClick={() => jump(sec.key)} className="w-full px-4 py-2.5 text-left hover:bg-muted/50 border-b border-border/70 last:border-0">
                      <div className="text-xs font-semibold">{n.label}</div>
                      <div className="text-[0.6875rem] text-muted-foreground">{PHASE_SHORT[sec.key] ?? sec.title}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </GridRelated>
          <section className={cn(GRID_CARD, "px-4 py-3 text-xs text-muted-foreground flex gap-2")}>
            <Info size={14} className="shrink-0 mt-0.5 text-primary" />
            <p>Possession and the sale deed run side by side once the agreement for sale is registered. Most steps tick themselves from their own pages; the director meeting is marked here.</p>
          </section>
        </aside>
      </div>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────
const PHASE_KEYS = ["agreement", "afsVisit1", "noc", "possession", "saleDeed", "afsVisit2", "mutation"] as const;
type Focus = "all" | "complete" | (typeof PHASE_KEYS)[number];
// The server's orders (routes/crmLegalMilestones.js, LM_ORDER).
type SortKey = "least" | "most" | "name" | "newest";
interface JourneySummary { total: number; complete: number; manualDue: number; avgProgress: number; gates: Record<string, number>; atPhase: Record<string, number> }
interface JourneyPage { rows: any[]; total: number; summary: JourneySummary }
const EMPTY_SUMMARY: JourneySummary = { total: 0, complete: 0, manualDue: 0, avgProgress: 0, gates: {}, atPhase: {} };

const CrmLegalMilestones: React.FC = () => {
  const rights = usePageRights("crm-legal-milestones");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [newDialog, setNewDialog] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const s = useCrmListState({ pageSize, defaultSort: { key: "CreatedAt", dir: "desc" } });
  const [focus, setFocusRaw] = useState<Focus>("all");
  const [sortKey, setSortKeyRaw] = useState<SortKey>("least");
  const setFocus = (f: Focus) => { setFocusRaw(f); s.setPage(1); };
  const setSortKey = (k: SortKey) => { setSortKeyRaw(k); s.setPage(1); };
  // The open journey lives in the address (?bookingId=), so a refresh or a shared link lands on it.
  const openBookingId = sp.get("bookingId");

  // One page of journeys from the server, filtered to where they are and in the asked order, with the summary across
  // every journey under the search and filters (the gates and the tab counts): however many there are, the page only
  // ever holds one page of them.
  const qs = useMemo(() => {
    const p = listParams(s.query, "All");
    ["status", "sortKey", "sortDir"].forEach((k) => p.delete(k));
    p.set("focus", focus);
    p.set("order", sortKey);
    return p;
  }, [s.query, focus, sortKey]);
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["crm-legal-milestones", "map", qs.toString()],
    queryFn: async (): Promise<JourneyPage> => {
      const r = await fetchWithAuth(`${API}?${qs}`);
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || `Could not load the legal journeys (${r.status}).`);
      return { rows: d?.rows || [], total: d?.total || 0, summary: d?.summary || EMPTY_SUMMARY };
    },
    staleTime: 30_000,
  });
  const result = useSticky(data);
  const summary = result?.summary ?? EMPTY_SUMMARY;
  const { data: bookings = [], isLoading: loadingBookings } = useQuery({
    queryKey: ["crm-legal-milestones-eligible-bookings"], queryFn: fetchEligibleBookings, staleTime: 60_000, enabled: newDialog,
  });
  const { data: openTracker, refetch: refetchOpen } = useQuery({
    queryKey: ["crm-legal-milestones", "booking", openBookingId],
    queryFn: () => fetchTrackerByBooking(openBookingId!),
    enabled: !!openBookingId,
    staleTime: 15_000,
  });
  const lanes = useMemo(() => (result?.rows ?? []).map((t) => ({ t, m: buildWorkflowModel(t) })), [result]);
  const pageTotal = result?.total ?? 0;
  const { total, complete, manualDue } = summary;
  const avgPct = summary.avgProgress;

  const openJourney = (t: any) => setSp((p) => { p.set("bookingId", String(t.BookingId)); return p; }, { replace: false });
  const closeJourney = () => setSp((p) => { p.delete("bookingId"); return p; }, { replace: false });

  const startableBookings = bookings as any[];
  const handleStart = async () => {
    if (!bookingId) return void toast.error("Select a booking.");
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ BookingId: parseInt(bookingId) }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not start the legal workflow.");
      toast.success("Legal workflow started");
      setNewDialog(false);
      ["crm-legal-milestones", "crm-legal-milestones-eligible-bookings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      // Open the journey just started.
      setSp((p) => { p.set("bookingId", bookingId); return p; });
      setBookingId("");
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleStepUpdate = async (step: string, status: string) => {
    if (!openTracker) return;
    try {
      const res = await fetchWithAuth(`${API}/${openTracker.Id}/${step}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: status, Done: status === "Completed" ? todayLocal() : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not update the step.");
      toast.success("Step marked done");
      qc.invalidateQueries({ queryKey: ["crm-legal-milestones"] });
      refetchOpen();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };
  const openModel = openTracker ? buildWorkflowModel(openTracker, (step) => handleStepUpdate(step, "Completed")) : null;

  const focusTabs = [
    { key: "all" as Focus, label: "All journeys", count: total },
    ...PHASE_KEYS.map((k) => ({ key: k as Focus, label: `At ${PHASE_SHORT[k]}`, count: summary.atPhase[k] ?? 0 })),
    { key: "complete" as Focus, label: "Complete", count: complete },
  ];

  return (
    <>
      <Breadcrumbs items={openBookingId ? ["Dashboard", "CRM", "Legal Milestones", "Journey"] : ["Dashboard", "CRM", "Legal Milestones"]} />
      <CrmAppPage icon={Scale} section="CRM · Legal & Possession" title="Legal Milestones"
        subtitle={openBookingId ? undefined : "Every booking's legal journey on one map: agreement, both Sub-Registrar visits, NOC, possession, sale deed and mutation."}
        actions={<>
          {openBookingId && <button type="button" onClick={closeJourney} className={GRID_BTN}><ArrowLeft size={13} /> Journey map</button>}
          {rights.canCreate && <button type="button" onClick={() => setNewDialog(true)} className={GRID_BTN_BRAND}><Plus size={13} /> Start workflow</button>}
        </>}>

        {!openBookingId && (
          <>
            {/* The gates: what share of journeys has cleared each phase. Click one to see who is on it now. */}
            <section className={cn(GRID_CARD, "p-4")}>
              <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-base font-bold leading-tight">Gates cleared</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Share of the {total.toLocaleString("en-IN")} journeys past each phase. Click a gate to see who is on it now.</p>
                </div>
                <div className="flex gap-6">
                  <div className="text-right"><div className="text-2xl font-bold tabular-nums">{complete.toLocaleString("en-IN")}</div><div className="text-[0.6875rem] text-muted-foreground">complete</div></div>
                  <div className="text-right"><div className="text-2xl font-bold tabular-nums">{avgPct}%</div><div className="text-[0.6875rem] text-muted-foreground">average progress</div></div>
                  <div className="text-right"><div className={cn("text-2xl font-bold tabular-nums", manualDue > 0 && "text-primary")}>{manualDue.toLocaleString("en-IN")}</div><div className="text-[0.6875rem] text-muted-foreground">director meetings due</div></div>
                </div>
              </div>
              {isLoading && !result ? <div className="h-28 rounded-lg bg-muted/40 animate-pulse" /> : (
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-1">
                  {PHASE_KEYS.map((k, i) => (
                    <Gauge key={k} value={summary.gates[k] ?? 0} total={total} label={PHASE_SHORT[k]} tone={["text-sky-500", "text-indigo-500", "text-violet-500", "text-amber-500", "text-teal-500", "text-cyan-600", "text-emerald-600"][i]}
                      active={focus === k} onClick={() => setFocus(focus === k ? "all" : k)} />
                  ))}
                </div>
              )}
            </section>

            {/* The journey map: one lane per booking, one cell per phase. */}
            <section className={cn(GRID_CARD, "overflow-hidden")}>
              <GridTabs<Focus> label="Where they are" active={focus} onChange={setFocus} tabs={focusTabs} />
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
                <GridSearch value={s.searchInput} onChange={s.setSearchInput} placeholder="Search customer or booking" />
                <CrmCompanyProjectBlockFilter value={s.cpb} onChange={s.setCpb} />
                <GridSegment<SortKey> label="Order" value={sortKey} onChange={setSortKey} options={[
                  { key: "least", label: "Least done" }, { key: "most", label: "Most done" }, { key: "name", label: "Name" }, { key: "newest", label: "Newest" },
                ]} />
                {(s.hasFilters || focus !== "all") && (
                  <button type="button" onClick={() => { s.reset(); setFocus("all"); }} className="inline-flex items-center gap-1 h-8 px-2 text-xs text-primary hover:underline">
                    <RotateCcw size={12} /> Clear
                  </button>
                )}
                <div className="ml-auto flex items-center gap-3">
                  <span className="hidden md:flex items-center gap-3 text-[0.6875rem] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500/40 border border-emerald-500/40" /> Done</span>
                    <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-primary/20 border border-primary/40" /> Workable now</span>
                    <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-muted border border-border" /> Waiting</span>
                  </span>
                  <button type="button" className={cn(GRID_BTN, "w-9 px-0")} onClick={() => refetch()} aria-label="Refresh" title="Refresh">
                    <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <div className={cn("min-w-[64rem] transition-opacity", isFetching && result && "opacity-60")}>
                  <div className="grid grid-cols-[16rem_repeat(7,minmax(0,1fr))_4.5rem] gap-2 px-3 py-2 bg-muted text-xs font-semibold text-muted-foreground border-b border-border sticky top-0 z-10">
                    <span>Booking</span>
                    {PHASE_KEYS.map((k) => <span key={k} className="truncate">{PHASE_SHORT[k]}</span>)}
                    <span className="text-right">Done</span>
                  </div>
                  {error ? (
                    <p className="py-12 text-center text-sm text-destructive">{(error as Error).message} <button type="button" onClick={() => refetch()} className="underline ml-1">Retry</button></p>
                  ) : isLoading && !result ? (
                    <div className="p-3 space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 rounded-md bg-muted/50 animate-pulse" />)}</div>
                  ) : lanes.length === 0 ? (
                    <p className="py-14 text-center text-sm text-muted-foreground">{s.hasFilters || focus !== "all" ? "No journey matches." : "No legal workflow started yet."}</p>
                  ) : (
                    <ul>
                      {lanes.map(({ t, m }) => {
                        const pct = m.totalCount ? Math.round((m.doneCount / m.totalCount) * 100) : 0;
                        return (
                          <li key={t.Id} className="grid grid-cols-[16rem_repeat(7,minmax(0,1fr))_4.5rem] gap-2 items-center px-3 py-2 border-b border-border/70 hover:bg-muted/30">
                            <button type="button" onClick={() => openJourney(t)} className="min-w-0 text-left">
                              <div className="text-[0.8125rem] font-semibold text-primary hover:underline truncate">{t.ApplicantName || "—"}</div>
                              <div className="text-[0.6875rem] text-muted-foreground tabular-nums truncate">{[t.BookingNo, t.UnitNo].filter(Boolean).join(" · ")}{m.isPhysicallyComplete ? " · project ready" : ""}</div>
                            </button>
                            {PHASE_KEYS.map((k) => {
                              const sec = m.sections.find((x) => x.key === k);
                              return sec ? <PhaseCell key={k} sec={sec} onOpen={() => openJourney(t)} /> : <span key={k} />;
                            })}
                            <span className="text-right">
                              <span className={cn("text-sm font-bold tabular-nums", pct === 100 && "text-emerald-600")}>{pct}%</span>
                              <span className="block text-[0.6875rem] text-muted-foreground tabular-nums">{m.doneCount}/{m.totalCount}</span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
              <GridFooter page={s.page} pageSize={pageSize} total={pageTotal} onPage={s.setPage} onPageSize={(n) => { setPageSize(n); s.setPage(1); }} />
            </section>
          </>
        )}

        {openBookingId && (
          !openTracker || !openModel
            ? <div className={cn(GRID_CARD, "py-16 text-center text-sm text-muted-foreground")}>{openTracker === null ? "This booking has no legal workflow yet." : "Loading…"}</div>
            : <JourneyRecord t={openTracker} model={openModel} canEdit={rights.canEdit} navigate={navigate} />
        )}
      </CrmAppPage>

      <Dialog open={newDialog} onOpenChange={(o) => { if (!o) setNewDialog(false); }}>
        <DialogContent className="max-w-sm p-5 gap-4">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Scale size={16} className="text-primary" /> Start legal workflow</DialogTitle></DialogHeader>
          <label className="block space-y-1">
            <span className={cn("block font-medium", GRID_LABEL)}>Booking <span className="text-destructive">*</span></span>
            <SearchableSelect value={bookingId} onChange={setBookingId}
              placeholder={loadingBookings ? "Loading bookings…" : startableBookings.length ? "Select booking" : "No booking is eligible"}
              searchPlaceholder="Search booking or customer…"
              options={startableBookings.map((b: any) => ({ value: String(b.Id), label: `${b.BookingNo} · ${b.ApplicantName}` }))} />
            {!loadingBookings && startableBookings.length === 0 && (
              <span className="block text-xs text-muted-foreground pt-1">A booking needs to be approved, active, not frozen, have an agreement on file, and no legal workflow yet.</span>
            )}
          </label>
          <DialogFooter className="gap-2">
            <button type="button" onClick={() => setNewDialog(false)} className={GRID_BTN}>Cancel</button>
            <button type="button" onClick={handleStart} disabled={saving || !bookingId} className={GRID_BTN_BRAND}>{saving ? "Starting…" : "Start workflow"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CrmLegalMilestones;
