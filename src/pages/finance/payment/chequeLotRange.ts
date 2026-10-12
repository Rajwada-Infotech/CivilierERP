// The cheque numbers a cheque lot covers, e.g. "5 – 50", shown beside the lot number in the Payment form's cheque panel
// so the right lot can be picked at a glance. Null when the lot has no usable range.

export interface LotRangeLike {
  ChequeStartNumber: number | null;
  ChequeEndNumber: number | null;
}

export function chequeLotRange(lot: LotRangeLike | null | undefined): string | null {
  if (!lot) return null;
  const from = lot.ChequeStartNumber;
  const to = lot.ChequeEndNumber;
  if (from == null || to == null || !Number.isFinite(Number(from)) || !Number.isFinite(Number(to))) return null;
  return from === to ? String(from) : `${from} – ${to}`;
}
