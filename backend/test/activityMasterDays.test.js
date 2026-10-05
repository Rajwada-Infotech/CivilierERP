process.env.NODE_ENV = "test";

jest.mock("../db", () => ({ getPool: jest.fn(), sql: require("mssql") }));
jest.mock("../redis", () => ({ bumpCacheVersion: jest.fn(async () => {}) }));
jest.mock("../middleware/cache", () => ({ cache: () => (_req, _res, next) => next() }));

const express = require("express");
const request = require("supertest");
const { getPool } = require("../db");

// A pool that records each query and its bound parameters.
function fakePool({ rowsAffected = 1 } = {}) {
  const calls = [];
  getPool.mockReturnValue({
    request: () => {
      const inputs = {};
      const req = {
        input: (k, _t, v) => ((inputs[k] = v), req),
        query: async (text) => {
          calls.push({ text, inputs });
          return { recordset: [{ id: 42 }], rowsAffected: [rowsAffected] };
        },
      };
      return req;
    },
  });
  return calls;
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { role: "admin", email: "a@x.com" };
  next();
});
app.use("/api/activity-master", require("../routes/activityMaster"));

const activity = { activity_name: "Hacking", activity_type: 1, group_id: 3 };
const group = { activity_name: "Civil", activity_type: 0 };

describe("Activity Master: days_of_completion", () => {
  beforeEach(() => jest.clearAllMocks());

  it("saves the days on an Activity", async () => {
    const calls = fakePool();
    const res = await request(app).post("/api/activity-master").send({ ...activity, days_of_completion: 7 });
    expect(res.status).toBe(201);
    expect(calls[0].text).toMatch(/days_of_completion/);
    expect(calls[0].inputs.days_of_completion).toBe(7);
  });

  it("accepts the number as text, as a form sends it", async () => {
    const calls = fakePool();
    await request(app).post("/api/activity-master").send({ ...activity, days_of_completion: "12" });
    expect(calls[0].inputs.days_of_completion).toBe(12);
  });

  it("leaves it NULL when blank or omitted", async () => {
    for (const v of ["", null, undefined]) {
      const calls = fakePool();
      const res = await request(app).post("/api/activity-master").send({ ...activity, days_of_completion: v });
      expect(res.status).toBe(201);
      expect(calls[0].inputs.days_of_completion).toBeNull();
    }
  });

  it("is only for Activities: a Group's days are dropped, not stored", async () => {
    const calls = fakePool();
    const res = await request(app).post("/api/activity-master").send({ ...group, days_of_completion: 9 });
    expect(res.status).toBe(201);
    expect(calls[0].inputs.days_of_completion).toBeNull();
  });

  it.each([0, -3, 2.5, "abc", 3651, "7 days"])("rejects %p with a 400 and writes nothing", async (bad) => {
    const calls = fakePool();
    const res = await request(app).post("/api/activity-master").send({ ...activity, days_of_completion: bad });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/whole number of days between 1 and 3650/);
    expect(calls).toHaveLength(0);
  });

  it("accepts the 1 and 3650 limits", async () => {
    for (const v of [1, 3650]) {
      fakePool();
      const res = await request(app).post("/api/activity-master").send({ ...activity, days_of_completion: v });
      expect(res.status).toBe(201);
    }
  });

  it("update writes it, can clear it, and validates it too", async () => {
    let calls = fakePool();
    let res = await request(app).put("/api/activity-master/5").send({ ...activity, days_of_completion: 14 });
    expect(res.status).toBe(200);
    expect(calls[0].text).toMatch(/days_of_completion\s*=\s*@days_of_completion/);
    expect(calls[0].inputs.days_of_completion).toBe(14);

    calls = fakePool();
    res = await request(app).put("/api/activity-master/5").send({ ...activity, days_of_completion: "" });
    expect(res.status).toBe(200);
    expect(calls[0].inputs.days_of_completion).toBeNull();

    calls = fakePool();
    res = await request(app).put("/api/activity-master/5").send({ ...activity, days_of_completion: 0 });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("changing an Activity into a Group clears its days", async () => {
    const calls = fakePool();
    await request(app).put("/api/activity-master/5").send({ ...group, days_of_completion: 10 });
    expect(calls[0].inputs.days_of_completion).toBeNull();
  });

  it("lists and fetches the field", async () => {
    const calls = fakePool();
    await request(app).get("/api/activity-master");
    await request(app).get("/api/activity-master/5");
    expect(calls[0].text).toMatch(/am\.days_of_completion/);
    expect(calls[1].text).toMatch(/am\.days_of_completion/);
  });
});
