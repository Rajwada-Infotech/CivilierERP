// Resale rules decided 2026-10-14:
//  - only a REGISTERED sale deed stops a resale / buy-back; a handover alone does not
//  - an individual buyer (PAN 4th letter P) gives Aadhaar; a company / firm doesn't
jest.mock("../db", () => ({ sql: { Int: "Int", NVarChar: () => "NVarChar" }, getPool: () => { throw new Error("no database in tests"); } }));
const { conveyedReason } = require("../services/crmResaleTransfer");
const { isIndividualPan } = require("../services/crmResaleCase");

const dbAnswering = (rowsFor) => ({ request: () => ({ query: async (q) => ({ recordset: rowsFor(q) }) }) });

describe("conveyed — what stops a booking changing hands", () => {
  test("a handover alone does not: the check never looks at handovers", async () => {
    let seen = "";
    const db = dbAnswering((q) => { seen = q; return []; });
    expect(await conveyedReason(db, [5])).toBeNull();
    expect(seen).not.toMatch(/CrmHandover/);
    expect(seen).toMatch(/CrmSalesDeed[\s\S]*Registered/);
  });
  test("a registered sale deed does, pointing to Ownership Changes", async () => {
    const db = dbAnswering(() => [{ BookingNo: "BKG-1", Why: "its sale deed is registered" }]);
    expect(await conveyedReason(db, [5])).toMatch(/BKG-1: its sale deed is registered.*Ownership Changes/);
  });
});

describe("buyer KYC by PAN type", () => {
  test("individual (P) needs Aadhaar", () => {
    expect(isIndividualPan("ABCPE1234F")).toBe(true);
  });
  test("company (C), firm (F), HUF (H), trust (T) do not", () => {
    for (const p of ["AAACR1234F", "AAAFR1234F", "AAAHR1234F", "AAATR1234F"]) expect(isIndividualPan(p)).toBe(false);
  });
  test("no or malformed PAN is treated as an individual (Aadhaar still asked)", () => {
    expect(isIndividualPan(null)).toBe(true);
    expect(isIndividualPan("12345")).toBe(true);
  });
});
