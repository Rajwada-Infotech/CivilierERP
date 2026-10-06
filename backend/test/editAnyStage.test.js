process.env.NODE_ENV = "test";

/**
 * Fund Transfer and Journal Voucher can be edited at any stage:
 *   Draft → stays Draft · Rejected → re-submitted · Pending → stays Pending (approval restarts)
 *   Approved → needs the post-approval right; GL posting reversed, back to Pending, amendment logged.
 * The pool and the approval engine are faked; the SQL itself runs on the live server.
 */
const express = require("express");
const request = require("supertest");

let mockStatus = "Draft";
let mockAllowPostApproval = true;
let mockCalls = [];
let mockQueries = [];

jest.mock("../middleware/auth", () => (req, _res, next) => { req.user = { userId: 3, email: "fin@x.in", name: "Fin", role: "admin" }; next(); });
jest.mock("../middleware/requirePageRight", () => ({
  requirePageRight: () => (_req, _res, next) => next(),
  requireAnyPageRight: () => (_req, _res, next) => next(),
}));
jest.mock("../middleware/permissions", () => ({
  resolveAllowPostApproval: async () => mockAllowPostApproval,
  checkPermission: () => (_req, _res, next) => next(),
  userPermissionCache: { invalidate: () => {} },
  permissionCache: { invalidateAll: () => {}, invalidateRole: () => {} },
}));
jest.mock("../redis", () => ({
  bumpCacheVersion: jest.fn().mockResolvedValue(),
  getCacheVersion: jest.fn().mockResolvedValue(1),
  getRedis: () => null,
  redisGet: jest.fn(), redisSet: jest.fn(), redisDel: jest.fn(), invalidateUserSession: jest.fn(),
}));
jest.mock("../services/approvalService", () => ({
  guardEditAnyStage: async (_m, _id, { allowPostApproval } = {}) => {
    if (mockStatus === "Approved" && !allowPostApproval) throw new Error("Cannot edit an approved record.");
    return mockStatus;
  },
  guardEdit: async () => {},
  getRecordStatus: async () => mockStatus,
  restartApprovalCycle: async (...a) => { mockCalls.push(["restartApprovalCycle", a[0], a[1]]); },
  transition: async (...a) => { mockCalls.push(["transition", a[0], a[2]]); return { newStatus: a[2] }; },
}));
jest.mock("../services/amendmentLog", () => ({
  snapshotRow: async () => ({ DocNo: "FT-1", JVNo: "JV-1", SourceCompanyId: 1, Status: "Approved", Amount: 100 }),
  recordAmendment: async (a) => { mockCalls.push(["recordAmendment", a.refDocType, a.refDocId]); return 5; },
}));
jest.mock("../services/generalLedger", () => ({
  postFundTransferApproval: jest.fn(), hasPosting: jest.fn(),
  reversePostingBySource: async (_p, type, id) => { mockCalls.push(["reversePostingBySource", type, id]); },
  postJournalVoucherApproval: jest.fn(),
}));
jest.mock("../db", () => {
  const mkReq = () => {
    const r = {
      inputs: {},
      input(name, _t, v) { r.inputs[name] = v; return r; },
      query: async (text) => {
        mockQueries.push({ text, inputs: { ...r.inputs } });
        if (/UPDATE dbo\.(FundTransfer|JournalVoucher)\b/.test(text) && !/Narration=@Narration, UpdatedBy/.test(text)) return { rowsAffected: [1], recordset: [] };
        if (/FROM dbo\.CrmRebookingTransfer/.test(text)) return { recordset: [] };
        if (/FROM dbo\.enterprise/.test(text)) return { recordset: [{ name: "ACME" }] };
        if (/FROM dbo\.NewPayment/.test(text)) return { recordset: [{ cnt: 0 }] };
        return { recordset: [], rowsAffected: [1] };
      },
    };
    return r;
  };
  const pool = { request: mkReq, transaction: () => ({ begin: async () => {}, commit: async () => {}, rollback: async () => {}, request: mkReq }) };
  return { sql: require("mssql"), getPool: () => pool };
});
jest.mock("../utils/docNumberLock", () => ({ resolveDocTypeId: jest.fn(), lockNextDocNumber: jest.fn(), backPatchRecordId: jest.fn() }));

const ftBody = {
  TransferDate: "2026-10-05", TransferType: "Intra", SourceCompanyId: 1, DestinationCompanyId: 1,
  SourceBankId: 10, DestinationBankId: 11, Amount: 500, Narration: "x", Mode: "NEFT", DigitalRefNumber: "R1",
};

beforeEach(() => { mockStatus = "Draft"; mockAllowPostApproval = true; mockCalls = []; mockQueries = []; });

describe("PUT /api/fund-transfer/:id — edit at any stage", () => {
  const app = () => express().use(express.json()).use("/api/fund-transfer", require("../routes/fundTransfer"));
  const put = () => request(app()).put("/api/fund-transfer/9").send(ftBody);
  const updateSql = () => mockQueries.find((q) => /UPDATE dbo\.FundTransfer SET/.test(q.text));

  it("Pending: stays Pending, and the approval cycle restarts", async () => {
    mockStatus = "Pending";
    const res = await put();
    expect(res.status).toBe(200);
    expect(updateSql().text).not.toMatch(/Status='Pending'/);
    expect(updateSql().inputs.status).toBe("Pending");
    expect(mockCalls).toContainEqual(["restartApprovalCycle", "fund-transfer", 9]);
    expect(mockCalls.find((c) => c[0] === "reversePostingBySource")).toBeUndefined();
    expect(res.body.message).toMatch(/still pending approval/);
  });

  it("Approved: needs the post-approval right", async () => {
    mockStatus = "Approved";
    mockAllowPostApproval = false;
    const res = await put();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cannot edit an approved record/);
    expect(updateSql()).toBeUndefined();
  });

  it("Approved with the right: GL posting reversed, back to Pending, amendment logged", async () => {
    mockStatus = "Approved";
    const res = await put();
    expect(res.status).toBe(200);
    expect(updateSql().text).toMatch(/Status='Pending'/);
    expect(updateSql().text).toMatch(/WHERE FTId=@id AND Status=@status/);
    expect(mockCalls).toContainEqual(["reversePostingBySource", "FundTransfer", 9]);
    expect(mockCalls).toContainEqual(["recordAmendment", "fund-transfer", 9]);
    expect(res.body.reopenedForApproval).toBe(true);
  });

  it("Rejected: saved then re-submitted; Draft: saved as is", async () => {
    mockStatus = "Rejected";
    const rej = await put();
    expect(rej.body.resubmitted).toBe(true);
    expect(mockCalls).toContainEqual(["transition", "fund-transfer", "Pending"]);
    mockCalls = [];
    mockStatus = "Draft";
    const draft = await put();
    expect(draft.status).toBe(200);
    expect(mockCalls).toEqual([]);
  });

  it("validation still applies (same bank both sides)", async () => {
    const res = await request(app()).put("/api/fund-transfer/9").send({ ...ftBody, DestinationBankId: 10 });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/journal-voucher/:id — Pending can be edited too", () => {
  const app = () => express().use(express.json()).use("/api/journal-voucher", require("../routes/journalVoucher"));
  const jv = {
    JVDate: "2026-10-05", Narration: "n", CompanyId: 1, ProjectId: null, Mode: "Cash",
    lines: [
      { LHeadId: 1, DebitAmount: 100, CreditAmount: 0 },
      { LHeadId: 2, DebitAmount: 0, CreditAmount: 100 },
    ],
  };

  it("Pending: edit allowed, stays Pending, approval restarts", async () => {
    mockStatus = "Pending";
    const res = await request(app()).put("/api/journal-voucher/4").send(jv);
    expect(res.status).toBe(200);
    expect(mockCalls).toContainEqual(["restartApprovalCycle", "journal-voucher", 4]);
    expect(mockQueries.find((q) => /UPDATE dbo\.JournalVoucher\s+SET/.test(q.text)).text).not.toMatch(/Status='Pending'/);
    expect(res.body.message).toMatch(/still pending approval/);
  });

  it("Approved: reversed, reopened, amendment logged", async () => {
    mockStatus = "Approved";
    const res = await request(app()).put("/api/journal-voucher/4").send(jv);
    expect(res.status).toBe(200);
    expect(mockCalls).toContainEqual(["reversePostingBySource", "JournalVoucher", 4]);
    expect(mockCalls).toContainEqual(["recordAmendment", "journal-voucher", 4]);
    expect(res.body.reopenedForApproval).toBe(true);
  });
});
