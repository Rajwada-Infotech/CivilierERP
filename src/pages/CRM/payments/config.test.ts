import { describe, expect, it } from "vitest";
import { daysLate, isOverdue, milestoneFill, nextOpenMilestone } from "./config";
import { todayStr } from "./config";

const dayOffset = (n: number) => {
  const d = new Date(`${todayStr()}T00:00:00`);
  d.setDate(d.getDate() + n);
  const m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}T00:00:00.000Z`;
};

describe("a milestone's lateness", () => {
  it("a milestone due today is not late; yesterday is one day late", () => {
    expect(daysLate({ DueDate: dayOffset(0) })).toBe(0);
    expect(daysLate({ DueDate: dayOffset(-1) })).toBe(1);
    expect(isOverdue({ MoneyStage: null, Status: "Pending", DueDate: dayOffset(0) })).toBe(false);
    expect(isOverdue({ MoneyStage: null, Status: "Pending", DueDate: dayOffset(-1) })).toBe(true);
  });
  it("money against it, or no due date, is never overdue", () => {
    expect(isOverdue({ MoneyStage: "Verified", Status: "Pending", DueDate: dayOffset(-9) })).toBe(false);
    expect(isOverdue({ MoneyStage: "InVerification", Status: "Pending", DueDate: dayOffset(-9) })).toBe(false);
    expect(isOverdue({ MoneyStage: null, Status: "Pending", DueDate: null })).toBe(false);
  });
});

describe("what a milestone's amount is made of", () => {
  it("settled, held and with Finance leave the missing money, to the paisa", () => {
    expect(milestoneFill({ AmountDue: 630150.5, AmountPaid: 100, HeldOnAccount: 600000, WithFinanceCover: 20000.25 }))
      .toMatchObject({ settled: 100, held: 600000, finance: 20000.25, missing: 10050.25, waived: false });
  });
  it("the next open milestone is the first with money missing, skipping waived and covered ones", () => {
    const plan = [
      { Id: 1, AmountDue: 10, HeldOnAccount: 10, Status: "Pending" },
      { Id: 2, AmountDue: 10, Status: "Waived" },
      { Id: 3, AmountDue: 10, HeldOnAccount: 4, Status: "Pending" },
      { Id: 4, AmountDue: 10, Status: "Pending" },
    ];
    expect(nextOpenMilestone(plan)?.Id).toBe(3);
    expect(nextOpenMilestone([plan[0], plan[1]])).toBeNull();
  });
});
