import { Wallet, CheckCircle2, AlertCircle, Receipt, Save } from "lucide-react";
import { fmt, fmtDate } from "./shared";
import { PostingCard } from "./parts";
import type { LoanSanctionState } from "./useLoanSanction";

// The loan's general-ledger postings.
export function PostingTab({ ls }: { ls: LoanSanctionState }) {
  const { viewingLoan, tab, loanPostingData, loanPostingLoading, loanPosting, loanPostingError, loans, readOnly, isBankLoan, displayLender, displayBorrower, displayAmount } = ls;
  return (
    <>
      {/* Posting tab */}
      {tab === "posting" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Wallet size={14} className="text-foreground" />
              <span className="text-[0.625rem] font-heading font-semibold font-heading uppercase tracking-[0.12em] text-muted-foreground">
                Journal Entry — Loan Posting
              </span>
            </div>
            {readOnly && (
              loanPostingLoading ? (
                <span className="text-[0.625rem] text-muted-foreground">Loading…</span>
              ) : loanPostingData?.isPosted ? (
                <span className="flex items-center gap-1 px-1.5 py-0.5 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] bg-foreground text-card border border-foreground">
                  <CheckCircle2 size={10} /> Posted · {loanPostingData.jvNo || viewingLoan?.LoanNo}
                </span>
              ) : loanPosting ? (
                <span className="flex items-center gap-1.5 text-[0.625rem] text-muted-foreground">
                  <span className="w-2.5 h-2.5 border-2 border-foreground border-t-transparent rounded-full animate-spin" />
                  Posting…
                </span>
              ) : loanPostingError ? (
                <span className="flex items-center gap-1 px-1.5 py-0.5 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-destructive border border-destructive">
                  <AlertCircle size={10} /> {loanPostingError}
                </span>
              ) : (
                <span className="flex items-center gap-1 px-1.5 py-0.5 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-foreground border border-dashed border-foreground">
                  <AlertCircle size={10} /> Not disbursed
                </span>
              )
            )}
          </div>
          {readOnly && (loanPostingData?.postings?.length ?? 0) > 1 ? (
            // Inter-Company: two separate company-scoped entries were
            // actually posted (see POST / in loanSanction.js) — show
            // each company's own books as its own card, same Dr/Cr
            // layout as the invoice Payment page's own Posting tab
            // (Payment.tsx "GL Postings — Full Payment Chain"), rather
            // than the plain single-JV table below (which only
            // applies when there's just one posting, i.e. Bank/
            // Customer loans).
            <div className="space-y-4">
              {loanPostingData.postings.map((p: any, i: number) => (
                <PostingCard key={p.companyId ?? i} p={p} />
              ))}
            </div>
          ) : (() => {
            // Same debit/credit grid + colored side-dot styling as
            // GRN's Posting tab (GRN.tsx "Journal Entry — GRN
            // Posting"), instead of a plain <table> — kept visually
            // identical across the app's posting views.
            const gridCols = "grid-cols-[minmax(0,2.5fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] sm:grid-cols-[minmax(0,2.2fr)_1.2fr_1fr_1fr]";
            const borrowerGroup = readOnly
              ? viewingLoan?.BorrowerGroupName
                ? `${viewingLoan.BorrowerParentGroupName ? `${viewingLoan.BorrowerParentGroupName} / ` : ""}${viewingLoan.BorrowerGroupName}`
                : "—"
              : "Loans and Advances";
            const lenderGroup = readOnly
              ? viewingLoan?.LenderGroupName
                ? `${viewingLoan.LenderParentGroupName ? `${viewingLoan.LenderParentGroupName} / ` : ""}${viewingLoan.LenderGroupName}`
                : "—"
              : isBankLoan
                ? "Bank's own account group"
                : "Loans and Advances";
            return (
              <div className="border border-foreground/30 overflow-hidden">
                <div className={`grid ${gridCols} border-b border-foreground px-2 sm:px-4 py-2.5 text-[0.5625rem] sm:text-[0.625rem] font-heading uppercase tracking-[0.12em] text-muted-foreground font-semibold gap-1 sm:gap-2`}>
                  <span>Account</span>
                  <span>Account Group</span>
                  <span className="text-right">Debit (₹)</span>
                  <span className="text-right">Credit (₹)</span>
                </div>
                <div className={`grid ${gridCols} px-2 sm:px-4 py-3 border-b border-foreground/50 items-center gap-1 sm:gap-2`}>
                  <div className="flex items-center gap-2 min-w-0 pl-1">
                    <span className="font-heading text-[0.5625rem] font-semibold w-5 shrink-0 text-foreground">Dr</span>
                    <span className="text-[0.6875rem] sm:text-xs text-foreground break-words sm:truncate min-w-0">
                      Loan — {displayBorrower || "Borrower"}
                      {readOnly && viewingLoan?.BorrowerLHeadCode && ` (${viewingLoan.BorrowerLHeadCode})`}
                    </span>
                  </div>
                  <span className="text-[0.6875rem] text-muted-foreground truncate">{borrowerGroup}</span>
                  <span className="text-xs text-right font-heading tabular-nums text-foreground">{fmt(displayAmount)}</span>
                  <span className="text-xs text-right font-heading tabular-nums text-foreground" />
                </div>
                <div className={`grid ${gridCols} px-2 sm:px-4 py-3 border-b border-foreground/50 items-center gap-1 sm:gap-2`}>
                  <div className="flex items-center gap-2 min-w-0 pl-1">
                    <span className="font-heading text-[0.5625rem] font-semibold w-5 shrink-0 text-muted-foreground">Cr</span>
                    <span className="text-[0.6875rem] sm:text-xs text-foreground break-words sm:truncate min-w-0">
                      Loan — {displayLender || "Lender"}
                      {readOnly && viewingLoan?.LenderLHeadCode && ` (${viewingLoan.LenderLHeadCode})`}
                    </span>
                  </div>
                  <span className="text-[0.6875rem] text-muted-foreground truncate">{lenderGroup}</span>
                  <span className="text-xs text-right font-heading tabular-nums text-foreground" />
                  <span className="text-xs text-right font-heading tabular-nums text-foreground">{fmt(displayAmount)}</span>
                </div>
                <div className={`grid ${gridCols} px-2 sm:px-4 py-3 border-t border-foreground text-xs font-bold gap-1 sm:gap-2`}>
                  <span className="font-heading uppercase tracking-[0.12em] text-muted-foreground text-[0.625rem]">Total</span>
                  <span />
                  <span className="text-right text-foreground font-heading tabular-nums">{fmt(displayAmount)}</span>
                  <span className="text-right text-foreground font-heading tabular-nums">{fmt(displayAmount)}</span>
                </div>
              </div>
            );
          })()}

          <p className="text-xs text-muted-foreground">
            All postings use system-generated GL accounts, auto-created per counterparty on first use.
          </p>

          {/* Posted / posting / error status banner — same layout as
              GRN's Posting tab status banner. */}
          {readOnly && !loanPostingLoading && (
            loanPostingData?.isPosted ? (
              <div className="flex items-center gap-2.5 border border-foreground px-4 py-3">
                <CheckCircle2 size={13} className="text-foreground flex-shrink-0" />
                <p className="text-xs text-foreground">
                  Posted to General Ledger as <span className="font-semibold">{loanPostingData.jvNo || viewingLoan?.LoanNo}</span>. Entries are visible in the Trial Balance.
                </p>
              </div>
            ) : loanPostingError ? (
              <div className="flex items-center gap-2.5 border border-destructive px-4 py-3">
                <AlertCircle size={13} className="text-destructive flex-shrink-0" />
                <p className="text-xs text-destructive">Auto-posting failed: {loanPostingError}</p>
              </div>
            ) : loanPosting ? (
              <div className="flex items-center gap-2.5 border border-foreground/30 px-4 py-3">
                <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <p className="text-xs text-muted-foreground">Posting to General Ledger…</p>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 border border-dashed border-foreground px-4 py-3">
                <AlertCircle size={13} className="text-foreground flex-shrink-0" />
                <p className="text-xs text-foreground">
                  {viewingLoan?.LoanType === "Bank Loan"
                    ? <>Not yet disbursed — go to Finance &gt; Received Payment's "Disburse a Bank Loan" picker to record it.</>
                    : <>Not yet disbursed — go to Finance &gt; Payment's "Loan Disbursement" picker to record it.</>}
                </p>
              </div>
            )
          )}
          {!readOnly && (
            <p className="text-xs text-muted-foreground">Save the loan to generate this posting.</p>
          )}

          {/* Repayment postings — each repayment (see POST /:id/pay)
              posts its own reversing two-sided entry; list them below
              the sanction entry the same way Payment.tsx lists every
              transaction in an invoice's "Full Payment Chain", instead
              of only ever showing the one-off sanction posting. */}
          {readOnly && (loanPostingData?.repaymentPostings?.length ?? 0) > 0 && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-2">
                <Receipt size={14} className="text-foreground" />
                <span className="text-[0.625rem] font-heading font-semibold font-heading uppercase tracking-[0.12em] text-muted-foreground">
                  Repayment Postings
                </span>
              </div>
              {loanPostingData.repaymentPostings.map((rp: any) => (
                <div key={rp.paymentId} className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap text-[0.625rem] text-muted-foreground">
                    <span className="font-heading tabular-nums">{rp.paymentRef}</span>
                    <span>·</span>
                    <span>{fmtDate(rp.paymentDate)}</span>
                    <span>·</span>
                    <span>{rp.paymentType === "LumpSum" ? "Lump Sum" : "EMI"}</span>
                    <span>·</span>
                    <span className="font-heading tabular-nums">{fmt(rp.amount)}</span>
                  </div>
                  <div className="space-y-4">
                    {rp.postings.map((p: any, i: number) => (
                      <PostingCard key={p.companyId ?? i} p={p} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
