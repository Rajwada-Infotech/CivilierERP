process.env.NODE_ENV = "test";

/**
 * Data Review checklist (services/crmApplicationChecklist.js):
 * - an item changes only while the booking is still in Data Review — the
 *   stage is checked inside the same UPDATE, so a write that waited behind a
 *   send finds it sent and is refused (409), not silently applied;
 * - a ticked item whose data the preparer changes goes back to be verified,
 *   with a note of what changed; untouched items keep their tick.
 */
jest.mock("../db", () => ({
  sql: new Proxy({}, { get: () => () => "type" }),
  getPool: () => ({}),
}));

const checklist = require("../services/crmApplicationChecklist");

// A pool whose UPDATE answers `updated` rows and whose existence probe answers `exists`.
function mockPool({ updated = [], exists = true } = {}) {
  const queries = [];
  const pool = {
    queries,
    request() {
      const r = {
        inputs: {},
        input(name, _t, v) { r.inputs[name] = v; return r; },
        async query(q) {
          queries.push({ q, inputs: r.inputs });
          if (/^\s*UPDATE/.test(q)) return { recordset: updated };
          if (q.includes("SELECT 1 AS x FROM dbo.CrmApplicationVerificationChecklist")) return { recordset: exists ? [{ x: 1 }] : [] };
          if (q.includes("SELECT CheckStatus")) return { recordset: [{ CheckStatus: "Checked" }] };
          return { recordset: [] };
        },
      };
      return r;
    },
  };
  return pool;
}
const updates = (pool) => pool.queries.filter((x) => /^\s*UPDATE/.test(x.q));
const STAGE_GUARD = /EXISTS \(SELECT 1 FROM dbo\.CrmBooking b WHERE b\.ApplicationId = @aid AND b\.IsActive = 1\s+AND ISNULL\(b\.WorkflowStage, N'Review'\) = N'Review'\)/;

describe("a Data Review item changes only while the booking is in Data Review", () => {
  test.each(["checkItem", "flagItem", "uncheckItem", "resubmitItem"])("%s checks the stage inside its UPDATE", async (fn) => {
    const pool = mockPool({ updated: [{ ItemKey: "ApplicantKyc" }] });
    if (fn === "resubmitItem") pool.request = ((orig) => () => {
      const r = orig(); const q = r.query;
      r.query = async (s) => (s.includes("SELECT CheckStatus") ? { recordset: [{ CheckStatus: "NeedsRecheck" }] } : q(s));
      return r;
    })(pool.request.bind(pool));
    await checklist[fn](pool, 5, "ApplicantKyc", { actor: 1, remarks: "PAN does not match", level: 1 });
    expect(updates(pool)).toHaveLength(1);
    expect(updates(pool)[0].q).toMatch(STAGE_GUARD);
  });

  test("a level-2 item is not tied to the booking's stage", async () => {
    const pool = mockPool({ updated: [{ ItemKey: "x" }] });
    const key = checklist.itemsForLevel(2)[0]?.key;
    if (!key) return; // no level-2 items configured
    await checklist.checkItem(pool, 5, key, { actor: 1, level: 2 });
    expect(updates(pool)[0].q).not.toMatch(STAGE_GUARD);
  });

  test("the booking was sent meanwhile: refused with 409, not 'not found'", async () => {
    const pool = mockPool({ updated: [], exists: true });
    await expect(checklist.flagItem(pool, 5, "ApplicantKyc", { actor: 1, remarks: "wrong PAN" }))
      .rejects.toMatchObject({ status: 409, message: expect.stringMatching(/already been sent for approval/) });
  });

  test("an item that does not exist is still 404", async () => {
    const pool = mockPool({ updated: [], exists: false });
    await expect(checklist.checkItem(pool, 5, "ApplicantKyc", { actor: 1 })).rejects.toMatchObject({ status: 404 });
  });
});

describe("a ticked item whose data changes goes back to be verified", () => {
  const C = checklist.APPLICATION_ITEM_COLUMNS;

  test("only the item whose column changed; blank and null count as the same", () => {
    const before = { TokenValue: 100000, RatePerSqFt: "4500.0000", Email: null, Source: "Walk-in" };
    const after = { TokenValue: 150000, RatePerSqFt: "4500.0000", Email: "", Source: "Walk-in" };
    expect(checklist.changedItems(C, before, after)).toEqual(["PaymentPlanAmounts"]);
  });

  test("dates compare by day", () => {
    const B = checklist.BANK_DETAIL_ITEM_COLUMNS;
    const d = (s) => new Date(`${s}T00:00:00.000Z`);
    expect(checklist.changedItems(B, { ChequeDate: d("2026-11-01") }, { ChequeDate: d("2026-11-01") })).toEqual([]);
    expect(checklist.changedItems(B, { ChequeDate: d("2026-11-01") }, { ChequeDate: d("2026-11-03") })).toEqual(["BankDepositMode"]);
  });

  test("the buyer's own bank account is checked by no item — changing it resets nothing", () => {
    const cols = Object.values(checklist.BANK_DETAIL_ITEM_COLUMNS).flat();
    expect(cols).not.toEqual(expect.arrayContaining(["AccountNo"]));
    expect(cols).not.toEqual(expect.arrayContaining(["IFSC"]));
  });

  test("resets Checked rows only, in Data Review only, with a note naming what changed", async () => {
    const pool = mockPool({ updated: [{ ItemKey: "PaymentPlanAmounts" }] });
    const out = await checklist.resetForChangedColumns(pool, { applicationId: 5 }, C,
      { TokenValue: 100000 }, { TokenValue: 150000 }, "application edited");
    expect(out).toEqual(["PaymentPlanAmounts"]);
    const [u] = updates(pool);
    expect(u.q).toMatch(/CheckStatus = 'Checked'/);
    expect(u.q).toMatch(STAGE_GUARD);
    expect(u.inputs.what).toBe("Changed after it was verified: application edited (TokenValue)");
    expect(u.inputs.k0).toBe("PaymentPlanAmounts");
  });

  test("nothing changed: no write at all", async () => {
    const pool = mockPool();
    expect(await checklist.resetForChangedColumns(pool, { applicationId: 5 }, C, { TokenValue: 1 }, { TokenValue: 1 }, "x")).toEqual([]);
    expect(updates(pool)).toHaveLength(0);
  });

  test("never fails the save that triggered it", async () => {
    const pool = { request: () => { throw new Error("connection lost"); } };
    jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(checklist.resetVerifiedItems(pool, { applicationId: 5 }, ["Documents"], "document deleted")).resolves.toEqual([]);
    console.error.mockRestore();
  });

  test("unknown item keys are ignored", async () => {
    const pool = mockPool();
    expect(await checklist.resetVerifiedItems(pool, { applicationId: 5 }, ["NotAnItem"], "x")).toEqual([]);
    expect(updates(pool)).toHaveLength(0);
  });
});
