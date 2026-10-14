import { ArrowLeft, Trash2, History, CheckCircle2, Clock, TrendingDown, TrendingUp, FileCheck2, Pencil } from "lucide-react";
import { MoneyRecive } from "iconsax-react";
import { fmtDate, LOAN_TYPE_COLORS } from "./shared";
import type { LoanSanctionState } from "./useLoanSanction";

// The open loan's header (back, number, type and lifecycle marks, edit/delete) and its tab bar.
export function LoanDetailHeader({ ls }: { ls: LoanSanctionState }) {
  const { viewingLoan, tab, setTab, setDeleteTarget, editingDetails, schedule, openEditDetails, closeForm, totalEmis, paidEmis, nextDue, tabs } = ls;
  return (
    <>
      {/* Header */}
      <div className="relative overflow-hidden flex items-center justify-between gap-3 px-4 sm:px-6 py-3 bg-emerald-500/[0.06] border-b border-emerald-500/20">
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-transparent via-emerald-500 to-transparent" />
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={closeForm}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft size={15} />
            <span className="hidden sm:inline">Back</span>
          </button>
          <span className="text-emerald-500/40">|</span>
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-emerald-500/[0.18] border border-emerald-500/30 shrink-0">
              <MoneyRecive size={12} className="text-emerald-500" />
            </div>
            <h2 className="text-sm font-heading font-bold text-foreground truncate">
              {viewingLoan ? `Loan ${viewingLoan.LoanNo}` : "Sanction New Loan"}
            </h2>
            {viewingLoan && (
              <span
                className="px-1.5 py-0.5 rounded-full text-[0.5625rem] font-medium shrink-0"
                style={{
                  background: `${LOAN_TYPE_COLORS[viewingLoan.LoanType]}18`,
                  color: LOAN_TYPE_COLORS[viewingLoan.LoanType],
                }}
              >
                {viewingLoan.LoanType}
              </span>
            )}
            {/* BUG 9 FIX: perspective badge — tells the user which direction
                the money flowed from OUR company's point of view.
                Customer Loan (Company to Customer, the original
                  direction) → we are the lender → "Loan Given"
                Customer Loan (Customer to Company, migration 402) and
                Bank Loan → we are the borrower → "Loan Received"
                Inter-Company → could be either; show both party labels */}
            {viewingLoan && viewingLoan.LoanType === "Customer Loan" && !viewingLoan.LenderCustomerId && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[0.5625rem] font-semibold shrink-0 bg-blue-500/15 text-blue-600 dark:text-blue-400">
                <TrendingUp size={9} /> Loan Given
              </span>
            )}
            {viewingLoan && (viewingLoan.LoanType === "Bank Loan" || (viewingLoan.LoanType === "Customer Loan" && !!viewingLoan.LenderCustomerId)) && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[0.5625rem] font-semibold shrink-0 bg-purple-500/15 text-purple-600 dark:text-purple-400">
                <TrendingDown size={9} /> Loan Received
              </span>
            )}
            {/* Lifecycle badge — three real states, not just Sanctioned
                vs Closed: a loan can be Sanctioned (still repaying),
                fully repaid but not yet formally closed ("Paid" — see
                the matching "Fully repaid" text on the Repayment
                History tab), or Closed (NOC issued). This used to show
                a "Sanctioned" label specifically when Status==="Closed",
                inverted from what it should say. */}
            {viewingLoan && viewingLoan.Status === "Closed" && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[0.5625rem] font-semibold shrink-0 bg-slate-500/15 text-slate-600 dark:text-slate-400">
                <FileCheck2 size={10} /> Closed
              </span>
            )}
            {viewingLoan && viewingLoan.Status !== "Closed" && totalEmis > 0 && paidEmis === totalEmis && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[0.5625rem] font-semibold shrink-0 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={10} /> Paid
              </span>
            )}
            {viewingLoan && viewingLoan.Status !== "Closed" && !(totalEmis > 0 && paidEmis === totalEmis) && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[0.5625rem] font-semibold shrink-0 bg-blue-500/15 text-blue-600 dark:text-blue-400">
                <MoneyRecive size={10} /> Sanctioned
              </span>
            )}
            {viewingLoan && viewingLoan.Status !== "Closed" && nextDue && (
              <span
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[0.5625rem] font-semibold shrink-0 ${
                  new Date(nextDue.DueDate) < new Date(new Date().toDateString())
                    ? "bg-red-500/15 text-red-600 dark:text-red-400"
                    : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                }`}
              >
                <Clock size={10} />
                Due {fmtDate(nextDue.DueDate)}
                {new Date(nextDue.DueDate) < new Date(new Date().toDateString()) ? " · OVERDUE" : ""}
              </span>
            )}
          </div>
        </div>
        {viewingLoan && (
          <div className="flex items-center gap-2 shrink-0">
            {!editingDetails && (
              <button
                type="button"
                onClick={() => openEditDetails(viewingLoan)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-primary border border-primary/30 hover:bg-primary/10 transition-colors"
              >
                <Pencil size={12} /> Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => setDeleteTarget(viewingLoan)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-destructive border border-destructive/30 hover:bg-destructive/10 transition-colors"
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap items-center gap-0.5 sm:gap-1 px-2 sm:px-8 pt-2 border-b border-border bg-card">
        {tabs.map((t) => {
          const disabled = !viewingLoan && (t.id === "schedule" || t.id === "chain");
          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-5 py-2.5 sm:py-3.5 text-[0.6875rem] sm:text-xs font-semibold rounded-t-lg border-b-2 whitespace-nowrap transition-colors ${
                disabled
                  ? "opacity-40 cursor-not-allowed border-transparent text-muted-foreground"
                  : tab === t.id
                    ? "border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
              }`}
            >
              <t.icon size={12} />
              {t.label}
            </button>
          );
        })}
      </div>
    </>
  );
}
