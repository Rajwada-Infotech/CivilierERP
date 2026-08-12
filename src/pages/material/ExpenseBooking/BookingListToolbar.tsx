import { Search, X, CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CardTitle } from "@/components/ui/card";
import { ALL_STATUSES } from "./constants";

interface BookingListToolbarProps {
  totalRecords: number;
  search: string;
  onSearchChange: (val: string) => void;
  statusFilter: string;
  onStatusFilterChange: (val: string) => void;
  finYearOptions: string[];
  finYearFilter: string;
  onFinYearFilterChange: (val: string) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (val: string) => void;
  onDateToChange: (val: string) => void;
}

export function BookingListToolbar({
  totalRecords,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  finYearOptions,
  finYearFilter,
  onFinYearFilterChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}: BookingListToolbarProps) {
  const hasDateOrYear = !!(finYearFilter || dateFrom || dateTo);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base font-semibold">
            Booking Register
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalRecords} record{totalRecords !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search doc no, supplier…"
            className="pl-9 pr-8 h-9 text-sm focus-visible:ring-indigo-500/30 focus-visible:ring-offset-0"
          />
          {search && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={12} />
            </button>
          )}
        </div>
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
      {/* Fin Year + Document Date range — narrows the paginated list
          server-side (unlike the status chips/search above, which only
          ever filter within the current page). */}
      <div className="flex flex-wrap items-end gap-3 pt-1 border-t border-border/60">
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
        {hasDateOrYear && (
          <button
            type="button"
            onClick={() => {
              onFinYearFilterChange("");
              onDateFromChange("");
              onDateToChange("");
            }}
            className="h-8 mt-2 flex items-center gap-1 px-2 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
          >
            <X size={11} /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
