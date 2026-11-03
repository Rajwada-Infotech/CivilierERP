import { describe, expect, it } from "vitest";
import { bookingSendBack, bookingSendBackChain, bookingSendBackChoices } from "./crmStatuses";

// A booking's stage log as the server sends it (stageState.history): newest
// first, each row the stage the booking moved TO.
const log = (...rows: [string, string, string?, string?][]) =>
  rows.map(([Stage, Action, Remarks, ActorName], i) => ({ Id: i + 1, Stage, Action, Remarks: Remarks ?? null, ActorName: ActorName ?? null, CreatedAt: `2026-11-03T0${i}:00:00Z` })).reverse();

describe("bookingSendBackChain — every reason of this round, oldest first", () => {
  it("Director → Marketing Head → Data Review: the Director's reason is still read", () => {
    const history = log(
      ["MarketingHeadApproval", "SubmittedForApproval"],
      ["DirectorApproval", "Approved"],
      ["MarketingHeadApproval", "BouncedBackForCorrection", "wrong rate", "Asha"],
      ["Review", "BouncedBackForCorrection", "correct the rate to 4,500", "Vikram"],
    );
    expect(bookingSendBackChain(history).map(({ from, to, remark, byName }) => ({ from, to, remark, byName }))).toEqual([
      { from: "Director", to: "Marketing Head", remark: "wrong rate", byName: "Asha" },
      { from: "Marketing Head", to: "Data Review", remark: "correct the rate to 4,500", byName: "Vikram" },
    ]);
  });

  it("the Director straight to Data Review", () => {
    const history = log(
      ["MarketingHeadApproval", "SubmittedForApproval"],
      ["DirectorApproval", "Approved"],
      ["Review", "BouncedBackForCorrection", "PAN is wrong"],
    );
    expect(bookingSendBackChain(history)).toMatchObject([{ from: "Director", to: "Data Review", remark: "PAN is wrong" }]);
  });

  it("only this round: send-backs before the last send are history, not shown", () => {
    const history = log(
      ["MarketingHeadApproval", "SubmittedForApproval"],
      ["Review", "BouncedBackForCorrection", "old reason"],
      ["MarketingHeadApproval", "SubmittedForApproval"],
      ["Review", "BouncedBackForCorrection", "new reason"],
    );
    expect(bookingSendBackChain(history).map((c) => c.remark)).toEqual(["new reason"]);
  });

  it("never sent back, or no log: nothing", () => {
    expect(bookingSendBackChain(log(["MarketingHeadApproval", "SubmittedForApproval"]))).toEqual([]);
    expect(bookingSendBackChain(undefined)).toEqual([]);
  });
});

describe("bookingSendBackChoices — the server's targets, worded", () => {
  it("from the Director: the Marketing Head first (the default), then Data Review", () => {
    const c = bookingSendBackChoices(["MarketingHeadApproval", "Review"]);
    expect(c.map((x) => [x.value, x.label])).toEqual([
      ["MarketingHeadApproval", "To the Marketing Head"],
      ["Review", "To Data Review"],
    ]);
    expect(c[1].note).toMatch(/verified and approved at every level again/);
  });

  it("reads the inbox's comma-separated column the same way", () => {
    expect(bookingSendBackChoices("MarketingHeadApproval,Review")).toEqual(bookingSendBackChoices(["MarketingHeadApproval", "Review"]));
  });

  it("one target (Marketing Head) or none: no real choice", () => {
    expect(bookingSendBackChoices("Review")).toHaveLength(1);
    expect(bookingSendBackChoices(null)).toEqual([]);
    expect(bookingSendBackChoices("")).toEqual([]);
  });
});

describe("bookingSendBack — whose turn it is now", () => {
  it("back at Data Review: the preparer corrects", () => {
    expect(bookingSendBack("Review", "DirectorApproval")).toMatchObject({ from: "Director", preparerCorrects: true });
  });
  it("back at the Marketing Head: theirs to approve again", () => {
    expect(bookingSendBack("MarketingHeadApproval", "DirectorApproval")).toMatchObject({ from: "Director", now: "Marketing Head", preparerCorrects: false });
  });
});
