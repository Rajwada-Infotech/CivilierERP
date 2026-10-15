import { Search, RefreshCw } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { printStatusLabel } from "@/utils/printStatus";
import { HEAD, RULE, chip, spaced } from "./config";
import type { QtState } from "./useQuotation";

const STATUSES = ["", "Draft", "Sent", "PartiallyQuoted", "Quoted", "Closed"];

// The quotation register: search, status filter, the table.
export function QtList({ m }: { m: QtState }) {
  const { search, setSearch, statusFilter, setStatusFilter, loadingList, rows, columns } = m;
  return (
    <div className="bg-card" style={{ border: RULE }}>
      <div className="px-4 py-3 space-y-3" style={{ borderBottom: RULE }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className={HEAD}>Quotation register</span>
            {!loadingList && (
              <p className="text-xs text-muted-foreground mt-1">{rows.length} record{rows.length !== 1 ? "s" : ""}</p>
            )}
          </div>
          <div className="relative w-full sm:w-64">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search doc no, company…"
              aria-label="Search quotations"
              className="w-full h-9 pl-9 pr-3 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUSES.map((s) => (
            <button key={s || "all"} aria-pressed={statusFilter === s} onClick={() => setStatusFilter(s)} className={chip(statusFilter === s)}>
              {s ? spaced(printStatusLabel(s)) : "All"}
            </button>
          ))}
        </div>
      </div>
      {loadingList ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
          <RefreshCw size={15} className="animate-spin" /> Loading…
        </div>
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          searchable={false}
          paginated={false}
          emptyMessage="No quotations found. Use New quotation to raise one."
        />
      )}
    </div>
  );
}
