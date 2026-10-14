import { History, CheckCircle2, Circle, AlertCircle, FileCheck2, Receipt } from "lucide-react";
import { fmt, fmtDate, paymentInstrumentLabel } from "./shared";
import { ChainNode } from "./parts";
import type { LoanSanctionState } from "./useLoanSanction";

// What has actually been repaid so far.
export function HistoryTab({ ls }: { ls: LoanSanctionState }) {
  const { viewingLoan, tab, closingLoan, schedule, payments, set, handleCloseLoan, totalEmis, paidEmis, outstandingAmount, nextDue } = ls;
  return (
    <>
      {/* Repayment History tab — narrative HISTORY: what's actually happened so far */}
      {tab === "chain" && viewingLoan && (
        <div className="space-y-5">
          {/* Progress bar */}
          <div className="rounded-xl border border-border p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">Repayment Progress</span>
              <span className="text-muted-foreground">
                {totalEmis ? `${paidEmis} of ${totalEmis} installments paid` : "No EMI schedule"}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full transition-all"
                style={{ width: `${totalEmis ? (paidEmis / totalEmis) * 100 : 0}%` }}
              />
            </div>
            {nextDue ? (
              <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 pt-1">
                <AlertCircle size={12} />
                Next EMI ({fmt(nextDue.EMIAmount)}) due {fmtDate(nextDue.DueDate)}
              </div>
            ) : totalEmis > 0 ? (
              <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 pt-1">
                <CheckCircle2 size={12} />
                Fully repaid
              </div>
            ) : null}
          </div>

          {/* Event timeline — repayments only (money coming BACK from
              the borrower/lender). Disbursement (money going OUT) is
              not a repayment and belongs on Overview's "Disbursed Via"
              card instead — showing it here as the chain's first node
              used to make an outgoing loan read as if it were itself
              the first incoming repayment. */}
          <div>
            {payments.map((p, i, arr) => (
              <ChainNode
                key={p.PaymentId}
                icon={<Receipt size={13} className="text-emerald-500" />}
                title={`${p.PaymentType === "LumpSum" ? "Lump Sum Payment" : `${p.EmisCovered} EMI${p.EmisCovered === 1 ? "" : "s"} Paid`} — ${p.PaymentRef}`}
                subtitle={(() => {
                  const instrLabel = paymentInstrumentLabel(p);
                  const instrPart = instrLabel === "NOT_ON_FILE"
                    ? " · Payment mode not on file"
                    : instrLabel
                      ? ` · ${instrLabel}`
                      : "";
                  const docNoPart = p.PaymentDocNo ? ` · Finance ref: ${p.PaymentDocNo}` : "";
                  return `${fmt(p.TotalAmount)}${p.LateFee > 0 ? ` (incl. ${fmt(p.LateFee)} late fee)` : ""} · Paid ${fmtDate(p.PaymentDate)}${instrPart}${docNoPart}${p.CreatedBy ? ` by ${p.CreatedBy}` : ""}${p.ExcessCredited > 0 ? ` · ${fmt(p.ExcessCredited)} excess credited to lender's on-account` : ""}${p.ClosedLoan && viewingLoan.Status !== "Closed" ? " · All installments settled" : ""}`;
                })()}
                done
                isLast={i === arr.length - 1 && viewingLoan.Status === "Closed"}
              />
            ))}
            {/* EMIs can be marked paid (IsPaid=1 on LoanEMISchedule)
                with no matching dbo.LoanPayment row — pre-dates the
                Payment-page-only repayment flow, or was set directly
                rather than through it. Surfacing this honestly (with
                whatever PaidDate is on file) instead of either hiding
                it or showing the contradictory "No payments yet" next
                to a progress bar that's clearly already moved. */}
            {payments.length === 0 && paidEmis > 0 && (
              <ChainNode
                icon={<Receipt size={13} className="text-amber-500" />}
                title={`${paidEmis} installment${paidEmis === 1 ? "" : "s"} marked paid`}
                subtitle={`Payment details not on record for ${paidEmis === 1 ? "this installment" : "these installments"} — recorded before the repayment system was updated.${schedule.find((e) => e.IsPaid)?.PaidDate ? ` Earliest paid: ${fmtDate(schedule.find((e) => e.IsPaid)!.PaidDate!)}.` : ""}`}
                done
                isLast={viewingLoan.Status !== "Closed"}
              />
            )}
            {viewingLoan.Status === "Closed" && (
              <ChainNode
                icon={<FileCheck2 size={13} className="text-emerald-500" />}
                title="Loan Fully Repaid — Closed"
                subtitle={
                  viewingLoan.NOCFileName
                    ? `NOC on file: ${viewingLoan.NOCFileName}`
                    : viewingLoan.ClosedAt
                      ? `Closed ${fmtDate(viewingLoan.ClosedAt)} — NOC not yet uploaded`
                      : "NOC not yet uploaded"
                }
                done
                isLast
              />
            )}
            {viewingLoan.Status !== "Closed" && payments.length === 0 && paidEmis === 0 && (
              <ChainNode
                icon={<Circle size={13} className="text-amber-500" />}
                title="No payments yet"
                subtitle="Pay from Finance → Payment (Loan EMIs tab) — an installment or a lump sum."
                done={false}
                isLast
              />
            )}
          </div>

          {/* Close Loan CTA in Repayment History tab — same logic as in
              Overview: show only when all EMIs paid and loan still open */}
          {viewingLoan.Status !== "Closed" && (totalEmis === 0 || paidEmis === totalEmis) && outstandingAmount <= 0 && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  All installments paid — ready to close
                </p>
                <p className="text-[0.6875rem] text-muted-foreground">
                  Click to formally close this loan, record the closure date, and unlock NOC upload.
                </p>
              </div>
              <button
                onClick={handleCloseLoan}
                disabled={closingLoan}
                className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60 transition-colors"
              >
                <CheckCircle2 size={14} />
                {closingLoan ? "Closing…" : "Close Loan"}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
