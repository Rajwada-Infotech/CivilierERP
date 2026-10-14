import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Eye, Trash2, Pencil, X as XIcon, Filter } from "lucide-react";
import { CompanyFilterCombo } from "@/components/CompanyFilterCombo";
import { type LoanSanction } from "@/api/loanSanctionApi";
import { ACCENT, fmt, sanctionInstrumentLabel, sanctionInstrumentLabelCompact, LOAN_TYPE_COLORS } from "./shared";
import type { LoanSanctionState } from "./useLoanSanction";
import { SheetMark } from "@/components/sheet/Sheet";
import { RULE, HEAD, ACT, ACT_DEL, labelCls } from "./shared";

// The list view: company filter strip and the table of sanctioned loans.
export function LoanList({ ls }: { ls: LoanSanctionState }) {
  const { isDark, setDeleteTarget, listCompanyId, setListCompanyId, loans, isLoading, companies, openView, openEditDetails } = ls;
  const columns: ColumnDef<LoanSanction, unknown>[] = [
    {
      id: "loanNo",
      header: "Loan No",
      cell: ({ row }) => (
        <span className="font-heading text-xs font-semibold tabular-nums text-foreground">{row.original.LoanNo}</span>
      ),
    },
    {
      id: "loanType",
      header: "Type",
      cell: ({ row }) => {
        return (
          <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-foreground border border-foreground/40 px-1.5 py-0.5 whitespace-nowrap">
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
      cell: ({ row }) => <span className="font-heading font-semibold tabular-nums text-foreground">{fmt(row.original.Amount)}</span>,
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
            <div className="flex-1 h-1.5 border border-foreground/60 overflow-hidden">
              <div className="h-full bg-foreground" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[0.6875rem] tabular-nums text-muted-foreground shrink-0">
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

        const instrument = sanctionInstrumentLabelCompact(row.original);
        const instrumentFull = sanctionInstrumentLabel(row.original);
        return (
          <div className="flex flex-col gap-0.5">
            <SheetMark text={label} tone={closed || fullyPaid ? "done" : "waiting"} />
            {instrument && (
              <span
                title={instrumentFull ?? undefined}
                className="inline-block w-fit whitespace-nowrap text-[0.625rem] tabular-nums text-muted-foreground"
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
            className={ACT}
            title="View" aria-label="View"
          >
            <Eye size={13} />
          </button>
          <button
            onClick={() => openEditDetails(row.original)}
            className={ACT}
            title="Edit details" aria-label="Edit details"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => setDeleteTarget(row.original)}
            className={ACT_DEL}
            title="Delete" aria-label="Delete"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ];



  return (
    <>
      <div className="bg-card" style={{ border: RULE }}>
        <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
          {[
            { label: "Loans", value: String(loans.length), note: listCompanyId != null ? "for this company" : "across every company" },
            { label: "Sanctioned", value: fmt(loans.reduce((s, l) => s + Number(l.Amount || 0), 0)), note: "in all" },
            { label: "Running", value: String(loans.filter((l) => l.Status !== "Closed").length), note: "not yet closed" },
            { label: "Closed", value: String(loans.filter((l) => l.Status === "Closed").length), note: "NOC issued" },
          ].map((x) => (
            <div key={x.label}>
              <p className="label">{x.label}</p>
              <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
              <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card overflow-hidden" style={{ border: RULE }}>
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
        style={{
          borderBottom: RULE,
        }}
      >
        <p className="flex items-baseline gap-2.5">
          <span className={HEAD}>Loans</span>
          <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{loans.length}</span>
        </p>
        <div className="ml-auto flex items-center gap-2">
          <span className={labelCls}>Company</span>
          <CompanyFilterCombo companies={companies} value={listCompanyId} onChange={setListCompanyId} />
        </div>
      </div>
        <DataTable
          columns={columns}
          data={loans}
          loading={isLoading}
          emptyMessage={listCompanyId ? "No loans sanctioned yet for this company. Use New loan to start one." : "No loans sanctioned yet. Use New loan to start one."}
        />
      </div>
    </>
  );
}
