import { FileText, Wallet, CalendarClock, CheckCircle2, Building2, Clock, StickyNote, AlertCircle, Percent, TrendingUp, Landmark, Upload, Receipt, Calendar, Hash, ListChecks, CreditCard } from "lucide-react";
import { MoneyRecive } from "iconsax-react";
import { fmt, fmtDate } from "./shared";
import { SectionLabel, InfoCard } from "./parts";
import type { LoanSanctionState } from "./useLoanSanction";

// View mode: parties, terms, repayment status, documents and notes.
export function LoanOverview({ ls }: { ls: LoanSanctionState }) {
  const { viewingLoan, uploadingDocument, documentInputRef, closingLoan, schedule, loanDocuments, handleCloseLoan, handleUploadDocument, isInterCompanyType, isCustomerLoanType, isBankLoanType, isCustomerToCompanyType, displayLender, displayBorrower, displayAmount, displayHasInterest, displayInterestType, totalEmis, paidEmis, totalScheduledAmount, paidAmount, outstandingAmount, nextDue, tabs } = ls;
  return (
    <>
      {/* Parties */}
      <SectionLabel icon={Building2} label="Parties" />
      <div className="grid grid-cols-2 gap-2">
        <InfoCard
          icon={Building2}
          label={isBankLoanType ? "Lender (Bank)" : isCustomerToCompanyType ? "Lender (Customer)" : "Lender"}
          value={displayLender || "—"}
        />
        <InfoCard
          icon={Building2}
          label={isCustomerLoanType && !isCustomerToCompanyType ? "Borrower (Customer)" : "Borrower (Company)"}
          value={displayBorrower || "—"}
        />
        {isInterCompanyType && (
          <>
            <InfoCard icon={Landmark} label="Lender Bank A/C" value={viewingLoan?.LenderBankAccountName || "—"} />
            <InfoCard icon={Landmark} label="Borrower Bank A/C" value={viewingLoan?.BorrowerBankAccountName || "—"} />
          </>
        )}
        {isCustomerLoanType && (
          <InfoCard icon={Landmark} label="Lender Bank A/C" value={viewingLoan?.LenderBankAccountName || "—"} />
        )}
      </div>

      {/* Terms */}
      <SectionLabel icon={MoneyRecive as any} label="Loan Terms" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <InfoCard icon={Wallet} label="Amount" value={fmt(displayAmount)} accent />
        <InfoCard icon={Calendar} label="Loan Date" value={fmtDate(viewingLoan?.LoanDate)} />
        <InfoCard icon={Hash} label="Loan Doc No." value={viewingLoan?.LoanDocNo || "—"} />
        <InfoCard
          icon={Clock}
          label="Tenure"
          value={viewingLoan?.TenureMonths != null ? `${viewingLoan.TenureMonths} months` : "—"}
        />
        <InfoCard
          icon={Percent}
          label="Interest"
          value={
            displayHasInterest
              ? `${viewingLoan?.InterestRate ?? "—"}% p.a. (${displayInterestType === "SI" ? "Simple" : "Compound"})`
              : "Interest-free"
          }
        />
        <InfoCard
          icon={TrendingUp}
          label="Total Interest"
          value={fmt(schedule.reduce((s, e) => s + Number(e.InterestComponent), 0))}
        />
        <InfoCard
          icon={Receipt}
          label="Total Repayable"
          value={fmt(schedule.reduce((s, e) => s + Number(e.EMIAmount), 0))}
          accent
        />
        {viewingLoan?.PaymentMode && (
          <InfoCard
            icon={CreditCard}
            label="Disbursed Via"
            value={
              viewingLoan.PaymentMode === "Cheque" || viewingLoan.PaymentMode === "Post-Dated Cheque"
                ? `${viewingLoan.PaymentMode} #${viewingLoan.ChequeNo || "—"}${viewingLoan.ChequeDate ? ` (${fmtDate(viewingLoan.ChequeDate)})` : ""}`
                : ["Cash"].includes(viewingLoan.PaymentMode)
                  ? viewingLoan.PaymentMode
                  : `${viewingLoan.PaymentMode} (Ref: ${viewingLoan.DigitalRefNumber || "—"})`
            }
          />
        )}
      </div>

      {/* Repayment Status — live financial state of the loan.
          Shows how much has been paid, what's outstanding, and
          the EMI progress at a glance without switching tabs. */}
      {schedule.length > 0 && (
        <>
          <SectionLabel icon={Receipt} label="Repayment Status" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <InfoCard
              icon={CheckCircle2}
              label="Amount Paid"
              value={fmt(paidAmount)}
              accent={paidAmount > 0}
            />
            <InfoCard
              icon={AlertCircle}
              label="Outstanding"
              value={fmt(outstandingAmount)}
              accent={outstandingAmount > 0}
            />
            <InfoCard
              icon={ListChecks}
              label="EMIs Paid"
              value={totalEmis ? `${paidEmis} / ${totalEmis}` : "—"}
            />
            <InfoCard
              icon={CalendarClock}
              label="Next Due"
              value={
                viewingLoan?.Status === "Closed"
                  ? "Closed ✓"
                  : nextDue
                    ? `${fmt(nextDue.EMIAmount)} on ${fmtDate(nextDue.DueDate)}`
                    : totalEmis > 0
                      ? "All paid"
                      : "—"
              }
            />
          </div>
          {/* Amount progress bar */}
          <div className="rounded-xl border border-border bg-muted/10 px-3.5 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-[0.6875rem] font-medium text-muted-foreground">
              <span>Repayment progress</span>
              <span className="font-heading font-bold text-foreground tabular-nums">
                {totalScheduledAmount > 0
                  ? `${Math.min(100, Math.round((paidAmount / totalScheduledAmount) * 100))}%`
                  : "—"}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full transition-all duration-500"
                style={{
                  width: `${totalScheduledAmount > 0
                    ? Math.min(100, (paidAmount / totalScheduledAmount) * 100)
                    : 0}%`,
                  boxShadow: "0 0 8px rgba(16,185,129,0.5)",
                }}
              />
            </div>
            {nextDue && viewingLoan?.Status !== "Closed" && (
              <p className={`text-[0.6875rem] flex items-center gap-1 ${
                new Date(nextDue.DueDate) < new Date(new Date().toDateString())
                  ? "text-red-600 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}>
                <AlertCircle size={11} />
                {new Date(nextDue.DueDate) < new Date(new Date().toDateString())
                  ? `Next EMI overdue — ${fmt(nextDue.EMIAmount)} was due ${fmtDate(nextDue.DueDate)}`
                  : `Next EMI: ${fmt(nextDue.EMIAmount)} due ${fmtDate(nextDue.DueDate)}`}
              </p>
            )}
          </div>
          {/* Close Loan CTA — shown only when all EMIs are paid
              and loan is still Sanctioned (not yet formally closed).
              The backend double-checks this before closing. */}
          {viewingLoan?.Status !== "Closed" && (totalEmis === 0 || paidEmis === totalEmis) && outstandingAmount <= 0 && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  All installments paid — ready to close
                </p>
                <p className="text-[0.6875rem] text-muted-foreground">
                  Formally closing the loan updates its status, records the closure date,
                  and enables NOC upload. This step requires your confirmation.
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
        </>
      )}

      {/* Documents — the agreement/sanction letter attached against Loan Doc No. */}
      <SectionLabel icon={FileText} label="Documents" />
      <div className="space-y-2">
        {loanDocuments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No documents attached yet.</p>
        ) : (
          <div className="space-y-1.5">
            {loanDocuments.map((d) => (
              <a
                key={d.AttachmentId}
                href={`/api/loan-sanction/document/${d.AttachmentId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted/40 transition-colors"
              >
                <FileText size={12} className="text-muted-foreground shrink-0" />
                <span className="flex-1 truncate font-medium text-foreground">{d.FileName}</span>
                <span className="text-[0.625rem] text-muted-foreground shrink-0">{d.DocType}</span>
              </a>
            ))}
          </div>
        )}
        <input
          ref={documentInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUploadDocument(f);
          }}
        />
        <button
          type="button"
          disabled={uploadingDocument}
          onClick={() => documentInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-muted-foreground hover:bg-muted/40 disabled:opacity-60 transition-colors"
        >
          <Upload size={12} /> {uploadingDocument ? "Uploading…" : "Attach Document"}
        </button>
      </div>

      {(viewingLoan?.Purpose || viewingLoan?.Remarks) && (
        <>
          <SectionLabel icon={StickyNote} label="Notes" />
          <div className="grid grid-cols-2 gap-3">
            <InfoCard icon={FileText} label="Purpose" value={viewingLoan?.Purpose || "—"} />
            <InfoCard icon={StickyNote} label="Remarks" value={viewingLoan?.Remarks || "—"} />
          </div>
        </>
      )}
    </>
  );
}
