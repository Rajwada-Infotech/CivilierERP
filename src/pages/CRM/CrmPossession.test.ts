import { describe, expect, it } from "vitest";
import { eligibilitySteps, gateHold, handoverHolds, nextStep, stepsOf } from "./CrmPossession";

const ready = {
  BookingId: 7, ProjectId: 3, BookingStatus: "Approved", WelcomeDone: 1, AgreementId: 11, AgreementStatus: "Registered",
  Gate0_AgreementExecuted: 1, Gate1a_AfsQueryPayment: 1, Gate1b_AfsRegistryCompleted: 1, Gate1_AfsRegistered: 1, Gate2_OcCcReceived: 1,
  FullyFunded: 1, Balance: 0, DocumentationCheck: true, QualityInspectionCheck: true, UtilityReadinessCheck: true,
};
const noAgreement = { ...ready, AgreementId: null, AgreementStatus: null, Gate0_AgreementExecuted: 0, Gate1a_AfsQueryPayment: 0, Gate1b_AfsRegistryCompleted: 0, Gate1_AfsRegistered: 0 };
const AMOUNT = "Booking Amount (Milestone 1) must be paid before agreement preparation";

describe("what holds a booking back, and where the button goes", () => {
  const cases: [string, any, string, string, string][] = [
    ["booking still with the Director", { ...noAgreement, BookingStatus: "Pending", WorkflowStage: "DirectorApproval" }, "Booking awaiting Director Approval", "/crm/bookings?view=7", "Open Booking"],
    ["booking with no stage on record", { ...noAgreement, BookingStatus: "Pending" }, "Booking awaiting approval", "/crm/bookings?view=7", "Open Booking"],
    ["approved, no welcome call", { ...noAgreement, WelcomeDone: 0 }, "Welcome call not completed", "/crm/welcome-calls?bookingId=7", "Open Welcome Call"],
    ["welcomed, booking amount short", { ...noAgreement, AgreementBlocks: [AMOUNT] }, "Booking amount not received", "/crm/payments?bookingId=7", "Open Payments"],
    ["another blocker on the agreement", { ...noAgreement, AgreementBlocks: ["Booking must be linked to a Unit Master unit"] }, "Booking must be linked to a Unit Master unit", "/crm/bookings?view=7", "Open Booking"],
    ["eligible, no agreement: only case that creates", { ...noAgreement, AgreementBlocks: [] }, "Agreement not created", "/crm/agreements?bookingId=7", "Create Agreement"],
    ["agreement in draft opens it", { ...noAgreement, AgreementId: 11, AgreementStatus: "Draft" }, "Agreement is Draft", "/crm/agreements?bookingId=7", "Open Agreement"],
    ["executed, registration payment open", { ...noAgreement, AgreementId: 11, AgreementStatus: "Executed", Gate0_AgreementExecuted: 1 }, "Agreement registration payment not confirmed", "/crm/agreements?bookingId=7&tab=afs-payment", "Open Agreement"],
    ["payment done, registry open", { ...noAgreement, AgreementId: 11, AgreementStatus: "Executed", Gate0_AgreementExecuted: 1, Gate1a_AfsQueryPayment: 1 }, "Registry visit pending", "/crm/agreements?bookingId=7&tab=afs-registry", "Open Agreement"],
    ["registry done, not marked registered", { ...noAgreement, AgreementId: 11, AgreementStatus: "Executed", Gate0_AgreementExecuted: 1, Gate1a_AfsQueryPayment: 1, Gate1b_AfsRegistryCompleted: 1 }, "Agreement not registered", "/crm/agreements?bookingId=7", "Open Agreement"],
    ["registered, certificate missing", { ...ready, Gate2_OcCcReceived: 0 }, "Occupancy or Completion Certificate not issued", "/crm/oc-cc?open=3", "Open Certificates"],
  ];
  it.each(cases)("%s", (_n, row, label, path, action) => {
    expect(gateHold(row)).toMatchObject({ label, path, action });
  });
  it("nothing holds a registered, certified booking", () => expect(gateHold(ready)).toBeNull());
  it("never offers Create Agreement when one exists", () => {
    for (const status of ["Draft", "Executed", "Registered", "PendingCustomerReview"]) {
      expect(gateHold({ ...noAgreement, AgreementId: 11, AgreementStatus: status })?.action).toBe("Open Agreement");
    }
  });
  it("a welcome call gap does not outrank an agreement that already exists", () => {
    expect(gateHold({ ...noAgreement, WelcomeDone: 0, AgreementId: 11, AgreementStatus: "Draft" })?.label).toBe("Agreement is Draft");
  });
});

describe("the next step, stage by stage", () => {
  const n = (o: any) => nextStep({ ...ready, ...o });
  it.each([
    ["closed booking", { Stage: "Closed", BookingStatus: "Cancelled" }, "Booking Cancelled", undefined],
    ["completed", { Stage: "Completed" }, "Keys handed over", undefined],
    ["not ready shows the hold", { ...noAgreement, Stage: "NotReady", BookingStatus: "Pending" }, "Booking awaiting approval", undefined],
    ["checklist to start", { Stage: "Checklist", CheckId: null }, "Start the checklist", undefined],
    ["checklist blocked", { Stage: "Checklist", CheckId: 1, CheckStatus: "Blocked" }, "Checklist blocked", true],
    ["checklist items left", { Stage: "Checklist", CheckId: 1, CheckStatus: "InProgress", FullyFunded: 0, DocumentationCheck: false }, "Pending: Dues, Documentation", undefined],
    ["notice to create", { Stage: "Notice", NoticeId: null }, "Create the possession notice", undefined],
    ["draft notice", { Stage: "Notice", NoticeId: 1, NoticeStatus: "Draft" }, "Send the notice", undefined],
    ["disputed notice", { Stage: "Notice", NoticeId: 1, NoticeStatus: "Disputed" }, "Customer objected to the notice", true],
    ["response overdue", { Stage: "Notice", NoticeId: 1, NoticeStatus: "Sent", NoticeOverdue: 1 }, "Customer response overdue", true],
    ["waiting on customer", { Stage: "Notice", NoticeId: 1, NoticeStatus: "Sent", NoticeOverdue: 0 }, "Awaiting customer response", undefined],
    ["handover to schedule", { Stage: "Handover", NoticeStatus: "Acknowledged" }, "Schedule the handover", undefined],
    ["cancelled handover can be rescheduled", { Stage: "Handover", NoticeStatus: "Acknowledged", HandoverId: 1, HandoverStatus: "Cancelled" }, "Schedule the handover", undefined],
    ["snags open", { Stage: "Handover", NoticeStatus: "Acknowledged", HandoverId: 1, HandoverStatus: "SnagPending", OpenSnags: 2 }, "2 snags to fix", true],
    ["one snag open", { Stage: "Handover", NoticeStatus: "Acknowledged", HandoverId: 1, HandoverStatus: "SnagPending", OpenSnags: 1 }, "1 snag to fix", true],
    ["scheduled", { Stage: "Handover", NoticeStatus: "Acknowledged", HandoverId: 1, HandoverStatus: "Scheduled", OpenSnags: 0 }, "Start the inspection", undefined],
    ["inspecting", { Stage: "Handover", NoticeStatus: "Acknowledged", HandoverId: 1, HandoverStatus: "SnagInspection", OpenSnags: 0 }, "Complete the handover", undefined],
  ])("%s", (_n, o, text, late) => {
    const r = n(o);
    expect(r.text).toBe(text);
    expect(r.late).toBe(late);
  });
});

describe("what holds a handover", () => {
  const ack = { ...ready, NoticeStatus: "Acknowledged", CheckId: 1 };
  it("nothing when every rule is met", () => expect(handoverHolds(ack)).toEqual([]));
  it("the notice", () => expect(handoverHolds({ ...ack, NoticeStatus: "Sent" })).toEqual(["Possession notice not acknowledged"]));
  it("the balance", () => expect(handoverHolds({ ...ack, FullyFunded: 0, Balance: 1000 })[0]).toContain("Balance due"));
  it("an open NOC", () => expect(handoverHolds({ ...ack, NocPending: 1 })).toEqual(["NOC still to be issued"]));
  it("an unticked checklist", () => expect(handoverHolds({ ...ack, QualityInspectionCheck: false })).toEqual(["Checklist not complete"]));
  it("no checklist record does not hold it, as on the server", () => expect(handoverHolds({ ...ack, CheckId: null })).toEqual([]));
});

describe("the tracker", () => {
  const states = (o: any) => stepsOf({ ...ready, ...o }).map((s) => s.state);
  it("not eligible", () => expect(states({ Gate1_AfsRegistered: 0 })).toEqual(["active", "off", "off", "off"]));
  it("closed booking is not shown as in progress", () => expect(states({ Gate1_AfsRegistered: 0, Stage: "Closed" })[0]).toBe("off"));
  it("checklist running", () => expect(states({ CheckId: 1, CheckStatus: "InProgress" })).toEqual(["done", "active", "off", "off"]));
  it("checklist blocked", () => expect(states({ CheckId: 1, CheckStatus: "Blocked" })[1]).toBe("stopped"));
  it("disputed notice", () => expect(states({ CheckId: 1, CheckStatus: "Ready", NoticeId: 1, NoticeStatus: "Disputed" })[2]).toBe("stopped"));
  it("cancelled handover is not live", () => expect(states({ HandoverId: 1, HandoverStatus: "Cancelled" })[3]).toBe("off"));
  it("all done", () => expect(states({ CheckId: 1, CheckStatus: "Ready", NoticeId: 1, NoticeStatus: "Acknowledged", HandoverId: 1, HandoverStatus: "Completed" })).toEqual(["done", "done", "done", "done"]));
});

describe("the steps before possession", () => {
  const keys = eligibilitySteps(ready).map((s) => s.key);
  it("run in the order they happen", () => expect(keys).toEqual(["approval", "welcome", "amount", "executed", "payment", "registry", "registered", "certificate"]));
  it("a ready booking has every step done", () => expect(eligibilitySteps(ready).every((s) => s.ok)).toBe(true));
  it("the current step is always one of the listed steps, and not done", () => {
    const rows = [
      { ...noAgreement, BookingStatus: "Pending" }, { ...noAgreement, WelcomeDone: 0 }, { ...noAgreement, AgreementBlocks: [AMOUNT] }, { ...noAgreement, AgreementBlocks: [] },
      { ...noAgreement, AgreementId: 11, AgreementStatus: "Draft" },
      { ...noAgreement, AgreementId: 11, AgreementStatus: "Executed", Gate0_AgreementExecuted: 1 },
      { ...noAgreement, AgreementId: 11, AgreementStatus: "Executed", Gate0_AgreementExecuted: 1, Gate1a_AfsQueryPayment: 1 },
      { ...noAgreement, AgreementId: 11, AgreementStatus: "Executed", Gate0_AgreementExecuted: 1, Gate1a_AfsQueryPayment: 1, Gate1b_AfsRegistryCompleted: 1 },
      { ...ready, Gate2_OcCcReceived: 0 },
    ];
    for (const r of rows) {
      const step = eligibilitySteps(r).find((s) => s.key === gateHold(r)?.step);
      expect(step, JSON.stringify(r)).toBeDefined();
      expect(step!.ok, step!.key).toBe(false);
    }
  });
  it("a certificate issued early shows done while earlier steps are pending", () => {
    const steps = eligibilitySteps({ ...noAgreement, BookingStatus: "Pending" });
    expect(steps.find((s) => s.key === "certificate")!.ok).toBe(true);
    expect(steps.find((s) => s.key === "approval")!.ok).toBe(false);
  });
});
