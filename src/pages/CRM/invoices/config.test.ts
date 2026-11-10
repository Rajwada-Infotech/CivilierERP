import { describe, expect, it } from "vitest";
import { billingStateOf, typeLabel, type InvoiceRow } from "./config";

const inv = (x: Partial<InvoiceRow>) => x as InvoiceRow;

describe("a milestone's billing state", () => {
  const m = { Id: 1, Status: "Pending", DemandStatus: "Demanded" };
  it("a demand raised and no invoice is ready to invoice; no demand waits for one", () => {
    expect(billingStateOf(m, [])).toBe("ready");
    expect(billingStateOf({ ...m, DemandStatus: "Pending" }, [])).toBe("demand");
  });
  it("its own live invoice wins; a void one frees it", () => {
    expect(billingStateOf(m, [inv({ MilestoneId: 1, Status: "Generated", InvoiceNo: "INV-1" })])).toBe("invoiced");
    expect(billingStateOf(m, [inv({ MilestoneId: 1, Status: "Void", InvoiceNo: "INV-1" })])).toBe("ready");
  });
  it("a live Final invoice covers every milestone; a void one covers none", () => {
    expect(billingStateOf({ ...m, DemandStatus: "Pending" }, [inv({ InvoiceType: "Final", Status: "Generated" })])).toBe("final");
    expect(billingStateOf(m, [inv({ InvoiceType: "Final", Status: "Void" })])).toBe("ready");
  });
  it("a Non-Invoice customer's milestones wait for the final invoice, then are on it", () => {
    expect(billingStateOf(m, [], true)).toBe("later");
    expect(billingStateOf(m, [], true, true)).toBe("finalDue");
    expect(billingStateOf(m, [inv({ InvoiceType: "Final", Status: "Generated" })], true)).toBe("final");
  });
  it("a waived milestone is never billable", () => {
    expect(billingStateOf({ ...m, Status: "Waived" }, [inv({ InvoiceType: "Final", Status: "Generated" })])).toBe("waived");
  });
});

describe("an invoice type in words", () => {
  it("splits the words and keeps a single word as it is", () => {
    expect(typeLabel("TransferFee")).toBe("Transfer fee");
    expect(typeLabel("OnAccount")).toBe("On account");
    expect(typeLabel("Final")).toBe("Final");
    expect(typeLabel(null)).toBe("");
  });
});
