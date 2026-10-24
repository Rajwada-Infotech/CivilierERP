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
    <span className={`text-[0.6875rem] px-2 py-0.5 rounded-full border font-medium ${DATE_BADGE_COLORS[color]}`}>
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
export function agreementStepStates(a: any, documents: any[] | undefined): { label: string; state: StepState; tab: AgrTab }[] {
  const legalAssigned = a?.LegalExecutiveId != null;
  const followup = followupProgress(documents);
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
