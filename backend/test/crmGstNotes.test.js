const { describe, it } = require("node:test");
const assert = require("node:assert");
const gst = require("../services/crmGstNotes");

describe("crmGstNotes service", () => {
  it("creditNoteDeadline calculates 30 Nov after financial year end", () => {
    // FY 2024-25 (dated 15 May 2024) -> FY ends 31 Mar 2025 -> deadline 30 Nov 2025
    assert.strictEqual(gst.creditNoteDeadline("2024-05-15"), "2025-11-30");

    // FY 2024-25 (dated 15 Jan 2025) -> FY ends 31 Mar 2025 -> deadline 30 Nov 2025
    assert.strictEqual(gst.creditNoteDeadline("2025-01-15"), "2025-11-30");

    // FY 2025-26 (dated 05 Apr 2025) -> FY ends 31 Mar 2026 -> deadline 30 Nov 2026
    assert.strictEqual(gst.creditNoteDeadline("2025-04-05"), "2026-11-30");
  });

  it("exports required functions", () => {
    assert.strictEqual(typeof gst.list, "function");
    assert.strictEqual(typeof gst.load, "function");
    assert.strictEqual(typeof gst.issueForRefund, "function");
    assert.strictEqual(typeof gst.createAdjustment, "function");
    assert.strictEqual(typeof gst.updateAdjustment, "function");
    assert.strictEqual(typeof gst.submitAdjustment, "function");
    assert.strictEqual(typeof gst.decideAdjustment, "function");
    assert.strictEqual(typeof gst.requestCancel, "function");
    assert.strictEqual(typeof gst.decideCancel, "function");
    assert.strictEqual(typeof gst.reissue, "function");
    assert.strictEqual(typeof gst.renderPdf, "function");
  });
});
