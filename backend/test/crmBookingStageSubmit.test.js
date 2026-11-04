process.env.NODE_ENV = "test";

jest.mock("../db", () => {
  const sql = {
    Int: "Int",
    NVarChar: () => "NVarChar",
    DateTime2: "DateTime2",
    MAX: "MAX",
  };
  return { sql, getPool: () => ({}) };
});

jest.mock("../services/crmApplicationChecklist", () => ({
  ensureChecklistRows: jest.fn(),
}));

const { ensureChecklistRows } = require("../services/crmApplicationChecklist");
const {
  submitForApproval, rejectStageRequest, sendBackTargetsSql, SEND_BACK_TARGETS,
  STAGE_REVIEW, STAGE_MARKETING, STAGE_DIRECTOR, STAGE_CONFIRMED,
} = require("../services/crmBookingStageService");

describe("crmBookingStageService.submitForApproval", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createMockPool({
    bookingRow = {
      Id: 10,
      BookingNo: "BKG-2026-00010",
      Status: "Pending",
      IsActive: true,
      WorkflowStage: "Review",
      ApplicationId: 100,
    },
    totalValue = 5000000,
    // What the booking / checklist look like under the send's lock (by then a
    // double click may have sent it, or an item may have been flagged).
    lockedStage = "Review",
    openUnderLock = 0,
  } = {}) {
    const mockTx = {
      begin: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      request: () => {
        const req = {
          input: () => req,
          query: jest.fn().mockImplementation(async (q) => {
            if (q.includes("WITH (UPDLOCK, HOLDLOCK) WHERE Id = @bid")) return { recordset: [{ WorkflowStage: lockedStage, Status: "Pending", IsActive: true }] };
            if (q.includes("CrmApplicationVerificationChecklist WITH (UPDLOCK, HOLDLOCK)")) return { recordset: [{ N: openUnderLock }] };
            return { recordset: [] };
          }),
        };
        return req;
      },
    };

    const mockPool = {
      transaction: () => mockTx,
      request: () => {
        const req = {
          input: () => req,
          query: jest.fn().mockImplementation(async (queryStr) => {
            if (queryStr.includes("SELECT Id, BookingNo, Status, IsActive, WorkflowStage")) {
              return { recordset: bookingRow ? [bookingRow] : [] };
            }
            if (queryStr.includes("SELECT b.Status, b.TotalValue")) {
              return { recordset: [{ Status: bookingRow.Status, TotalValue: totalValue }] };
            }
            if (queryStr.includes("INSERT INTO dbo.CrmBookingStageLog")) {
              return { recordset: [] };
            }
            return { recordset: [] };
          }),
        };
        return req;
      },
    };

    return { mockPool, mockTx };
  }

  it("submits booking for approval when checklist is checked and total value > 0, without requiring milestone 1 to be prepaid", async () => {
    const { mockPool, mockTx } = createMockPool();
    ensureChecklistRows.mockResolvedValue([
      { ItemKey: "ApplicantKyc", CheckStatus: "Checked" },
      { ItemKey: "ProjectUnitRate", CheckStatus: "Checked" },
    ]);

    const res = await submitForApproval(mockPool, 10, "staff@example.com", "staff", 42);

    expect(res.ok).toBe(true);
    expect(res.stage).toBe(STAGE_MARKETING);
    expect(mockTx.begin).toHaveBeenCalled();
    expect(mockTx.commit).toHaveBeenCalled();
  });

  it("blocks submission if checklist has unchecked items", async () => {
    const { mockPool } = createMockPool();
    ensureChecklistRows.mockResolvedValue([
      { ItemKey: "ApplicantKyc", CheckStatus: "Checked" },
      { ItemKey: "ProjectUnitRate", CheckStatus: "Pending" },
    ]);

    await expect(submitForApproval(mockPool, 10, "staff@example.com", "staff", 42))
      .rejects.toThrow(/Complete the data review checklist first/);
  });

  it("a second send (double click) finds it already sent and changes nothing", async () => {
    const { mockPool, mockTx } = createMockPool({ lockedStage: "MarketingHeadApproval" });
    ensureChecklistRows.mockResolvedValue([{ ItemKey: "ApplicantKyc", CheckStatus: "Checked" }]);
    await expect(submitForApproval(mockPool, 10, "staff@example.com", "staff", 42)).rejects.toThrow(/already been sent/);
    expect(mockTx.rollback).toHaveBeenCalled();
    expect(mockTx.commit).not.toHaveBeenCalled();
  });

  it("an item flagged while it was being sent still stops it", async () => {
    const { mockPool, mockTx } = createMockPool({ openUnderLock: 1 });
    ensureChecklistRows.mockResolvedValue([{ ItemKey: "ApplicantKyc", CheckStatus: "Checked" }]);
    await expect(submitForApproval(mockPool, 10, "staff@example.com", "staff", 42)).rejects.toThrow(/1 item\(s\) still not checked/);
    expect(mockTx.commit).not.toHaveBeenCalled();
  });

  it("a leftover row for an item that no longer applies does not stop the send", async () => {
    // The page shows 7 of 7; an 8th row (e.g. parking since removed) is still Pending.
    let lockedQuery = null;
    const { mockPool, mockTx } = createMockPool();
    const req0 = mockTx.request;
    mockTx.request = () => {
      const r = req0();
      const q = r.query;
      r.query = jest.fn(async (s) => {
        if (s.includes("CrmApplicationVerificationChecklist WITH (UPDLOCK, HOLDLOCK)")) {
          lockedQuery = s;
          return { recordset: [{ N: s.includes("ItemKey IN (@k0, @k1)") ? 0 : 1 }] };
        }
        return q(s);
      });
      return r;
    };
    ensureChecklistRows.mockResolvedValue([
      { ItemKey: "ApplicantKyc", CheckStatus: "Checked" },
      { ItemKey: "ProjectUnitRate", CheckStatus: "Checked" },
    ]);
    const res = await submitForApproval(mockPool, 10, "staff@example.com", "staff", 42);
    expect(res.ok).toBe(true);
    expect(lockedQuery).toMatch(/ItemKey IN \(@k0, @k1\)/);
    expect(mockTx.commit).toHaveBeenCalled();
  });

  it("blocks submission if total value is 0", async () => {
    const { mockPool } = createMockPool({ totalValue: 0 });
    ensureChecklistRows.mockResolvedValue([
      { ItemKey: "ApplicantKyc", CheckStatus: "Checked" },
    ]);

    await expect(submitForApproval(mockPool, 10, "staff@example.com", "staff", 42))
      .rejects.toThrow(/Total value is ₹0/);
  });
});

// Sending back (rejectStageRequest): one step back by default; the Director
// may also send it straight to Data Review. Every approval from the target on
// is cleared, so the booking passes each later level again.
describe("crmBookingStageService.rejectStageRequest — where a send-back goes", () => {
  function rejectPool(stage) {
    const writes = [];
    const answer = (q, inputs) => {
      writes.push({ q, inputs });
      if (q.includes("SELECT Id, BookingNo, Status, IsActive, WorkflowStage")) {
        return { recordset: [{ Id: 10, BookingNo: "BKG-10", Status: "Pending", IsActive: true, WorkflowStage: stage, ApplicationId: 100 }] };
      }
      if (q.includes("WITH (UPDLOCK, HOLDLOCK) WHERE Id = @bid")) return { recordset: [{ WorkflowStage: stage, Status: "Pending", IsActive: true }] };
      return { recordset: [] };
    };
    const req = () => { const r = { inputs: {}, input: (n, _t, v) => { r.inputs[n] = v; return r; }, query: async (q) => answer(q, r.inputs) }; return r; };
    const tx = { begin: jest.fn(), commit: jest.fn(), rollback: jest.fn(), request: req };
    return { pool: { request: req, transaction: () => tx }, tx, writes };
  }
  const stageWrite = (writes) => writes.find((w) => w.q.includes("WorkflowStage = @stg"));
  const clearedFrom = (writes) => writes.find((w) => w.q.includes("DELETE FROM dbo.ApprovalAuditLog")).inputs.lvl;
  const send = (pool, stage, toStage) =>
    rejectStageRequest(pool, 10, stage, "dir@example.com", "super_admin", 7, "rate is wrong", toStage === undefined ? {} : { toStage });

  it("the one rule: Marketing Head → Data Review; Director → Marketing Head (default) or Data Review", () => {
    expect(SEND_BACK_TARGETS).toEqual({
      [STAGE_MARKETING]: [STAGE_REVIEW],
      [STAGE_DIRECTOR]: [STAGE_MARKETING, STAGE_REVIEW],
    });
  });

  it("the inbox's SendBackTo column is built from the same rule", () => {
    expect(sendBackTargetsSql("b.WorkflowStage")).toBe(
      "CASE b.WorkflowStage WHEN N'MarketingHeadApproval' THEN N'Review' WHEN N'DirectorApproval' THEN N'MarketingHeadApproval,Review' END");
  });

  it("Director, no choice: to the Marketing Head, who must approve again", async () => {
    const { pool, tx, writes } = rejectPool(STAGE_DIRECTOR);
    const res = await send(pool, STAGE_DIRECTOR);
    expect(res.stage).toBe(STAGE_MARKETING);
    expect(stageWrite(writes).inputs).toMatchObject({ stg: STAGE_MARKETING, rejFrom: STAGE_DIRECTOR });
    expect(stageWrite(writes).q).toMatch(/MarketingHeadApprovedAt = NULL/);
    expect(clearedFrom(writes)).toBe(1);
    expect(tx.commit).toHaveBeenCalled();
  });

  it("Director → Data Review: every approval cleared, out of the inbox until sent again", async () => {
    const { pool, writes } = rejectPool(STAGE_DIRECTOR);
    const res = await send(pool, STAGE_DIRECTOR, STAGE_REVIEW);
    expect(res.stage).toBe(STAGE_REVIEW);
    expect(stageWrite(writes).inputs).toMatchObject({ stg: STAGE_REVIEW, rejFrom: STAGE_DIRECTOR });
    expect(stageWrite(writes).q).toMatch(/ReadyForApprovalAt = CASE WHEN @stg = 'Review' THEN NULL/);
    expect(clearedFrom(writes)).toBe(0);
    const log = writes.find((w) => w.q.includes("INSERT INTO dbo.CrmBookingStageLog"));
    expect(log.inputs).toMatchObject({ stg: STAGE_REVIEW, act: "BouncedBackForCorrection", rem: "rate is wrong" });
  });

  it("Marketing Head → Data Review", async () => {
    const { pool, writes } = rejectPool(STAGE_MARKETING);
    expect((await send(pool, STAGE_MARKETING)).stage).toBe(STAGE_REVIEW);
    expect(clearedFrom(writes)).toBe(0);
  });

  it("a target the rule does not allow is refused, nothing written", async () => {
    const { pool, tx, writes } = rejectPool(STAGE_MARKETING);
    await expect(send(pool, STAGE_MARKETING, STAGE_DIRECTOR)).rejects.toMatchObject({ status: 400 });
    expect(tx.begin).not.toHaveBeenCalled();
    expect(stageWrite(writes)).toBeUndefined();
  });

  it("a confirmed booking cannot be sent back", async () => {
    const { pool } = rejectPool(STAGE_CONFIRMED);
    await expect(send(pool, STAGE_CONFIRMED)).rejects.toMatchObject({ status: 409 });
  });

  it("approved by someone else meanwhile: the send-back is refused, the approval stands", async () => {
    const { pool, tx, writes } = rejectPool(STAGE_MARKETING);
    // Read before the lock says Marketing Head; under the lock it has moved on.
    const req0 = pool.transaction().request;
    pool.transaction().request = () => { const r = req0(); const q = r.query; r.query = async (s) => (s.includes("UPDLOCK") ? { recordset: [{ WorkflowStage: STAGE_DIRECTOR, Status: "Pending", IsActive: true }] } : q(s)); return r; };
    await expect(send(pool, STAGE_MARKETING)).rejects.toMatchObject({ status: 409 });
    expect(tx.rollback).toHaveBeenCalled();
    expect(writes.some((w) => w.q.includes("DELETE FROM dbo.ApprovalAuditLog"))).toBe(false);
  });
});
