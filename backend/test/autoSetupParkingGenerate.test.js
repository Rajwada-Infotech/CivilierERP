process.env.NODE_ENV = "test";

/**
 * Auto Project Setup — POST /generate-parking-slots creates exactly what a
 * block's parking mix still lacks, counted by TYPE, never by name.
 *
 * The bug this pins: Block 1 had 7 Covered slots named by an older pattern
 * (EMP/CP1..CP7) and a mix of 7 Covered + 5 Open. Counting by name under the
 * current pattern (EMP/1/P1..) matched none of them, so "create" made 12 new
 * slots (7 duplicate Covered) instead of the 5 Open ones.
 *
 * The database is an in-memory model behind a faked mssql pool.
 */
const express = require("express");
const request = require("supertest");

const mockDb = {
  project: { Id: 1, Name: "Emporis", ShortName: "EMP", Code: "EMP" },
  blocks: [{ Id: 10, BlockName: "1", ProjectId: 1 }],
  mix: [],     // { BlockId, ParkingType, Count, SortOrder }
  slots: [],   // { Id, ProjectId, BlockId, SlotNo, ParkingType, IsActive }
  // sp_getapplock: one holder per resource; the next waits until the holder's
  // transaction ends (as SQL Server does).
  locks: new Map(),
};
const mockShortfall = (blockId) => {
  const want = {};
  const order = {};
  mockDb.mix.filter((m) => m.BlockId === blockId).forEach((m) => {
    want[m.ParkingType] = (want[m.ParkingType] || 0) + m.Count;
    order[m.ParkingType] = Math.min(order[m.ParkingType] ?? 1e9, m.SortOrder);
  });
  return Object.keys(want)
    .map((t) => ({ ParkingType: t, SortOrder: order[t], Missing: Math.max(0, want[t] - mockDb.slots.filter((s) => s.BlockId === blockId && s.IsActive && s.ParkingType === t).length) }))
    .sort((a, b) => a.SortOrder - b.SortOrder);
};

jest.mock("../db", () => {
  const request = (tx = null) => {
    const inputs = {};
    const r = {
      input: (name, _type, value) => { inputs[name] = value; return r; },
      query: async (q) => {
        if (q.includes("sp_getapplock")) {
          while (mockDb.locks.has(inputs.r)) await mockDb.locks.get(inputs.r).released;
          let release;
          const released = new Promise((ok) => { release = ok; });
          mockDb.locks.set(inputs.r, { released });
          tx.held.push(() => { mockDb.locks.delete(inputs.r); release(); });
          return { recordset: [] };
        }
        // Let another request run between statements, as a real server would.
        await new Promise((ok) => setImmediate(ok));
        if (q.includes("FROM dbo.enterprise")) return { recordset: [mockDb.project] };
        if (q.includes("SELECT b.Id AS BlockId, b.BlockName")) {
          return { recordset: mockDb.blocks.filter((b) => mockShortfall(b.Id).some((x) => x.Missing > 0)).map((b) => ({ BlockId: b.Id, BlockName: b.BlockName })) };
        }
        if (q.includes("ORDER BY t.SortOrder")) return { recordset: mockShortfall(inputs.bid) };
        if (q.includes("FROM dbo.ParkingSlot WITH (UPDLOCK")) {
          return { recordset: mockDb.slots.filter((s) => s.BlockId === inputs.bid && s.SlotNo === inputs.slot).map((s) => ({ Id: s.Id, IsActive: s.IsActive })) };
        }
        if (q.includes("INSERT INTO dbo.ParkingSlot")) {
          mockDb.slots.push({ Id: mockDb.slots.length + 100, ProjectId: inputs.pid, BlockId: inputs.bid, SlotNo: inputs.slot, ParkingType: inputs.type, IsActive: true });
          return { recordset: [], rowsAffected: [1] };
        }
        if (q.includes("UPDATE dbo.ParkingSlot SET IsActive = 1")) {
          const s = mockDb.slots.find((x) => x.Id === inputs.id);
          s.IsActive = true; s.ParkingType = inputs.type;
          return { recordset: [], rowsAffected: [1] };
        }
        throw new Error(`unexpected query: ${q.slice(0, 120)}`);
      },
    };
    return r;
  };
  const transaction = () => {
    const tx = { held: [] };
    const end = async () => { tx.held.splice(0).forEach((free) => free()); };
    return Object.assign(tx, { begin: async () => {}, commit: end, rollback: end, request: () => request(tx) });
  };
  return {
    sql: new Proxy({}, { get: () => (x) => x }),
    getPool: () => ({ request: () => request(), transaction }),
  };
});
jest.mock("../redis", () => ({ bumpCacheVersion: async () => {}, getRedis: () => null }));
jest.mock("../middleware/auth", () => (req, _res, next) => { req.user = { userId: 1, role: "super_admin" }; next(); });
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/requirePageRight", () => ({
  requirePageRight: () => (_req, _res, next) => next(),
  requireAnyPageRight: () => (_req, _res, next) => next(),
}));
jest.mock("../services/projectScope", () => ({
  ...jest.requireActual("../services/projectScope"),
  setupScopeGuard: () => {},
  assertProjectAllowed: async () => true,
}));
jest.mock("../services/projectShortCode", () => ({ isValidShortCode: () => true, ensureProjectShortCode: async () => "EMP" }));
jest.mock("../services/namingPattern", () => ({
  SCOPE: { PARKING: "Parking" },
  towerNumbers: async () => new Map(),
  resolvePattern: async () => "current",
  nameFor: (_p, _s, { shortCode, blockName, seq }) => `${shortCode}/${blockName}/P${seq}`,
}));

const app = express();
app.use(express.json());
app.use("/setup", require("../routes/crmProjectAutoSetup"));
const generate = () => request(app).post("/setup/generate-parking-slots").send({ ProjectId: 1 });

beforeEach(() => {
  mockDb.mix = [
    { BlockId: 10, ParkingType: "Covered", Count: 7, SortOrder: 1 },
    { BlockId: 10, ParkingType: "Open", Count: 5, SortOrder: 2 },
  ];
  // 7 Covered slots under an older naming pattern.
  mockDb.slots = Array.from({ length: 7 }, (_, i) => ({ Id: i + 1, ProjectId: 1, BlockId: 10, SlotNo: `EMP/CP${i + 1}`, ParkingType: "Covered", IsActive: true }));
});

test("creates only the 5 missing Open slots, not 12 — existing slots under an older name stay counted", async () => {
  const res = await generate();
  expect(res.status).toBe(201);
  expect(res.body.createdCount).toBe(5);
  const active = mockDb.slots.filter((s) => s.IsActive);
  expect(active.filter((s) => s.ParkingType === "Covered")).toHaveLength(7);
  expect(active.filter((s) => s.ParkingType === "Open").map((s) => s.SlotNo)).toEqual(["EMP/1/P1", "EMP/1/P2", "EMP/1/P3", "EMP/1/P4", "EMP/1/P5"]);
  expect(mockDb.slots.filter((s) => s.SlotNo.startsWith("EMP/CP"))).toHaveLength(7); // never renamed
});

test("a second run creates nothing", async () => {
  await generate();
  const res = await generate();
  expect(res.body.createdCount).toBe(0);
  expect(mockDb.slots.filter((s) => s.IsActive)).toHaveLength(12);
});

test("skips names a live slot already uses, and brings back a deactivated one", async () => {
  mockDb.slots.push({ Id: 50, ProjectId: 1, BlockId: 10, SlotNo: "EMP/1/P1", ParkingType: "Covered", IsActive: true });
  mockDb.slots.push({ Id: 51, ProjectId: 1, BlockId: 10, SlotNo: "EMP/1/P2", ParkingType: "Open", IsActive: false });
  mockDb.mix[0].Count = 8; // the 8th Covered is the live EMP/1/P1 — nothing more needed there
  const res = await generate();
  expect(res.body.createdCount).toBe(5);
  const open = mockDb.slots.filter((s) => s.IsActive && s.ParkingType === "Open").map((s) => s.SlotNo);
  expect(open).toEqual(["EMP/1/P2", "EMP/1/P3", "EMP/1/P4", "EMP/1/P5", "EMP/1/P6"]);
  expect(mockDb.slots.find((s) => s.Id === 51).IsActive).toBe(true); // reused, not duplicated
});

test("two Create clicks at the same moment still make only the 5 missing slots", async () => {
  const [a, b] = await Promise.all([generate(), generate()]);
  expect(a.body.createdCount + b.body.createdCount).toBe(5);
  expect(mockDb.slots.filter((s) => s.IsActive && s.ParkingType === "Open")).toHaveLength(5);
  expect(mockDb.slots.filter((s) => s.IsActive)).toHaveLength(12);
});
