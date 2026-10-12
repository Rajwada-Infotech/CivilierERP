import { describe, expect, it } from "vitest";
import { autoPostKey, autoPostUrl, nextEntryToAutoPost } from "./paymentAutoPost";

const entry = (over: Partial<{ type: string; pmtId: number; isPosted: boolean; isBounced: boolean }> = {}) => ({
  type: "payment",
  pmtId: 6306,
  isPosted: false,
  isBounced: false,
  ...over,
});

describe("nextEntryToAutoPost", () => {
  it("takes the first entry that is not posted, bounced or a debit note", () => {
    const entries = [entry({ pmtId: 1, isPosted: true }), entry({ pmtId: 2, isBounced: true }), entry({ pmtId: 3, type: "debit_note" }), entry({ pmtId: 4 }), entry({ pmtId: 5 })];
    expect(nextEntryToAutoPost(entries, new Set())?.pmtId).toBe(4);
  });

  it("never picks an entry whose post already failed - that was the request storm", () => {
    const entries = [entry({ pmtId: 6306 })];
    expect(nextEntryToAutoPost(entries, new Set())).toBeDefined();
    expect(nextEntryToAutoPost(entries, new Set([autoPostKey(entries[0])]))).toBeUndefined();
  });

  it("moves on to the next entry after one failed, instead of stopping or looping", () => {
    const entries = [entry({ pmtId: 1 }), entry({ pmtId: 2 })];
    expect(nextEntryToAutoPost(entries, new Set(["payment:1"]))?.pmtId).toBe(2);
  });

  it("a failed bounce charge does not block the payment with the same id, and vice versa", () => {
    const entries = [entry({ type: "bounce_charge", pmtId: 9 }), entry({ type: "payment", pmtId: 9 })];
    expect(nextEntryToAutoPost(entries, new Set(["bounce_charge:9"]))?.type).toBe("payment");
  });

  it("is empty-safe", () => {
    expect(nextEntryToAutoPost([], new Set())).toBeUndefined();
  });
});

describe("autoPostUrl", () => {
  it("posts payments and bounce charges to their own endpoints", () => {
    expect(autoPostUrl({ type: "payment", pmtId: 6306 })).toBe("/api/new-payment/6306/post-to-gl");
    expect(autoPostUrl({ type: "bounce_charge", pmtId: 6306 })).toBe("/api/new-payment/6306/post-bounce-charge-to-gl");
  });
});
