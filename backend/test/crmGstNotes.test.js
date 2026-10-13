const gst = require("../services/crmGstNotes");

describe("crmGstNotes service", () => {
  it("creditNoteDeadline calculates 30 Nov after financial year end", () => {
    // FY 2024-25 (dated 15 May 2024) -> FY ends 31 Mar 2025 -> deadline 30 Nov 2025
    expect(gst.creditNoteDeadline("2024-05-15")).toBe("2025-11-30");

    // FY 2024-25 (dated 15 Jan 2025) -> FY ends 31 Mar 2025 -> deadline 30 Nov 2025
    expect(gst.creditNoteDeadline("2025-01-15")).toBe("2025-11-30");

    // FY 2025-26 (dated 05 Apr 2025) -> FY ends 31 Mar 2026 -> deadline 30 Nov 2026
    expect(gst.creditNoteDeadline("2025-04-05")).toBe("2026-11-30");
  });

  it("exports required functions", () => {
    expect(typeof gst.list).toBe("function");
    expect(typeof gst.load).toBe("function");
    expect(typeof gst.issueForRefund).toBe("function");
    expect(typeof gst.createAdjustment).toBe("function");
    expect(typeof gst.updateAdjustment).toBe("function");
    expect(typeof gst.submitAdjustment).toBe("function");
    expect(typeof gst.decideAdjustment).toBe("function");
    expect(typeof gst.requestCancel).toBe("function");
    expect(typeof gst.decideCancel).toBe("function");
    expect(typeof gst.reissue).toBe("function");
    expect(typeof gst.renderPdf).toBe("function");
    expect(typeof gst.formatSac).toBe("function");
  });

  it("formatSac strips internal rate suffixes for statutory documents", () => {
    expect(gst.formatSac("9954AFH")).toBe("9954");
    expect(gst.formatSac("9954OTH")).toBe("9954");
    expect(gst.formatSac("995411")).toBe("995411");
    expect(gst.formatSac(null)).toBe("9954");
    expect(gst.formatSac("")).toBe("9954");
  });
});
