import { ArrowLeft, Trash2, History, CheckCircle2, Clock, TrendingDown, TrendingUp, FileCheck2, Pencil } from "lucide-react";
import { MoneyRecive } from "iconsax-react";
import { fmtDate, RULE, KEY, KEY_LINE } from "./shared";
import { SheetMark } from "@/components/sheet/Sheet";

const TAG_BASE = "inline-flex items-center gap-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 shrink-0 whitespace-nowrap";
const TAG_LINE = `${TAG_BASE} text-foreground border border-foreground/50`;
import type { LoanSanctionState } from "./useLoanSanction";

// The open loan's header (back, number, type and lifecycle marks, edit/delete) and its tab bar.
export function LoanDetailHeader({ ls }: { ls: LoanSanctionState }) {
  const { viewingLoan, tab, setTab, setDeleteTarget, editingDetails, schedule, openEditDetails, closeForm, totalEmis, paidEmis, nextDue, tabs } = ls;
  return (
    <>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3" style={{ borderBottom: RULE }}>
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" onClick={closeForm} className={`${KEY_LINE} h-8 px-3 shrink-0`}>
            <ArrowLeft size={13} />
            <span className="hidden sm:inline">Back</span>
          </button>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
            <h2 className="font-heading text-base font-bold tracking-tight text-foreground truncate">
              {viewingLoan ? `Loan ${viewingLoan.LoanNo}` : "New loan"}
            </h2>
            {viewingLoan && <span className={TAG_LINE}>{viewingLoan.LoanType}</span>}
            {/* BUG 9 FIX: perspective badge — tells the user which direction
                the money flowed from OUR company's point of view.
                Customer Loan (Company to Customer, the original
                  direction) → we are the lender → "Loan Given"
                Customer Loan (Customer to Company, migration 402) and
                Bank Loan → we are the borrower → "Loan Received"
                Inter-Company → could be either; show both party labels */}
            {viewingLoan && viewingLoan.LoanType === "Customer Loan" && !viewingLoan.LenderCustomerId && (
              <span className={TAG_LINE}>
                <TrendingUp size={10} /> Loan given
              </span>
            )}
            {viewingLoan && (viewingLoan.LoanType === "Bank Loan" || (viewingLoan.LoanType === "Customer Loan" && !!viewingLoan.LenderCustomerId)) && (
              <span className={TAG_LINE}>
                <TrendingDown size={10} /> Loan received
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
              <SheetMark text="Closed" tone="done" />
            )}
            {viewingLoan && viewingLoan.Status !== "Closed" && totalEmis > 0 && paidEmis === totalEmis && (
              <SheetMark text="Paid" tone="done" />
            )}
            {viewingLoan && viewingLoan.Status !== "Closed" && !(totalEmis > 0 && paidEmis === totalEmis) && (
              <SheetMark text="Sanctioned" tone="waiting" />
            )}
            {viewingLoan && viewingLoan.Status !== "Closed" && nextDue && (
              <span
                className={`${TAG_BASE} ${
                  new Date(nextDue.DueDate) < new Date(new Date().toDateString())
                    ? "text-destructive border border-destructive"
                    : "text-foreground border border-dashed border-foreground"
                }`}
              >
                <Clock size={10} />
                Due {fmtDate(nextDue.DueDate)}
                {new Date(nextDue.DueDate) < new Date(new Date().toDateString()) ? " · overdue" : ""}
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
                className={`${KEY_LINE} h-8 px-3`}
              >
                <Pencil size={12} /> Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => setDeleteTarget(viewingLoan)}
              className={`${KEY} h-8 px-3 border border-destructive text-destructive hover:bg-destructive/10`}
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap items-stretch gap-0 px-2 sm:px-4" style={{ borderBottom: RULE }}>
        {tabs.map((t) => {
          const disabled = !viewingLoan && (t.id === "schedule" || t.id === "chain");
          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-3 -mb-px font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] border-b-2 whitespace-nowrap transition-colors ${
                disabled
                  ? "opacity-40 cursor-not-allowed border-transparent text-muted-foreground"
                  : tab === t.id
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
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
