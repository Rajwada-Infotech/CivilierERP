import { describe, expect, it } from "vitest";
import { bankReportChequeNo, isChequeMode, NO_CHEQUE } from "./bankReportCheque";

describe("isChequeMode", () => {
  it("recognises every spelling of a cheque payment", () => {
    for (const mode of ["Cheque", "cheque", "CHEQUE", "Post-Dated Cheque", "Post Dated Cheque"]) expect(isChequeMode(mode)).toBe(true);
  });
  it("is false for everything else, and for nothing at all", () => {
    for (const mode of ["Cash", "NEFT", "UPI", "RTGS", "Fund Transfer", "Loan Disbursement", "", null, undefined]) expect(isChequeMode(mode)).toBe(false);
  });
});

describe("bankReportChequeNo", () => {
  it("shows the cheque number of a payment made by cheque", () => {
    expect(bankReportChequeNo({ Mode: "Cheque", SourceType: "PAYMENT", ChequeNo: "004512", TxnId: "004512" })).toBe("004512");
    expect(bankReportChequeNo({ Mode: "Post-Dated Cheque", SourceType: "RECEIVED", ChequeNo: " 778899 " })).toBe("778899");
  });

  it("shows a dash when the mode is not cheque, even if some number is on the row", () => {
    expect(bankReportChequeNo({ Mode: "NEFT", ChequeNo: "004512", TxnId: "UTR123" })).toBe(NO_CHEQUE);
    expect(bankReportChequeNo({ Mode: "Fund Transfer", ChequeNo: null })).toBe(NO_CHEQUE);
    expect(bankReportChequeNo({ Mode: "Cash" })).toBe(NO_CHEQUE);
    expect(bankReportChequeNo({})).toBe(NO_CHEQUE);
  });

  it("a cheque row with no number recorded shows a dash, not a blank or 'null'", () => {
    expect(bankReportChequeNo({ Mode: "Cheque", SourceType: "PAYMENT", ChequeNo: null })).toBe(NO_CHEQUE);
    expect(bankReportChequeNo({ Mode: "Cheque", SourceType: "PAYMENT", ChequeNo: "   " })).toBe(NO_CHEQUE);
  });

  it("CRM customer receipts keep the cheque number in their reference, so only they fall back to it", () => {
    expect(bankReportChequeNo({ Mode: "Cheque", SourceType: "CRM_RECEIVED", ChequeNo: null, TxnId: "556677" })).toBe("556677");
    // a payment's TxnId is not trusted: it can hold a digital reference
    expect(bankReportChequeNo({ Mode: "Cheque", SourceType: "PAYMENT", ChequeNo: null, TxnId: "UTR999" })).toBe(NO_CHEQUE);
  });

  it("keeps leading zeros (a cheque number is text, not a number)", () => {
    expect(bankReportChequeNo({ Mode: "Cheque", ChequeNo: "000123" })).toBe("000123");
  });
});
