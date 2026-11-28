// CRM Legal Milestones: truthful, end-to-end tracker for every booking's legal & possession lifecycle.
// Reflects the exact backend gates enforced by Agreement, AFS Registry, NOC, OC/CC, Pre-Possession, Notice,
// Handover, Loan Clearance, Sale Deed, Sub-Registrar Visit 2, and Mutation — showing real blockers and 1-click fixes.
import { CERTIFICATE_TERMS, CERT_STATUS_LABEL } from "@/constants/crmStatuses";
import React, { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, Check, ChevronDown, CircleDot, Download, ExternalLink,
  Home, Lock, Plus, RefreshCw, Scale, ScrollText, ShieldCheck,
} from "lucide-react";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import { useCrmListState, useSticky, listParams } from "@/hooks/useCrmListState";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SearchableSelect } from "@/components/SearchableSelect";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import {
  CrmGrid, GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_KEY, GRID_KEY_BRAND, GRID_PAGE_SIZES,
  GridDialog, GridFormField, GridFormSection, GridGuidance, GridSearch, GridSegment,
  GridStatusPill, GridTabs, GridToneMark, exportGrid, useGridPrefs, type GridCol,
} from "@/components/crm/CrmDataTable";
import { AGREEMENT_STEP_NAMES } from "./agreement/config";
import { Initials, StepBar, personName, type StepState } from "./payments/parts";

const API = "/api/crm/legal-milestones";

const TONE_EMERALD_TEXT = "text-emerald-400 [[data-theme]_&]:text-emerald-700";
const TONE_AMBER_TEXT = "text-amber-300 [[data-theme]_&]:text-amber-700";
const TONE_EMERALD_PILL = "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 [[data-theme]_&]:bg-emerald-500/10 [[data-theme]_&]:border-emerald-500/25 [[data-theme]_&]:text-emerald-700";
const TONE_AMBER_PILL = "bg-amber-500/15 border-amber-500/30 text-amber-300 [[data-theme]_&]:bg-amber-500/10 [[data-theme]_&]:border-amber-500/30 [[data-theme]_&]:text-amber-700";
const TONE_ROSE_PILL = "bg-rose-500/15 border-rose-500/30 text-rose-300 [[data-theme]_&]:bg-rose-500/10 [[data-theme]_&]:border-rose-500/30 [[data-theme]_&]:text-rose-700";

const AGREEMENT_STEPS: { key: string; hint: string; tab: string }[] = [
  { key: "agrInit", hint: "Agreement shell is created once booking is approved & initial booking amount clears", tab: "overview" },
  { key: "agrLegal", hint: "Assign a legal executive to prepare and track the paperwork", tab: "legal" },
  { key: "agrPapers", hint: "Collect and upload every mandatory Agreement document", tab: "documents" },
  { key: "agrSenior", hint: "Senior Legal Approval under Approval Setup: CRM Agreement", tab: "legal" },
  { key: "agrSent", hint: "Share draft agreement to customer portal", tab: "legal" },
  { key: "agrCustomer", hint: "Customer reviews and approves the agreement", tab: "legal" },
  { key: "agrDate", hint: "Mutual signing date agreed & approved", tab: "legal" },
  { key: "agrExecuted", hint: "All mandatory documents Verified and agreement marked Executed", tab: "legal" },
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
  } catch {
    return null;
  }
}

interface StageBlocker {
  label: string;
  linkLabel?: string;
  linkPath?: string;
}

interface Stage {
  key: string;
  label: string;
  sublabel: string;
  no: string | null;
  status: string | null;
  isDone: boolean;
  isLocked: boolean;
  blockers: StageBlocker[];
  unlockedHint: string;
  action: { path: string; label?: string };
  liveDetails?: string[];
}

interface Section {
  key: string;
  title: string;
  trackLabel: string;
  description: string;
  isApplicable: boolean;
  stages: Stage[];
}

interface WorkflowModel {
  isPhysicallyComplete: boolean;
  requiresHandoverBeforeDeed: boolean;
  agreementDone: boolean;
  afsRegistered: boolean;
  loanBlocked: boolean;
  sections: Section[];
  progressChecks: { label: string; done: boolean }[];
  journeyLabel: { text: string; done: boolean };
  doneCount: number;
  totalCount: number;
}

function deedInternalStageHint(t: any): string {
  if (t.SalesDeedId == null) return "Not drafted yet — start Sale Deed preparation";
  if (!t.DeedLegalExecutiveId) return "Drafted — next: assign Legal Executive";
  const req = Number(t.DeedDocsRequired || 0);
  const up = Number(t.DeedDocsUploaded || 0);
  const ver = Number(t.DeedDocsVerified || 0);
  if (req > 0 && up < req) return `Drafted — documents uploaded (${up}/${req})`;
  if (t.DeedSeniorApprovalStatus !== "Approved") {
    return `Documents ready — awaiting Senior Approval (${t.DeedSeniorApprovalStatus || "Pending"})`;
  }
  if (!t.DeedSentToCustomerAt) return "Senior approved — send Sale Deed to Customer";
  if (t.DeedCustomerApprovalStatus !== "Approved") {
    return `Sent to customer — awaiting Customer Approval (${t.DeedCustomerApprovalStatus || "Pending"})`;
  }
  if (t.DeedDirectorApprovalStatus !== "Approved") {
    return `Customer approved — awaiting Director Approval (${t.DeedDirectorApprovalStatus || "Pending"})`;
  }
  if (req > 0 && ver < req) return `Director approved — verify mandatory docs (${ver}/${req})`;
  return "Director approved";
}

function buildWorkflowModel(t: any): WorkflowModel {
  const isPhysicallyComplete = t.ProjectType === "ReadyToMove" || t.ProjectStatus === "Completed";
  const requiresHandoverBeforeDeed = t.RequiresHandoverBeforeDeed === 1
    || (t.ProjectType === "UnderConstruction" && t.ProjectStatus !== "Completed");

  const done = (key: string) => t[`D_${key}`] === 1;
  const locked = (key: string) => t[`L_${key}`] === 1;

  const bookingId = t.BookingId;
  const agreementDone = done("agrExecuted");
  const afsRegistered = done("afsReg");
  const handoverDone = done("handover");

  const nocType: "Bank" | "Organisation" = t.NocResolvedType === "Bank" ? "Bank" : "Organisation";
  const isLoanFinanced = nocType === "Bank";
  const nocNo = nocType === "Bank" ? t.BankNocNo : t.OrgNocNo;
  const nocStatus = nocType === "Bank" ? t.BankNocStatus : t.OrgNocStatus;
  const loanSanction = t.LoanSanctionStatus || null;
  const loanBlocked = t.FinancingType === "LoanFinanced"
    && t.HasOutstandingDues === 1
    && !["Sanctioned", "Disbursed"].includes(loanSanction || "");

  const agreementStages: Stage[] = AGREEMENT_STEPS.map((st, i) => {
    const live: string[] = [];
    if (st.key === "agrPapers" && Number(t.AgrPapersAsked || 0) > 0 && !done(st.key)) {
      live.push(`${t.AgrPapersIn || 0} of ${t.AgrPapersAsked} mandatory papers uploaded`);
    }
    const prevName = AGREEMENT_STEP_NAMES[i - 1];
    return {
      key: st.key,
      label: AGREEMENT_STEP_NAMES[i],
      sublabel: done(st.key) ? "Completed" : st.hint,
      no: i === 0 ? t.AgreementNo || null : null,
      status: null,
      isDone: done(st.key),
      isLocked: locked(st.key),
      blockers: locked(st.key) && prevName
        ? [{ label: `Waiting on: ${prevName}` }]
        : [],
      unlockedHint: prevName ? `Waits for: ${prevName}` : "Ready",
      liveDetails: live,
      action: { path: `/crm/agreements?tab=${st.tab}`, label: "Open Agreement" },
    };
  });

  // Exact prerequisite blockers for downstream gated steps
  const afsRegBlockers: StageBlocker[] = [];
  if (!agreementDone) afsRegBlockers.push({ label: "Agreement must be Executed first", linkLabel: "Agreement", linkPath: `/crm/agreements?bookingId=${bookingId}&tab=legal` });
  else if (t.AfsQPStatus !== "Confirmed" && !afsRegistered) afsRegBlockers.push({ label: "Confirm Agreement Registration Fees first", linkLabel: "AFS Fees", linkPath: `/crm/agreements?bookingId=${bookingId}&tab=afs-payment` });

  const ocCcBlockers: StageBlocker[] = !afsRegistered
    ? [{ label: "Agreement for Sale must be Registered (Visit 1)", linkLabel: "AFS Registry", linkPath: `/crm/agreements?bookingId=${bookingId}&tab=afs-registry` }]
    : [];

  const prePossBlockers: StageBlocker[] = [];
  if (!afsRegistered) prePossBlockers.push({ label: "Agreement for Sale must be Registered (Visit 1)", linkLabel: "Agreement", linkPath: `/crm/agreements?bookingId=${bookingId}&tab=afs-registry` });
  if (t.OcCcReceived !== 1) prePossBlockers.push({ label: `${CERTIFICATE_TERMS.ONE} must be Received`, linkLabel: "OC / CC", linkPath: `/crm/oc-cc${t.ProjectId ? `?open=${t.ProjectId}` : ""}` });

  const prePossLive: string[] = [];
  if (t.PrePossessionStatus && !done("prePossession")) {
    prePossLive.push(
      `Docs: ${t.PrePossessionDocCheck ? "✓" : "Pending"}`,
      `Quality: ${t.PrePossessionQualityCheck ? "✓" : "Pending"}`,
      `Utilities: ${t.PrePossessionUtilityCheck ? "✓" : "Pending"}`,
      `Dues: ${t.HasOutstandingDues === 1 ? "Outstanding" : "✓ Clear"}`,
    );
  }

  const noticeBlockers: StageBlocker[] = [];
  if (!afsRegistered) noticeBlockers.push({ label: "Agreement for Sale must be Registered", linkLabel: "Agreement", linkPath: `/crm/agreements?bookingId=${bookingId}&tab=afs-registry` });
  if (t.OcCcReceived !== 1) noticeBlockers.push({ label: `${CERTIFICATE_TERMS.ONE} required`, linkLabel: "OC / CC", linkPath: `/crm/oc-cc${t.ProjectId ? `?open=${t.ProjectId}` : ""}` });
  if (!done("prePossession")) noticeBlockers.push({ label: `Pre-Possession Check must be Ready (currently ${t.PrePossessionStatus || "Not started"})`, linkLabel: "Possession", linkPath: `/crm/possession?booking=${bookingId}` });

  const handoverBlockers: StageBlocker[] = [];
  if (!afsRegistered) handoverBlockers.push({ label: "Agreement must be Registered", linkLabel: "Agreement", linkPath: `/crm/agreements?bookingId=${bookingId}&tab=afs-registry` });
  if (!done("prePossession")) handoverBlockers.push({ label: `Pre-Possession must remain Ready (${t.PrePossessionStatus || "Not started"})`, linkLabel: "Possession", linkPath: `/crm/possession?booking=${bookingId}` });
  if (t.PossessionNoticeStatus !== "Acknowledged") handoverBlockers.push({ label: `Customer must acknowledge Possession Notice (${t.PossessionNoticeStatus || "Not sent"})`, linkLabel: "Notice", linkPath: `/crm/possession?booking=${bookingId}` });
  if (["Pending", "Approved"].includes(nocStatus || "")) handoverBlockers.push({ label: `${nocType} NOC is ${nocStatus} — must be Issued`, linkLabel: "Open NOC", linkPath: `/crm/noc?bookingId=${bookingId}&nocType=${nocType}` });
  if (t.HasOutstandingDues === 1) handoverBlockers.push({ label: "All booking payment milestones must be Paid or Waived", linkLabel: "Payments", linkPath: `/crm/payments?bookingId=${bookingId}` });

  const saleDeedBlockers: StageBlocker[] = [];
  if (!afsRegistered) saleDeedBlockers.push({ label: "Agreement for Sale must be Registered (Visit 1)", linkLabel: "AFS Registry", linkPath: `/crm/agreements?bookingId=${bookingId}&tab=afs-registry` });
  if (t.SalesDeedId == null && loanBlocked) {
    saleDeedBlockers.push({
      label: `Home Loan must be Sanctioned or Disbursed (${loanSanction || "No loan recorded"})`,
      linkLabel: "Loan Tracking",
      linkPath: `/crm/loan-details?bookingId=${bookingId}`,
    });
  }
  if (t.SalesDeedId == null && requiresHandoverBeforeDeed && !handoverDone) {
    saleDeedBlockers.push({
      label: "Under-Construction rule: Physical Handover must complete before Sale Deed",
      linkLabel: "Possession",
      linkPath: `/crm/possession?booking=${bookingId}`,
    });
  }

  const deedStatus = t.DeedRegistrationNo ? "Registered"
    : t.DeedExecutedBy ? "Executed"
    : t.SalesDeedId != null ? "Drafted"
    : null;

  const qpFeeMissing = t.SalesDeedId != null && (Number(t.DeedStampDuty || 0) + Number(t.DeedRegistrationFee || 0) <= 0);
  const qpBlockers: StageBlocker[] = [];
  if (!afsRegistered) qpBlockers.push({ label: "Agreement Registry (Visit 1) must complete first", linkLabel: "AFS Registry", linkPath: `/crm/agreements?bookingId=${bookingId}&tab=afs-registry` });
  if (t.SalesDeedId == null || !done("salesDeed")) {
    qpBlockers.push({
      label: `Sale Deed must be Director Approved first${t.SalesDeedId == null ? " (not started)" : ` (${t.DeedDirectorApprovalStatus || "Pending"})`}`,
      linkLabel: "Sale Deed",
      linkPath: `/crm/sales-deed?bookingId=${bookingId}`,
    });
  }

  const regBlockers: StageBlocker[] = [];
  if (!afsRegistered) regBlockers.push({ label: "Agreement Registry (Visit 1) must complete first" });
  if (t.QueryPaymentStatus !== "Confirmed") {
    regBlockers.push({
      label: `Deed Registration Fees must be Confirmed (${t.QueryPaymentStatus || "Pending"})`,
      linkLabel: "Fees Tab",
      linkPath: `/crm/sales-deed?bookingId=${bookingId}&tab=Query+Payment`,
    });
  }

  const mutBlockers: StageBlocker[] = [];
  if (!afsRegistered) mutBlockers.push({ label: "Agreement Registry (Visit 1) must complete first" });
  if (t.RegistryStatus !== "Completed") {
    mutBlockers.push({
      label: `Sale Deed Registry (Visit 2) must be Completed (${t.RegistryStatus || "Not started"})`,
      linkLabel: "Registry",
      linkPath: `/crm/sales-deed?bookingId=${bookingId}&tab=Registry`,
    });
  }

  const sections: Section[] = [
    {
      key: "agreement",
      title: "Agreement Preparation & Signing",
      trackLabel: "Phase 1 · Mandatory Foundation",
      isApplicable: true,
      description: "Agreement draft, legal assignment, document verification, senior & customer approval, signing date, and final execution.",
      stages: agreementStages,
    },
    {
      key: "afsVisit1",
      title: "Sub-Registrar Visit 1 — Agreement Registration",
      trackLabel: "Phase 2 · Mandatory Anchor",
      isApplicable: true,
      description: "Registering the Agreement for Sale anchors ownership protection and unlocks NOC, Possession, and downstream conveyance.",
      stages: [
        {
          key: "afsQP",
          label: "Agreement Registration Fees",
          sublabel: "Stamp duty & registration fee confirmation prior to Visit 1",
          no: t.AfsQPNo || null,
          status: t.AfsQPStatus || null,
          isDone: done("afsQP"),
          isLocked: locked("afsQP"),
          blockers: !agreementDone ? [{ label: "Agreement must be Executed first", linkLabel: "Agreement", linkPath: `/crm/agreements?bookingId=${bookingId}&tab=legal` }] : [],
          unlockedHint: "Unlocks once the Agreement is Executed",
          action: { path: "/crm/agreements?tab=afs-payment", label: "Open AFS Fees" },
        },
        {
          key: "afsReg",
          label: "Agreement Registry",
          sublabel: "Sub-Registrar appearance (Visit 1) — marks Agreement Registered",
          no: t.AfsRegNo || null,
          status: t.AfsRegistryStatus || null,
          isDone: done("afsReg"),
          isLocked: locked("afsReg"),
          blockers: afsRegBlockers,
          unlockedHint: "Requires AFS Registration Fees to be Confirmed first",
          action: { path: "/crm/agreements?tab=afs-registry", label: "Open AFS Registry" },
        },
      ],
    },
    {
      key: "noc",
      title: "No Objection Certificate",
      trackLabel: "Parallel Clearance Track",
      isApplicable: true,
      description: isLoanFinanced
        ? "Loan-financed booking — obtain Bank NOC clearing the lender's charge once the Agreement is Registered."
        : "Self-funded booking — obtain Organisation NOC confirming no builder dues/objections once the Agreement is Registered.",
      stages: [
        {
          key: "noc",
          label: isLoanFinanced ? "No Objection Certificate — Bank" : "No Objection Certificate — Organisation",
          sublabel: isLoanFinanced
            ? "Single clearance step for loan-financed buyers"
            : "Single clearance step for self-funded buyers",
          no: nocNo || null,
          status: nocStatus || null,
          isDone: done("noc"),
          isLocked: locked("noc"),
          blockers: !afsRegistered
            ? [{ label: "Agreement for Sale must be Registered (Visit 1)", linkLabel: "AFS Registry", linkPath: `/crm/agreements?bookingId=${bookingId}&tab=afs-registry` }]
            : [],
          unlockedHint: "Unlocks once the Agreement for Sale is Registered",
          action: { path: `/crm/noc?nocType=${nocType}`, label: nocStatus ? "Open NOC" : "Request NOC" },
        },
      ],
    },
    {
      key: "possession",
      title: "Possession & Key Handover",
      trackLabel: requiresHandoverBeforeDeed ? "Required Before Sale Deed (Under Construction)" : "Parallel With Sale Deed (Completed / Ready)",
      isApplicable: true,
      description: requiresHandoverBeforeDeed
        ? "For under-construction projects, OC/CC -> Pre-Possession Inspection -> Possession Notice -> Physical Handover MUST complete before the Sale Deed can be prepared."
        : "With OC/CC issued and Agreement Registered, complete Pre-Possession Inspection, issue the Notice, and hand over keys.",
      stages: [
        {
          key: "ocCc",
          label: CERTIFICATE_TERMS.ONE,
          sublabel: t.OcCcSource === "block"
            ? "Verified against this booking's specific block certificate coverage"
            : "Authority certificate recorded at project/block level",
          no: null,
          status: t.OcCcReceived === 1 ? CERT_STATUS_LABEL.Received : "Pending",
          isDone: done("ocCc"),
          isLocked: locked("ocCc"),
          blockers: ocCcBlockers,
          unlockedHint: "Tracked on the OC / CC module for this project/block",
          action: { path: `/crm/oc-cc${t.ProjectId ? `?open=${t.ProjectId}` : ""}`, label: "Open OC / CC" },
        },
        {
          key: "prePossession",
          label: "Pre-Possession Inspection",
          sublabel: "Site documents, quality snag inspection, utility readiness & dues verification",
          no: null,
          status: t.PrePossessionStatus || null,
          isDone: done("prePossession"),
          isLocked: locked("prePossession"),
          blockers: prePossBlockers,
          unlockedHint: `Requires Agreement Registered & ${CERTIFICATE_TERMS.ONE} Issued`,
          liveDetails: prePossLive,
          action: { path: "/crm/possession", label: t.PrePossessionStatus ? "Open Inspection" : "Start Check" },
        },
        {
          key: "possessionNotice",
          label: "Possession Notice",
          sublabel: "Formal offer of possession with offered date — requires buyer acknowledgement",
          no: t.PossessionNoticeNo || null,
          status: t.PossessionNoticeStatus || null,
          isDone: done("possessionNotice"),
          isLocked: locked("possessionNotice"),
          blockers: noticeBlockers,
          unlockedHint: "Requires Pre-Possession Inspection to be Ready",
          action: { path: "/crm/possession", label: t.PossessionNoticeStatus ? "Open Notice" : "Issue Notice" },
        },
        {
          key: "handover",
          label: "Physical Handover",
          sublabel: "Key handover after dues cleared, no open snags, acknowledged notice & no pending NOC",
          no: null,
          status: t.HandoverStatus || null,
          isDone: done("handover"),
          isLocked: locked("handover"),
          blockers: handoverBlockers,
          unlockedHint: "Requires Acknowledged Notice, Dues Cleared & NOC Issued",
          liveDetails: Number(t.HandoverOpenSnags || 0) > 0 ? [`${t.HandoverOpenSnags} open snag(s)`] : [],
          action: { path: "/crm/possession", label: t.HandoverStatus ? "Open Handover" : "Schedule Handover" },
        },
      ],
    },
    {
      key: "saleDeed",
      title: "Sale Deed Preparation & Approvals",
      trackLabel: requiresHandoverBeforeDeed ? "Unlocks After Handover & Loan Clearance" : "Conveyance Track",
      isApplicable: true,
      description: requiresHandoverBeforeDeed
        ? "Under-construction project: requires Agreement Registered, Home Loan Sanctioned/Disbursed (if loan-financed), and Physical Handover Completed before Sale Deed creation."
        : "Project is Ready-to-Move / Completed: Sale Deed opens after Agreement Registration and Loan Sanction (Handover runs independently).",
      stages: [
        {
          key: "salesDeed",
          label: "Sale Deed (Director Approved)",
          sublabel: deedInternalStageHint(t),
          no: t.DeedNo || null,
          status: deedStatus,
          isDone: done("salesDeed"),
          isLocked: locked("salesDeed"),
          blockers: saleDeedBlockers,
          unlockedHint: requiresHandoverBeforeDeed
            ? "Requires Agreement Registered, Loan Cleared & Handover Completed"
            : "Requires Agreement Registered & Loan Cleared",
          liveDetails: t.SalesDeedId != null && !done("salesDeed")
            ? [
                t.DeedSeniorApprovalStatus ? `Senior: ${t.DeedSeniorApprovalStatus}` : null,
                t.DeedCustomerApprovalStatus ? `Customer: ${t.DeedCustomerApprovalStatus}` : null,
                t.DeedDirectorApprovalStatus ? `Director: ${t.DeedDirectorApprovalStatus}` : null,
              ].filter((x): x is string => Boolean(x))
            : [],
          action: { path: "/crm/sales-deed", label: t.SalesDeedId != null ? "Open Sale Deed" : "Prepare Deed" },
        },
      ],
    },
    {
      key: "afsVisit2",
      title: "Sub-Registrar Visit 2 — Sale Deed Registration",
      trackLabel: "Statutory Conveyance",
      isApplicable: true,
      description: "Stamp duty & registration fee payment followed by Visit 2 Sub-Registrar execution transferring permanent legal title.",
      stages: [
        {
          key: "queryPayment",
          label: "Deed Registration Fees",
          sublabel: qpFeeMissing
            ? "Enter Stamp Duty & Registration Fee values on the Sale Deed before starting registration fees"
            : "Stamp duty & fee paid against final Director-approved Sale Deed",
          no: t.QPNo || null,
          status: t.QueryPaymentStatus || null,
          isDone: done("queryPayment"),
          isLocked: locked("queryPayment"),
          blockers: qpBlockers,
          unlockedHint: "Requires AFS Registered & Director Approved Sale Deed",
          liveDetails: qpFeeMissing && !done("queryPayment") ? ["Stamp duty / fee amounts not entered on Sale Deed yet"] : [],
          action: { path: "/crm/sales-deed?tab=Query+Payment", label: "Open Fees Tab" },
        },
        {
          key: "registry",
          label: "Deed Registry",
          sublabel: "Sub-Registrar Visit 2 completed & registration number recorded",
          no: t.RegNo || null,
          status: t.RegistryStatus || null,
          isDone: done("registry"),
          isLocked: locked("registry"),
          blockers: regBlockers,
          unlockedHint: "Requires Deed Registration Fees Confirmed first",
          action: { path: "/crm/sales-deed?tab=Registry", label: "Open Registry" },
        },
      ],
    },
    {
      key: "mutation",
      title: "Post-Registration — Property Mutation",
      trackLabel: "Final Municipal Record Update",
      isApplicable: true,
      description: "Update municipal land/revenue records (Khata / Mutation / Dakhil Kharij) after Sale Deed Registration completes.",
      stages: [
        {
          key: "mutation",
          label: "Property Mutation (Khata Transfer)",
          sublabel: "Municipal record mutation application and approval post-registry",
          no: t.MutationNo || null,
          status: t.MutationStatus || null,
          isDone: done("mutation"),
          isLocked: locked("mutation"),
          blockers: mutBlockers,
          unlockedHint: "Requires Deed Registry (Visit 2) Completed first",
          action: { path: "/crm/mutation", label: t.MutationStatus ? "Open Mutation" : "Apply Mutation" },
        },
      ],
    },
  ];

  const applicableStages = sections.filter((sec) => sec.isApplicable).flatMap((sec) => sec.stages);
  const doneCount = applicableStages.filter((s) => s.isDone).length;
  const totalCount = applicableStages.length;

  const progressChecks = sections.map((sec) => ({
    label: sec.title,
    done: sec.stages.length > 0 && sec.stages.every((s) => s.isDone),
  }));

  const firstOpen = applicableStages.find((s) => !s.isDone && !s.isLocked);
  const firstPending = applicableStages.find((s) => !s.isDone);
  const journeyLabel: { text: string; done: boolean } = !firstPending
    ? { text: "Journey Complete", done: true }
    : firstOpen
      ? { text: firstOpen.label, done: false }
      : { text: `Blocked on: ${firstPending.label}`, done: false };

  return {
    isPhysicallyComplete,
    requiresHandoverBeforeDeed,
    agreementDone,
    afsRegistered,
    loanBlocked,
    sections,
    progressChecks,
    journeyLabel,
    doneCount,
    totalCount,
  };
}

type PhaseState = "done" | "open" | "waiting";
const phaseState = (sec: Section): PhaseState => {
  if (sec.stages.length && sec.stages.every((s) => s.isDone)) return "done";
  return sec.stages.some((s) => !s.isDone && !s.isLocked) ? "open" : "waiting";
};
const phaseNext = (sec: Section) => sec.stages.find((s) => !s.isDone && !s.isLocked);
const firstLockedInPhase = (sec: Section) => sec.stages.find((s) => !s.isDone && s.isLocked);

const PHASE_SHORT: Record<string, string> = {
  agreement: "Agreement", afsVisit1: "Agmt. reg.", noc: "NOC", possession: "Possession",
  saleDeed: "Sale deed", afsVisit2: "Deed reg.", mutation: "Mutation",
};
const PHASE_TAB_NAME: Partial<Record<string, string>> = { afsVisit1: "Agreement reg." };
const PHASE_STEP: Record<PhaseState, StepState> = { done: "done", open: "active", waiting: "off" };
const PHASE_WORD: Record<PhaseState, string> = { done: "Done", open: "Action Open", waiting: "Blocked / Waiting" };
const phaseName = (sec: Section) => PHASE_SHORT[sec.key] ?? sec.title;
const workableNow = (m: WorkflowModel) => m.sections.flatMap((sec) => { const n = phaseNext(sec); return n ? [{ sec, n }] : []; });

function journeyBar(m: WorkflowModel): { steps: { label: string; state: StepState }[]; caption: string } {
  const steps = m.sections.map((sec) => ({ label: phaseName(sec), state: PHASE_STEP[phaseState(sec)] }));
  const at = m.sections.filter((sec) => phaseState(sec) === "open").map(phaseName);
  const caption = m.journeyLabel.done ? "Journey complete" : at.length ? `Active: ${at.join(" · ")}` : "Waiting on prerequisite";
  return { steps, caption };
}
const pctOf = (m: WorkflowModel) => (m.totalCount ? Math.round((m.doneCount / m.totalCount) * 100) : 0);

const stagePath = (stage: Stage, bookingId: number) => {
  if (stage.action.path.startsWith("/crm/oc-cc")) return stage.action.path;
  return `${stage.action.path}${stage.action.path.includes("?") ? "&" : "?"}bookingId=${bookingId}`;
};

function stageGo(stage: Stage, bookingId: number, navigate: (p: string) => void): { label: string; run: () => void } {
  return {
    label: stage.action.label ?? (stage.status ? "Continue" : "Start"),
    run: () => navigate(stagePath(stage, bookingId)),
  };
}

// ─── Stage Timeline Row (100% Transparent Prerequisites & Blockers) ──────────
const StageLine: React.FC<{ stage: Stage; bookingId: number; navigate: (path: string) => void }> = ({ stage, bookingId, navigate }) => {
  const workable = !stage.isDone && !stage.isLocked;
  const go = workable ? stageGo(stage, bookingId, navigate) : null;
  const donePath = stage.isDone ? stagePath(stage, bookingId) : null;

  return (
    <li className={cn("flex items-start gap-3 px-4 py-3 transition-colors", workable && "bg-primary/[0.04]")}>
      <span className={cn(
        "mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 border",
        stage.isDone
          ? "bg-emerald-600 border-emerald-600 text-white"
          : workable
            ? "border-2 border-primary bg-card"
            : "bg-muted border-border text-muted-foreground",
      )}>
        {stage.isDone ? <Check size={11} /> : workable ? <span className="w-1.5 h-1.5 rounded-full bg-primary" /> : <Lock size={9} />}
      </span>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn(
            "text-[0.8125rem]",
            workable ? "font-semibold text-foreground" : stage.isDone ? "font-medium text-foreground" : "font-medium text-muted-foreground",
          )}>
            {stage.label}
          </span>
          {stage.no && <span className="text-[0.6875rem] font-mono tabular-nums text-muted-foreground">{stage.no}</span>}
          {stage.status && !stage.isDone && <GridStatusPill status={stage.status} />}
          {workable && (
            <span className="rounded-full bg-primary/10 border border-primary/25 px-2 py-0.5 text-[0.625rem] font-semibold text-primary">
              Ready to work
            </span>
          )}
        </div>

        {!stage.isDone && (
          <p className="text-xs text-muted-foreground">
            {stage.isLocked ? stage.unlockedHint : stage.sublabel}
          </p>
        )}

        {/* Exact unmet blocker pills with direct links to resolve them */}
        {!stage.isDone && stage.isLocked && stage.blockers.length > 0 && (
          <div className="pt-1 flex flex-wrap gap-1.5">
            {stage.blockers.map((blk, i) => (
              <span
                key={i}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[0.6875rem]",
                  TONE_AMBER_PILL,
                )}
              >
                <span>Blocked: {blk.label}</span>
                {blk.linkPath && (
                  <Link
                    to={blk.linkPath}
                    className="font-semibold underline underline-offset-2 hover:opacity-80 inline-flex items-center gap-0.5"
                  >
                    {blk.linkLabel || "Fix"} <ExternalLink size={9} />
                  </Link>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Live sub-progress chips (mandatory docs / snag checks / deed approval chain) */}
        {!stage.isDone && stage.liveDetails && stage.liveDetails.length > 0 && (
          <div className="pt-1 flex flex-wrap gap-1.5">
            {stage.liveDetails.map((d, i) => (
              <span key={i} className="rounded-md border border-border bg-card px-2 py-0.5 text-[0.6875rem] text-muted-foreground">
                {d}
              </span>
            ))}
          </div>
        )}
      </div>

      {stage.isDone ? (
        <span className="flex items-center gap-2 shrink-0 pt-0.5">
          <span className={cn("text-xs font-medium tabular-nums", TONE_EMERALD_TEXT)}>{stage.status || "Done"}</span>
          {donePath && (
            <button
              type="button"
              onClick={() => navigate(donePath)}
              className="text-muted-foreground hover:text-primary cursor-pointer"
              title={`Open ${stage.label}`}
              aria-label={`Open ${stage.label}`}
            >
              <ExternalLink size={12} />
            </button>
          )}
        </span>
      ) : go ? (
        <button type="button" onClick={go.run} className={cn(GRID_BTN_BRAND, "h-8 shrink-0")}>
          <span>{go.label}</span>
          <ExternalLink size={11} />
        </button>
      ) : null}
    </li>
  );
};

// ─── Collapsible Phase Accordion ─────────────────────────────────────────────
const PhaseBlock: React.FC<{
  sec: Section;
  open: boolean;
  onToggle: () => void;
  bookingId: number;
  navigate: (p: string) => void;
}> = ({ sec, open, onToggle, bookingId, navigate }) => {
  const st = phaseState(sec);
  const done = sec.stages.filter((s) => s.isDone).length;
  const now = phaseNext(sec);
  const lockedStage = firstLockedInPhase(sec);
  const summaryNote = st === "done"
    ? "All steps complete"
    : st === "open"
      ? `Next action: ${now?.label ?? "—"}`
      : lockedStage?.blockers[0]?.label || lockedStage?.unlockedHint || "Waiting on earlier phase";

  return (
    <section id={`lm-phase-${sec.key}`} className="border-t border-border/80 first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/35 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
      >
        <span className={cn(
          "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
          st === "done" ? "bg-emerald-600 text-white" : st === "open" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}>
          {st === "done" ? <Check size={14} /> : st === "open" ? <CircleDot size={14} /> : <Lock size={12} />}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[0.8125rem] font-semibold text-foreground">{sec.title}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[0.625rem] font-medium text-muted-foreground">
              {sec.trackLabel}
            </span>
          </span>
          <span className="block text-xs text-muted-foreground truncate mt-0.5">{summaryNote}</span>
        </span>

        <span className="text-xs tabular-nums text-muted-foreground shrink-0">{done} / {sec.stages.length}</span>
        <GridToneMark text={PHASE_WORD[st]} tone={st === "done" ? "done" : st === "open" ? "moving" : "draft"} />
        <ChevronDown size={15} className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="pb-2">
          <p className="px-4 pb-2.5 text-xs text-muted-foreground">{sec.description}</p>
          <ol className="divide-y divide-border/60 border-y border-border/60">
            {sec.stages.map((stage) => (
              <StageLine key={stage.key} stage={stage} bookingId={bookingId} navigate={navigate} />
            ))}
          </ol>
        </div>
      )}
    </section>
  );
};

// ─── Single Booking Legal Journey View ───────────────────────────────────────
const JourneyRecord: React.FC<{
  t: any;
  model: WorkflowModel;
  navigate: (p: string) => void;
  onBack: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}> = ({ t, model, navigate, onBack, onRefresh, refreshing }) => {
  const nowOpen = workableNow(model);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const isOpen = (sec: Section) => opened[sec.key] ?? phaseState(sec) === "open";
  const toggle = (key: string, now: boolean) => setOpened((o) => ({ ...o, [key]: !now }));

  const pct = pctOf(model);
  const first = nowOpen[0];
  const nextTitle = model.journeyLabel.done
    ? "Legal journey complete"
    : first
      ? `Next open action: ${first.n.label} (${phaseName(first.sec)})`
      : "No legal action currently unlocked — resolve highlighted gate blockers";
  const nextSub = model.journeyLabel.done
    ? "All mandatory legal, possession, conveyance, and mutation steps are complete."
    : nowOpen.length > 1
      ? `${nowOpen.length} parallel steps can be worked right now: ${nowOpen.map((x) => x.n.label).join(" · ")}.`
      : first
        ? first.n.sublabel
        : "Expand the Waiting phases below to jump directly to the blocking requirement (Agreement Visit 1, OC/CC, Loan Sanction, or Dues).";

  const firstGo = first ? stageGo(first.n, t.BookingId, navigate) : null;

  return (
    <div className="space-y-4">
      {/* Enterprise Header Card (5-theme consistent) */}
      <section className="rounded-xl border border-border bg-card px-5 py-4 shadow-[0_1px_2px_0_hsl(var(--foreground)/0.04)] space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Scale size={13} className="text-primary" />
              <span>Legal Journey · <span className="font-mono font-medium text-foreground">{t.BookingNo || "—"}</span></span>
              {t.BookingIsFrozen === true || t.BookingIsFrozen === 1 ? (
                <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium", TONE_ROSE_PILL)}>
                  Booking Frozen
                </span>
              ) : null}
              {t.IsPlotBooking === 1 && (
                <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[0.6875rem] font-medium text-foreground">
                  Plot Sale
                </span>
              )}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-foreground capitalize">{personName(t.ApplicantName)}</h1>
              <GridToneMark tone={model.journeyLabel.done ? "done" : nowOpen.length ? "moving" : "waiting"} text={model.journeyLabel.done ? "Complete" : nowOpen.length ? `${nowOpen.length} Open` : "Blocked"} />
            </div>

            <p className="text-xs text-muted-foreground mt-0.5">
              {[t.ProjectName, t.UnitNo && `Unit ${t.UnitNo}`, model.requiresHandoverBeforeDeed ? "Under-construction (Handover before Sale Deed)" : "Ready-to-Move / Completed (Parallel Deed & Handover)"].filter(Boolean).join(" · ")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button type="button" onClick={onBack} className={GRID_BTN}>
              <ArrowLeft size={13} /> All journeys
            </button>
            <button type="button" onClick={() => navigate(`/crm/agreements?bookingId=${t.BookingId}`)} className={GRID_BTN}>
              <ScrollText size={13} /> Agreement
            </button>
            <button type="button" onClick={() => navigate(`/crm/bookings?view=${t.BookingId}`)} className={GRID_BTN}>
              <Home size={13} /> Booking
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className={cn(GRID_KEY, "h-9 w-9 !px-0")}
              title="Refresh journey"
              aria-label="Refresh journey"
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* 7-Phase Linear StepBar */}
        <div className="pt-2 border-t border-border/70">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs">
            <span className="font-semibold text-foreground tabular-nums">
              {pct}% complete <span className="font-normal text-muted-foreground">({model.doneCount} of {model.totalCount} milestones)</span>
            </span>
            <span className="text-muted-foreground">{journeyBar(model).caption}</span>
          </div>
          <StepBar steps={journeyBar(model).steps} />
        </div>

        {/* Transparent Workflow Gate Telemetry (Financing / Loan / OC-CC / Dues / Project Gate Rule) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
          <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            <div className="text-[0.6875rem] text-muted-foreground">Financing &amp; NOC</div>
            <div className="text-xs font-semibold text-foreground mt-0.5">
              {t.NocResolvedType === "Bank" ? "Home Loan · Bank NOC" : "Self-funded · Organisation NOC"}
            </div>
            <div className="text-[0.6875rem] mt-0.5">
              {t.FinancingType === "LoanFinanced" ? (
                <Link to={`/crm/loan-details?bookingId=${t.BookingId}`} className={cn("hover:underline", model.loanBlocked ? TONE_AMBER_TEXT : TONE_EMERALD_TEXT)}>
                  Loan: {t.LoanSanctionStatus || "Not recorded"} {model.loanBlocked ? "(blocks Sale Deed)" : ""}
                </Link>
              ) : (
                <span className="text-muted-foreground">No loan clearance block</span>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            <div className="text-[0.6875rem] text-muted-foreground">{CERTIFICATE_TERMS.ONE}</div>
            <div className={cn("text-xs font-semibold mt-0.5", t.OcCcReceived === 1 ? TONE_EMERALD_TEXT : TONE_AMBER_TEXT)}>
              {t.OcCcReceived === 1 ? CERT_STATUS_LABEL.Received : "Pending Issuance"}
            </div>
            <div className="text-[0.6875rem] text-muted-foreground mt-0.5">
              <Link to={`/crm/oc-cc${t.ProjectId ? `?open=${t.ProjectId}` : ""}`} className="hover:underline text-foreground/80">
                {t.OcCcReceived === 1 ? "Cleared for possession →" : "Open OC / CC module →"}
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            <div className="text-[0.6875rem] text-muted-foreground">Handover Dues Gate</div>
            <div className={cn("text-xs font-semibold mt-0.5", t.HasOutstandingDues === 1 ? TONE_AMBER_TEXT : TONE_EMERALD_TEXT)}>
              {t.HasOutstandingDues === 1 ? "Balance Outstanding" : "All Dues Clear"}
            </div>
            <div className="text-[0.6875rem] text-muted-foreground mt-0.5">
              <Link to={`/crm/payments?bookingId=${t.BookingId}`} className="hover:underline text-foreground/80">
                {t.HasOutstandingDues === 1 ? "View due schedule →" : "Handover gate clear →"}
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            <div className="text-[0.6875rem] text-muted-foreground">Deed Sequencing Rule</div>
            <div className="text-xs font-semibold text-foreground mt-0.5">
              {model.requiresHandoverBeforeDeed ? "Handover Before Sale Deed" : "Parallel Track Allowed"}
            </div>
            <div className="text-[0.6875rem] text-muted-foreground mt-0.5">
              {model.requiresHandoverBeforeDeed ? "Under-Construction rule" : "Ready / Completed project"}
            </div>
          </div>
        </div>

        {/* Action / Guidance Callout */}
        <GridGuidance
          tone={model.journeyLabel.done ? "done" : first ? "moving" : "waiting"}
          title={nextTitle}
          text={nextSub}
          action={firstGo ? (
            <button type="button" onClick={firstGo.run} className={GRID_BTN_BRAND}>
              <span>{firstGo.label}</span>
              <ExternalLink size={12} />
            </button>
          ) : undefined}
        />
      </section>

      {/* Stacked Phase Timeline */}
      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <div className="px-4 py-3 border-b border-border bg-muted/20 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <ShieldCheck size={14} className="text-primary" />
            <span>End-to-End Legal Checklist &amp; Gate Rules</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {model.requiresHandoverBeforeDeed
              ? "Sequence: Agreement → Visit 1 → NOC & Possession Handover → Sale Deed → Visit 2 → Mutation"
              : "Sequence: Agreement → Visit 1 → (NOC, Possession & Sale Deed run in parallel) → Visit 2 → Mutation"}
          </span>
        </div>
        <div>
          {model.sections.map((sec) => {
            const o = isOpen(sec);
            return (
              <PhaseBlock
                key={sec.key}
                sec={sec}
                open={o}
                onToggle={() => toggle(sec.key, o)}
                bookingId={t.BookingId}
                navigate={navigate}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ─── All Journeys List View ──────────────────────────────────────────────────
const PHASE_KEYS = ["agreement", "afsVisit1", "noc", "possession", "saleDeed", "afsVisit2", "mutation"] as const;
type Focus = "all" | "complete" | (typeof PHASE_KEYS)[number];
type SortKey = "least" | "most" | "name" | "newest";
interface JourneySummary { total: number; complete: number; avgProgress: number; gates: Record<string, number>; atPhase: Record<string, number> }
interface JourneyPage { rows: any[]; total: number; summary: JourneySummary }
const EMPTY_SUMMARY: JourneySummary = { total: 0, complete: 0, avgProgress: 0, gates: {}, atPhase: {} };
type Lane = { t: any; m: WorkflowModel };

const COLS: GridCol<Lane>[] = [
  {
    id: "customer",
    label: "Customer",
    locked: true,
    csv: ({ t }) => personName(t.ApplicantName),
    cell: ({ t }) => (
      <div className="flex items-center gap-2.5 min-w-0 py-1 max-w-[240px]">
        <Initials name={t.ApplicantName} />
        <div className="min-w-0">
          <div className="text-[0.8125rem] font-semibold text-foreground capitalize truncate" title={t.ApplicantName}>
            {personName(t.ApplicantName)}
          </div>
          <div className="text-xs text-muted-foreground font-mono tabular-nums">{t.BookingNo}</div>
        </div>
      </div>
    ),
  },
  {
    id: "unit",
    label: "Project & Track Rule",
    csv: ({ t }) => [t.ProjectName, t.UnitNo].filter(Boolean).join(" / "),
    cell: ({ t, m }) => (
      <div className="min-w-0 py-1 space-y-0.5">
        <div className="text-xs font-medium text-foreground truncate">
          {[t.ProjectName, t.UnitNo].filter(Boolean).join(" · ") || "—"}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
          <span>{t.NocResolvedType === "Bank" ? "Home loan" : "Self-funded"}</span>
          <span>·</span>
          <span>{m.requiresHandoverBeforeDeed ? "Handover before Deed" : "Ready / Parallel"}</span>
          {t.OcCcReceived !== 1 && (
            <span className={cn("inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 border text-[0.625rem]", TONE_AMBER_PILL)}>
              No OC/CC
            </span>
          )}
        </div>
      </div>
    ),
  },
  {
    id: "progress",
    label: "Legal Phases (7)",
    csv: ({ m }) => journeyBar(m).caption,
    cell: ({ m }) => {
      const b = journeyBar(m);
      return <span className="block min-w-[15rem] py-1"><StepBar steps={b.steps} caption={b.caption} /></span>;
    },
  },
  {
    id: "now",
    label: "Actionable Now",
    csv: ({ m }) => workableNow(m).map((x) => `${x.n.label} (${phaseName(x.sec)})`).join("; "),
    cell: ({ m }) => {
      const now = workableNow(m);
      if (now.length) {
        return (
          <div className="py-1 space-y-1 text-xs">
            {now.map(({ sec, n }) => (
              <div key={n.key} className="flex items-center gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                <span className="font-medium text-foreground truncate">{n.label}</span>
                <span className="text-[0.6875rem] text-muted-foreground shrink-0">({phaseName(sec)})</span>
              </div>
            ))}
          </div>
        );
      }
      return m.journeyLabel.done ? (
        <span className={cn("inline-flex items-center gap-1 text-xs font-medium", TONE_EMERALD_TEXT)}>
          <Check size={12} /> Complete
        </span>
      ) : (
        <span className={cn("inline-flex items-center gap-1 text-xs font-medium", TONE_AMBER_TEXT)}>
          <AlertTriangle size={12} /> {m.journeyLabel.text}
        </span>
      );
    },
  },
  {
    id: "done",
    label: "Done",
    align: "right",
    csv: ({ m }) => `${pctOf(m)}%`,
    cell: ({ m }) => (
      <span className="block text-right">
        <span className={cn("text-sm font-bold tabular-nums", pctOf(m) === 100 ? TONE_EMERALD_TEXT : "text-foreground")}>
          {pctOf(m)}%
        </span>
        <span className="block text-[0.6875rem] text-muted-foreground tabular-nums">{m.doneCount}/{m.totalCount}</span>
      </span>
    ),
  },
  ...PHASE_KEYS.map((k): GridCol<Lane> => ({
    id: `ph-${k}`,
    label: PHASE_SHORT[k],
    hiddenByDefault: true,
    cell: () => null,
    csv: ({ m }) => {
      const sec = m.sections.find((x) => x.key === k);
      return sec ? PHASE_WORD[phaseState(sec)] : "";
    },
  })),
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
  const [prefs, setPrefs] = useGridPrefs("crm-legal-milestones-cols-v3", COLS);
  const openBookingId = sp.get("bookingId");

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
    queryKey: ["crm-legal-milestones-eligible-bookings"],
    queryFn: fetchEligibleBookings,
    staleTime: 60_000,
    enabled: newDialog,
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
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BookingId: parseInt(bookingId, 10) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not start the legal workflow.");
      toast.success("Legal workflow started");
      setNewDialog(false);
      ["crm-legal-milestones", "crm-legal-milestones-eligible-bookings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setSp((p) => { p.set("bookingId", bookingId); return p; });
      setBookingId("");
    } catch (e: unknown) {
      toast.error(translateError(e instanceof Error ? e.message : "Could not start the legal workflow."));
    } finally {
      setSaving(false);
    }
  };

  const openModel = openTracker ? buildWorkflowModel(openTracker) : null;

  const handleExport = async () => {
    setExporting(true);
    try {
      const p = new URLSearchParams(qs);
      ["page", "pageSize", "focus", "order"].forEach((k) => p.delete(k));
      const r = await fetchWithAuth(`${API}?${p}`);
      const rows = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(rows)) throw new Error(rows?.error || `Could not export (${r.status}).`);
      exportGrid(rows.map((t: any) => ({ t, m: buildWorkflowModel(t) })), COLS, "legal-journeys");
    } catch (e: unknown) {
      toast.error(translateError(e instanceof Error ? e.message : "Could not export."));
    } finally {
      setExporting(false);
    }
  };

  const focusTabs = [
    { key: "all" as Focus, label: "All journeys", count: result ? total : null },
    ...PHASE_KEYS.map((k) => ({ key: k as Focus, label: PHASE_TAB_NAME[k] ?? PHASE_SHORT[k], count: result ? summary.atPhase[k] ?? 0 : null })),
    { key: "complete" as Focus, label: "Complete", count: result ? complete : null },
  ];
  const listFiltered = s.hasFilters || focus !== "all";
  const completePct = total > 0 ? Math.round((complete / total) * 100) : 0;

  return (
    <div className="space-y-4">
      <Breadcrumbs items={openBookingId ? [{ label: "CRM", path: "/crm/dashboard" }, { label: "Legal Milestones", path: "/crm/legal-milestones" }, { label: "Journey", path: `/crm/legal-milestones?bookingId=${openBookingId}` }] : [{ label: "CRM", path: "/crm/dashboard" }, { label: "Legal Milestones", path: "/crm/legal-milestones" }]} />

      {openBookingId ? (
        !openTracker || !openModel ? (
          <div className={cn(GRID_CARD, "rounded-xl py-16 text-center text-sm text-muted-foreground")}>
            {openTracker === null ? (
              <>
                This booking has no legal workflow yet.{" "}
                <button type="button" onClick={closeJourney} className="text-primary hover:underline ml-1 cursor-pointer">
                  All journeys
                </button>
              </>
            ) : "Loading legal journey…"}
          </div>
        ) : (
          <JourneyRecord
            t={openTracker}
            model={openModel}
            navigate={navigate}
            onBack={closeJourney}
            onRefresh={() => refetchOpen()}
            refreshing={openFetching}
          />
        )
      ) : (
        <>
          {/* Enterprise Header Card */}
          <section className="rounded-xl border border-border bg-card px-5 py-4 shadow-[0_1px_2px_0_hsl(var(--foreground)/0.04)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Scale size={13} className="text-primary" />
                  <span>CRM · Legal &amp; Possession Lifecycle</span>
                </div>
                <h1 className="text-xl font-bold tracking-tight text-foreground mt-0.5">Legal Milestones</h1>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-[84ch]">
                  Transparent booking journeys from Agreement through Visit 1, NOC, Possession, Sale Deed, Visit 2, and Mutation — showing real gate locks and blockers.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className={cn(GRID_KEY, "h-9 w-9 !px-0")}
                  title="Refresh"
                  aria-label="Refresh legal journeys"
                >
                  <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={exporting || !total}
                  className={GRID_BTN}
                >
                  <Download size={13} />
                  <span>{exporting ? "Exporting…" : "Export CSV"}</span>
                </button>
                {rights.canCreate && (
                  <button type="button" onClick={() => setNewDialog(true)} className={`${GRID_KEY_BRAND} h-9 px-3.5`}>
                    <Plus size={14} />
                    <span>Start Workflow</span>
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Gate Milestones Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Journeys complete</span>
                <span className="tabular-nums font-medium">{completePct}%</span>
              </div>
              <div className="text-lg sm:text-xl font-bold text-foreground tabular-nums mt-1">
                {complete} <span className="text-xs font-normal text-muted-foreground">of {total}</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${completePct}%` }} />
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="text-xs text-muted-foreground">Average completion</div>
              <div className="text-lg sm:text-xl font-bold text-foreground tabular-nums mt-1">{summary.avgProgress}%</div>
              <div className="text-[0.6875rem] text-muted-foreground mt-0.5">Across filtered journeys</div>
            </div>

            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="text-xs text-muted-foreground">Agreement registered</div>
              <div className={cn("text-lg sm:text-xl font-bold tabular-nums mt-1", TONE_AMBER_TEXT)}>
                {summary.gates.afsVisit1 ?? 0}
              </div>
              <div className="text-[0.6875rem] text-muted-foreground mt-0.5">
                {summary.gates.agreement ?? 0} executed · Visit 1 done
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="text-xs text-muted-foreground">Sale deed registered</div>
              <div className={cn("text-lg sm:text-xl font-bold tabular-nums mt-1", TONE_EMERALD_TEXT)}>
                {summary.gates.afsVisit2 ?? 0}
              </div>
              <div className="text-[0.6875rem] text-muted-foreground mt-0.5">Visit 2 complete</div>
            </div>
          </div>

          {/* Main Journeys Card */}
          <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
            <GridTabs<Focus> label="Active legal phase" active={focus} onChange={setFocus} tabs={focusTabs} />

            <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-border bg-card">
              <GridSearch value={s.searchInput} onChange={s.setSearchInput} placeholder="Customer or booking" />
              <CrmCompanyProjectBlockFilter value={s.cpb} onChange={s.setCpb} />
              <GridSegment<SortKey>
                label="Order"
                value={sortKey}
                onChange={setSortKey}
                options={[
                  { key: "least", label: "Least done" },
                  { key: "most", label: "Most done" },
                  { key: "name", label: "Name" },
                  { key: "newest", label: "Newest" },
                ]}
              />
              {listFiltered && (
                <button type="button" onClick={() => { s.reset(); setFocus("all"); }} className={GRID_BTN}>
                  Clear filters
                </button>
              )}
            </div>

            <CrmGrid
              cols={COLS}
              prefs={prefs}
              onPrefs={setPrefs}
              rows={lanes}
              rowKey={({ t }) => t.Id}
              noRowNumbers
              loading={isLoading}
              fetching={isFetching}
              error={error ? translateError((error as Error).message) : null}
              onRetry={() => refetch()}
              sort={NO_SORT}
              onSort={() => {}}
              onRowClick={({ t }) => openJourney(t)}
              empty={listFiltered ? "No journey matches these filters." : "No legal workflow started yet."}
              page={s.page}
              pageSize={pageSize}
              total={result?.total ?? 0}
              onPage={s.setPage}
              onPageSize={(n) => { setPageSize(n); s.setPage(1); }}
              mobileCardRenderer={({ t, m }) => (
                <div
                  onClick={() => openJourney(t)}
                  className="rounded-lg border border-border bg-card p-3.5 space-y-2 cursor-pointer hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground capitalize truncate">{personName(t.ApplicantName)}</div>
                      <div className="text-xs text-muted-foreground font-mono">{t.BookingNo} · {t.UnitNo || "—"}</div>
                    </div>
                    <span className={cn("text-sm font-bold tabular-nums shrink-0", pctOf(m) === 100 ? TONE_EMERALD_TEXT : "text-foreground")}>
                      {pctOf(m)}%
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {workableNow(m).length
                      ? `Open: ${workableNow(m).map((x) => x.n.label).join(", ")}`
                      : m.journeyLabel.text}
                  </div>
                </div>
              )}
            />
          </div>
        </>
      )}

      {newDialog && (
        <GridDialog
          onClose={() => setNewDialog(false)}
          icon={Scale}
          width="max-w-2xl"
          title="Start Legal Workflow"
          description="Tracks the booking's legal journey from the agreement through mutation."
          footer={
            <>
              <button type="button" onClick={() => setNewDialog(false)} className={GRID_BTN}>Cancel</button>
              <button type="button" onClick={handleStart} disabled={saving || !bookingId} className={GRID_BTN_BRAND}>
                {saving ? "Starting…" : "Start Workflow"}
              </button>
            </>
          }
        >
          <GridFormSection>
            <GridFormField
              label="Booking"
              required
              wide
              hint={!loadingBookings && startableBookings.length === 0
                ? "No booking is eligible: it needs to be approved, active, not frozen, have an agreement on file, and no legal workflow yet."
                : undefined}
            >
              <SearchableSelect
                value={bookingId}
                onChange={setBookingId}
                placeholder={loadingBookings ? "Loading bookings…" : startableBookings.length ? "Select booking" : "No booking is eligible"}
                searchPlaceholder="Search booking or customer…"
                options={startableBookings.map((b: any) => ({ value: String(b.Id), label: `${b.BookingNo} · ${personName(b.ApplicantName)}` }))}
              />
            </GridFormField>
          </GridFormSection>
        </GridDialog>
      )}
    </div>
  );
};

export default CrmLegalMilestones;
