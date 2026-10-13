const {
  conveyedReason,
  ResaleError,
} = require("../services/crmResaleTransfer");
const {
  DOC_TYPES,
  DEED_STEPS,
  CaseError,
} = require("../services/crmResaleCase");

describe("crmResale services", () => {
  describe("crmResaleCase definitions", () => {
    it("defines statutory document types", () => {
      expect(DOC_TYPES.SellerLoanNoc).toBe("Seller's home-loan NOC / closure letter");
      expect(DOC_TYPES.DeveloperNoc).toBe("Developer NOC (signed)");
      expect(DOC_TYPES.RegisteredDeed).toBe("Registered deed");
      expect(DOC_TYPES.CancellationLetter).toBe("Cancellation letter (signed)");
    });

    it("defines statutory deed steps in exact legal order", () => {
      expect(DEED_STEPS).toEqual([
        "Draft",
        "LegalApproved",
        "Consented",
        "Executed",
        "DutyPaid",
        "Registered",
      ]);
    });

    it("CaseError sets error message and status code", () => {
      const err = new CaseError("Custom error", 403);
      expect(err.message).toBe("Custom error");
      expect(err.status).toBe(403);
    });
  });

  describe("crmResaleTransfer conveyedReason guard", () => {
    it("returns null when bookingIds is empty", async () => {
      const mockDb = { request: () => ({ query: async () => ({ recordset: [] }) }) };
      const res = await conveyedReason(mockDb, []);
      expect(res).toBeNull();
    });

    it("returns null when property has not been conveyed", async () => {
      const mockDb = {
        request: () => ({
          query: async () => ({ recordset: [] }),
        }),
      };
      const res = await conveyedReason(mockDb, [101]);
      expect(res).toBeNull();
    });

    it("blocks resale and directs to Ownership Changes if sale deed is registered", async () => {
      const mockDb = {
        request: () => ({
          query: async () => ({
            recordset: [{ BookingNo: "BKG-2026-0001", Why: "its sale deed is registered" }],
          }),
        }),
      };
      const res = await conveyedReason(mockDb, [101]);
      expect(res).toContain("its sale deed is registered");
      expect(res).toContain("record a new owner in Ownership Changes instead");
    });

    it("blocks resale if handover has already started", async () => {
      const mockDb = {
        request: () => ({
          query: async () => ({
            recordset: [{ BookingNo: "BKG-2026-0002", Why: "its handover has started" }],
          }),
        }),
      };
      const res = await conveyedReason(mockDb, [102]);
      expect(res).toContain("its handover has started");
      expect(res).toContain("Ownership Changes");
    });
  });
});
