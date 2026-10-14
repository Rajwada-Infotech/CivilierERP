// Loan Sanction. The page is split into parts under ./sanction:
//   useLoanSanction   all state, queries and handlers
//   LoanList          the list view
//   LoanDetailHeader  an open loan's header and tab bar
//   NewLoanTypePicker, NewLoanForm   create mode
//   EditDetailsForm, LoanOverview    view mode (Overview tab)
//   ExposureTab, ScheduleTab, HistoryTab, PostingTab   the other tabs
//   DeleteLoanDialog
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { GlassShell } from "@/components/dashboard/GlassShell";
import { ExportMenu } from "@/components/ExportMenu";
import { Plus } from "lucide-react";
import { MoneyRecive } from "iconsax-react";
import { ACCENT, LOAN_EXPORT_COLUMNS } from "./sanction/shared";
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
    <GlassShell
      title="Loan Sanction"
      subtitle="Sanction inter-company, bank and customer loans"
      icon={MoneyRecive as any}
      accentColor={ACCENT}
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
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg btn-module transition-all"
            >
              <Plus size={13} />
              <span className="hidden sm:inline">New Loan</span>
            </button>
          </div>
        ) : undefined
      }
    >
      <Breadcrumbs items={[{ label: "Loan", path: "/loan" }, { label: "Loan Sanction" }]} />

      {!showForm ? (
        <LoanList ls={ls} />
      ) : (
        <div className="rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
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
            <div className="flex justify-end gap-3 px-7 sm:px-8 pb-7 sm:pb-8 pt-2">
              <button
                onClick={closeForm}
                className="px-3.5 py-1.5 rounded-lg border border-border text-xs hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
              >
                {saving ? "Sanctioning…" : "Sanction Loan"}
              </button>
            </div>
          )}
        </div>
      )}

      <DeleteLoanDialog ls={ls} />

    </GlassShell>
  );
}
