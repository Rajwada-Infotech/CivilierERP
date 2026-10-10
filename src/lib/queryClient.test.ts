import { describe, expect, it } from "vitest";
import { ApiError } from "./fetchWithAuth";
import { shouldRetry } from "./queryClient";

describe("shouldRetry", () => {
  it("never retries a rate limit, however it was thrown", () => {
    expect(shouldRetry(0, Object.assign(new Error("x"), { status: 429 }), 2)).toBe(false);
    expect(shouldRetry(0, new Error("Too many requests, please try again later."), 2)).toBe(false); // plain Error, no status
    expect(shouldRetry(0, new Error("GET failed: 429"), 2)).toBe(false);
  });

  it("never retries an expired session or a refusal", () => {
    expect(shouldRetry(0, new ApiError("no", 401), 2)).toBe(false);
    expect(shouldRetry(0, new ApiError("no", 403), 2)).toBe(false);
  });

  it("still retries ordinary failures, up to the limit", () => {
    expect(shouldRetry(0, new Error("Network error"), 2)).toBe(true);
    expect(shouldRetry(1, new Error("Network error"), 2)).toBe(true);
    expect(shouldRetry(2, new Error("Network error"), 2)).toBe(false);
    expect(shouldRetry(0, new Error("Server error 500"), 2)).toBe(true);
  });

  it("does not mistake a number that merely contains 429 for a rate limit", () => {
    expect(shouldRetry(0, new Error("Invoice INV-14290 not found"), 2)).toBe(true);
    expect(shouldRetry(0, new Error("Amount 4290.00 is invalid"), 2)).toBe(true);
  });
});
