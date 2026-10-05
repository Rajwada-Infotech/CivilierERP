import { describe, it, expect } from "vitest";
import {
  evaluateExpression,
  expressionFromPaste,
  sanitizeExpression,
  formatIndian,
  plainNumber,
} from "./calcExpression";

const val = (s: string) => {
  const r = evaluateExpression(s);
  if (!r.ok) throw new Error(`"${s}" failed: ${r.error}`);
  return r.value;
};

describe("evaluateExpression", () => {
  it("does ordinary arithmetic with the right precedence", () => {
    expect(val("2 + 3 * 4")).toBe(14);
    expect(val("(2 + 3) * 4")).toBe(20);
    expect(val("10 / 4")).toBe(2.5);
    expect(val("2 ^ 3 ^ 2")).toBe(512); // right-associative
    expect(val("-5 + 2")).toBe(-3);
    expect(val("3 * -2")).toBe(-6);
  });

  it("avoids floating point noise", () => {
    expect(val("0.1 + 0.2")).toBe(0.3);
    expect(val("1.1 * 3")).toBe(3.3);
  });

  it("treats a trailing % like a pocket calculator", () => {
    expect(val("200 + 10%")).toBe(220);
    expect(val("200 - 10%")).toBe(180);
    expect(val("50%")).toBe(0.5);
    expect(val("200 * 10%")).toBe(20);
  });

  it("accepts figures pasted from invoices and spreadsheets", () => {
    expect(val("₹1,23,456.50 + 3.50")).toBe(123460);
    expect(val("Rs. 1,000 × 3")).toBe(3000);
    expect(val("900 ÷ 4")).toBe(225);
    expect(val("10 − 4")).toBe(6);
  });

  it("reports problems instead of throwing", () => {
    expect(evaluateExpression("5 / 0")).toEqual({ ok: false, error: "Division by zero" });
    expect(evaluateExpression("(2 + 3").ok).toBe(false);
    expect(evaluateExpression("2 +").ok).toBe(false);
    expect(evaluateExpression("1.2.3").ok).toBe(false);
    expect(evaluateExpression("").ok).toBe(false);
  });

  it("can never run pasted text as code", () => {
    // Everything that isn't maths is stripped before parsing.
    expect(sanitizeExpression("alert(1); 2+2")).toBe("(1) 2+2");
    expect(evaluateExpression("process.exit()").ok).toBe(false);
  });
});

describe("expressionFromPaste", () => {
  it("sums a pasted column of amounts", () => {
    expect(expressionFromPaste("1,200\n800\n450.50")).toBe("1200 + 800 + 450.50");
    expect(val(expressionFromPaste("1,200\r\n800\r\n450.50"))).toBe(2450.5);
  });

  it("keeps negative amounts as subtractions", () => {
    expect(val(expressionFromPaste("1000\n-250"))).toBe(750);
  });

  it("passes a normal expression through, cleaned", () => {
    expect(expressionFromPaste("₹ 5,000 * 2")).toBe("5000 * 2");
  });
});

describe("formatting", () => {
  it("groups digits the Indian way", () => {
    expect(formatIndian(1234567.5)).toBe("12,34,567.5");
  });
  it("copies a plain number with no separators", () => {
    expect(plainNumber(1234567.5)).toBe("1234567.5");
    expect(plainNumber(0.1 + 0.2)).toBe("0.3");
  });
});
