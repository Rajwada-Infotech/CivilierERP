import { useState, useEffect } from "react";
import { toast } from "sonner";
import { fetchChequeLots, fetchChequeNumbers, deductChequeFromLot } from "@/pages/finance/payment/api";
import { type ChequeLot } from "@/pages/finance/payment/types";
import { type LoanSanction } from "@/api/loanSanctionApi";
import { DateInput } from "@/components/ui/date-input";
import { chequeLotRange } from "@/pages/finance/payment/chequeLotRange";
import { inputCls, labelCls } from "./shared";

// Cheque Lot / Cheque Number picker for the disbursement's Cheque or
// Post-Dated Cheque mode — same fetchChequeLots/fetchChequeNumbers/
// deductChequeFromLot API Finance > Payment's ChequePanel uses, so a
// cheque picked here is deducted from the same shared lot and can't be
// reused by both flows. LoanSanction has no bank-account column of its
// own for disbursement (only the lender's bank, when the loan type IS a
// bank), so bankId is optional — fetchChequeLots(null) returns every
// active lot when there's nothing to filter by.
export function LoanChequePicker({
  bankId,
  chequeLotId,
  chequeNo,
  chequeDate,
  isPostDated,
  onLotChange,
  onChequeNoChange,
  onChequeDateChange,
}: {
  bankId: number | null;
  chequeLotId: string;
  chequeNo: string;
  chequeDate: string;
  isPostDated: boolean;
  onLotChange: (lot: ChequeLot) => void;
  onChequeNoChange: (chequeNo: string) => void;
  onChequeDateChange: (date: string) => void;
}) {
  const [lots, setLots] = useState<ChequeLot[]>([]);
  const [loadingLots, setLoadingLots] = useState(false);
  const [chequeNumbers, setChequeNumbers] = useState<{ number: string; used: boolean; bounced: boolean }[]>([]);
  const [loadingCheques, setLoadingCheques] = useState(false);
  const [validating, setValidating] = useState(false);

  useEffect(() => {
    // No bank picked yet — don't fetch at all, let alone show every active
    // lot across every bank. The picker stays hidden until there's an
    // actual bank to scope it to (see the bankId == null render guard).
    if (!bankId) {
      setLots([]);
      return;
    }
    setLoadingLots(true);
    fetchChequeLots(bankId)
      .then((fetched) => {
        setLots(fetched);
        if (fetched.length > 0 && !chequeLotId) onLotChange(fetched[0]);
      })
      .catch(() => setLots([]))
      .finally(() => setLoadingLots(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId]);

  useEffect(() => {
    const lotIdNum = chequeLotId ? Number(chequeLotId) : null;
    if (!lotIdNum) {
      setChequeNumbers([]);
      return;
    }
    setLoadingCheques(true);
    fetchChequeNumbers(lotIdNum)
      .then(setChequeNumbers)
      .catch(() => setChequeNumbers([]))
      .finally(() => setLoadingCheques(false));
  }, [chequeLotId]);

  const activeLot = lots.find((l) => String(l.CId) === chequeLotId) ?? null;
  const availableCheques = chequeNumbers.filter((c) => !c.used && !c.bounced);

  const handleChequeSelect = async (nextChequeNo: string) => {
    onChequeNoChange(nextChequeNo);
    const lotIdNum = chequeLotId ? Number(chequeLotId) : null;
    if (!nextChequeNo || !lotIdNum) return;
    setValidating(true);
    try {
      await deductChequeFromLot(lotIdNum, nextChequeNo);
    } catch (err: any) {
      toast.error(err.message);
      onChequeNoChange("");
    } finally {
      setValidating(false);
    }
  };

  // Nothing to scope a cheque lot to yet — stay out of the way entirely
  // rather than showing every lot across every bank, or an explanatory
  // "select a bank first" placeholder.
  if (!bankId) return null;

  return (
    <>
      <div className="space-y-2">
        <label className={labelCls}>Cheque Lot</label>
        {loadingLots ? (
          <div className={`${inputCls} flex items-center text-xs text-muted-foreground`}>Loading lots…</div>
        ) : lots.length === 0 ? (
          <div className={`${inputCls} flex items-center text-xs text-foreground`}>No active cheque lots found.</div>
        ) : (
          <select
            className={inputCls}
            value={chequeLotId}
            onChange={(e) => {
              const lot = lots.find((l) => String(l.CId) === e.target.value);
              if (lot) onLotChange(lot);
            }}
          >
            <option value="">— Select lot —</option>
            {lots.map((lot) => (
              <option key={lot.CId} value={String(lot.CId)}>
                {lot.ChequeLotNumber}
                {chequeLotRange(lot) ? ` · Cheques ${chequeLotRange(lot)}` : ""}
                {lot.RemainingCheques != null ? ` (${lot.RemainingCheques} left)` : ""}
              </option>
            ))}
          </select>
        )}
        {chequeLotRange(activeLot) && (
          <p className="text-[0.6875rem] text-muted-foreground normal-case tracking-normal">Cheques {chequeLotRange(activeLot)}</p>
        )}
      </div>
      <div className="space-y-2">
        <label className={labelCls}>Cheque Number</label>
        <select
          className={inputCls}
          value={chequeNo}
          onChange={(e) => handleChequeSelect(e.target.value)}
          disabled={!activeLot || loadingCheques || validating}
        >
          <option value="">— Select cheque number —</option>
          {availableCheques.map((c) => (
            <option key={c.number} value={c.number}>
              # {c.number}
            </option>
          ))}
        </select>
        {activeLot && availableCheques.length === 0 && !loadingCheques && (
          <p className="text-[0.6875rem] text-foreground">No available cheques left in this lot.</p>
        )}
      </div>
      <div className="space-y-2">
        <label className={labelCls}>{isPostDated ? "Post-Dated Cheque Date" : "Cheque Date"}</label>
        <DateInput
          className={inputCls}
          value={chequeDate}
          min={isPostDated ? new Date().toISOString().slice(0, 10) : undefined}
          max={isPostDated ? undefined : new Date().toISOString().slice(0, 10)}
          onChange={(e) => onChequeDateChange(e.target.value)}
        />
      </div>
    </>
  );
}
