// CRM Legal Milestones: every booking's legal journey, from the agreement through both Sub-Registrar visits, NOC,
// possession, sale deed and mutation. One list; one page per journey with the phases stacked, the phase it is on
// highlighted and the one next action in the band. Each step's done/locked state is decided on the server.
import { CERTIFICATE_TERMS, CERT_STATUS_LABEL } from "@/constants/crmStatuses";
import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";
import { ArrowLeft, Check, ChevronDown, CircleDot, Download, ExternalLink, Home, Lock, Plus, RefreshCw, Scale, ScrollText } from "lucide-react";
import { AGREEMENT_STEP_NAMES } from "./agreement/config";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import {
  CrmGrid, GridDialog, GridFormField, GridFormSection, GridRelated, GridSearch, GridSegment, GridStatusPill, GridTabs, GridToneMark,
  exportGrid, useGridPrefs, GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_PAGE_SIZES, GRID_SHEET_KEYS, type GridCol,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, useSticky, listParams } from "@/hooks/useCrmListState";
import { SearchableSelect } from "@/components/SearchableSelect";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, BandNext, CollectionBar, MoneyBand, StepBar, personName, type StepState } from "./payments/parts";


const API = "/api/crm/legal-milestones";

// The agreement phase: the Agreement page's own steps up to execution (agreement/config.tsx, same names and order; the
// server reads them off the agreement record as agr* flags). Its registration is the AFS registration phase. Each step
// is worked on the Agreement page, in the part named here.
const AGREEMENT_STEPS: { key: string; hint: string; tab: string }[] = [
  { key: "agrInit", hint: "The agreement is made for the booking", tab: "overview" },
  { key: "agrLegal", hint: "Assign the legal executive who prepares the paperwork", tab: "legal" },
  { key: "agrPapers", hint: "Ask for and upload every mandatory paper", tab: "documents" },
  { key: "agrSenior", hint: "An approver (Approval Setup: CRM Agreement) approves it", tab: "legal" },
  { key: "agrSent", hint: "Share it with the customer's portal", tab: "legal" },
  { key: "agrCustomer", hint: "The customer approves it, in the portal or recorded by staff", tab: "legal" },
  { key: "agrDate", hint: "Both sides agree the signing date and it is approved", tab: "legal" },
  { key: "agrExecuted", hint: "Every mandatory paper verified, then mark it executed", tab: "legal" },
];

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

// Every step is worked on the page that owns it; this page opens that page on the booking.
type StageAction = { kind: "navigate"; path: string; label?: string };

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
function buildWorkflowModel(t: any): WorkflowModel {
  const isPhysicallyComplete = t.ProjectType === "ReadyToMove" || t.ProjectStatus === "Completed";
  // When each step is done and when it is locked is decided on the server (routes/crmLegalMilestones.js, LM_STAGES)
  // and comes on the row as D_<step> / L_<step>; this model only arranges and words them.
  const done = (key: string) => t[`D_${key}`] === 1;
  const locked = (key: string) => t[`L_${key}`] === 1;

  const agreementDone = done("agrExecuted");
  const agreementStages: Stage[] = AGREEMENT_STEPS.map((st, i) => ({
    key: st.key,
    label: AGREEMENT_STEP_NAMES[i],
    sublabel: done(st.key) ? "Done" : st.hint,
    no: i === 0 ? t.AgreementNo || null : null,
    status: null,
    isDone: done(st.key),
    isLocked: locked(st.key),
    unlockedHint: `Waits for: ${AGREEMENT_STEP_NAMES[i - 1] ?? "the agreement"}`,
    action: { kind: "navigate", path: `/crm/agreements?tab=${st.tab}`, label: "Open Agreement" },
  }));

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
      description: "Prepared, approved by a senior and the customer, dated and executed: the same steps as on the Agreement page.",
      stages: agreementStages,
    },

    // ── Sub-Registrar Visit 1 — AFS Registration ─────────────────────────
    {
      key: "afsVisit1",
      title: "Sub-Registrar Visit 1 — Registering the Agreement for Sale",
      isApplicable: true,
      description: "The Agreement for Sale must be registered at the Sub-Registrar's Office before the deal is legally recognised. First the buyer pays the stamp duty and registration fee (Agreement Registration Fees), then both parties attend in person to register the document.",
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
          label: "Agreement Registry",
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
            ? "Bank confirms it has no objection to the agreement's registration (loan-case NOC)"
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
      description: "Once the Agreement for Sale is registered and the project receives its Occupancy Certificate, the developer schedules a pre-possession inspection, issues a Possession Notice, and hands over keys.",
      stages: [
        {
          key: "ocCc",
          label: CERTIFICATE_TERMS.ONE,
          sublabel: "The project's certificate from the authority: one record for the whole project, not for each booking",
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
          unlockedHint: `Unlocks once the agreement is registered and the ${CERTIFICATE_TERMS.ONE} is issued`,
          action: { kind: "navigate", path: "/crm/possession" },
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
          action: { kind: "navigate", path: "/crm/possession" },
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
          action: { kind: "navigate", path: "/crm/possession" },
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
          label: "Sale Deed (director approved)",
          sublabel: "The ownership-transfer document: drafted, then approved by the director (its registration is the next phase)",
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
      description: "Once the Sale Deed is Director Approved: confirm the stamp duty and registration fee (less the stamp duty already paid on the agreement), then both parties attend in person to register the Sale Deed. After this, ownership is officially and permanently transferred.",
      stages: [
        {
          key: "queryPayment",
          label: "Deed Registration Fees",
          sublabel: "Stamp duty and registration fee due before Visit 2, less the stamp duty already paid on the agreement",
          no: t.QPNo || null,
          status: t.QueryPaymentStatus || null,
          isDone: done("queryPayment"),
          isLocked: locked("queryPayment"),
          unlockedHint: "Requires the Sale Deed to be Director Approved first",
          action: { kind: "navigate", path: "/crm/sales-deed?tab=Query+Payment" },
        },
        {
          key: "registry",
          label: "Deed Registry",
          sublabel: "Buyer & seller appear at Sub-Registrar Office (Visit 2) — ownership transferred",
          no: t.RegNo || null,
          status: t.RegistryStatus || null,
          isDone: done("registry"),
          isLocked: locked("registry"),
          unlockedHint: "Requires the Deed Registration Fees to be confirmed first",
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

          unlockedHint: "Requires the Deed Registry to be completed first",
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


// ─── Phase state ──────────────────────────────────────────────────────────────
// Every view below reads a phase's state from the same WorkflowModel: done when all its steps are done, open when one of
// its steps can be worked now, waiting when every step left is still locked behind another phase.
type PhaseState = "done" | "open" | "waiting";
const phaseState = (sec: Section): PhaseState => {
  const st = sec.stages.filter((s) => s.isApplicable !== false);
  if (st.length && st.every((s) => s.isDone)) return "done";
  return st.some((s) => !s.isDone && !s.isLocked) ? "open" : "waiting";
};
const phaseNext = (sec: Section) => sec.stages.find((s) => s.isApplicable !== false && !s.isDone && !s.isLocked);
const PHASE_SHORT: Record<string, string> = {
  agreement: "Agreement", afsVisit1: "Agmt. reg.", noc: "NOC", possession: "Possession",
  saleDeed: "Sale deed", afsVisit2: "Deed reg.", mutation: "Mutation",
};
const { RULE_SOFT } = GRID_SHEET_KEYS;
// The tabs have more room than the bar: a longer name where the short one is abbreviated.
const PHASE_TAB_NAME: Partial<Record<string, string>> = { afsVisit1: "Agreement reg." };
const PHASE_STEP: Record<PhaseState, StepState> = { done: "done", open: "active", waiting: "off" };
const PHASE_WORD: Record<PhaseState, string> = { done: "Done", open: "In progress", waiting: "Waiting" };
const phaseName = (sec: Section) => PHASE_SHORT[sec.key] ?? sec.title;
const workableNow = (m: WorkflowModel) => m.sections.flatMap((sec) => { const n = phaseNext(sec); return n ? [{ sec, n }] : []; });

/** The journey's phases as the shared bar, with where it stands. */
function journeyBar(m: WorkflowModel): { steps: { label: string; state: StepState }[]; caption: string } {
  const steps = m.sections.map((sec) => ({ label: phaseName(sec), state: PHASE_STEP[phaseState(sec)] }));
  const at = m.sections.filter((sec) => phaseState(sec) === "open").map(phaseName);
  const caption = m.journeyLabel.done ? "Journey complete" : at.length ? `Now at ${at.join(" and ")}` : "Waiting";
  return { steps, caption };
}
const pctOf = (m: WorkflowModel) => (m.totalCount ? Math.round((m.doneCount / m.totalCount) * 100) : 0);

// ─── The record: one booking's journey ────────────────────────────────────────
// What a step's button does: opens the page that owns the step, on this booking.
const stagePath = (stage: Stage, bookingId: number) => `${stage.action.path}${stage.action.path.includes("?") ? "&" : "?"}bookingId=${bookingId}`;
function stageGo(stage: Stage, bookingId: number, navigate: (p: string) => void): { label: string; run: () => void } {
  return { label: stage.action.label ?? (stage.status ? "Continue" : "Start"), run: () => navigate(stagePath(stage, bookingId)) };
}

/** One step inside a phase: a single line when done or waiting, a highlighted row with its button when it can be worked. */
const StageLine: React.FC<{ stage: Stage; bookingId: number; navigate: (path: string) => void }> = ({ stage, bookingId, navigate }) => {
  const na = stage.isApplicable === false;
  const workable = !stage.isDone && !stage.isLocked && !na;
  const go = workable ? stageGo(stage, bookingId, navigate) : null;
  const path = stage.isDone ? stagePath(stage, bookingId) : null;
  return (
    <li className={cn("flex items-start gap-3 px-4 py-2.5", workable && "bg-primary/5")}>
      <span className={cn("mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 border",
        stage.isDone ? "bg-emerald-600 border-emerald-600 text-white" : workable ? "border-2 border-primary bg-card" : "bg-muted border-border text-muted-foreground")}>
        {stage.isDone ? <Check size={11} /> : workable ? <span className="w-1.5 h-1.5 rounded-full bg-primary" /> : <Lock size={9} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("text-[0.8125rem]", workable ? "font-semibold" : "font-medium", !stage.isDone && !workable && "text-muted-foreground", na && "line-through")}>{stage.label}</span>
          {stage.no && <span className="text-[0.6875rem] tabular-nums text-muted-foreground">{stage.no}</span>}
          {stage.status && !stage.isDone && <GridStatusPill status={stage.status} />}
        </div>
        {!stage.isDone && <p className="text-xs text-muted-foreground mt-0.5">{na ? stage.notApplicableReason : stage.isLocked ? stage.unlockedHint : stage.sublabel}</p>}
      </div>
      {stage.isDone ? (
        <span className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-emerald-700 dark:text-emerald-300 tabular-nums">{stage.status || "Done"}</span>
          {path && <button type="button" onClick={() => navigate(path)} className="text-muted-foreground hover:text-primary" title={`Open ${stage.label}`} aria-label={`Open ${stage.label}`}><ExternalLink size={12} /></button>}
        </span>
      ) : go ? (
        <button type="button" onClick={go.run} className={cn(GRID_BTN_BRAND, "h-7 shrink-0")}>{go.label} <ExternalLink size={11} /></button>
      ) : null}
    </li>
  );
};

/** One phase: a single line (state, name, steps done); opened to show its steps. */
const PhaseBlock: React.FC<{ sec: Section; open: boolean; onToggle: () => void; bookingId: number; navigate: (p: string) => void }> = ({ sec, open, onToggle, bookingId, navigate }) => {
  const st = phaseState(sec);
  const steps = sec.stages.filter((s) => s.isApplicable !== false);
  const done = steps.filter((s) => s.isDone).length;
  const now = phaseNext(sec);
  return (
    <section id={`lm-phase-${sec.key}`} className="scroll-mt-4" style={{ borderTop: RULE_SOFT }}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
        <span className={cn("w-7 h-7 rounded-md flex items-center justify-center shrink-0", st === "done" ? "bg-emerald-600 text-white" : st === "open" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
          {st === "done" ? <Check size={14} /> : st === "open" ? <CircleDot size={14} /> : <Lock size={12} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.8125rem] font-semibold">{sec.title}</span>
          <span className="block text-xs text-muted-foreground truncate">{st === "done" ? "All steps done" : st === "open" ? `Now: ${now?.label ?? "—"}` : sec.stages.find((s) => !s.isDone)?.unlockedHint || "Waiting on an earlier phase"}</span>
        </span>
        <span className="text-xs tabular-nums text-muted-foreground shrink-0">{done} of {steps.length}</span>
        <GridToneMark text={PHASE_WORD[st]} tone={st === "done" ? "done" : st === "open" ? "moving" : "draft"} />
        <ChevronDown size={15} className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="pb-2">
          <p className="px-4 pb-2 text-xs text-muted-foreground">{sec.description}</p>
          {sec.isApplicable
            ? <ol className="divide-y divide-border/60 border-y border-border/60">{sec.stages.map((stage) => <StageLine key={stage.key} stage={stage} bookingId={bookingId} navigate={navigate} />)}</ol>
            : <p className="px-4 py-2 text-xs text-muted-foreground">{sec.notApplicableReason}</p>}
        </div>
      )}
    </section>
  );
};

const JourneyRecord: React.FC<{ t: any; model: WorkflowModel; navigate: (p: string) => void; onBack: () => void; onRefresh: () => void; refreshing: boolean }> = ({ t, model, navigate, onBack, onRefresh, refreshing }) => {
  const nowOpen = workableNow(model);
  // Phases in progress start open; finished and waiting ones are one line each until opened.
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const isOpen = (sec: Section) => opened[sec.key] ?? phaseState(sec) === "open";
  const toggle = (key: string, now: boolean) => setOpened((o) => ({ ...o, [key]: !now }));
  // The band's next step: the first step that can be worked now. Possession and the sale deed can both be open at once;
  // every open phase is unfolded below with its own button.
  const first = nowOpen[0];
  let next = ""; let action: { label: string; run: () => void } | null = null;
  if (model.journeyLabel.done) next = "Every step of the legal journey is done.";
  else if (!first) next = "Everything left is waiting on another phase.";
  else {
    next = `${first.n.label} (${phaseName(first.sec)})${nowOpen.length > 1 ? `, and ${nowOpen.length - 1} more open below` : ""}`;
    const go = stageGo(first.n, t.BookingId, navigate);
    action = { label: first.n.action.label ?? `${go.label}: ${first.n.label}`, run: go.run };
  }
  return (
    <div className="space-y-4">
      <MoneyBand eyebrow={`Legal journey · ${t.BookingNo ?? ""}`} title={<span className="capitalize">{personName(t.ApplicantName)}</span>}
        status={<span className="inline-flex items-center h-5 px-2 rounded-full border border-white/30 text-[0.6875rem] font-semibold text-white">{model.journeyLabel.done ? "Journey complete" : "In progress"}</span>}
        sub={[t.ProjectName, t.UnitNo && `Unit ${t.UnitNo}`, model.isPhysicallyComplete && "project ready to move"].filter(Boolean).join(" · ")}
        actions={<>
          <button type="button" onClick={onBack} className={BAND_KEY}><ArrowLeft size={13} /> All journeys</button>
          <button type="button" onClick={() => navigate(`/crm/agreements?bookingId=${t.BookingId}`)} className={BAND_KEY}><ScrollText size={13} /> Agreement</button>
          <button type="button" onClick={() => navigate(`/crm/bookings?view=${t.BookingId}`)} className={BAND_KEY}><Home size={13} /> Booking</button>
          <button type="button" onClick={onRefresh} disabled={refreshing} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /></button>
        </>}
        lead={`${pctOf(model)}%`} leadNote={`${model.doneCount} of ${model.totalCount} steps done`}
        bar={<StepBar steps={journeyBar(model).steps} onDark />}
        figures={[
          { label: "Phases done", dot: BAND_DOT.collected, value: `${model.progressChecks.filter((p) => p.done).length} of ${model.progressChecks.length}`, note: model.journeyLabel.done ? "Complete" : `${nowOpen.length} step${nowOpen.length === 1 ? "" : "s"} open now` },
          { label: "Financing", value: t.NocResolvedType === "Bank" ? "Home loan" : "Self-funded", note: t.NocResolvedType === "Bank" ? "Bank NOC" : "Developer NOC" },
          { label: CERTIFICATE_TERMS.ONE, value: t.OcCcReceived === 1 ? CERT_STATUS_LABEL.Received : "Not yet", note: "For the project" },
          { label: "Dues", dot: t.HasOutstandingDues === 1 ? BAND_DOT.overdue : undefined, value: t.HasOutstandingDues === 1 ? "Outstanding" : "Clear", note: "Needed for handover", alert: t.HasOutstandingDues === 1 },
        ]}
        footer={<BandNext text={next} finished={model.journeyLabel.done} action={action} />} />

      <GridRelated icon={Scale} title="Journey" action={<span className="text-xs text-muted-foreground">Possession and the sale deed run side by side once the agreement for sale is registered.</span>}>
        <div>
          {model.sections.map((sec) => { const o = isOpen(sec); return <PhaseBlock key={sec.key} sec={sec} open={o} onToggle={() => toggle(sec.key, o)} bookingId={t.BookingId} navigate={navigate} />; })}
        </div>
      </GridRelated>
    </div>
  );
};

// ─── The list ─────────────────────────────────────────────────────────────────
const PHASE_KEYS = ["agreement", "afsVisit1", "noc", "possession", "saleDeed", "afsVisit2", "mutation"] as const;
type Focus = "all" | "complete" | (typeof PHASE_KEYS)[number];
// The server's orders (routes/crmLegalMilestones.js, LM_ORDER).
type SortKey = "least" | "most" | "name" | "newest";
interface JourneySummary { total: number; complete: number; avgProgress: number; gates: Record<string, number>; atPhase: Record<string, number> }
interface JourneyPage { rows: any[]; total: number; summary: JourneySummary }
const EMPTY_SUMMARY: JourneySummary = { total: 0, complete: 0, avgProgress: 0, gates: {}, atPhase: {} };
type Lane = { t: any; m: WorkflowModel };

const COLS: GridCol<Lane>[] = [
  { id: "customer", label: "Customer", locked: true, csv: ({ t }) => personName(t.ApplicantName), cell: ({ t }) => (
    <span className="block py-1.5 min-w-0">
      <span className="block font-semibold text-foreground capitalize truncate" title={t.ApplicantName}>{personName(t.ApplicantName)}</span>
      <span className="block text-xs text-muted-foreground tabular-nums">{t.BookingNo}</span>
    </span>
  ) },
  { id: "unit", label: "Project and unit", csv: ({ t }) => [t.ProjectName, t.UnitNo].filter(Boolean).join(" / "), cell: ({ t, m }) => (
    <span className="block py-1.5 min-w-0">
      <span className="block font-medium truncate">{[t.ProjectName, t.UnitNo].filter(Boolean).join(" · ") || "—"}</span>
      <span className="block text-xs text-muted-foreground truncate">{[t.NocResolvedType === "Bank" ? "Home loan" : "Self-funded", m.isPhysicallyComplete && "project ready"].filter(Boolean).join(" · ")}</span>
    </span>
  ) },
  { id: "progress", label: "Progress", csv: ({ m }) => journeyBar(m).caption, cell: ({ m }) => { const b = journeyBar(m); return <span className="block min-w-[16rem] py-1.5"><StepBar steps={b.steps} caption={b.caption} /></span>; } },
  { id: "now", label: "Can be worked now", csv: ({ m }) => workableNow(m).map((x) => x.n.label).join("; "), cell: ({ m }) => {
    const now = workableNow(m);
    return now.length ? <span className="block py-1 text-xs space-y-0.5">{now.map(({ n }) => <span key={n.key} className="block truncate">{n.label}</span>)}</span>
      : <span className="text-muted-foreground">{m.journeyLabel.done ? "Complete" : "Waiting"}</span>;
  } },
  { id: "done", label: "Done", align: "right", csv: ({ m }) => `${pctOf(m)}%`, cell: ({ m }) => (
    <span className="block text-right">
      <span className={cn("text-sm font-bold tabular-nums", pctOf(m) === 100 && "text-emerald-600")}>{pctOf(m)}%</span>
      <span className="block text-[0.6875rem] text-muted-foreground tabular-nums">{m.doneCount}/{m.totalCount}</span>
    </span>
  ) },
  // In the export only: each phase's state.
  ...PHASE_KEYS.map((k): GridCol<Lane> => ({ id: `ph-${k}`, label: PHASE_SHORT[k], hiddenByDefault: true, cell: () => null,
    csv: ({ m }) => { const sec = m.sections.find((x) => x.key === k); return sec ? PHASE_WORD[phaseState(sec)] : ""; } })),
];
const NO_SORT = { key: "", dir: "asc" as const };

const CrmLegalMilestones: React.FC = () => {
  const rights = usePageRights("crm-legal-milestones");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [newDialog, setNewDialog] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const s = useCrmListState({ pageSize, defaultSort: { key: "CreatedAt", dir: "desc" } });
  const [focus, setFocusRaw] = useState<Focus>("all");
  const [sortKey, setSortKeyRaw] = useState<SortKey>("least");
  const setFocus = (f: Focus) => { setFocusRaw(f); s.setPage(1); };
  const setSortKey = (k: SortKey) => { setSortKeyRaw(k); s.setPage(1); };
  const [prefs, setPrefs] = useGridPrefs("crm-legal-milestones-cols-v2", COLS);
  // The open journey lives in the address (?bookingId=), so a refresh or a shared link lands on it.
  const openBookingId = sp.get("bookingId");

  // One page of journeys from the server, filtered to where they are and in the asked order, with the summary across
  // every journey under the search and filters (the gates and the tab counts).
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
    enabled: !openBookingId,
  });
  const result = useSticky(data);
  const summary = result?.summary ?? EMPTY_SUMMARY;
  const { data: bookings = [], isLoading: loadingBookings } = useQuery({
    queryKey: ["crm-legal-milestones-eligible-bookings"], queryFn: fetchEligibleBookings, staleTime: 60_000, enabled: newDialog,
  });
  const { data: openTracker, refetch: refetchOpen, isFetching: openFetching } = useQuery({
    queryKey: ["crm-legal-milestones", "booking", openBookingId],
    queryFn: () => fetchTrackerByBooking(openBookingId!),
    enabled: !!openBookingId,
    staleTime: 15_000,
  });
  const lanes = useMemo<Lane[]>(() => (result?.rows ?? []).map((t) => ({ t, m: buildWorkflowModel(t) })), [result]);
  const { total, complete } = summary;

  const openJourney = (t: any) => setSp((p) => { p.set("bookingId", String(t.BookingId)); return p; }, { replace: false });
  const closeJourney = () => setSp((p) => { p.delete("bookingId"); return p; }, { replace: false });

  const startableBookings = bookings as any[];
  const handleStart = async () => {
    if (!bookingId) return void toast.error("Select a booking.");
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ BookingId: parseInt(bookingId) }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not start the legal workflow.");
      toast.success("Legal workflow started");
      setNewDialog(false);
      ["crm-legal-milestones", "crm-legal-milestones-eligible-bookings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setSp((p) => { p.set("bookingId", bookingId); return p; });
      setBookingId("");
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const openModel = openTracker ? buildWorkflowModel(openTracker) : null;

  const handleExport = async () => {
    setExporting(true);
    try {
      const p = new URLSearchParams(qs); ["page", "pageSize", "focus", "order"].forEach((k) => p.delete(k));
      const r = await fetchWithAuth(`${API}?${p}`);
      const rows = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(rows)) throw new Error(rows?.error || `Could not export (${r.status}).`);
      exportGrid(rows.map((t: any) => ({ t, m: buildWorkflowModel(t) })), COLS, "legal-journeys");
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };

  const focusTabs = [
    { key: "all" as Focus, label: "All journeys", count: result ? total : null },
    ...PHASE_KEYS.map((k) => ({ key: k as Focus, label: PHASE_TAB_NAME[k] ?? PHASE_SHORT[k], count: result ? summary.atPhase[k] ?? 0 : null })),
    { key: "complete" as Focus, label: "Complete", count: result ? complete : null },
  ];
  const listFiltered = s.hasFilters || focus !== "all";

  return (
    <div className="space-y-4">
      <Breadcrumbs items={openBookingId ? ["Dashboard", "CRM", "Legal Milestones", "Journey"] : ["Dashboard", "CRM", "Legal Milestones"]} />
      {openBookingId ? (
        !openTracker || !openModel
          ? <div className={cn(GRID_CARD, "py-16 text-center text-sm text-muted-foreground")}>
              {openTracker === null ? <>This booking has no legal workflow yet. <button type="button" onClick={closeJourney} className="text-primary hover:underline ml-1">All journeys</button></> : "Loading…"}
            </div>
          : <JourneyRecord t={openTracker} model={openModel} navigate={navigate} onBack={closeJourney} onRefresh={() => refetchOpen()} refreshing={openFetching} />
      ) : (
        <>
          <MoneyBand eyebrow="CRM" title="Legal Milestones" sub="Every booking's legal journey: agreement, both Sub-Registrar visits, NOC, possession, sale deed and mutation."
            actions={<>
              {rights.canCreate && <button type="button" onClick={() => setNewDialog(true)} className={BAND_KEY_MAIN}><Plus size={13} /> Start Workflow</button>}
              <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            </>}
            lead={`${complete} of ${total}`} leadNote="journeys complete"
            bar={<CollectionBar onDark due={total} collected={complete} finance={0} recorded={0} />}
            figures={[
              { label: "Average progress", value: `${summary.avgProgress}%`, note: "Across every journey" },
              { label: "Agreement executed", value: String(summary.gates.agreement ?? 0), note: "Agreement phase done" },
              { label: "Agreement registered", dot: BAND_DOT.finance, value: String(summary.gates.afsVisit1 ?? 0), note: "Visit 1 done" },
              { label: "Sale deed registered", dot: BAND_DOT.collected, value: String(summary.gates.afsVisit2 ?? 0), note: "Visit 2 done" },
            ]} />
          <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
            <GridTabs<Focus> label="Where they are" active={focus} onChange={setFocus} tabs={focusTabs} />
            <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
              <GridSearch value={s.searchInput} onChange={s.setSearchInput} placeholder="Customer or booking" />
              <CrmCompanyProjectBlockFilter value={s.cpb} onChange={s.setCpb} />
              <GridSegment<SortKey> label="Order" value={sortKey} onChange={setSortKey} options={[
                { key: "least", label: "Least done" }, { key: "most", label: "Most done" }, { key: "name", label: "Name" }, { key: "newest", label: "Newest" },
              ]} />
              {listFiltered && <button type="button" onClick={() => { s.reset(); setFocus("all"); }} className={GRID_BTN}>Clear filters</button>}
              <button type="button" onClick={handleExport} disabled={exporting || !total} className={cn(GRID_BTN, "ml-auto")} title="Export to Excel"><Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span></button>
            </div>
            <CrmGrid cols={COLS} prefs={prefs} onPrefs={setPrefs} rows={lanes} rowKey={({ t }) => t.Id} noRowNumbers
              loading={isLoading} fetching={isFetching} error={error ? translateError((error as Error).message) : null} onRetry={() => refetch()}
              sort={NO_SORT} onSort={() => {}} onRowClick={({ t }) => openJourney(t)}
              empty={listFiltered ? "No journey matches these filters." : "No legal workflow started yet."}
              page={s.page} pageSize={pageSize} total={result?.total ?? 0} onPage={s.setPage} onPageSize={(n) => { setPageSize(n); s.setPage(1); }} />
          </div>
        </>
      )}

      {newDialog && (
        <GridDialog onClose={() => setNewDialog(false)} icon={Scale} width="max-w-2xl" title="Start Legal Workflow" description="Tracks the booking's legal journey from the agreement to mutation."
          footer={<><button type="button" onClick={() => setNewDialog(false)} className={GRID_BTN}>Cancel</button><button type="button" onClick={handleStart} disabled={saving || !bookingId} className={GRID_BTN_BRAND}>{saving ? "Starting…" : "Start Workflow"}</button></>}>
          <GridFormSection>
            <GridFormField label="Booking" required wide hint={!loadingBookings && startableBookings.length === 0 ? "No booking is eligible: it needs to be approved, active, not frozen, have an agreement on file, and no legal workflow yet." : undefined}>
              <SearchableSelect value={bookingId} onChange={setBookingId}
                placeholder={loadingBookings ? "Loading bookings…" : startableBookings.length ? "Select booking" : "No booking is eligible"}
                searchPlaceholder="Search booking or customer…"
                options={startableBookings.map((b: any) => ({ value: String(b.Id), label: `${b.BookingNo} · ${personName(b.ApplicantName)}` }))} />
            </GridFormField>
          </GridFormSection>
        </GridDialog>
      )}
    </div>
  );
};

export default CrmLegalMilestones;
