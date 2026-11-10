process.env.NODE_ENV = "test";

// The Finance end of a refund: recovering one whose voucher was never raised, and who a rejection is recorded against.
const mockQueries = [];
const mockRefund = { row: null };

jest.mock("../db", () => {
  const fakeRequest = () => {
    const r = {
      inputs: {},
      input(n, a, b) { r.inputs[n] = b === undefined ? a : b; return r; },
      async query(q) {
        mockQueries.push({ q, inputs: r.inputs });
        if (/UPDATE dbo\.CrmRefund SET\s+Status = 'FinanceApproved'/.test(q)) {
          // What the database would do: the row only matches if the WHERE allows its current status.
          const allowed = /Status IN \('FinancePending', 'Approved'\)/.test(q) ? ["FinancePending", "Approved"] : ["FinancePending"];
          return { recordset: [], rowsAffected: [allowed.includes(mockRefund.row.Status) ? 1 : 0] };
        }
        if (/FROM dbo\.CrmRefund WITH \(UPDLOCK, HOLDLOCK\)/.test(q)) return { recordset: [mockRefund.row], rowsAffected: [1] };
        if (/INSERT INTO dbo\.NewPayment/.test(q)) return { recordset: [{ PPaymentID: 55 }], rowsAffected: [1] };
        return { recordset: [], rowsAffected: [1] };
      },
    };
    return r;
  };
  return {
    sql: require("mssql"),
    getPool: () => ({ request: fakeRequest, transaction: () => ({ begin: async () => {}, commit: async () => {}, rollback: async () => {}, request: fakeRequest }) }),
  };
});
jest.mock("../redis", () => new Proxy({}, { get: () => async () => null }));
jest.mock("../socket", () => ({ getIo: () => null }));
jest.mock("../middleware/auth", () => (req, _res, next) => { req.user = { userId: 7, id: 7, role: "admin", email: "a@b.c" }; next(); });
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/requirePageRight", () => {
  const pass = () => (_req, _res, next) => next();
  return { requirePageRight: pass, requireAnyPageRight: pass };
});
jest.mock("../services/approvalService", () => ({
  ...jest.requireActual("../services/approvalService"),
  transition: jest.fn(async (_m, _id, target) => ({ newStatus: target })),
  isApproverFor: jest.fn(async () => true),
}));
jest.mock("../services/crmLedger", () => ({ ...jest.requireActual("../services/crmLedger"), ensureCrmCustomerLedgerHead: jest.fn(async () => 9) }));
jest.mock("../utils/docNumberLock", () => ({
  lockNextDocNumber: jest.fn(async () => "PAY-2026-00001"), backPatchRecordId: jest.fn(async () => {}), resolveDocTypeId: jest.fn(async () => 1),
}));

const express = require("express");
const request = require("supertest");
const { transition } = require("../services/approvalService");
const router = require("../routes/crmRefunds");

const app = express();
app.use(express.json());
app.use("/", router);

const refund = (Status) => ({ Id: 3, RefundNo: "CRFD-1", Status, CustomerId: 1, CompanyId: 1, ProjectId: 1, NetAmount: 100, GrossAmount: 100, SourceOnAccountId: null, RefundBankLHeadId: 5, CustomerBankName: "X", CustomerAccountNo: "1", FinanceNewPaymentId: null, PreferredPaymentMode: "Cheque" });

beforeEach(() => { mockQueries.length = 0; transition.mockClear(); });

describe("raising the payout voucher from Finance", () => {
  test("a refund approved but left without a voucher can be recovered", async () => {
    mockRefund.row = refund("Approved");
    const r = await request(app).put("/3/finance-approve").send({});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "FinanceApproved", newPaymentId: 55 });
  });

  test("the normal path still works", async () => {
    mockRefund.row = refund("FinancePending");
    expect((await request(app).put("/3/finance-approve").send({})).status).toBe(200);
  });

  test("a refund in any other state is refused, with no voucher raised", async () => {
    mockRefund.row = refund("Pending");
    expect((await request(app).put("/3/finance-approve").send({})).status).toBe(400);
    expect(mockQueries.filter((x) => /INSERT INTO dbo\.NewPayment/.test(x.q))).toHaveLength(0);
  });
});

describe("rejecting a refund", () => {
  test("records who rejected it, so an approver named individually in Approval Setup is recognised", async () => {
    await request(app).put("/3/reject").send({ note: "Wrong bank" });
    expect(transition).toHaveBeenCalledWith("crm-refunds", 3, "Rejected", expect.anything(), "admin", "Wrong bank", 7);
  });
});

describe("the refunds list", () => {
  const listQuery = () => mockQueries.find((x) => /OFFSET @offset/.test(x.q)).q;
  test("a tab covering several statuses asks for all of them", async () => {
    await request(app).get("/?page=1&pageSize=25&status=Voucher");
    expect(listQuery()).toContain("r.Status IN ('Approved', 'FinancePending')");
  });
  test("the overdue tab asks for refunds past their due date and unpaid", async () => {
    await request(app).get("/?page=1&pageSize=25&status=Overdue");
    expect(listQuery()).toContain("CAST(SYSDATETIME() AS DATE) > r.RefundDueDate");
    expect(listQuery()).not.toContain("r.Status = @st");
  });
  test("open refunds come first unless someone picks a sort", async () => {
    await request(app).get("/?page=1&pageSize=25");
    expect(listQuery()).toMatch(/ORDER BY CASE WHEN r\.Status IN \('Paid', 'Rejected'\) THEN 1 ELSE 0 END/);
  });
  test("only known columns can be sorted on", async () => {
    await request(app).get("/?page=1&pageSize=25&sortKey=NetAmount&sortDir=asc");
    expect(listQuery()).toContain("ORDER BY r.NetAmount ASC");
    mockQueries.length = 0;
    await request(app).get("/?page=1&pageSize=25&sortKey=constructor");
    expect(listQuery()).toContain("ORDER BY CASE WHEN");
  });
});
