process.env.NODE_ENV = "test";

/**
 * Civil Work DPR activity comments: who may use the thread, validation, send
 * idempotency, and cursor paging. The DB pool and socket server are faked.
 */

const express = require("express");
const request = require("supertest");

const mockEmit = jest.fn();
let mockInsertError = null;
let mockRows = [];

jest.mock("../socket", () => ({
  getIo: () => ({
    to: () => ({ emit: mockEmit }),
    in: () => ({ emit: jest.fn(), socketsLeave: jest.fn() }),
  }),
}));

jest.mock("../middleware/auth", () => (req, _res, next) => {
  req.user = JSON.parse(req.headers["x-user"] || "null");
  next();
});

jest.mock("../db", () => {
  const sql = require("mssql");
  const run = async (text, inputs) => {
    if (text.includes("FROM dbo.DependencyActivityAssignment daa")) {
      return { recordset: [{ assignmentId: 1, levelsJson: JSON.stringify([{ id: "l1", userIds: [7] }]) }] };
    }
    if (text.includes("FROM dbo.DependencyActivityEngineer")) return { recordset: [{ EngineerId: 5 }] };
    if (text.includes("INSERT INTO dbo.ActivityComment")) {
      if (mockInsertError) throw mockInsertError;
      return {
        recordset: [{
          id: "101", rungId: inputs.rungId, authorUserId: inputs.uid, authorName: inputs.name,
          body: inputs.body, clientId: inputs.cid, createdAt: new Date("2026-10-02T10:00:00Z"),
        }],
      };
    }
    if (text.includes("FROM dbo.ActivityComment c")) return { recordset: mockRows };
    return { recordset: [] };
  };
  const pool = {
    request: () => {
      const inputs = {};
      const req = { input(name, _t, v) { inputs[name] = v === undefined ? _t : v; return req; }, query: (t) => run(t, inputs) };
      return req;
    },
  };
  return { getPool: () => pool, sql };
});

const router = require("../routes/activityComments");
const authWall = require("../middleware/auth"); // mocked: sets req.user, like the /api auth wall in server.js
const app = express().use(express.json()).use(authWall).use("/api/activity-comments", router);
const as = (user) => JSON.stringify(user);

const engineer = { userId: 5, name: "Engineer Five", role: "user" };
const approver = { userId: 7, name: "Approver Seven", role: "user" };
const outsider = { userId: 99, name: "Outsider", role: "user" };
const superAdmin = { userId: 1, name: "Boss", role: "super_admin" };

beforeEach(() => {
  mockEmit.mockClear();
  mockInsertError = null;
  mockRows = [];
});

describe("thread access", () => {
  test("an unrelated user is refused (read and write)", async () => {
    const get = await request(app).get("/api/activity-comments/10").set("x-user", as(outsider));
    expect(get.status).toBe(403);
    const post = await request(app).post("/api/activity-comments/10").set("x-user", as(outsider)).send({ body: "hi" });
    expect(post.status).toBe(403);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  test("the allocated engineer, a named approver and super_admin are allowed", async () => {
    for (const u of [engineer, approver, superAdmin]) {
      const r = await request(app).get("/api/activity-comments/11").set("x-user", as(u));
      expect(r.status).toBe(200);
    }
  });
});

describe("sending", () => {
  test("rejects an empty message and an over-long one", async () => {
    const empty = await request(app).post("/api/activity-comments/12").set("x-user", as(engineer)).send({ body: "   " });
    expect(empty.status).toBe(400);
    const long = await request(app).post("/api/activity-comments/12").set("x-user", as(engineer)).send({ body: "x".repeat(2001) });
    expect(long.status).toBe(400);
  });

  test("saves, returns the stored message with a numeric id, and broadcasts it once", async () => {
    const r = await request(app).post("/api/activity-comments/13").set("x-user", as(engineer)).send({ body: "  slab poured  ", clientId: "abc" });
    expect(r.status).toBe(201);
    expect(r.body.message).toMatchObject({ id: 101, body: "slab poured", authorUserId: 5, clientId: "abc" });
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith("activity-comment:new", expect.objectContaining({ rungId: 13 }));
  });

  test("a retried send with the same clientId returns the existing message and does not re-broadcast", async () => {
    const dup = Object.assign(new Error("duplicate"), { number: 2601 });
    mockInsertError = dup;
    mockRows = [{ id: "55", rungId: 14, authorUserId: 5, authorName: "Engineer Five", body: "once", clientId: "same", createdAt: new Date() }];
    const r = await request(app).post("/api/activity-comments/14").set("x-user", as(engineer)).send({ body: "once", clientId: "same" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ duplicate: true, message: { id: 55 } });
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("reading", () => {
  const row = (id) => ({ id: String(id), rungId: 15, authorUserId: 5, authorName: "E", body: `m${id}`, clientId: null, createdAt: new Date() });

  test("returns newest page oldest-first and says when there is more", async () => {
    // limit=2 -> server asks for 3 (newest-first); 3 rows back means "more exists"
    mockRows = [row(30), row(29), row(28)];
    const r = await request(app).get("/api/activity-comments/15?limit=2").set("x-user", as(engineer));
    expect(r.body.hasMore).toBe(true);
    expect(r.body.messages.map((m) => m.id)).toEqual([29, 30]);
  });

  test("afterId catch-up returns ascending and no hasMore when it fits", async () => {
    mockRows = [row(31), row(32)];
    const r = await request(app).get("/api/activity-comments/15?afterId=30").set("x-user", as(engineer));
    expect(r.body.messages.map((m) => m.id)).toEqual([31, 32]);
    expect(r.body.hasMore).toBe(false);
  });
});
