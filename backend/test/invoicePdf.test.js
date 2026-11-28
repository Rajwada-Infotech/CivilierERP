jest.mock("../db", () => ({ sql: { Int: "Int", NVarChar: () => "NVarChar", MAX: "MAX" } }));
jest.mock("../services/crmLedger", () => ({
  getGstSplit: jest.fn(async (_pool, _bid, amt) => ({ gstAmount: Math.round((amt * 5) / 105 * 100) / 100, baseAmount: Math.round((amt - (amt * 5) / 105) * 100) / 100 })),
  gstSplitByRatio: jest.fn((amt, totalGst, grandTotal) => {
    const ratio = grandTotal > 0 ? totalGst / grandTotal : 0;
    const gstAmount = Math.round(amt * ratio * 100) / 100;
    return { gstAmount, baseAmount: Math.round((amt - gstAmount) * 100) / 100 };
  }),
}));

const {
  renderInvoicePdfBuffer,
  getInvoicePdfBuffer,
  getFinalStatementPdfBuffer,
} = require("../services/invoicePdf");

const pages = (buf) => (buf.toString("latin1").match(/\/Type \/Page\b/g) || []).length;

const sampleIssued = {
  Id: 1,
  InvoiceNo: "INV-2026-00042",
  InvoiceType: "Milestone",
  Amount: 875400,
  InvBase: 833714.29,
  InvGst: 41685.71,
  UnitParkingGstRate: 5,
  HsnCode: "995411",
  InvoiceDate: "2026-11-28",
  CreatedAt: "2026-11-28T10:30:00Z",
  Status: "Generated",
  BookingId: 316,
  BookingNo: "BKG-2026-00185",
  ApplicationNo: "APP-2026-00210",
  ApplicantName: "Rahul Sharma",
  Mobile: "9830012345",
  Email: "rahul@example.com",
  CustomerAddress: "Salt Lake Sector V",
  CustomerCity: "Kolkata",
  CustomerState: "West Bengal",
  CustomerPincode: "700091",
  CustomerGst: "19ABCDE1234F1Z5",
  UnitNo: "RG/A1/104",
  BlockName: "Tower A",
  ProjectFullName: "Royal Garden Residency",
  ProjectRera: "WBRERA/P/NOR/2025/001982",
  ProjectState: "West Bengal",
  CompanyName: "Civilier Buildcon Private Limited",
  CompanyAddress: "Plot 12, Eco Space",
  CompanyCity: "Kolkata",
  CompanyState: "West Bengal",
  CompanyPincode: "700160",
  CompanyGst: "19AABCC1234D1Z9",
  CompanyPan: "AABCC1234D",
  MilestoneNo: 2,
  MilestoneName: "On Execution of Agreement for Sale & Legal Compliance",
  DemandNo: "DEM-2026-00308",
  MilestonePaidDate: "2026-11-27",
  MilestonePaymentMode: "RTGS",
  creditNotes: [{ DocNo: "CN-2026-00011", DocDate: "2026-11-29", TotalAmount: 25000, Status: "Issued" }],
};

describe("invoicePdf service", () => {
  test("renders a single-page v4 PDF for an issued milestone invoice", async () => {
    const buf = await renderInvoicePdfBuffer(sampleIssued);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pages(buf)).toBe(1);
    expect(buf.includes("CivilierInvoiceV4")).toBe(true);
  });

  test("renders a single-page VOID invoice PDF with long address and void reason", async () => {
    const buf = await renderInvoicePdfBuffer({
      ...sampleIssued,
      Status: "Void",
      VoidedAt: "2026-11-29",
      VoidReason: "Duplicate billing superseded by demand DEM-2026-00310",
      CustomerAddress: "24/A Ballygunge Circular Road ".repeat(4),
      Description: "Additional finishing milestone charges",
    });
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pages(buf)).toBe(1);
    expect(buf.includes("CivilierInvoiceV4")).toBe(true);
  });

  test("keeps extremely long invoice inputs strictly within 1 page", async () => {
    const buf = await renderInvoicePdfBuffer({
      ...sampleIssued,
      Status: "Void",
      ApplicantName: "Dr. Rajendraprasad Venkataraman & Smt. Lakshmipriya Chatterjee-Mukherjee",
      CustomerAddress: "Tower 4, Penthouse 1902, Sovereign Enclave, Phase III, Near IT Expressway ".repeat(3),
      MilestoneName: "Superstructure Slab Casting, MEP Rough-in, External Facade & Fire Safety Commissioning",
      Description: "Milestone demand raised after stage completion certificate and inspection clearance",
      VoidReason: "Revised unit transfer reallocation per booking amendment request BKG-AMD-2026-098",
      creditNotes: [
        { DocNo: "CN-2026-00011", DocDate: "2026-11-29", TotalAmount: 25000, Status: "Issued" },
        { DocNo: "CN-2026-00012", DocDate: "2026-11-30", TotalAmount: 10000, Status: "Issued" },
      ],
    });
    expect(pages(buf)).toBe(1);
  });

  test("getInvoicePdfBuffer keeps v4 cached PDFs and upgrades legacy cached PDFs", async () => {
    const v4 = await renderInvoicePdfBuffer(sampleIssued);
    const hitPool = {
      request: () => ({
        input: function () { return this; },
        query: async () => ({ recordset: [{ PdfBase64: v4.toString("base64") }] }),
      }),
    };
    const cached = await getInvoicePdfBuffer(hitPool, 1);
    expect(cached.equals(v4)).toBe(true);

    const legacyPdf = Buffer.from("%PDF-1.4\nCivilierInvoiceV3\n%%EOF").toString("base64");
    const queries = [];
    const upgradePool = {
      request: () => ({
        input: function () { return this; },
        query: async (sqlText) => {
          queries.push(sqlText);
          if (sqlText.includes("SELECT PdfBase64")) return { recordset: [{ PdfBase64: legacyPdf }] };
          if (sqlText.includes("FROM dbo.CrmInvoice inv")) return { recordset: [sampleIssued] };
          return { recordset: [] };
        },
      }),
    };
    const upgraded = await getInvoicePdfBuffer(upgradePool, 1);
    expect(upgraded.includes("CivilierInvoiceV4")).toBe(true);
    expect(queries.some((q) => q.includes("UPDATE dbo.CrmInvoice SET PdfBase64"))).toBe(true);
  });

  test("renders consolidated Final Statement cleanly on one page", async () => {
    const stmtPool = {
      request: () => ({
        input: function () { return this; },
        query: async (q) => {
          if (q.includes("FROM dbo.CrmBooking b")) return { recordset: [sampleIssued] };
          if (q.includes("FROM dbo.CrmInvoice i")) {
            return {
              recordset: [
                { InvoiceNo: "INV-2026-00040", InvoiceDate: "2026-11-01", InvoiceType: "Milestone", Amount: 500000, MilestoneName: "Booking", Credited: 0 },
                { InvoiceNo: "INV-2026-00042", InvoiceDate: "2026-11-28", InvoiceType: "Milestone", Amount: 875400, MilestoneName: "Agreement Execution", Credited: 25000 },
              ],
            };
          }
          return { recordset: [{ MilestoneName: "Early Bird Discount", Amount: 50000 }] };
        },
      }),
    };
    const buf = await getFinalStatementPdfBuffer(stmtPool, 316);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pages(buf)).toBe(1);
    expect(buf.includes("CivilierInvoiceV4")).toBe(true);
  });
});
