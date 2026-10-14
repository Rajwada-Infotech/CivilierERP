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
              <Wallet size={14} className="text-emerald-600" />
              <span className="text-[0.625rem] font-heading font-semibold uppercase tracking-widest text-muted-foreground">
                Journal Entry — Loan Posting
              </span>
            </div>
            {readOnly && (
              loanPostingLoading ? (
                <span className="text-[0.625rem] text-muted-foreground">Loading…</span>
              ) : loanPostingData?.isPosted ? (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.625rem] font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  <CheckCircle2 size={10} /> Posted · {loanPostingData.jvNo || viewingLoan?.LoanNo}
                </span>
              ) : loanPosting ? (
                <span className="flex items-center gap-1.5 text-[0.625rem] text-muted-foreground">
                  <span className="w-2.5 h-2.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  Posting…
                </span>
              ) : loanPostingError ? (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.625rem] font-semibold bg-red-500/10 text-red-600 border border-red-500/20">
                  <AlertCircle size={10} /> {loanPostingError}
                </span>
              ) : (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.625rem] font-semibold bg-[#ffe2021a] text-amber-600 border border-amber-500/20">
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
              <div className="rounded-xl border border-border overflow-hidden">
                <div className={`grid ${gridCols} bg-muted/40 border-b border-border px-2 sm:px-4 py-2.5 text-[0.5625rem] sm:text-[0.625rem] uppercase tracking-widest text-muted-foreground font-semibold gap-1 sm:gap-2`}>
                  <span>Account</span>
                  <span>Account Group</span>
                  <span className="text-right">Debit (₹)</span>
                  <span className="text-right">Credit (₹)</span>
                </div>
                <div className={`grid ${gridCols} px-2 sm:px-4 py-3 border-b border-border/50 items-center gap-1 sm:gap-2`}>
                  <div className="flex items-center gap-2 min-w-0 pl-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 bg-emerald-500" />
                    <span className="text-[0.6875rem] sm:text-xs text-foreground break-words sm:truncate min-w-0">
                      Loan — {displayBorrower || "Borrower"}
                      {readOnly && viewingLoan?.BorrowerLHeadCode && ` (${viewingLoan.BorrowerLHeadCode})`}
                    </span>
                  </div>
                  <span className="text-[0.6875rem] text-muted-foreground truncate">{borrowerGroup}</span>
                  <span className="text-xs text-right font-mono text-emerald-700 dark:text-emerald-400">{fmt(displayAmount)}</span>
                  <span className="text-xs text-right font-mono text-rose-600 dark:text-rose-400" />
                </div>
                <div className={`grid ${gridCols} px-2 sm:px-4 py-3 border-b border-border/50 items-center gap-1 sm:gap-2`}>
                  <div className="flex items-center gap-2 min-w-0 pl-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 bg-rose-500" />
                    <span className="text-[0.6875rem] sm:text-xs text-foreground break-words sm:truncate min-w-0">
                      Loan — {displayLender || "Lender"}
                      {readOnly && viewingLoan?.LenderLHeadCode && ` (${viewingLoan.LenderLHeadCode})`}
                    </span>
                  </div>
                  <span className="text-[0.6875rem] text-muted-foreground truncate">{lenderGroup}</span>
                  <span className="text-xs text-right font-mono text-emerald-700 dark:text-emerald-400" />
                  <span className="text-xs text-right font-mono text-rose-600 dark:text-rose-400">{fmt(displayAmount)}</span>
                </div>
                <div className={`grid ${gridCols} px-2 sm:px-4 py-3 bg-muted/30 border-t-2 border-border text-xs font-bold gap-1 sm:gap-2`}>
                  <span className="uppercase tracking-widest text-muted-foreground text-[0.625rem]">Total</span>
                  <span />
                  <span className="text-right text-emerald-600 dark:text-emerald-400 font-mono">{fmt(displayAmount)}</span>
                  <span className="text-right text-rose-600 dark:text-rose-400 font-mono">{fmt(displayAmount)}</span>
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
              <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  Posted to General Ledger as <span className="font-semibold">{loanPostingData.jvNo || viewingLoan?.LoanNo}</span>. Entries are visible in the Trial Balance.
                </p>
              </div>
            ) : loanPostingError ? (
              <div className="flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
                <AlertCircle size={13} className="text-destructive flex-shrink-0" />
                <p className="text-xs text-destructive">Auto-posting failed: {loanPostingError}</p>
              </div>
            ) : loanPosting ? (
              <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/20 px-4 py-3">
                <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <p className="text-xs text-muted-foreground">Posting to General Ledger…</p>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                <AlertCircle size={13} className="text-amber-600 flex-shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
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
                <Receipt size={14} className="text-emerald-600" />
                <span className="text-[0.625rem] font-heading font-semibold uppercase tracking-widest text-muted-foreground">
                  Repayment Postings
                </span>
              </div>
              {loanPostingData.repaymentPostings.map((rp: any) => (
                <div key={rp.paymentId} className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap text-[0.625rem] text-muted-foreground">
                    <span className="font-mono">{rp.paymentRef}</span>
                    <span>·</span>
                    <span>{fmtDate(rp.paymentDate)}</span>
                    <span>·</span>
                    <span>{rp.paymentType === "LumpSum" ? "Lump Sum" : "EMI"}</span>
                    <span>·</span>
                    <span className="font-mono">{fmt(rp.amount)}</span>
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
