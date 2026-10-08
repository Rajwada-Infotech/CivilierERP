// A villa contains its floors: each room of a villa sits on the floor its villa
// type's plan gives it, filled bottom floor first in room-number order.
jest.mock("../db", () => ({ sql: new Proxy({}, { get: () => () => "type" }), getPool: () => null }));
const { applyStoreys, storeyOrder } = require("../services/villaComposition");

const BED = 1, BATH = 5, STORE = 9;
function mockDb({ plan, rooms }) {
  const writes = [];
  return {
    writes,
    request() {
      const inputs = {};
      const r = {
        input(k, _t, v) { inputs[k] = v; return r; },
        async query(text) {
          if (/FROM dbo\.UnitMaster/.test(text)) return { recordset: [{ VillaTypeId: 6 }] };
          if (/FROM dbo\.VillaTypeRoomPlan/.test(text)) return { recordset: plan };
          if (/FROM dbo\.RoomMaster/.test(text)) return { recordset: rooms };
          if (/UPDATE dbo\.RoomMaster SET Storey/.test(text)) { writes.push([inputs.id, inputs.s]); return { recordset: [] }; }
          return { recordset: [] };
        },
      };
      return r;
    },
  };
}

describe("villa floors", () => {
  test("G first, then numbered floors, then named ones like Roof", () => {
    expect(["Roof", "2", "G", "1"].sort((a, b) => storeyOrder(a) - storeyOrder(b))).toEqual(["G", "1", "2", "Roof"]);
  });

  test("rooms are placed on their floors bottom-up in number order", async () => {
    const db = mockDb({
      plan: [
        { storey: "G", categoryId: BED, quantity: 1 }, { storey: "G", categoryId: BATH, quantity: 1 },
        { storey: "1", categoryId: BED, quantity: 2 }, { storey: "1", categoryId: BATH, quantity: 2 },
        { storey: "2", categoryId: BED, quantity: 1 }, { storey: "2", categoryId: STORE, quantity: 1 },
      ],
      rooms: [
        { Id: 14, RoomName: "Bedroom 4", RoomCategoryId: BED, Storey: null },
        { Id: 11, RoomName: "Bedroom 1", RoomCategoryId: BED, Storey: null },
        { Id: 12, RoomName: "Bedroom 2", RoomCategoryId: BED, Storey: null },
        { Id: 13, RoomName: "Bedroom 3", RoomCategoryId: BED, Storey: null },
        { Id: 21, RoomName: "Bathroom 1", RoomCategoryId: BATH, Storey: null },
        { Id: 22, RoomName: "Bathroom 2", RoomCategoryId: BATH, Storey: null },
        { Id: 23, RoomName: "Bathroom 3", RoomCategoryId: BATH, Storey: null },
        { Id: 31, RoomName: "Store Room", RoomCategoryId: STORE, Storey: null },
      ],
    });
    expect(await applyStoreys(db, 50)).toBe(8);
    const at = Object.fromEntries(db.writes);
    expect([at[11], at[12], at[13], at[14]]).toEqual(["G", "1", "1", "2"]);
    expect([at[21], at[22], at[23]]).toEqual(["G", "1", "1"]);
    expect(at[31]).toBe("2");
  });

  test("a room beyond the plan keeps no floor, and nothing is rewritten when already right", async () => {
    const db = mockDb({
      plan: [{ storey: "G", categoryId: BED, quantity: 1 }],
      rooms: [
        { Id: 11, RoomName: "Bedroom 1", RoomCategoryId: BED, Storey: "G" },
        { Id: 12, RoomName: "Bedroom 2", RoomCategoryId: BED, Storey: "1" },
      ],
    });
    expect(await applyStoreys(db, 50)).toBe(1);
    expect(db.writes).toEqual([[12, null]]);
  });
});
