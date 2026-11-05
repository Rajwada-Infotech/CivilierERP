// Loan Sanction. The page is split into parts under ./sanction:
//   useLoanSanction   all state, queries and handlers
//   LoanList          the list view
//   LoanDetailHeader  an open loan's header and tab bar
//   NewLoanTypePicker, NewLoanForm   create mode
//   EditDetailsForm, LoanOverview    view mode (Overview tab)
//   ExposureTab, ScheduleTab, HistoryTab, PostingTab   the other tabs
//   DeleteLoanDialog
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { ExportMenu } from "@/components/ExportMenu";
import { Plus } from "lucide-react";
import { LOAN_EXPORT_COLUMNS, RULE, KEY_INK, KEY_LINE } from "./sanction/shared";
import { useLoanSanction } from "./sanction/useLoanSanction";
import { LoanList } from "./sanction/LoanList";
import { LoanDetailHeader } from "./sanction/LoanDetailHeader";
import { NewLoanTypePicker } from "./sanction/NewLoanTypePicker";
import { EditDetailsForm } from "./sanction/EditDetailsForm";
import { LoanOverview } from "./sanction/LoanOverview";
import { NewLoanForm } from "./sanction/NewLoanForm";
import { ExposureTab } from "./sanction/ExposureTab";
import { ScheduleTab } from "./sanction/ScheduleTab";
import { HistoryTab } from "./sanction/HistoryTab";
import { PostingTab } from "./sanction/PostingTab";
import { DeleteLoanDialog } from "./sanction/DeleteLoanDialog";

export default function LoanSanctionPage() {
  const ls = useLoanSanction();
  const { showForm, tab, saving, loans, isLoading, openCreate, closeForm, handleSave, readOnly } = ls;

  return (
    <>
    <Breadcrumbs items={[{ label: "Loan", path: "/loan" }, { label: "Loan Sanction" }]} />
    <SheetShell
      eyebrow="CivilierERP · Loan"
      title="Loan sanction"
      subtitle="Inter-company, bank and customer loans: who lent to whom, on what terms, and how the repayment stands."
      action={
        !showForm ? (
          <div className="flex items-center gap-2">
            <ExportMenu
              data={loans as unknown as Record<string, unknown>[]}
              columns={LOAN_EXPORT_COLUMNS}
              title="Loan Sanction"
              filename="loan-sanctions"
              disabled={isLoading || !loans.length}
            />
            <button onClick={openCreate} className={`${KEY_INK} h-9 px-4 shrink-0`}>
              <Plus size={13} />
              <span className="hidden sm:inline">New loan</span>
            </button>
          </div>
        ) : undefined
      }
    >

      {!showForm ? (
        <LoanList ls={ls} />
      ) : (
        <div className="bg-card overflow-hidden" style={{ border: RULE }}>
          <LoanDetailHeader ls={ls} />

          <div className="p-4 sm:p-5 space-y-4">
            {/* Overview tab — General + Loan Details merged into one clean view */}
            {tab === "overview" && (
              <div className="space-y-4">
                <NewLoanTypePicker ls={ls} />

                {readOnly ? (
                  <>
                    <EditDetailsForm ls={ls} />

                    <LoanOverview ls={ls} />
                  </>
                ) : (
                  <NewLoanForm ls={ls} />
                )}
              </div>
            )}

            <ExposureTab ls={ls} />

            <ScheduleTab ls={ls} />

            <HistoryTab ls={ls} />

            <PostingTab ls={ls} />
          </div>

          {!readOnly && (
            <div className="flex justify-end gap-2 px-4 sm:px-5 py-3" style={{ borderTop: RULE }}>
              <button onClick={closeForm} className={`${KEY_LINE} h-9 px-4`}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className={`${KEY_INK} h-9 px-5`}>
                {saving ? "Sanctioning…" : "Sanction loan"}
              </button>
            </div>
          )}
        </div>
      )}

      <DeleteLoanDialog ls={ls} />
    </SheetShell>
    </>
  );
}
