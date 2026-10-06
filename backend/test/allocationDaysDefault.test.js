process.env.NODE_ENV = "test";

/**
 * Work Allocation pulls "Days" from the Activity Master's Days of Completion: GET /:rungId returns it
 * as `daysOfCompletion`, and a server without that column (migration 533) simply returns null.
 * The pool is faked; the SQL itself runs on the live server.
 */
const express = require("express");
const request = require("supertest");

let mockDays = 7;
let mockColumnMissing = false;
jest.mock("../middleware/auth", () => (req, _res, next) => { req.user = { userId: 3, email: "eng@x.in" }; next(); });
jest.mock("../middleware/requirePageRight", () => ({
  requirePageRight: () => (_req, _res, next) => next(),
  requireAnyPageRight: () => (_req, _res, next) => next(),
}));
jest.mock("../services/activityThread", () => ({ invalidateThread: jest.fn() }));
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request: () => {
      const r = {
        input() { return r; },
        query: async (text) => {
          if (/FROM dbo\.DependencyMasterActivity dma WHERE dma\.Id = @rungId/.test(text)) return { recordset: [{ Id: 55, ActivityId: 12 }] };
          if (/days_of_completion FROM dbo\.ActivityMaster/.test(text)) {
            if (mockColumnMissing) throw new Error("Invalid column name 'days_of_completion'.");
            return { recordset: [{ days_of_completion: mockDays }] };
          }
          return { recordset: [], rowsAffected: [0] };
        },
      };
      return r;
    },
  }),
}));

const app = () => express().use(express.json()).use("/api/dependency-activity-assignment", require("../routes/dependencyActivityAssignment"));

describe("GET /:rungId — Days default from the Activity Master", () => {
  it("returns the activity's Days of Completion", async () => {
    mockDays = 7; mockColumnMissing = false;
    const res = await request(app()).get("/api/dependency-activity-assignment/55");
    expect(res.status).toBe(200);
    expect(res.body.daysOfCompletion).toBe(7);
    expect(res.body.activityId).toBe(12);
  });

  it("returns null when the activity has none set", async () => {
    mockDays = null; mockColumnMissing = false;
    const res = await request(app()).get("/api/dependency-activity-assignment/55");
    expect(res.body.daysOfCompletion).toBeNull();
  });

  it("still works on a server without the column", async () => {
    mockColumnMissing = true;
    const res = await request(app()).get("/api/dependency-activity-assignment/55");
    expect(res.status).toBe(200);
    expect(res.body.daysOfCompletion).toBeNull();
  });
});
