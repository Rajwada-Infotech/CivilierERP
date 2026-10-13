const {
  FIELDS,
  MAX_ROWS,
  cleanRow,
  analyze,
} = require("../services/crmCustomerImport");

describe("crmCustomerImport service", () => {
  it("exports required definitions and limits", () => {
    expect(Array.isArray(FIELDS)).toBe(true);
    expect(FIELDS.some((f) => f.key === "CustomerName" && f.required)).toBe(true);
    expect(FIELDS.some((f) => f.key === "Mobile")).toBe(true);
    expect(FIELDS.some((f) => f.key === "PanNo")).toBe(true);
    expect(MAX_ROWS).toBe(2500);
  });

  describe("cleanRow sanitization & validation", () => {
    it("cleans valid Indian customer row cleanly", () => {
      const res = cleanRow({
        CustomerName: "Rahul Sharma",
        Mobile: "+91 98300 12345",
        Email: "rahul@example.com",
        PanNo: "abcde1234f",
        AadhaarNo: "1234 5678 9012",
        PermanentAddress: "123 Park Street",
        PermanentCity: "Kolkata",
        PermanentState: "West Bengal",
        PermanentPincode: "700016",
      });

      expect(res.errors).toHaveLength(0);
      expect(res.data.CustomerName).toBe("Rahul Sharma");
      expect(res.data.Mobile).toBe("9830012345");
      expect(res.data.PanNo).toBe("ABCDE1234F");
      expect(res.data.AadhaarNo).toBe("123456789012");
      expect(res.data.Email).toBe("rahul@example.com");
      expect(res.data.PermanentPincode).toBe("700016");
    });

    it("supports composite First and Last name if CustomerName is omitted", () => {
      const res = cleanRow({
        FirstName: "Amit",
        LastName: "Verma",
        Mobile: "9876543210",
      });

      expect(res.errors).toHaveLength(0);
      expect(res.data.CustomerName).toBe("Amit Verma");
    });

    it("errors when Customer Name is completely missing", () => {
      const res = cleanRow({ Mobile: "9876543210" });
      expect(res.errors).toContain("Customer Name is missing");
    });

    it("flags truncated Excel scientific notation on mobile numbers", () => {
      const res = cleanRow({
        CustomerName: "Test User",
        Mobile: "9.83E+09",
      });

      expect(res.errors.some((e) => e.includes("truncated by Excel's scientific notation"))).toBe(true);
    });

    it("splits multiple phone numbers in a single mobile cell into Mobile and AltMobile", () => {
      const res = cleanRow({
        CustomerName: "Priya Roy",
        Mobile: "9830012345 / 9830098765",
      });

      expect(res.errors).toHaveLength(0);
      expect(res.data.Mobile).toBe("9830012345");
      expect(res.data.AltMobile).toBe("9830098765");
      expect(res.warnings.some((w) => w.includes("Split multiple phone numbers"))).toBe(true);
    });

    it("validates PAN format and rejects invalid formats", () => {
      const res = cleanRow({
        CustomerName: "Valid Name",
        PanNo: "INVALID_PAN",
      });

      expect(res.errors.some((e) => e.includes("standard AAAAA9999A format"))).toBe(true);
    });

    it("validates Aadhaar to exactly 12 digits", () => {
      const res = cleanRow({
        CustomerName: "Valid Name",
        AadhaarNo: "12345",
      });

      expect(res.errors.some((e) => e.includes("must be exactly 12 digits"))).toBe(true);
    });

    it("parses dates in various formats (DD/MM/YYYY, DD-Mon-YYYY)", () => {
      const r1 = cleanRow({ CustomerName: "A", DateOfBirth: "15/08/1990" });
      expect(r1.data.DateOfBirth).toBe("1990-08-15");

      const r2 = cleanRow({ CustomerName: "B", DateOfBirth: "26-Jan-1985" });
      expect(r2.data.DateOfBirth).toBe("1985-01-26");
    });

    it("parses amounts in words (lakh, cr) and currency formats", () => {
      const r1 = cleanRow({ CustomerName: "A", AnnualIncome: "12 Lakh" });
      expect(r1.data.AnnualIncome).toBe(1200000);

      const r2 = cleanRow({ CustomerName: "B", AnnualIncome: "₹ 1,50,000" });
      expect(r2.data.AnnualIncome).toBe(150000);
    });

    it("handles InvoiceMode correctly", () => {
      const r1 = cleanRow({ CustomerName: "A", InvoiceMode: "GST" });
      expect(r1.data.InvoiceMode).toBe("Invoice");

      const r2 = cleanRow({ CustomerName: "B", InvoiceMode: "Without Invoice" });
      expect(r2.data.InvoiceMode).toBe("NonInvoice");

      const r3 = cleanRow({ CustomerName: "C", InvoiceMode: "" });
      expect(r3.data.InvoiceMode).toBe("");
    });
  });

  describe("analyze in-file duplicate detection", () => {
    it("flags duplicate rows within the same file", async () => {
      const mockPool = {
        request() {
          return {
            input() { return this; },
            async query() { return { recordset: [] }; },
          };
        },
      };

      const rows = [
        { rowNo: 1, cells: { CustomerName: "First User", Mobile: "9830011111" } },
        { rowNo: 2, cells: { CustomerName: "Second User", Mobile: "9830011111" } },
      ];

      const result = await analyze(mockPool, rows);
      expect(result.summary.total).toBe(2);
      expect(result.summary.new).toBe(1);
      expect(result.summary.duplicate).toBe(1);
      expect(result.rows[0].status).toBe("new");
      expect(result.rows[1].status).toBe("duplicate");
      expect(result.rows[1].duplicateOf).toBe(1);
    });
  });
});
