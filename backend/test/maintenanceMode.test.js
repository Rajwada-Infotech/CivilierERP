process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";

/**
 * Maintenance mode: while it is on only a super admin gets past the gate, the status check stays open, and only a
 * super admin can switch it. The database is faked.
 */

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

let mockRow = null; // the dbo.SystemMaintenance row, or null when the table is missing
let mockWrites = [];
jest.mock("../middleware/auth", () => (req, res, next) => {
  const h = req.headers.authorization || "";
  try {
    req.user = require("jsonwebtoken").verify(h.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "No token provided" });
  }
});
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request: () => {
      const inputs = {};
      const r = {
        input: (name, _type, value) => {
          inputs[name] = value;
          return r;
        },
        query: async (text) => {
          if (mockRow === null) throw Object.assign(new Error("Invalid object name 'dbo.SystemMaintenance'."), { number: 208 });
          if (/^\s*UPDATE/i.test(text)) {
            mockWrites.push(inputs);
            mockRow = {
              IsActive: !!inputs.active,
              Title: inputs.title,
              Message: inputs.message,
              StartedAt: new Date("2026-10-08T10:00:00Z"),
              StartsAt: inputs.startsAt,
              EndsAt: inputs.endsAt,
              UpdatedBy: inputs.by,
            };
            return { recordset: [] };
          }
          return { recordset: [mockRow] };
        },
      };
      return r;
    },
  }),
}));

const { maintenanceGate } = require("../middleware/maintenanceGate");
const { resetMaintenanceCache } = require("../services/maintenanceMode");
const systemMaintenance = require("../routes/systemMaintenance");

const app = express();
app.use(express.json());
app.use("/api", maintenanceGate);
app.use("/api/system-maintenance", systemMaintenance);
app.get("/api/app-version", (_req, res) => res.json({ ok: true }));
app.post("/api/users/login", (_req, res) => res.json({ reached: "login" }));
app.get("/api/things", (_req, res) => res.json({ reached: "things" }));

const token = (role) => jwt.sign({ userId: 1, role, name: "Tester" }, process.env.JWT_SECRET);
const bearer = (role) => ({ Authorization: `Bearer ${token(role)}` });
const ends = () => new Date(Date.now() + 2 * 3600 * 1000).toISOString();

beforeEach(() => {
  mockRow = { IsActive: false };
  mockWrites = [];
  resetMaintenanceCache();
});

describe("while maintenance is off", () => {
  test("everything is reachable", async () => {
    expect((await request(app).get("/api/things")).status).toBe(200);
    expect((await request(app).get("/api/things").set(bearer("user"))).status).toBe(200);
  });
});

describe("while maintenance is on", () => {
  beforeEach(() => {
    mockRow = { IsActive: true, Title: "Upgrade", Message: "Back soon", StartedAt: new Date("2026-10-08T10:00:00Z"), EndsAt: new Date("2026-10-08T12:00:00Z") };
  });

  test("a signed-in ordinary user, an admin and a caller with no token get 503 with the message and end time", async () => {
    for (const headers of [bearer("user"), bearer("admin"), bearer("finance_manager"), {}]) {
      const res = await request(app).get("/api/things").set(headers);
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: "MAINTENANCE", title: "Upgrade", message: "Back soon", endsAt: "2026-10-08T12:00:00.000Z" });
      expect(res.headers["retry-after"]).toBeDefined();
    }
  });

  test("a super admin carries on as normal", async () => {
    expect((await request(app).get("/api/things").set(bearer("super_admin"))).status).toBe(200);
  });

  test("a forged or expired token is just another blocked caller", async () => {
    const forged = jwt.sign({ role: "super_admin" }, "someone-elses-secret");
    expect((await request(app).get("/api/things").set({ Authorization: `Bearer ${forged}` })).status).toBe(503);
  });

  test("the status check, the public footers and the login route stay open", async () => {
    expect((await request(app).get("/api/system-maintenance/status")).status).toBe(200);
    expect((await request(app).get("/api/app-version")).status).toBe(200);
    expect((await request(app).post("/api/users/login").send({})).status).toBe(200);
  });

  test("the status check reports it, with no other detail", async () => {
    const res = await request(app).get("/api/system-maintenance/status");
    expect(res.body).toEqual({
      active: true,
      enforced: true,
      title: "Upgrade",
      message: "Back soon",
      startedAt: "2026-10-08T10:00:00.000Z",
      startsAt: null,
      endsAt: "2026-10-08T12:00:00.000Z",
      updatedBy: null,
    });
  });
});

describe("announced but not started yet", () => {
  const announce = (minutes) => {
    mockRow = { IsActive: true, Title: "Upgrade", Message: "Back soon", StartedAt: new Date(), StartsAt: new Date(Date.now() + minutes * 60000), EndsAt: null };
    resetMaintenanceCache();
  };

  test("everyone can still work, and the status says it is announced, not enforced", async () => {
    announce(5);
    expect((await request(app).get("/api/things").set(bearer("user"))).status).toBe(200);
    expect((await request(app).post("/api/users/login").send({})).status).toBe(200);
    const status = (await request(app).get("/api/system-maintenance/status")).body;
    expect(status).toMatchObject({ active: true, enforced: false, title: "Upgrade" });
    expect(status.startsAt).toEqual(expect.any(String));
  });

  test("once the start time has passed everyone but a super admin is held", async () => {
    announce(-1);
    expect((await request(app).get("/api/things").set(bearer("user"))).status).toBe(503);
    expect((await request(app).get("/api/things").set(bearer("super_admin"))).status).toBe(200);
    expect((await request(app).get("/api/system-maintenance/status")).body.enforced).toBe(true);
  });

  test("a super admin can announce it with minutes of warning, and 0 holds at once", async () => {
    const put = (body) => request(app).put("/api/system-maintenance").set(bearer("super_admin")).send(body);
    let res = await put({ active: true, startInMinutes: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ active: true, enforced: false });
    expect(Date.parse(res.body.startsAt) - Date.now()).toBeGreaterThan(4 * 60000);
    expect((await request(app).get("/api/things").set(bearer("user"))).status).toBe(200);

    res = await put({ active: true, startInMinutes: 0 });
    expect(res.body).toMatchObject({ enforced: true, startsAt: null });
    expect((await request(app).get("/api/things").set(bearer("user"))).status).toBe(503);
  });

  test("a bad warning, or an end before the start, is refused", async () => {
    const put = (body) => request(app).put("/api/system-maintenance").set(bearer("super_admin")).send(body);
    expect((await put({ active: true, startInMinutes: -1 })).status).toBe(400);
    expect((await put({ active: true, startInMinutes: 61 })).status).toBe(400);
    expect((await put({ active: true, startInMinutes: 2.5 })).status).toBe(400);
    const soon = new Date(Date.now() + 3 * 60000).toISOString();
    expect((await put({ active: true, startInMinutes: 10, endsAt: soon })).status).toBe(400);
  });
});

describe("before migration 548 (no table)", () => {
  test("nobody is locked out", async () => {
    mockRow = null;
    expect((await request(app).get("/api/things").set(bearer("user"))).status).toBe(200);
    expect((await request(app).get("/api/system-maintenance/status")).body.active).toBe(false);
  });

  test("switching it on says the migration is needed", async () => {
    mockRow = null;
    const res = await request(app).put("/api/system-maintenance").set(bearer("super_admin")).send({ active: true, endsAt: ends() });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/migration 548/);
  });
});

describe("PUT /api/system-maintenance", () => {
  test("only a super admin may change it", async () => {
    for (const role of ["admin", "dba", "user"]) {
      const res = await request(app).put("/api/system-maintenance").set(bearer(role)).send({ active: true });
      expect(res.status).toBe(403);
    }
    expect(mockWrites).toHaveLength(0);
    expect((await request(app).put("/api/system-maintenance").send({ active: true })).status).toBe(401);
  });

  test("switching on stores the message and the end, and the gate reacts straight away", async () => {
    const endsAt = ends();
    const res = await request(app).put("/api/system-maintenance").set(bearer("super_admin")).send({ active: true, title: " Upgrade ", message: " Back soon ", endsAt });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ active: true, title: "Upgrade", message: "Back soon", endsAt, updatedBy: "Tester" });
    expect((await request(app).get("/api/things").set(bearer("user"))).status).toBe(503);
    expect((await request(app).get("/api/things").set(bearer("super_admin"))).status).toBe(200);
  });

  test("switching off lets everyone back in and clears the message", async () => {
    await request(app).put("/api/system-maintenance").set(bearer("super_admin")).send({ active: true, message: "x", endsAt: ends() });
    const res = await request(app).put("/api/system-maintenance").set(bearer("super_admin")).send({ active: false, message: "ignored" });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
    expect(mockWrites[1]).toMatchObject({ active: 0, message: null, endsAt: null });
    expect((await request(app).get("/api/things").set(bearer("user"))).status).toBe(200);
  });

  test("an end in the past, a junk end, a far-off end and a non-boolean switch are refused", async () => {
    const put = (body) => request(app).put("/api/system-maintenance").set(bearer("super_admin")).send(body);
    expect((await put({ active: true, endsAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(400);
    expect((await put({ active: true, endsAt: "tomorrow-ish" })).status).toBe(400);
    expect((await put({ active: true, endsAt: new Date(Date.now() + 40 * 86400000).toISOString() })).status).toBe(400);
    expect((await put({ active: "yes" })).status).toBe(400);
    expect(mockWrites).toHaveLength(0);
  });

  test("an end time is optional", async () => {
    const res = await request(app).put("/api/system-maintenance").set(bearer("super_admin")).send({ active: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ active: true, endsAt: null });
  });
});
