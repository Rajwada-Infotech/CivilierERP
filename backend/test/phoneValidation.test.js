const { normalizePhone, cleanPhoneFields } = require("../validation/phone");

describe("phone validation service (backend/validation/phone.js)", () => {
  describe("Indian mobile normalization", () => {
    test("accepts standard 10-digit Indian numbers starting with 6, 7, 8, 9", () => {
      expect(normalizePhone("9876543210")).toEqual({ value: "9876543210" });
      expect(normalizePhone("8123456789")).toEqual({ value: "8123456789" });
      expect(normalizePhone("7012345678")).toEqual({ value: "7012345678" });
      expect(normalizePhone("6234567890")).toEqual({ value: "6234567890" });
    });

    test("cleans formatting characters (spaces, dashes, brackets, dots)", () => {
      expect(normalizePhone("98765 43210")).toEqual({ value: "9876543210" });
      expect(normalizePhone("(98765) 432-10")).toEqual({ value: "9876543210" });
      expect(normalizePhone("98765.43210")).toEqual({ value: "9876543210" });
    });

    test("strips leading 0 or 91 country code prefix for Indian numbers", () => {
      expect(normalizePhone("09876543210")).toEqual({ value: "9876543210" });
      expect(normalizePhone("919876543210")).toEqual({ value: "9876543210" });
      expect(normalizePhone("+91 98765 43210")).toEqual({ value: "9876543210" });
      expect(normalizePhone("0091 98765 43210")).toEqual({ value: "9876543210" });
    });

    test("strips Meta / Facebook export 'p:' prefix", () => {
      expect(normalizePhone("p:+919876543210")).toEqual({ value: "9876543210" });
      expect(normalizePhone("p:9876543210")).toEqual({ value: "9876543210" });
    });

    test("correctly handles Indian mobiles that start with 91 as subscriber number", () => {
      // 9123456789 is a 10-digit Indian mobile starting with 91
      expect(normalizePhone("9123456789")).toEqual({ value: "9123456789" });
      // +91 9123456789 -> strips country code +91 and keeps 9123456789
      expect(normalizePhone("+91 9123456789")).toEqual({ value: "9123456789" });
    });
  });

  describe("International E.164 numbers", () => {
    test("keeps international country codes with + prefix and 8-15 digits", () => {
      expect(normalizePhone("+971 50 123 4567")).toEqual({ value: "+971501234567" });
      expect(normalizePhone("+1 (212) 555-0199")).toEqual({ value: "+12125550199" });
      expect(normalizePhone("+44 20 7946 0912")).toEqual({ value: "+442079460912" });
    });

    test("converts leading 00 to + for international numbers", () => {
      expect(normalizePhone("00971 50 123 4567")).toEqual({ value: "+971501234567" });
      expect(normalizePhone("001 212 555 0199")).toEqual({ value: "+12125550199" });
    });
  });

  describe("Invalid phone rejection", () => {
    test("rejects numbers with letters or special characters other than allowed punctuation", () => {
      expect(normalizePhone("98765abcde").error).toBeDefined();
      expect(normalizePhone("98765@4321").error).toBeDefined();
    });

    test("rejects Indian numbers starting with invalid digits (0-5 without prefix)", () => {
      expect(normalizePhone("5123456789").error).toMatch(/10-digit Indian mobile/);
      expect(normalizePhone("1234567890").error).toMatch(/10-digit Indian mobile/);
      expect(normalizePhone("0123456789").error).toMatch(/10-digit Indian mobile/);
    });

    test("rejects numbers that are too short or too long without a country code", () => {
      expect(normalizePhone("98765").error).toMatch(/10-digit Indian mobile/);
      expect(normalizePhone("9876543210123").error).toMatch(/10-digit Indian mobile/);
    });

    test("rejects international numbers with fewer than 8 or more than 15 digits", () => {
      expect(normalizePhone("+123").error).toMatch(/8 to 15 digits/);
      expect(normalizePhone("+1234567890123456").error).toMatch(/8 to 15 digits/);
    });
  });

  describe("Blank and optional handling", () => {
    test("returns null for empty, undefined, or whitespace-only values", () => {
      expect(normalizePhone("")).toEqual({ value: null });
      expect(normalizePhone("   ")).toEqual({ value: null });
      expect(normalizePhone(null)).toEqual({ value: null });
      expect(normalizePhone(undefined)).toEqual({ value: null });
    });
  });

  describe("cleanPhoneFields helper", () => {
    test("cleans multiple phone fields on a request body in place", () => {
      const body = {
        CustomerName: "John Doe",
        Mobile: "+91 98765 43210",
        AltMobile: "08123456789",
      };
      const err = cleanPhoneFields(body, { Mobile: "Mobile", AltMobile: "Alternate mobile" });
      expect(err).toBeNull();
      expect(body.Mobile).toBe("9876543210");
      expect(body.AltMobile).toBe("8123456789");
    });

    test("returns first error and halts on invalid field", () => {
      const body = {
        Mobile: "invalid",
        AltMobile: "9876543210",
      };
      const err = cleanPhoneFields(body, { Mobile: "Mobile", AltMobile: "Alternate mobile" });
      expect(err).toMatch(/Mobile must contain only digits/);
    });

    test("ignores fields not present in body", () => {
      const body = { Mobile: "9876543210" };
      const err = cleanPhoneFields(body, { Mobile: "Mobile", AltMobile: "Alternate mobile" });
      expect(err).toBeNull();
      expect(body.AltMobile).toBeUndefined();
    });
  });
});
