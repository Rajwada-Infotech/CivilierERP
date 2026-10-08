// Two ways to sell a villa built on plots: directly (its plots unsold — any
// buyer, land and all), or after the plots were sold (only their owner).
// The real db module needs DB settings that CI doesn't have; these tests pass
// their own fake pool, so a stub is all that's needed.
jest.mock("../db", () => ({ sql: { Int: "Int", NVarChar: () => "NVarChar" }, getPool: () => { throw new Error("no db in tests"); } }));
const { assertVillaBuyerOwnsLand, VillaLandError } = require("../services/villaLand");

const poolWith = (rows) => ({
  request() { const req = { input() { return req; }, async query() { return { recordset: rows }; } }; return req; },
});
const row = (plotId, customerId, name) => ({ UnitId: 5, UnitName: "SW/A/P-21", PlotId: plotId, CustomerId: customerId, CustomerName: name });

describe("who may buy a villa built on plots", () => {
  test("unsold plot: the villa is sold directly to any buyer", async () => {
    await expect(assertVillaBuyerOwnsLand(poolWith([row(21, null)]), [5], 99)).resolves.toBeUndefined();
  });
  test("sold plot: its owner can buy the villa", async () => {
    await expect(assertVillaBuyerOwnsLand(poolWith([row(21, 7, "Asha")]), [5], 7)).resolves.toBeUndefined();
  });
  test("sold plot: anyone else is refused", async () => {
    await expect(assertVillaBuyerOwnsLand(poolWith([row(21, 7, "Asha")]), [5], 8)).rejects.toThrow(/only the plot's owner/);
  });
  test("some plots sold, some not: refused", async () => {
    await expect(assertVillaBuyerOwnsLand(poolWith([row(21, 7, "Asha"), row(22, null)]), [5], 7)).rejects.toBeInstanceOf(VillaLandError);
  });
});
