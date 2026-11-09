process.env.NODE_ENV = "test";

// Waiving a milestone: a request, an approval, and a reversal that is refused once something relies on the waiver. The
// pool is faked; the whole flow was also run against the development database.
const mockQueries = [];
const mockDb = { milestone: null, waiver: null, deps: {}, funding: {} };

jest.mock("../db", () => {
  const fakeRequest = () => {
    const r = {
      inputs: {},
      input(n, a, b) { r.inputs[n] = b === undefined ? a : b; return r; },
      async query(q) {
        mockQueries.push({ q, inputs: r.inputs });
        if (/INSERT INTO dbo\.CrmMilestoneWaiver/.test(q)) return { recordset: [{ Id: 9 }] };
        if (/UPDATE dbo\.CrmPaymentMilestone[\s\S]*OUTPUT INSERTED\.MilestoneNo/.test(q)) return { recordset: [{ MilestoneNo: 2 }] };
        if (/SELECT AmountDue, ISNULL\(AmountPaid, 0\) AS AmountPaid/.test(q)) return { recordset: [mockDb.milestone] };
        if (/AS RequiredAmount/.test(q)) return { recordset: [mockDb.funding] };
        if (/SELECT TOP 1 Id FROM dbo\.CrmMilestoneWaiver/.test(q)) return { recordset: [] };
        if (/SELECT \* FROM dbo\.CrmMilestoneWaiver/.test(q)) return { recordset: mockDb.waiver ? [mockDb.waiver] : [] };
        if (/AS FinalNo,\s+\(SELECT TOP 1 DeedNo/.test(q)) return { recordset: [mockDb.deps] };
        if (/SELECT Id, MilestoneName, AmountDue, Status, DemandStatus/.test(q)) return { recordset: [mockDb.milestone] };
        if (/FROM dbo\.CrmPaymentMilestone m WHERE m\.Id = @id/.test(q)) return { recordset: mockDb.milestone ? [mockDb.milestone] : [] };
        if (/SELECT Status, IsActive/.test(q)) return { recordset: [{ Status: "Approved", IsActive: true, IsFrozen: false }] };
        return { recordset: [] };
      },
    };
    return r;
  };
  return {
    sql: require("mssql"),
    getPool: () => ({
      request: fakeRequest,
      transaction: () => ({ begin: async () => {}, commit: async () => {}, rollback: async () => {}, request: fakeRequest }),
    }),
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
jest.mock("../services/approvalService", () => ({ ...jest.requireActual("../services/approvalService"), transition: jest.fn() }));
jest.mock("../services/crmLedger", () => {
  const actual = jest.requireActual("../services/crmLedger");
  const spied = {};
  for (const k of Object.keys(actual)) spied[k] = typeof actual[k] === "function" ? jest.fn(async () => ({})) : actual[k];
  spied.getGstSplit = jest.fn(async () => ({ gstAmount: 5, baseAmount: 95 }));
  return spied;
});

const express = require("express");
const request = require("supertest");
const { transition } = require("../services/approvalService");
const ledger = require("../services/crmLedger");
const router = require("../routes/crmPayments");
const { finalInvoiceDescription, generateMilestoneInvoiceForBooking } = require("../routes/crmBookings");

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { userId: 7, id: 7, role: "admin", email: "a@b.c" }; next(); });
app.use("/", router);

const REASON = { Reason: "Goodwill discount agreed by management" };
const ran = (re) => mockQueries.filter((x) => re.test(x.q));
const OPEN = { Id: 11, BookingId: 5, AmountDue: 100, AmountPaid: 0, Status: "Pending", InvoiceNo: null, FinalNo: null };

beforeEach(() => {
  mockQueries.length = 0;
  transition.mockReset();
  transition.mockImplementation(async (_m, _id, target, _e, _r, _n, _u, beforeApprove, onFullyApproved) => {
    const tx = require("../db").getPool().transaction();
    if (beforeApprove) await beforeApprove(tx);
    if (onFullyApproved) await onFullyApproved(tx);
    return { newStatus: target };
  });
  mockDb.milestone = { ...OPEN };
  mockDb.waiver = null;
  mockDb.deps = { FinalNo: null, DeedNo: null };
  mockDb.funding = { RequiredAmount: 200, MilestonePaid: 0, OnAccountAvailable: 50 };
});

describe("asking for a waiver", () => {
  test("it goes for approval and leaves the milestone due", async () => {
    const r = await request(app).put("/11/waive").send(REASON);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "Pending", waiverId: 9, amount: 100 });
    expect(transition).toHaveBeenCalledWith("crm-milestone-waiver", 9, "Pending", "a@b.c", "admin", null, 7);
    expect(ran(/UPDATE dbo\.CrmPaymentMilestone/)).toHaveLength(0);
  });

  test("the request records the taxable value and GST it gives up", async () => {
    await request(app).put("/11/waive").send(REASON);
    expect(ran(/INSERT INTO dbo\.CrmMilestoneWaiver/)[0].inputs).toMatchObject({ a: 100, t: 95, g: 5 });
  });

  test("a throwaway reason is refused", async () => {
    const r = await request(app).put("/11/waive").send({ Reason: "hiii" });
    expect(r.status).toBe(400);
    expect(ran(/INSERT INTO dbo\.CrmMilestoneWaiver/)).toHaveLength(0);
  });

  test.each([["its own invoice", { InvoiceNo: "INV-1" }, "INV-1"], ["a Final invoice on the booking", { FinalNo: "INV-2" }, "INV-2"]])(
    "a milestone billed by %s takes a credit note instead",
    async (_n, billed, no) => {
      mockDb.milestone = { ...OPEN, ...billed };
      const r = await request(app).put("/11/waive").send(REASON);
      expect(r.status).toBe(409);
      expect(r.body.error).toContain(no);
      expect(r.body.error).toContain("credit note");
      expect(ran(/INSERT INTO dbo\.CrmMilestoneWaiver/)).toHaveLength(0);
    },
  );

  test("a request that never reached an approver is closed, so it can be asked again", async () => {
    transition.mockRejectedValueOnce(Object.assign(new Error("No workflow set up"), { status: 400 }));
    const r = await request(app).put("/11/waive").send(REASON);
    expect(r.status).toBe(400);
    const closed = ran(/UPDATE dbo\.CrmMilestoneWaiver SET Status = N'Rejected'/);
    expect(closed).toHaveLength(1);
    expect(closed[0].inputs.n).toBe("No workflow set up");
  });
});

describe("deciding a waiver", () => {
  beforeEach(() => { mockDb.waiver = { Id: 9, BookingId: 5, MilestoneId: 11, Reason: REASON.Reason, Status: "Pending" }; });

  test("the milestone is waived only when the last level has approved", async () => {
    transition.mockResolvedValueOnce({ newStatus: "Pending" });
    await request(app).put("/waivers/9/approve").send({});
    expect(ran(/SET Status = 'Waived'/)).toHaveLength(0);
    await request(app).put("/waivers/9/approve").send({});
    expect(ran(/SET Status = 'Waived'/)).toHaveLength(1);
  });

  test("approving posts nothing to the books: it is a discount, the invoice just bills less", async () => {
    const r = await request(app).put("/waivers/9/approve").send({});
    expect(r.status).toBe(200);
    for (const k of Object.keys(ledger)) if (jest.isMockFunction(ledger[k]) && k !== "getGstSplit") expect(ledger[k]).not.toHaveBeenCalled();
  });

  test("a milestone invoiced while the waiver waited is refused at approval", async () => {
    mockDb.milestone = { ...OPEN, InvoiceNo: "INV-3" };
    const r = await request(app).put("/waivers/9/approve").send({});
    expect(r.status).toBe(409);
    expect(ran(/SET Status = 'Waived'/)).toHaveLength(0);
  });

  test("the amount is worked out at approval: money may have come in while it waited", async () => {
    mockDb.milestone = { ...OPEN, AmountDue: 100, AmountPaid: 40 };
    await request(app).put("/waivers/9/approve").send({});
    expect(ledger.getGstSplit).toHaveBeenLastCalledWith(expect.anything(), 5, 60);
    expect(ran(/SET Amount = @a/)[0].inputs).toMatchObject({ a: 60, t: 95, g: 5 });
  });

  test("the waiver is applied inside the approval's transaction, so a failure undoes both", async () => {
    let applied = 0;
    transition.mockImplementationOnce(async (_m, _id, _t, _e, _r, _n, _u, _before, onFullyApproved) => {
      expect(typeof onFullyApproved).toBe("function");
      applied = ran(/SET Status = 'Waived'/).length;
      return { newStatus: "Pending" };
    });
    await request(app).put("/waivers/9/approve").send({});
    expect(applied).toBe(0);
    expect(ran(/SET Status = 'Waived'/)).toHaveLength(0);
  });

  test("a waiver that leaves the booking fully funded settles the money on account, as a payment would", async () => {
    mockDb.funding = { RequiredAmount: 100, MilestonePaid: 0, OnAccountAvailable: 100 };
    await request(app).put("/waivers/9/approve").send({});
    const order = mockQueries.map((x) => x.q);
    const waived = order.findIndex((q) => /SET Status = 'Waived'/.test(q));
    const funding = order.findIndex((q) => /AS RequiredAmount/.test(q));
    expect(funding).toBeGreaterThan(waived);
    expect(ran(/Amount > ISNULL\(AppliedAmount, 0\)/).length).toBeGreaterThan(0);
  });

  test("still short of the full amount: the money stays on account", async () => {
    await request(app).put("/waivers/9/approve").send({});
    expect(ran(/AS RequiredAmount/).length).toBeGreaterThan(0);
    expect(ran(/Amount > ISNULL\(AppliedAmount, 0\)/)).toHaveLength(0);
  });

  test("a rejection needs a reason, and leaves the milestone due", async () => {
    expect((await request(app).put("/waivers/9/reject").send({})).status).toBe(400);
    const r = await request(app).put("/waivers/9/reject").send({ note: "Not agreed" });
    expect(r.body.status).toBe("Rejected");
    expect(ran(/RejectionNote = @n/)[0].inputs.n).toBe("Not agreed");
    expect(ran(/UPDATE dbo\.CrmPaymentMilestone/)).toHaveLength(0);
  });
});

describe("reversing a waiver", () => {
  beforeEach(() => { mockDb.waiver = { Id: 9, BookingId: 5, MilestoneId: 11, Reason: REASON.Reason, Status: "Approved", ReversalStatus: null }; });

  test.each([["a Final invoice", { FinalNo: "INV-9" }, "INV-9"], ["a sale deed", { DeedNo: "SD-4" }, "SD-4"]])(
    "%s relying on it refuses the reversal, and nothing is written",
    async (_n, dep, no) => {
      mockDb.deps = { FinalNo: null, DeedNo: null, ...dep };
      const r = await request(app).put("/waivers/9/reverse").send(REASON);
      expect(r.status).toBe(409);
      expect(r.body.error).toContain(no);
      expect(ran(/UPDATE dbo\.CrmMilestoneWaiver/)).toHaveLength(0);
    },
  );

  test("a request that never reached an approver leaves the waiver as it was", async () => {
    transition.mockRejectedValueOnce(new Error("No workflow set up"));
    await request(app).put("/waivers/9/reverse").send(REASON);
    expect(ran(/SET ReversalStatus = NULL/)).toHaveLength(1);
  });

  test("the milestone is due again only once the reversal is approved", async () => {
    await request(app).put("/waivers/9/reverse").send(REASON);
    expect(ran(/UPDATE dbo\.CrmPaymentMilestone/)).toHaveLength(0);
    mockDb.waiver.ReversalStatus = "Pending";
    const r = await request(app).put("/waiver-reversals/9/approve").send({});
    expect(r.body.status).toBe("Approved");
    const back = ran(/UPDATE dbo\.CrmPaymentMilestone/);
    expect(back).toHaveLength(1);
    expect(back[0].q).toContain("Status = 'Pending'");
    expect(back[0].q).toContain("Status = 'Waived'");
  });

  test("something that came to rely on it while the reversal waited refuses the approval", async () => {
    mockDb.waiver.ReversalStatus = "Pending";
    mockDb.deps = { FinalNo: "INV-9", DeedNo: null };
    const r = await request(app).put("/waiver-reversals/9/approve").send({});
    expect(r.status).toBe(409);
    expect(ran(/UPDATE dbo\.CrmPaymentMilestone/)).toHaveLength(0);
  });
});

describe("invoicing a milestone from a list opened before the waiver", () => {
  test("a waived milestone is refused, and no invoice is written", async () => {
    mockDb.milestone = { Id: 11, MilestoneName: "Agreement", AmountDue: 100, Status: "Waived", DemandStatus: "Raised" };
    await expect(generateMilestoneInvoiceForBooking(require("../db").getPool(), 5, 11, 7)).rejects.toThrow("has been waived");
    expect(ran(/INSERT INTO dbo\.CrmInvoice/)).toHaveLength(0);
  });
});

describe("the Final invoice records the discount (CGST Act s.15(3)(a))", () => {
  const poolWith = (rows) => ({ request: () => ({ input() { return this; }, query: async () => ({ recordset: rows }) }) });
  const bk = { BookingNo: "BKG-1" };

  test("no waiver: the plain description", async () => {
    await expect(finalInvoiceDescription(poolWith([]), 5, bk, 80000)).resolves.toBe("Final invoice for BKG-1");
  });

  test("a waiver: agreed price, discount and the milestones it came from", async () => {
    const d = await finalInvoiceDescription(poolWith([{ MilestoneName: "Agreement", AmountDue: 25000, AmountPaid: 5000 }, { MilestoneName: "Plinth", AmountDue: 10000, AmountPaid: 0 }]), 5, bk, 70000);
    expect(d).toBe("Final invoice for BKG-1. Agreed price Rs. 1,00,000.00 less discount of Rs. 30,000.00 (Agreement, Plinth waived).");
  });
});
