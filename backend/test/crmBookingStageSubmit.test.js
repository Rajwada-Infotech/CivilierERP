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
const { submitForApproval, STAGE_MARKETING } = require("../services/crmBookingStageService");

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
  } = {}) {
    const mockTx = {
      begin: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      request: () => {
        const req = {
          input: () => req,
          query: jest.fn().mockResolvedValue({ recordset: [] }),
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

  it("blocks submission if total value is 0", async () => {
    const { mockPool } = createMockPool({ totalValue: 0 });
    ensureChecklistRows.mockResolvedValue([
      { ItemKey: "ApplicantKyc", CheckStatus: "Checked" },
    ]);

    await expect(submitForApproval(mockPool, 10, "staff@example.com", "staff", 42))
      .rejects.toThrow(/Total value is ₹0/);
  });
});
