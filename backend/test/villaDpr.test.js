// Plot -> villa -> DPR: the rules that decide where a villa's work chains sit,
// which step list they copy, and when land can't be cancelled from under a villa.
// A fake database answers each query by what it asks for.
let mockType = { HasFloors: true, Name: "High Rise Apartments" };
jest.mock("../services/projectType", () => ({ getEffectiveType: async () => mockType }));
let mockPoolHandler = () => [];
jest.mock("../db", () => ({ sql: { Int: "Int", NVarChar: () => "NVarChar" }, getPool: () => mockFakeDb(mockPoolHandler) }));
jest.mock("../redis", () => ({ bumpCacheVersion: async () => {} }));

function mockFakeDb(handler) {
  return {
    request() {
      const inputs = {};
      const r = {
        input(name, _type, value) { inputs[name] = value; return r; },
        async query(text) { const rows = handler(text, inputs) || []; return { recordset: rows, rowsAffected: [rows.length] }; },
      };
      return r;
    },
  };
}

const { chainFloorLabel } = require("../services/unitLayout");
const { villaBookedOnLandOf } = require("../services/villaLand");
const { createChainsForUnit, clearTemplateCache } = require("../services/autoDprChains");

describe("chainFloorLabel — a chain's Floor follows the project type", () => {
  const db = (plots) => mockFakeDb((q) => (/PlotMaster/.test(q) ? [{ Plots: plots }] : []));
  test("a unit with a floor keeps its floor label", async () => {
    expect(await chainFloorLabel(db(null), { UnitId: 1, UnitName: "CRT/1/GA", FloorNo: 0 })).toBe("G");
    expect(await chainFloorLabel(db(null), { UnitId: 1, UnitName: "CRT/1/3A", FloorNo: 3 })).toBe("3");
    expect(await chainFloorLabel(db(null), { UnitId: 1, UnitName: "CRT/1/3A", FloorNo: 3 }, { asLabel: false })).toBe("3");
  });
  test("a floorless unit in a type with floors is refused, never written as 'null'", async () => {
    mockType = { HasFloors: true, Name: "High Rise Apartments" };
    await expect(chainFloorLabel(db(null), { UnitId: 1, UnitName: "X/1/1A", FloorNo: null })).rejects.toThrow(/no floor/);
  });
  test("a villa in a plotted block is placed by its plot(s)", async () => {
    mockType = { HasFloors: false, Name: "Plotted + Villa" };
    expect(await chainFloorLabel(db("P-100"), { UnitId: 9, UnitName: "SW/A/P-100", FloorNo: null })).toBe("P-100");
    expect(await chainFloorLabel(db("P-1+P-2"), { UnitId: 9, UnitName: "SW/A/V1", FloorNo: null })).toBe("P-1+P-2");
  });
  test("a floorless unit in a plotted block that isn't built on a plot is refused", async () => {
    mockType = { HasFloors: false, Name: "Plotted + Villa" };
    await expect(chainFloorLabel(db(null), { UnitId: 9, UnitName: "SW/A/X", FloorNo: null })).rejects.toThrow(/isn't built on a plot/);
  });
});

describe("villaBookedOnLandOf — land can't be cancelled from under a booked villa", () => {
  test("returns the villa's booking when one stands on this booking's land", async () => {
    expect(await villaBookedOnLandOf(mockFakeDb(() => [{ BookingNo: "BK-0042" }]), 7)).toBe("BK-0042");
  });
  test("returns null when no booked villa stands on it", async () => {
    expect(await villaBookedOnLandOf(mockFakeDb(() => []), 7)).toBeNull();
  });
});

describe("createChainsForUnit — a villa's rooms get their DPR chains", () => {
  const unit = { UnitId: 50, UnitName: "SW/A/P-100", ProjectId: 12, BlockId: 3, FloorNo: null };
  const rooms = [
    { Id: 1, RoomName: "Bedroom 1", RoomCategoryId: 1 },
    { Id: 2, RoomName: "Kitchen", RoomCategoryId: 3 },
    { Id: 3, RoomName: "Store Room", RoomCategoryId: 9 },
  ];
  // Templates: the project has its own (tailored) Bedroom chain; Kitchen only exists elsewhere.
  const templates = (scopedToProject) => (scopedToProject
    ? [{ Id: 700, WorkType: "INTERNAL", RoomCategoryId: 1, Sig: "villa-steps" }]
    : [
      { Id: 100, WorkType: "INTERNAL", RoomCategoryId: 1, Sig: "flat-steps" },
      { Id: 101, WorkType: "INTERNAL", RoomCategoryId: 1, Sig: "flat-steps" },
      { Id: 200, WorkType: "INTERNAL", RoomCategoryId: 3, Sig: "kitchen-a" },
      { Id: 201, WorkType: "INTERNAL", RoomCategoryId: 3, Sig: "kitchen-a" },
      { Id: 202, WorkType: "INTERNAL", RoomCategoryId: 3, Sig: "kitchen-b" },
    ]);
  let inserted;
  let donors;
  beforeEach(() => {
    donors = [];
    clearTemplateCache();
    mockType = { HasFloors: false, Name: "Plotted + Villa" };
    inserted = [];
    mockPoolHandler = (q, inputs) => (/STRING_AGG\(CAST\(a\.ActivityId/.test(q) ? templates(inputs.p != null) : []);
  });
  const txDb = () => {
    let nextId = 900;
    return mockFakeDb((q, inputs) => {
      if (/FROM dbo\.UnitMaster WHERE Id = @u/.test(q)) return [unit];
      if (/FROM dbo\.RoomMaster r\s+WHERE r\.UnitId/.test(q)) return rooms;
      if (/FROM dbo\.PlotMaster/.test(q)) return [{ Plots: "P-100" }];
      if (/INSERT INTO dbo\.DependencyMaster /.test(q)) { inserted.push({ ...inputs }); return [{ id: nextId++ }]; }
      if (/INSERT INTO dbo\.DependencyMasterActivity/.test(q)) { donors.push(inputs.D); return []; }
      return [];
    });
  };
  test("each room with a template gets one chain, placed under the plot", async () => {
    const r = await createChainsForUnit(txDb(), 50, "tester");
    expect(r.created).toBe(2);
    expect(inserted.map((i) => i.A)).toEqual(["SW/A/P-100/Bedroom 1", "SW/A/P-100/Kitchen"]);
    expect(inserted.every((i) => i.Fl === "P-100")).toBe(true);
  });
  test("a room type with no chain anywhere is reported, not guessed", async () => {
    const r = await createChainsForUnit(txDb(), 50, "tester");
    expect(r.skipped).toEqual(["Store Room"]);
  });
  test("the project's own (tailored) step list wins; otherwise the most common one is copied", async () => {
    await createChainsForUnit(txDb(), 50, "tester");
    // Bedroom: donor 700, the project's own. Kitchen: 200, the most common list elsewhere.
    expect(donors).toEqual([700, 200]);
  });
});
