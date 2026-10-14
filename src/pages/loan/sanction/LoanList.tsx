import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Eye, Trash2, Pencil, X as XIcon, Filter } from "lucide-react";
import { CompanyFilterCombo } from "@/components/CompanyFilterCombo";
import { type LoanSanction } from "@/api/loanSanctionApi";
import { ACCENT, fmt, sanctionInstrumentLabel, sanctionInstrumentLabelCompact, LOAN_TYPE_COLORS } from "./shared";
import type { LoanSanctionState } from "./useLoanSanction";

// The list view: company filter strip and the table of sanctioned loans.
export function LoanList({ ls }: { ls: LoanSanctionState }) {
  const { isDark, setDeleteTarget, listCompanyId, setListCompanyId, loans, isLoading, companies, openView, openEditDetails } = ls;
  const columns: ColumnDef<LoanSanction, unknown>[] = [
    {
      id: "loanNo",
      header: "Loan No",
      cell: ({ row }) => (
        <span className="font-mono text-xs font-medium text-foreground">{row.original.LoanNo}</span>
      ),
    },
    {
      id: "loanType",
      header: "Type",
      cell: ({ row }) => {
        const c = LOAN_TYPE_COLORS[row.original.LoanType];
        return (
          <span className="px-2 py-0.5 rounded-full text-[0.6875rem] font-medium" style={{ background: `${c}18`, color: c }}>
            {row.original.LoanType}
          </span>
        );
      },
    },
    {
      id: "lender",
      header: "Lender",
      cell: ({ row }) => (
        <span className="text-sm text-foreground">
          {row.original.LenderCompanyName || row.original.LenderBankName || "—"}
        </span>
      ),
    },
    {
      id: "borrower",
      header: "Borrower",
      cell: ({ row }) => (
        <span className="text-sm text-foreground">
          {row.original.BorrowerCompanyName || row.original.BorrowerCustomerName || "—"}
        </span>
      ),
    },
    {
      id: "amount",
      header: "Amount",
      cell: ({ row }) => <span className="font-medium text-foreground">{fmt(row.original.Amount)}</span>,
    },
    {
      id: "emi",
      header: "EMI Progress",
      cell: ({ row }) => {
        const total = row.original.TotalEMIs ?? 0;
        const paid = row.original.PaidEMIs ?? 0;
        const pct = total ? Math.round((paid / total) * 100) : 0;
        return (
          <div className="flex items-center gap-2 w-28">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[0.6875rem] text-muted-foreground shrink-0">
              {paid}/{total}
            </span>
          </div>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const closed = row.original.Status === "Closed";
        // Same three real states as the detail modal's header pill
        // (Closed / Paid / Sanctioned) — this cell used to show the
        // literal text "Sanctioned" specifically when Status==="Closed",
        // inverted from what it should say (row.original.Status IS
        // already "Sanctioned" or "Closed", so that ternary was both
        // redundant and backwards).
        const fullyPaid = (row.original.TotalEMIs ?? 0) > 0 && row.original.PaidEMIs === row.original.TotalEMIs;
        const label = closed ? "Closed" : fullyPaid ? "Paid" : "Sanctioned";
        const dotColor = closed ? "bg-slate-400" : fullyPaid ? "bg-emerald-500" : "bg-blue-500";
        const textColor = closed
          ? "text-slate-600 dark:text-slate-400"
          : fullyPaid
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-blue-600 dark:text-blue-400";
        const instrument = sanctionInstrumentLabelCompact(row.original);
        const instrumentFull = sanctionInstrumentLabel(row.original);
        return (
          <div className="flex flex-col gap-0.5">
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${textColor}`}>
              <span className={`w-1.5 h-1.5 rounded-full inline-block ${dotColor}`} />
              {label}
            </span>
            {instrument && (
              <span
                title={instrumentFull ?? undefined}
                className="inline-block w-fit whitespace-nowrap text-[0.625rem] text-muted-foreground bg-muted px-2 py-0.5 rounded-full"
              >
                {instrument}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button data-row-view
            onClick={() => openView(row.original)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="View"
          >
            <Eye size={13} />
          </button>
          <button
            onClick={() => openEditDetails(row.original)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Edit details"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => setDeleteTarget(row.original)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ];



  return (
    <>
      <div
        className="rounded-xl px-4 py-3 mb-4 flex flex-wrap items-center gap-x-5 gap-y-3"
        style={{
          background: isDark ? "rgba(15,17,26,0.4)" : "rgba(248,250,252,0.72)",
          border: isDark ? "1px solid rgba(34,197,94,0.14)" : "1px solid rgba(34,197,94,0.14)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="flex items-center justify-center w-6 h-6 rounded-md shrink-0"
            style={{ background: "rgba(34,197,94,0.15)" }}
          >
            <Filter size={12} style={{ color: ACCENT }} />
          </div>
          <span className="text-[0.6875rem] font-heading uppercase tracking-wider text-muted-foreground">
            Filter loans
          </span>
        </div>

        <CompanyFilterCombo companies={companies} value={listCompanyId} onChange={setListCompanyId} />

        {listCompanyId != null && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[0.625rem] font-heading font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            {companies.find((c) => c.id === listCompanyId)?.label ?? "1 company"}
            <button
              type="button"
              onClick={() => setListCompanyId(null)}
              className="text-emerald-600/60 dark:text-emerald-400/60 hover:text-destructive transition-colors"
            >
              <XIcon size={9} />
            </button>
          </span>
        )}

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
          <span className="font-heading font-semibold text-foreground tabular-nums">{loans.length}</span>
          <span>{loans.length === 1 ? "loan" : "loans"}</span>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <DataTable
          columns={columns}
          data={loans}
          loading={isLoading}
          emptyMessage={listCompanyId ? "No loans sanctioned yet for this company. Click 'New Loan' to get started." : "No loans sanctioned yet. Click 'New Loan' to get started."}
        />
      </div>
    </>
  );
}
