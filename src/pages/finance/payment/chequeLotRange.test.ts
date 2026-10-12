import { describe, expect, it } from "vitest";
import { chequeLotRange } from "./chequeLotRange";

describe("chequeLotRange", () => {
  it("writes the range of a lot", () => {
    expect(chequeLotRange({ ChequeStartNumber: 5, ChequeEndNumber: 50 })).toBe("5 – 50");
    expect(chequeLotRange({ ChequeStartNumber: 400001, ChequeEndNumber: 400100 })).toBe("400001 – 400100");
  });
  it("a one-cheque lot shows just that number", () => {
    expect(chequeLotRange({ ChequeStartNumber: 7, ChequeEndNumber: 7 })).toBe("7");
  });
  it("shows nothing when the range is not recorded", () => {
    expect(chequeLotRange({ ChequeStartNumber: null, ChequeEndNumber: 50 })).toBeNull();
    expect(chequeLotRange({ ChequeStartNumber: 5, ChequeEndNumber: null })).toBeNull();
    expect(chequeLotRange(null)).toBeNull();
    expect(chequeLotRange(undefined)).toBeNull();
  });
});
