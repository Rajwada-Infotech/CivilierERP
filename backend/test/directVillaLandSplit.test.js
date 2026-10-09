// A villa sold directly (its plots never sold) carries its land inside the one
// villa price: GST and the ledger tax only the part above the land.
jest.mock("../db", () => ({ sql: { Int: "Int" }, getPool: () => ({}) }));
const { getBookingLandSplit } = require("../services/projectType");

const poolWith = ({ lines, own }) => ({
  request() {
    const req = {
      input() { return req; },
      async query(text) {
        if (/LandValue/.test(text)) return { recordset: own ? [own] : [] };
        if (/CrmBookingPlot bp/.test(text) && /UNION ALL/.test(text)) return { recordset: lines };
        return { recordset: [] }; // land kinds register
      },
    };
    return req;
  },
});
const villaLine = [{ IsLandLine: 0, UnitKind: "VILLA", AllocatedValue: 9000000 }];

describe("land part of a direct villa sale", () => {
  test("whole booking: land from LandValue, the rest is construction", async () => {
    const s = await getBookingLandSplit(poolWith({ lines: villaLine, own: { LandValue: 3000000, TotalValue: 9000000 } }), 1, 9000000);
    expect(s).toEqual({ landValue: 3000000, constructionValue: 6000000, isPureLand: false, hasLand: true });
  });
  test("one invoice: same land share of that amount", async () => {
    const s = await getBookingLandSplit(poolWith({ lines: villaLine, own: { LandValue: 3000000, TotalValue: 9000000 } }), 1, 900000);
    expect(s.landValue).toBe(300000);
    expect(s.constructionValue).toBe(600000);
  });
  test("villa bought by the plot's owner (no LandValue): all construction", async () => {
    const s = await getBookingLandSplit(poolWith({ lines: villaLine, own: { LandValue: null, TotalValue: 6000000 } }), 1, 6000000);
    expect(s).toEqual({ landValue: 0, constructionValue: 6000000, isPureLand: false, hasLand: false });
  });
});
