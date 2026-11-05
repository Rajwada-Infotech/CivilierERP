import { FileText, Wallet, CalendarClock, CheckCircle2, Circle, Clock, TrendingDown, Upload, FileCheck2 } from "lucide-react";
import { fmt, fmtDate } from "./shared";
import { StatTile } from "./parts";
import type { LoanSanctionState } from "./useLoanSanction";

// The full EMI repayment plan.
export function ScheduleTab({ ls }: { ls: LoanSanctionState }) {
  const { viewingLoan, tab, uploadingNoc, nocInputRef, schedule, scheduleLoading, handleUploadNoc, chequeByPaymentId, totalEmis, paidEmis, paidAmount, outstandingAmount, nextDue } = ls;
  return (
    <>
      {/* EMI Schedule tab — the full repayment PLAN (all installments, editable) */}
      {tab === "schedule" && viewingLoan && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile icon={CalendarClock} label="Installments" value={`${paidEmis}/${totalEmis}`} accent="#3b82f6" />
            <StatTile icon={CheckCircle2} label="Paid" value={fmt(paidAmount)} accent="#22c55e" />
            <StatTile icon={TrendingDown} label="Outstanding" value={fmt(outstandingAmount)} accent="#f59e0b" />
            <StatTile
              icon={Clock}
              label="Next Due"
              value={nextDue ? fmtDate(nextDue.DueDate) : "All settled"}
              accent={nextDue ? "#ef4444" : "#22c55e"}
            />
          </div>

          {viewingLoan.Status !== "Closed" && (
            <div className="border border-foreground/30 p-3.5 flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
              <Wallet size={13} className="shrink-0" />
              EMIs are paid from the <span className="font-semibold text-foreground">Finance → Payment</span> page (Loan EMIs tab) — this view is read-only.
            </div>
          )}

          <div className="border border-foreground/30 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 text-[0.625rem] font-heading uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="text-left px-3 py-2.5">#</th>
                  <th className="text-left px-3 py-2.5">Due Date</th>
                  <th className="text-right px-3 py-2.5">Principal</th>
                  <th className="text-right px-3 py-2.5">Interest</th>
                  <th className="text-right px-3 py-2.5">EMI Amount</th>
                  <th className="text-left px-3 py-2.5">Cheque No.</th>
                  <th className="text-center px-3 py-2.5">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/15">
                {scheduleLoading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground text-xs">
                      Loading…
                    </td>
                  </tr>
                ) : schedule.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground text-xs">
                      No EMI installments for this loan.
                    </td>
                  </tr>
                ) : (
                  schedule.map((emi) => {
                    const isNext = nextDue?.EMIId === emi.EMIId;
                    const isOverdue = !emi.IsPaid && new Date(emi.DueDate) < new Date(new Date().toDateString());
                    return (
                      <tr
                        key={emi.EMIId}
                        className={
                          emi.IsPaid ? undefined : isNext ? "bg-primary/5" : undefined
                        }
                      >
                        <td className="px-3 py-2.5 text-muted-foreground">{emi.InstallmentNo}</td>
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-1.5">
                            {fmtDate(emi.DueDate)}
                            {isNext && (
                              <span className="px-1.5 py-0.5 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-foreground border border-dashed border-foreground">
                                NEXT
                              </span>
                            )}
                            {isOverdue && (
                              <span className="px-1.5 py-0.5 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-destructive border border-destructive">
                                OVERDUE
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-heading tabular-nums">{fmt(emi.PrincipalComponent)}</td>
                        <td className="px-3 py-2.5 text-right font-heading tabular-nums text-muted-foreground">
                          {fmt(emi.InterestComponent)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-heading tabular-nums font-medium">{fmt(emi.EMIAmount)}</td>
                        <td className="px-3 py-2.5 font-heading tabular-nums text-xs text-muted-foreground">
                          {chequeByPaymentId.get(emi.PaymentId)?.chequeNo ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {emi.IsPaid ? (
                            <CheckCircle2 size={15} className="text-foreground inline-block" />
                          ) : (
                            <Circle size={15} className="text-muted-foreground/40 inline-block" />
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {viewingLoan.Status === "Closed" && (
            <div className="border border-foreground p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <FileCheck2 size={16} className="text-foreground shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-foreground">Loan fully repaid and closed</p>
                  <p className="text-[0.6875rem] text-muted-foreground">
                    {viewingLoan.NOCFileName
                      ? `NOC on file: ${viewingLoan.NOCFileName}`
                      : "Upload the No Objection Certificate (NOC) once received."}
                  </p>
                </div>
              </div>
              {viewingLoan.NOCFileName ? (
                <a
                  href={`/api/loan-sanction/noc/${viewingLoan.NOCAttachmentId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed h-9 px-4 border border-foreground text-foreground hover:bg-primary/10"
                >
                  <FileText size={12} /> View NOC
                </a>
              ) : (
                <>
                  <input
                    ref={nocInputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadNoc(f);
                    }}
                  />
                  <button
                    type="button"
                    disabled={uploadingNoc}
                    onClick={() => nocInputRef.current?.click()}
                    className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed h-9 px-4 bg-foreground text-card border border-foreground"
                  >
                    <Upload size={12} /> {uploadingNoc ? "Uploading…" : "Upload NOC"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
