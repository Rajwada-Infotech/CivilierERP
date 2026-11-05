process.env.NODE_ENV = "test";

/**
 * The Approval Inbox's Activity Approval panel reads GET /:rungId. It now also gets the company behind
 * Labour / Material Source (the project's developer company, or the named contractor) and the latest
 * Quality Check decision, so a reviewer sees names and QC status, not just "Developer".
 * The pool is faked; the SQL itself runs on the live server.
 */
const express = require("express");
const request = require("supertest");

let mockQc = null;
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
          if (/days_of_completion FROM dbo\.ActivityMaster/.test(text)) return { recordset: [{ days_of_completion: 5 }] };
          if (/Id AS assignmentId, StartDate AS startDate/.test(text)) {
            return {
              recordset: [{
                assignmentId: 9, startDate: "2026-10-06", days: 5, endDate: "2026-10-10",
                labourSource: "DEVELOPER", materialSource: "CONTRACTOR",
                labourContractorId: null, materialContractorId: 44,
                description: "d", remarks: "Use the new mix", approvalLevelsJson: null,
              }],
            };
          }
          if (/AS developerName/.test(text)) return { recordset: [{ developerName: "Rajwada Group" }] };
          if (/FROM dbo\.AccountHeadMaster WHERE LHeadId IN \(44\)/.test(text)) return { recordset: [{ id: 44, name: "Bengal Labour Supply Agency" }] };
          if (/FROM dbo\.DependencyActivityQc qc/.test(text)) return { recordset: mockQc ? [mockQc] : [] };
          if (/FROM dbo\.DependencyActivityQcCheck WHERE QcId = @qcId/.test(text)) {
            return {
              recordset: [
                { fieldName: "ALIGNMENT", passed: 1, rating: "EXCELLENT", note: null },
                { fieldName: "LABEL", passed: 0, rating: "POOR", note: "faded" },
              ],
            };
          }
          return { recordset: [], rowsAffected: [0] };
        },
      };
      return r;
    },
  }),
}));

const app = () => express().use(express.json()).use("/api/dependency-activity-assignment", require("../routes/dependencyActivityAssignment"));
const get = () => request(app()).get("/api/dependency-activity-assignment/55");

describe("GET /:rungId — names and QC status for the approval review", () => {
  it("names the developer company and the contractor behind each source", async () => {
    mockQc = null;
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.assignment.labourSource).toBe("DEVELOPER");
    expect(res.body.assignment.labourSourceName).toBe("Rajwada Group");
    expect(res.body.assignment.materialSource).toBe("CONTRACTOR");
    expect(res.body.assignment.materialSourceName).toBe("Bengal Labour Supply Agency");
  });

  it("carries the remarks alongside the materials", async () => {
    const res = await get();
    expect(res.body.assignment.remarks).toBe("Use the new mix");
  });

  it("QC status is null until a Quality Check decision exists, then the latest one", async () => {
    mockQc = null;
    expect((await get()).body.assignment.qcStatus).toBeNull();
    mockQc = { id: 7, decision: "REWORK", remarks: "redo", qcAt: "2026-10-06T10:00:00.000Z", qcBy: "QC Guy" };
    const res = await get();
    expect(res.body.assignment.qcStatus).toMatchObject({ decision: "REWORK", qcBy: "QC Guy" });
  });

  it("carries each checkpoint's rating (Poor / Good / Excellent) from that decision", async () => {
    mockQc = { id: 7, decision: "APPROVED", remarks: null, qcAt: "2026-10-06T10:00:00.000Z", qcBy: "QC Guy" };
    const res = await get();
    expect(res.body.assignment.qcStatus.checks).toEqual([
      { fieldName: "ALIGNMENT", passed: true, rating: "EXCELLENT", note: null },
      { fieldName: "LABEL", passed: false, rating: "POOR", note: "faded" },
    ]);
    expect(res.body.assignment.qcStatus.id).toBeUndefined(); // internal key stays server-side
  });
});
