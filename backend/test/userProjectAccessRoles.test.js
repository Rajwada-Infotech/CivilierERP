process.env.NODE_ENV = "test";

const mockDb = { calls: [], tx: { begun: 0, committed: 0, rolledBack: 0 }, roleRows: [], userRows: [], userRole: null, failInsert: false, roleTableMissing: false };

jest.mock("../db", () => {
  const mssql = require("mssql");
  const makeRequest = () => {
    const inputs = {};
    const req = {
      input: (k, _t, v) => ((inputs[k] = v), req),
      query: async (text) => {
        mockDb.calls.push({ text, inputs: { ...inputs } });
        if (/INSERT INTO/.test(text) && mockDb.failInsert) throw new Error("boom");
        if (/FROM dbo\.RoleProjectAccess/.test(text)) {
          if (mockDb.roleTableMissing) { const e = new Error("Invalid object name"); e.number = 208; throw e; }
          return { recordset: mockDb.roleRows };
        }
        if (/FROM dbo\.UserProjectAccess/.test(text)) return { recordset: mockDb.userRows };
        if (/FROM dbo\.users u/.test(text)) return { recordset: mockDb.userRole ? [mockDb.userRole] : [] };
        return { recordset: [], rowsAffected: [1] };
      },
    };
    return req;
  };
  class FakeTx {
    async begin() { mockDb.tx.begun += 1; }
    async commit() { mockDb.tx.committed += 1; }
    async rollback() { mockDb.tx.rolledBack += 1; }
  }
  class FakeRequest {
    constructor() { return makeRequest(); }
  }
  return { getPool: () => ({ request: makeRequest }), sql: { ...mssql, Transaction: FakeTx, Request: FakeRequest } };
});
jest.mock("../middleware/auth", () => (_req, _res, next) => next());
jest.mock("../services/projectScope", () => ({ invalidateProjectScope: jest.fn(), getProjectScope: jest.fn() }));

const express = require("express");
const request = require("supertest");
const { invalidateProjectScope } = require("../services/projectScope");
const router = require("../routes/userProjectAccess");

let role = "admin";
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { email: "a@x.com", role, userId: 1 };
  next();
});
app.use("/api/user-project-access", router);

const writes = () => mockDb.calls.filter((c) => /INSERT INTO|DELETE FROM/.test(c.text));

beforeEach(() => {
  jest.clearAllMocks();
  role = "admin";
  Object.assign(mockDb, { calls: [], tx: { begun: 0, committed: 0, rolledBack: 0 }, roleRows: [], userRows: [], userRole: null, failInsert: false, roleTableMissing: false });
});

describe("role project access", () => {
  it("GET /role/:id lists the role's projects", async () => {
    mockDb.roleRows = [{ ProjectId: 5 }, { ProjectId: 6 }];
    const res = await request(app).get("/api/user-project-access/role/7");
    expect(res.status).toBe(200);
    expect(res.body.projectIds).toEqual([5, 6]);
  });

  it("GET /role/:id reads as empty before migration 534", async () => {
    mockDb.roleTableMissing = true;
    const res = await request(app).get("/api/user-project-access/role/7");
    expect(res.status).toBe(200);
    expect(res.body.projectIds).toEqual([]);
  });

  it("PUT /role/:id replaces the list in one transaction and clears every cached scope", async () => {
    const res = await request(app).put("/api/user-project-access/role/7").send({ projectIds: [5, "6", 6, "x"] });
    expect(res.status).toBe(200);
    expect(res.body.projectIds).toEqual([5, 6]);
    expect(mockDb.tx).toEqual({ begun: 1, committed: 1, rolledBack: 0 });
    const w = writes();
    expect(w[0].text).toMatch(/DELETE FROM dbo\.RoleProjectAccess WHERE RoleId = @k/);
    expect(w.filter((c) => /INSERT INTO dbo\.RoleProjectAccess/.test(c.text)).map((c) => c.inputs.pid)).toEqual([5, 6]);
    expect(w.every((c) => c.inputs.k === 7)).toBe(true);
    expect(invalidateProjectScope).toHaveBeenCalledWith(); // no argument = clear all
  });

  it("an empty list removes the role's restriction", async () => {
    const res = await request(app).put("/api/user-project-access/role/7").send({ projectIds: [] });
    expect(res.status).toBe(200);
    expect(writes()).toHaveLength(1); // just the DELETE
  });

  it("rolls back if saving fails, and does not clear caches", async () => {
    mockDb.failInsert = true;
    const res = await request(app).put("/api/user-project-access/role/7").send({ projectIds: [5] });
    expect(res.status).toBe(500);
    expect(mockDb.tx).toEqual({ begun: 1, committed: 0, rolledBack: 1 });
    expect(invalidateProjectScope).not.toHaveBeenCalled();
  });

  it("rejects a bad role id or body", async () => {
    expect((await request(app).put("/api/user-project-access/role/abc").send({ projectIds: [] })).status).toBe(400);
    expect((await request(app).put("/api/user-project-access/role/7").send({ projectIds: "5" })).status).toBe(400);
    expect(mockDb.tx.begun).toBe(0);
  });

  it("only admins can read or change a role's list", async () => {
    role = "engineer";
    expect((await request(app).get("/api/user-project-access/role/7")).status).toBe(403);
    expect((await request(app).put("/api/user-project-access/role/7").send({ projectIds: [1] })).status).toBe(403);
    expect(mockDb.tx.begun).toBe(0);
  });
});

describe("user project access", () => {
  it("GET /:userId returns the user's own list and the role list they fall back to", async () => {
    mockDb.userRows = [];
    mockDb.userRole = { roleId: 7, roleName: "Site Engineer" };
    mockDb.roleRows = [{ ProjectId: 5 }];
    const res = await request(app).get("/api/user-project-access/42");
    expect(res.body).toEqual({ projectIds: [], roleId: 7, roleName: "Site Engineer", roleProjectIds: [5] });
  });

  it("PUT /:userId still replaces only that user's list and clears only their cache", async () => {
    const res = await request(app).put("/api/user-project-access/42").send({ projectIds: [9] });
    expect(res.status).toBe(200);
    expect(writes()[0].text).toMatch(/DELETE FROM dbo\.UserProjectAccess WHERE UserId = @k/);
    expect(invalidateProjectScope).toHaveBeenCalledWith(42);
  });

  it("the role route is not mistaken for a user id", async () => {
    mockDb.roleRows = [{ ProjectId: 1 }];
    const res = await request(app).get("/api/user-project-access/role/7");
    expect(res.body).toEqual({ projectIds: [1] }); // role shape, not the user shape
  });
});
