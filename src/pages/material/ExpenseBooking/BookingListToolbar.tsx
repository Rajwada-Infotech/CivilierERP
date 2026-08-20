import { useState } from "react";
import { CalendarDays, Building2, FolderKanban, Hash, Truck, Filter, ChevronDown } from "lucide-react";
import { CardTitle } from "@/components/ui/card";
import { ALL_STATUSES } from "./constants";

interface OptionLike {
  id: number | string;
  label: string;
}

interface BookingListToolbarProps {
  totalRecords: number;
  statusFilter: string;
  onStatusFilterChange: (val: string) => void;
  finYearOptions: string[];
  finYearFilter: string;
  onFinYearFilterChange: (val: string) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (val: string) => void;
  onDateToChange: (val: string) => void;
  // Same filter set as the Finance > Payment page — Company, Project, Doc
  // No, Vendor.
  companyOptions: OptionLike[];
  companyFilter: string;
  onCompanyFilterChange: (val: string) => void;
  projectOptions: OptionLike[];
  projectFilter: string;
  onProjectFilterChange: (val: string) => void;
  docNoFilter: string;
  onDocNoFilterChange: (val: string) => void;
  // Spans every party type a booking can be billed against — Supplier,
  // Contractor, and Customer/Applicant — not just suppliers.
  vendorOptions: OptionLike[];
  vendorFilter: string;
  onVendorFilterChange: (val: string) => void;
}

export function BookingListToolbar({
  totalRecords,
  statusFilter,
  onStatusFilterChange,
  finYearOptions,
  finYearFilter,
  onFinYearFilterChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  companyOptions,
  companyFilter,
  onCompanyFilterChange,
  projectOptions,
  projectFilter,
  onProjectFilterChange,
  docNoFilter,
  onDocNoFilterChange,
  vendorOptions,
  vendorFilter,
  onVendorFilterChange,
}: BookingListToolbarProps) {
  const [showFilters, setShowFilters] = useState(false);
  const activeFilterCount =
    [finYearFilter, dateFrom, dateTo, companyFilter, projectFilter, docNoFilter, vendorFilter].filter(
      Boolean,
    ).length;
  const clearAllFilters = () => {
    onFinYearFilterChange("");
    onDateFromChange("");
    onDateToChange("");
    onCompanyFilterChange("");
    onProjectFilterChange("");
    onDocNoFilterChange("");
    onVendorFilterChange("");
  };
  return (
    <div className="flex flex-col gap-5">
      <div>
        <CardTitle className="text-base font-semibold">
          Booking Register
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          {totalRecords} record{totalRecords !== 1 ? "s" : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {ALL_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onStatusFilterChange(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === s ? "bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 text-white border-transparent shadow-sm" : "bg-background text-muted-foreground border-border hover:border-indigo-500/40"}`}
          >
            {s}
          </button>
        ))}
      </div>
      {/* Fin Year, Date range, Company, Project, Doc No, Vendor — all
          narrow the paginated list server-side (unlike the status chips
          above, which only ever filter within the current page). Collapsed
          by default since it's a lot of controls. */}
      <button
        type="button"
        onClick={() => setShowFilters((v) => !v)}
        className="flex items-center justify-between gap-3 pt-3 border-t border-border/60"
      >
        <span className="flex items-center gap-1.5 text-[11px] font-heading uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
          <Filter size={11} /> More Filters
          {activeFilterCount > 0 && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-heading font-semibold bg-indigo-500 text-white">
              {activeFilterCount} active
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {activeFilterCount > 0 && (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                clearAllFilters();
              }}
              className="text-[11px] text-destructive/70 hover:text-destructive font-heading transition-colors cursor-pointer"
            >
              Clear all
            </span>
          )}
          <ChevronDown
            size={13}
            className={`text-muted-foreground transition-transform duration-200 ${showFilters ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {showFilters && (
        <>
          <div className="flex flex-wrap items-end gap-4 pt-3 border-t border-border/60">
            <div className="space-y-1 mt-2">
              <label className="flex items-center gap-1 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                <CalendarDays size={10} /> Fin Year
              </label>
              <select
                value={finYearFilter}
                onChange={(e) => onFinYearFilterChange(e.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              >
                <option value="">All years</option>
                {finYearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1 mt-2">
              <label className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                From
              </label>
              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => onDateFromChange(e.target.value)}
                className="h-8 min-w-[140px] rounded-md border border-border bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/30 [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
              />
            </div>
            <div className="space-y-1 mt-2">
              <label className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                To
              </label>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => onDateToChange(e.target.value)}
                className="h-8 min-w-[140px] rounded-md border border-border bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/30 [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
              />
            </div>
          </div>

          {/* Company / Project / Doc No / Vendor — same filter set as the
              Finance > Payment page. */}
          <div className="flex flex-wrap items-end gap-4 pt-3 border-t border-border/60">
            <div className="space-y-1 mt-2">
              <label className="flex items-center gap-1 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                <Building2 size={10} /> Company
              </label>
              <select
                value={companyFilter}
                onChange={(e) => onCompanyFilterChange(e.target.value)}
                className="h-8 min-w-[140px] rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              >
                <option value="">All Companies</option>
                {companyOptions.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1 mt-2">
              <label className="flex items-center gap-1 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                <FolderKanban size={10} /> Project
              </label>
              <select
                value={projectFilter}
                onChange={(e) => onProjectFilterChange(e.target.value)}
                className="h-8 min-w-[140px] rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              >
                <option value="">All Projects</option>
                {projectOptions.map((p) => (
                  <option key={p.id} value={p.label}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1 mt-2">
              <label className="flex items-center gap-1 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                <Hash size={10} /> Doc No
              </label>
              <input
                type="text"
                placeholder="e.g. DINV-2024-001"
                value={docNoFilter}
                onChange={(e) => onDocNoFilterChange(e.target.value)}
                className="h-8 min-w-[160px] rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div className="space-y-1 mt-2">
              <label className="flex items-center gap-1 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                <Truck size={10} /> Vendor
              </label>
              <select
                value={vendorFilter}
                onChange={(e) => onVendorFilterChange(e.target.value)}
                className="h-8 min-w-[160px] rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              >
                <option value="">All Vendors</option>
                {vendorOptions.map((v) => (
                  <option key={v.id} value={String(v.id)}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
