// Bank Report (Reports > Finance): the cheque number of a row whose payment mode is Cheque.
//
// The report merges outgoing payments, received payments, CRM customer receipts, fund transfers and loan entries.
//   - payments / received payments carry the cheque number in ChequeNo;
//   - CRM customer receipts keep it in their reference (TxnId) - only that kind of row falls back to it;
//   - anything that is not paid by cheque (cash, NEFT, fund transfers, loans) shows a dash.

export const NO_CHEQUE = "—";

/** "Cheque", "Post-Dated Cheque", "cheque" ... */
export const isChequeMode = (mode: unknown): boolean => /cheque/i.test(String(mode ?? ""));

export function bankReportChequeNo(row: Record<string, unknown>): string {
  if (!isChequeMode(row.Mode)) return NO_CHEQUE;
  const direct = String(row.ChequeNo ?? "").trim();
  if (direct) return direct;
  if (row.SourceType === "CRM_RECEIVED") {
    const reference = String(row.TxnId ?? "").trim();
    if (reference) return reference;
  }
  return NO_CHEQUE;
}
