import { describe, expect, it } from "vitest";
import {
  AGREEMENT_STEP_NAMES, agreementAlerts, agreementCurrentIndex, agreementCurrentStep, agreementDaysAtStep, rowFollowupProgress,
} from "./config";

// The agreement's board, insights and alerts read the same step logic as its record page.
const today = new Date(2026, 10, 5, 12); // 5 Nov 2026
const base = { Status: "Draft", CreatedAt: "2026-10-01T10:00:00", MandatoryDocCount: 2, MandatoryUploadedCount: 2 };

describe("agreement steps from a list row", () => {
  it("the board's columns are the steps' plain names", () => {
    expect(AGREEMENT_STEP_NAMES).toEqual([
      "Initialisation", "Legal Exec. Assigned", "Agreement Followup", "Senior Approval", "Sent to Customer",
      "Customer Approval", "Date Agreed", "Execution Follow-ups", "Registered",
    ]);
  });
  it("a row with no legal executive is on that step, counted from when it was made", () => {
    const a = { ...base, LegalExecutiveId: null };
    expect(agreementCurrentIndex(a, rowFollowupProgress(a))).toBe(1);
    expect(agreementDaysAtStep(a, rowFollowupProgress(a), today)).toBe(35);
  });
  it("sent to the customer: waiting for their approval, counted from the day it was sent", () => {
    const a = { ...base, LegalExecutiveId: 4, SeniorApprovalStatus: "Approved", SeniorApprovedAt: "2026-10-20", SentToCustomerAt: "2026-11-01T09:00:00" };
    expect(agreementCurrentStep(a, rowFollowupProgress(a))).toBe("Customer Approval");
    expect(agreementDaysAtStep(a, rowFollowupProgress(a), today)).toBe(4);
  });
  it("papers not all uploaded keep it on the follow-up step, with the percentage", () => {
    const a = { ...base, LegalExecutiveId: 4, MandatoryUploadedCount: 1 };
    expect(agreementCurrentStep(a, rowFollowupProgress(a))).toBe("Agreement Followup (50%)");
  });
  it("registered is complete; cancelled is on no step", () => {
    expect(agreementCurrentStep({ ...base, Status: "Registered" }, rowFollowupProgress(base))).toBe("Complete");
    expect(agreementCurrentIndex({ ...base, Status: "Cancelled" }, rowFollowupProgress(base))).toBe(-1);
  });
});

describe("agreement alerts, from what is recorded", () => {
  const keys = (a: any) => agreementAlerts(a, today).map((x) => x.key);
  it("a passed signing date on a draft is flagged; a future one is not", () => {
    expect(keys({ ...base, LegalExecutiveId: 1, AgreementDate: "2026-11-01" })).toContain("signingPassed");
    expect(keys({ ...base, LegalExecutiveId: 1, AgreementDate: "2026-11-20" })).not.toContain("signingPassed");
  });
  it("a recheck, a date to answer, an unsent approval and a missing legal executive each show", () => {
    expect(keys({ ...base, LegalExecutiveId: 1, CustomerApprovalStatus: "RecheckRequested" })).toContain("recheck");
    expect(keys({ ...base, LegalExecutiveId: 1, ProposedDateStatus: "PendingCompanyReview" })).toContain("dateReply");
    expect(keys({ ...base, LegalExecutiveId: 1, SeniorApprovalStatus: "Approved" })).toContain("toSend");
    expect(keys({ ...base, LegalExecutiveId: null })).toContain("noLegal");
  });
  it("a cancelled booking under a live agreement is flagged, and its other prompts are not", () => {
    const k = keys({ ...base, LegalExecutiveId: null, BookingStatus: "Cancelled", SeniorApprovalStatus: "Approved" });
    expect(k).toContain("bookingGone");
    expect(k).not.toContain("noLegal");
    expect(k).not.toContain("toSend");
  });
  it("executed waits to be registered; registered needs nothing", () => {
    expect(keys({ ...base, Status: "Executed" })).toEqual(["toRegister"]);
    expect(keys({ ...base, Status: "Registered" })).toEqual([]);
  });
});

describe("the status settles the step", () => {
  it("an executed agreement waits to be registered even if an older record lacks a legal executive", () => {
    const a = { ...base, Status: "Executed", LegalExecutiveId: null, UpdatedAt: "2026-11-03T08:00:00" };
    expect(agreementCurrentStep(a, rowFollowupProgress(a))).toBe("Registered");
    expect(agreementDaysAtStep(a, rowFollowupProgress(a), today)).toBe(2);
  });
});
