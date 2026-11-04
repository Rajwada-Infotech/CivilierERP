import { describe, expect, it } from "vitest";
import { sentBackTurns } from "./CrmListToolbar";

// Rows as GET /api/crm/dashboard/sent-back returns them.
const booking = (o: Record<string, unknown>) => ({ Kind: "booking", BookingId: 12, ApplicationId: 55, ...o });

describe("sentBackTurns — what each list row offers", () => {
  it("sent back to Data Review: the preparer corrects", () => {
    expect(sentBackTurns([booking({ State: "SentBack", Stage: "Review", FromStage: "MarketingHeadApproval" })], "BookingId").get(12)).toBe("SentBack");
  });

  it("sent back to the Marketing Head: Re-approve, only for someone who can approve it", () => {
    const row = { State: "SentBack", Stage: "MarketingHeadApproval", FromStage: "DirectorApproval" };
    expect(sentBackTurns([booking({ ...row, CanApprove: true })], "BookingId").get(12)).toBe("Reapprove");
    expect(sentBackTurns([booking({ ...row, CanApprove: false })], "BookingId").has(12)).toBe(false);
    expect(sentBackTurns([booking(row)], "ApplicationId").has(55)).toBe(false);
  });

  it("a correction to make outranks a recheck on the same booking", () => {
    const rows = [
      { Kind: "review", BookingId: 12, ApplicationId: 55, State: "Resubmitted" },
      booking({ State: "SentBack", Stage: "Review", FromStage: "MarketingHeadApproval" }),
    ];
    expect(sentBackTurns(rows, "BookingId").get(12)).toBe("SentBack");
  });

  it("other kinds (payments, refunds…) are not list-row turns", () => {
    expect(sentBackTurns([{ Kind: "payment", BookingId: 12, State: "SentBack" }], "BookingId").size).toBe(0);
  });
});
