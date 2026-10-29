import { describe, it, expect } from "vitest";
import { isValidPhone, toWhatsAppNumber } from "./phone";

describe("phone library (src/lib/phone.ts)", () => {
  describe("isValidPhone", () => {
    it("validates 10-digit Indian numbers", () => {
      expect(isValidPhone("9876543210")).toBe(true);
      expect(isValidPhone("8123456789")).toBe(true);
      expect(isValidPhone("7012345678")).toBe(true);
      expect(isValidPhone("6234567890")).toBe(true);
    });

    it("accepts Indian numbers with spaces, formatting, +91, 0, or 91 prefix", () => {
      expect(isValidPhone("+91 98765 43210")).toBe(true);
      expect(isValidPhone("09876543210")).toBe(true);
      expect(isValidPhone("919876543210")).toBe(true);
      expect(isValidPhone("p:+919876543210")).toBe(true);
    });

    it("accepts valid international numbers with country codes", () => {
      expect(isValidPhone("+971 50 123 4567")).toBe(true);
      expect(isValidPhone("+1 212 555 0199")).toBe(true);
      expect(isValidPhone("0044 20 7946 0912")).toBe(true);
    });

    it("rejects invalid numbers", () => {
      expect(isValidPhone("98765abcde")).toBe(false);
      expect(isValidPhone("1234567890")).toBe(false); // starts with 1
      expect(isValidPhone("98765")).toBe(false); // too short
      expect(isValidPhone("+123")).toBe(false); // international too short
    });

    it("treats blank / empty as valid (optional check)", () => {
      expect(isValidPhone("")).toBe(true);
      expect(isValidPhone(null)).toBe(true);
      expect(isValidPhone(undefined)).toBe(true);
    });
  });

  describe("toWhatsAppNumber", () => {
    it("prepends 91 to 10-digit Indian mobiles", () => {
      expect(toWhatsAppNumber("9876543210")).toBe("919876543210");
      expect(toWhatsAppNumber("+91 98765 43210")).toBe("919876543210");
    });

    it("correctly prepends 91 to 10-digit Indian mobiles that start with 91", () => {
      expect(toWhatsAppNumber("9123456789")).toBe("919123456789");
    });

    it("does not duplicate 91 if 12-digit number already has country code", () => {
      expect(toWhatsAppNumber("919876543210")).toBe("919876543210");
      expect(toWhatsAppNumber("+919123456789")).toBe("919123456789");
    });

    it("preserves international numbers with their own country code", () => {
      expect(toWhatsAppNumber("+971 50 123 4567")).toBe("971501234567");
      expect(toWhatsAppNumber("+1 212 555 0199")).toBe("12125550199");
    });
  });
});
