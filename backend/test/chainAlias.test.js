// A new DPR chain is named in its donor chain's style, so a project's chains
// read alike whoever (script or app) created them.
// The helpers under test are pure; keep db.js (which demands real env vars) out of the unit test.
jest.mock("../db", () => ({ sql: {}, getPool: () => ({}) }));
const { chainAlias, aliasFormatOf } = require("../services/autoDprChains");

describe("chain naming follows the donor", () => {
  test("'>' separator, upper-case — the style the clone script left", () => {
    const donor = { Alias: "SLV>A>V-100>BALCONY 1", UnitName: "SLV/A/V-100", RoomName: "Balcony 1" };
    expect(chainAlias(donor, "SLV/A/P-21", "Bedroom 2")).toBe("SLV>A>P-21>BEDROOM 2");
  });
  test("'/' separator, names as they are", () => {
    const donor = { Alias: "SLV/A/P-3/Bedroom 1", UnitName: "SLV/A/P-3", RoomName: "Bedroom 1" };
    expect(chainAlias(donor, "SLV/A/P-21", "Deck 2")).toBe("SLV/A/P-21/Deck 2");
  });
  test("a donor name that doesn't follow any pattern falls back to UNIT/Room", () => {
    const donor = { Alias: "Kitchen chain (old)", UnitName: "SLV/A/P-3", RoomName: "Kitchen" };
    expect(aliasFormatOf(donor)).toBeNull();
    expect(chainAlias(donor, "SLV/A/P-21", "Kitchen")).toBe("SLV/A/P-21/Kitchen");
  });
});
