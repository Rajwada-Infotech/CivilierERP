// Payment-mode ("how did it settle") state for the Journal Voucher form. Mirrors
// Fund Transfer's mode handling; the server (backend/utils/settlementMode.js)
// re-validates everything and owns the cheque-leaf availability check.

export type SettlementMode =
  | "Cash"
  | "Cheque"
  | "Post-Dated Cheque"
  | "NEFT"
  | "UPI"
  | "RTGS"
  | "IMPS"
  | "Card";

export const SETTLEMENT_MODES: SettlementMode[] = [
  "Cash",
  "Cheque",
  "Post-Dated Cheque",
  "NEFT",
  "UPI",
  "RTGS",
  "IMPS",
  "Card",
];

export const DIGITAL_REF_LABEL: Record<string, string> = {
  NEFT: "NEFT UTR Number",
  UPI: "UPI Transaction ID",
  RTGS: "RTGS UTR Number",
  IMPS: "IMPS Reference No.",
  Card: "Card Reference / Auth Code",
};

export interface SettlementValue {
  mode: SettlementMode | "";
  /** Bank account (AccountHeadMaster / BankMaster id) the settlement ran through. */
  bankId: string;
  chequeLotId: number | null;
  chequeNo: string;
  chequeDate: string;
  digitalRefNumber: string;
}

export const emptySettlement = (): SettlementValue => ({
  mode: "",
  bankId: "",
  chequeLotId: null,
  chequeNo: "",
  chequeDate: "",
  digitalRefNumber: "",
});

export const isChequeMode = (m: string) => m === "Cheque" || m === "Post-Dated Cheque";
export const isDigitalMode = (m: string) => ["NEFT", "UPI", "RTGS", "IMPS", "Card"].includes(m);
/** Anything but Cash and "no mode" moves through a bank account. */
export const needsBank = (m: string) => isChequeMode(m) || isDigitalMode(m);

/** True once anything beyond the empty state has been picked (for draft "dirty" checks). */
export const hasSettlement = (v: SettlementValue) => !!v.mode;

/** First problem that would make the server reject the mode section, or null. */
export function settlementError(v: SettlementValue): string | null {
  if (!v.mode) return null;
  if (isChequeMode(v.mode)) {
    if (!v.bankId) return "Select the bank account the cheque is drawn on.";
    if (!v.chequeLotId) return "Select a cheque lot.";
    if (!v.chequeNo) return "Select a cheque number.";
    if (!v.chequeDate) return "Enter the cheque date.";
  }
  return null;
}

/** The fields sent to the API — only what the chosen mode uses. */
export function settlementPayload(v: SettlementValue) {
  if (!v.mode) return { Mode: null };
  const cheque = isChequeMode(v.mode);
  return {
    Mode: v.mode,
    BankId: needsBank(v.mode) && v.bankId ? parseInt(v.bankId, 10) : null,
    ChequeLotId: cheque ? v.chequeLotId : null,
    ChequeNo: cheque ? v.chequeNo : null,
    ChequeDate: cheque ? v.chequeDate : null,
    DigitalRefNumber: isDigitalMode(v.mode) ? v.digitalRefNumber.trim() || null : null,
  };
}

/** Rebuilds form state from a saved voucher (edit / detail). */
export function settlementFromVoucher(v: {
  Mode?: string | null;
  BankId?: number | null;
  ChequeLotId?: number | null;
  ChequeNo?: string | null;
  ChequeDate?: string | null;
  DigitalRefNumber?: string | null;
}): SettlementValue {
  return {
    mode: (SETTLEMENT_MODES as string[]).includes(v.Mode ?? "") ? (v.Mode as SettlementMode) : "",
    bankId: v.BankId ? String(v.BankId) : "",
    chequeLotId: v.ChequeLotId ?? null,
    chequeNo: v.ChequeNo ?? "",
    chequeDate: v.ChequeDate ? v.ChequeDate.slice(0, 10) : "",
    digitalRefNumber: v.DigitalRefNumber ?? "",
  };
}
