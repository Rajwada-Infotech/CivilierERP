process.env.NODE_ENV = "test";

/**
 * My Work (routes/crmMyWork.js): only the queues the person may act on are
 * returned, in the order of the sale, each row linking to the page that does
 * the step, and a project-restricted user's queries carry their projects.
 * Rights come from Menu Rights / Approval Setup (mocked here), never a role list.
 */
const express = require("express");
const request = require("supertest");

jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/auth", () => (req, _res, next) => {
  req.user = { userId: 7, role: "crm_user" };
  req.projectScope = global.__scope ?? null;
  next();
});

const mockPageRights = new Set();
jest.mock("../middleware/requirePageRight", () => ({
  hasAnyPageAction: async (_req, pageKey, actions) => actions.some((a) => mockPageRights.has(`${pageKey}:${a}`)),
}));
const mockState = { verifier: false };
jest.mock("../services/approvalService", () => ({
  isApproverFor: async () => mockState.verifier,
}));
const mockApproverStages = new Set();
jest.mock("../services/crmBookingStageService", () => ({
  STAGE_REVIEW: "Review",
  STAGE_MARKETING: "MarketingHeadApproval",
  STAGE_DIRECTOR: "DirectorApproval",
  stageLabel: (s) => ({ Review: "Review", MarketingHeadApproval: "Marketing Head Approval", DirectorApproval: "Director Approval" })[s],
  canApproveStage: async (_role, stage) => mockApproverStages.has(stage),
}));

const mockQueries = [];
jest.mock("../db", () => ({
  getPool: () => ({
    request: () => ({
      query: async (q) => {
        mockQueries.push(q);
        if (/COUNT\(\*\)/.test(q)) return { recordset: [{ Cnt: 2 }] };
        return { recordset: [{ Id: 41, Ref: "BK-41", Name: "Asha", Since: "2026-10-01" }] };
      },
    }),
  }),
}));

const app = express();
app.use("/my-work", require("../routes/crmMyWork"));

beforeEach(() => {
  mockPageRights.clear();
  mockApproverStages.clear();
  mockState.verifier = false;
  mockQueries.length = 0;
  global.__scope = null;
});

test("a person with no rights gets no queues", async () => {
  const res = await request(app).get("/my-work");
  expect(res.status).toBe(200);
  expect(res.body.queues).toEqual([]);
  expect(mockQueries).toEqual([]);
});

test("only permitted queues, in the order of the sale, with links to their pages", async () => {
  mockPageRights.add("crm-welcome-calls:view");
  mockApproverStages.add("DirectorApproval");
  mockPageRights.add("crm-applications:edit");
  const res = await request(app).get("/my-work");
  expect(res.body.queues.map((q) => q.key)).toEqual(["applications-draft", "director-approval", "welcome-calls"]);
  const [apps, director, calls] = res.body.queues;
  expect(apps.rows[0].Link).toBe("/crm/applications?edit=41");
  expect(director.title).toBe("Director Approval");
  expect(director.count).toBe(2);
  expect(director.rows[0].Link).toBe("/crm/bookings?view=41");
  expect(calls.rows[0].Link).toBe("/crm/welcome-calls?bookingId=41");
});

test("the Data Review queue follows Approval Setup, not page rights", async () => {
  mockPageRights.add("crm-bookings:view");
  let res = await request(app).get("/my-work");
  expect(res.body.queues.map((q) => q.key)).toEqual([]);
  mockState.verifier = true;
  res = await request(app).get("/my-work");
  expect(res.body.queues.map((q) => q.key)).toEqual(["data-review"]);
});

test("a project-restricted user's queues are limited to their projects", async () => {
  global.__scope = [3, 9];
  mockPageRights.add("crm-agreements:view");
  mockPageRights.add("crm-applications:create");
  await request(app).get("/my-work");
  expect(mockQueries.length).toBe(4);
  expect(mockQueries.filter((q) => q.includes("b.ProjectId IN (3,9)")).length).toBe(2);
  expect(mockQueries.filter((q) => q.includes("a.ProjectId IN (3,9)")).length).toBe(2);
});

test("the menu badge counts only the queues the person may act on", async () => {
  mockPageRights.add("crm-welcome-calls:view");
  mockApproverStages.add("MarketingHeadApproval");
  const res = await request(app).get("/my-work/count");
  expect(res.body).toEqual({ count: 4 }); // 2 + 2
  expect(mockQueries.every((q) => /COUNT\(\*\)/.test(q))).toBe(true);
});
