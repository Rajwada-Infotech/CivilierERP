import { Wallet, CalendarClock, TrendingDown, AlertCircle, TrendingUp } from "lucide-react";
import { fmt, fmtDate } from "./shared";
import { SectionLabel, InfoCard } from "./parts";
import type { LoanSanctionState } from "./useLoanSanction";

// What the lender has lent out and the borrower already owes.
export function ExposureTab({ ls }: { ls: LoanSanctionState }) {
  const { tab, loans, exposureLenderCompanyId, exposureBorrowerCompanyId, lenderExposure, lenderExposureLoading, borrowerExposure, borrowerExposureLoading, displayLender, displayBorrower } = ls;
  return (
    <>
      {/* Exposure tab — live lender/borrower lookup: how much a company
          has already lent out (+ any EMI due to them), and how much a
          company already owes (+ their next due EMI). Updates live as
          the Lender/Borrower Company is picked in Overview. */}
      {tab === "exposure" && (
        <div className="space-y-6">
          {!exposureLenderCompanyId && !exposureBorrowerCompanyId ? (
            <div className="border border-dashed border-foreground/40 py-10 text-center text-sm text-muted-foreground">
              Select a Lender and/or Borrower Company in Overview to see their loan exposure here.
            </div>
          ) : (
            <>
              {exposureLenderCompanyId && (
                <div className="space-y-3">
                  <SectionLabel icon={TrendingUp} label={`${displayLender || "Lender"} — as Lender`} />
                  {lenderExposureLoading ? (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <InfoCard icon={Wallet} label="Total Lent (all loans)" value={fmt(lenderExposure?.asLender.totalLent ?? 0)} accent />
                      <InfoCard icon={AlertCircle} label="Currently Outstanding" value={fmt(lenderExposure?.asLender.totalOutstanding ?? 0)} />
                      <InfoCard
                        icon={CalendarClock}
                        label="Next EMI Receivable"
                        value={
                          lenderExposure?.asLender.nextDue
                            ? `${fmt(lenderExposure.asLender.nextDue.EMIAmount)} on ${fmtDate(lenderExposure.asLender.nextDue.DueDate)}`
                            : "None due"
                        }
                      />
                    </div>
                  )}
                </div>
              )}

              {exposureBorrowerCompanyId && (
                <div className="space-y-3">
                  <SectionLabel icon={TrendingDown} label={`${displayBorrower || "Borrower"} — as Borrower`} />
                  {borrowerExposureLoading ? (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <InfoCard icon={Wallet} label="Total Borrowed (all loans)" value={fmt(borrowerExposure?.asBorrower.totalBorrowed ?? 0)} accent />
                      <InfoCard icon={AlertCircle} label="Currently Owed" value={fmt(borrowerExposure?.asBorrower.totalOutstanding ?? 0)} />
                      <InfoCard
                        icon={CalendarClock}
                        label="Next EMI Payable"
                        value={
                          borrowerExposure?.asBorrower.nextDue
                            ? `${fmt(borrowerExposure.asBorrower.nextDue.EMIAmount)} on ${fmtDate(borrowerExposure.asBorrower.nextDue.DueDate)}`
                            : "None due"
                        }
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
