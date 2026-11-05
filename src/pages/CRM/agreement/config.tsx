// Shared by Agreements and its parts: the APIs, document types, status colours, the booking-cancelled check, the
// mandatory-document checks, the tabs and the step each agreement has reached.
import { CrmStatus } from "@/constants/crmStatuses";
import React from "react";

export const API = "/api/crm/agreements";
export const USERS_API = "/api/users";

export const DOC_TYPES = ["SaleAgreement", "PossessionLetter", "RegistrationDoc", "NOC", "IdentityProof", "Other"];

export const agrStatusColor: Record<string, string> = {
  Draft:      "text-muted-foreground bg-muted/50 border-border",
  Executed:   "text-foreground bg-card border-foreground/40",
  Registered: "text-card bg-foreground border-foreground",
  Cancelled:  "text-destructive bg-destructive/5 border-destructive/40",
};

export function isBookingCancelled(a: { BookingStatus?: string | null; BookingIsActive?: boolean | null }): boolean {
  return a.BookingIsActive === false || ["Cancelled", "Rejected"].includes(a.BookingStatus || "");
}

export const DATE_BADGE_COLORS: Record<string, string> = {
  purple: "text-foreground bg-card border-foreground/30 border-dashed",
  blue:   "text-foreground bg-card border-foreground/50",
  green:  "text-card bg-foreground border-foreground",
};
export function DateStatusBadge({ label, date, color, active }: { label: string; date?: string | null; color: "purple" | "blue" | "green"; active: boolean }) {
  if (!active) return null;
  return (
    <span className={`text-[0.6875rem] px-2 py-0.5 border font-medium ${DATE_BADGE_COLORS[color]}`}>
      {label}{date ? `: ${String(date).slice(0, 10)}` : ""}
    </span>
  );
}

export function unverifiedMandatoryDocs(documents: any[] | undefined): any[] {
  return (documents || []).filter((d) => d.IsMandatory && d.Status !== "Verified");
}

export function followupProgress(documents: any[] | undefined): { required: number; uploaded: number; percent: number } {
  const mandatory = (documents || []).filter((d) => d.IsMandatory);
  const required = mandatory.length;
  const uploaded = mandatory.filter((d) => d.FilePath).length;
  const percent = required > 0 ? Math.round((uploaded / required) * 100) : 0;
  return { required, uploaded, percent };
}

export const AGR_TABS = ["Timeline", "Overview", "Legal & Approval", "Documents", "AFS Payment", "AFS Registry"] as const;
export type AgrTab = typeof AGR_TABS[number];

export const TAB_SLUGS: Record<string, AgrTab> = {
  timeline: "Timeline", overview: "Overview", legal: "Legal & Approval",
  "legal-approval": "Legal & Approval", documents: "Documents", papers: "Documents",
  "afs-payment": "AFS Payment", "afs-query-payment": "AFS Payment",
  "afs-registry": "AFS Registry",
};
export const SLUG_FOR_TAB: Record<AgrTab, string> = {
  Timeline: "timeline", Overview: "overview", "Legal & Approval": "legal",
  Documents: "documents", "AFS Payment": "afs-payment", "AFS Registry": "afs-registry",
};

export type StepState = "done" | "current" | "upcoming";
/** The mandatory papers on a list row (the list carries counts, not the papers). */
export function rowFollowupProgress(a: any): { required: number; uploaded: number; percent: number } {
  const required = Number(a?.MandatoryDocCount) || 0;
  const uploaded = Number(a?.MandatoryUploadedCount) || 0;
  return { required, uploaded, percent: required > 0 ? Math.round((uploaded / required) * 100) : 0 };
}
/** Each step of the agreement and where it stands. Takes the agreement's papers (its record) or, for a list row, the
 *  paper counts already worked out. */
export function agreementStepStates(a: any, documents: any[] | undefined | { required: number; uploaded: number; percent: number }): { label: string; state: StepState; tab: AgrTab }[] {
  const legalAssigned = a?.LegalExecutiveId != null;
  const followup = documents && !Array.isArray(documents) ? documents : followupProgress(documents as any[] | undefined);
  const followupDone = followup.required > 0 && followup.percent === 100;
  const senior = a?.SeniorApprovalStatus === CrmStatus.APPROVED;
  const sent = !!a?.SentToCustomerAt;
  const custApproved = a?.CustomerApprovalStatus === CrmStatus.APPROVED;
  const dated = !!a?.AgreementDate;
  const executed = a?.Status === CrmStatus.EXECUTED || a?.Status === CrmStatus.REGISTERED;
  const registered = a?.Status === CrmStatus.REGISTERED;
  return [
    { label: "Initialisation",       state: "done" as StepState,                                                    tab: "Overview" as AgrTab },
    { label: "Legal Exec. Assigned", state: (legalAssigned ? "done" : "current") as StepState,                      tab: "Legal & Approval" as AgrTab },
    { label: `Agreement Followup${followup.required > 0 ? ` (${followup.percent}%)` : ""}`,
      state: (followupDone ? "done" : legalAssigned ? "current" : "upcoming") as StepState,                         tab: "Documents" as AgrTab },
    { label: "Senior Approval",      state: (senior ? "done" : followupDone ? "current" : "upcoming") as StepState,       tab: "Legal & Approval" as AgrTab },
    { label: "Sent to Customer",     state: (sent ? "done" : senior ? "current" : "upcoming") as StepState,               tab: "Legal & Approval" as AgrTab },
    { label: "Customer Approval",    state: (custApproved ? "done" : sent ? "current" : "upcoming") as StepState,         tab: "Legal & Approval" as AgrTab },
    { label: "Date Agreed",          state: (dated ? "done" : custApproved ? "current" : "upcoming") as StepState,        tab: "Legal & Approval" as AgrTab },
    { label: "Execution Follow-ups", state: (executed ? "done" : dated ? "current" : "upcoming") as StepState,            tab: "Documents" as AgrTab },
    { label: "Registered",           state: (registered ? "done" : executed ? "current" : "upcoming") as StepState,       tab: "Overview" as AgrTab },
  ];
}
/** The step an agreement is on now ("Complete" once registered); the list's Stage column. */
export function agreementCurrentStep(a: any, documents: Parameters<typeof agreementStepStates>[1]): string {
  if (a?.Status === CrmStatus.REGISTERED) return "Complete";
  const i = agreementCurrentIndex(a, documents);
  return i >= 0 ? agreementStepStates(a, documents)[i].label : "—";
}


// ── Board, insights and alerts: all read off agreementStepStates, so they never disagree with the record's own path ──
type StepProgress = Parameters<typeof agreementStepStates>[1];
/** The steps' plain names, in order (the follow-up step without its percentage): the board's columns. */
export const AGREEMENT_STEP_NAMES: string[] = agreementStepStates(null, { required: 0, uploaded: 0, percent: 0 }).map((s) => s.label);
/** Where the agreement stands: the index of its current step, or -1 when none is (registered, or cancelled). */
export function agreementCurrentIndex(a: any, progress: StepProgress): number {
  // The status settles it first: an executed agreement is waiting to be registered, whatever an older record lacks.
  if (!a || a.Status === CrmStatus.CANCELLED || a.Status === CrmStatus.REGISTERED) return -1;
  if (a.Status === CrmStatus.EXECUTED) return AGREEMENT_STEP_NAMES.length - 1;
  return agreementStepStates(a, progress).findIndex((s) => s.state === "current");
}
// When each step began: the last date the record keeps for the step before it (same order as the steps). The early
// steps record no date of their own, so they count from when the agreement was made; Registered counts from the last
// update, which is when it was executed.
const STEP_SINCE: ((a: any) => string | null | undefined)[] = [
  (a) => a.CreatedAt, (a) => a.CreatedAt, (a) => a.CreatedAt, (a) => a.CreatedAt,
  (a) => a.SeniorApprovedAt, (a) => a.SentToCustomerAt, (a) => a.CustomerApprovedAt, (a) => a.AgreementDate, (a) => a.UpdatedAt,
];
const DAY_MS = 86_400_000;
/** Whole days the agreement has been on its current step, or null when it isn't on one. */
export function agreementDaysAtStep(a: any, progress: StepProgress, today = new Date()): number | null {
  const i = agreementCurrentIndex(a, progress);
  const since = i >= 0 ? STEP_SINCE[i]?.(a) : null;
  if (!since) return null;
  return Math.max(0, Math.floor((today.getTime() - new Date(since).getTime()) / DAY_MS));
}

export type AgreementAlertTone = "stopped" | "waiting" | "moving";
/** What needs someone now, read only from what is recorded (no day limits): each with who it waits on. */
export const AGREEMENT_ALERTS: { key: string; label: string; tone: AgreementAlertTone; test: (a: any, today: Date) => boolean }[] = [
  { key: "bookingGone", label: "Booking cancelled, agreement still open", tone: "stopped",
    test: (a) => isBookingCancelled(a) && a.Status !== CrmStatus.CANCELLED && a.Status !== CrmStatus.REGISTERED },
  { key: "recheck", label: "Customer asked for a recheck", tone: "stopped",
    test: (a) => a.Status === CrmStatus.DRAFT && a.CustomerApprovalStatus === "RecheckRequested" },
  { key: "signingPassed", label: "Signing date passed, not executed", tone: "stopped",
    test: (a, today) => a.Status === CrmStatus.DRAFT && !!a.AgreementDate && new Date(String(a.AgreementDate).slice(0, 10)) < new Date(today.toDateString()) },
  { key: "noLegal", label: "No legal executive", tone: "waiting",
    test: (a) => a.Status === CrmStatus.DRAFT && a.LegalExecutiveId == null && !isBookingCancelled(a) },
  { key: "dateReply", label: "Customer proposed a date: our reply", tone: "moving",
    test: (a) => a.Status === CrmStatus.DRAFT && a.ProposedDateStatus === "PendingCompanyReview" },
  { key: "toSend", label: "Senior-approved, not sent to customer", tone: "moving",
    test: (a) => a.Status === CrmStatus.DRAFT && a.SeniorApprovalStatus === CrmStatus.APPROVED && !a.SentToCustomerAt && !isBookingCancelled(a) },
  { key: "toRegister", label: "Executed, to register", tone: "moving",
    test: (a) => a.Status === CrmStatus.EXECUTED && !isBookingCancelled(a) },
];
export function agreementAlerts(a: any, today = new Date()) {
  return AGREEMENT_ALERTS.filter((x) => x.test(a, today));
}
