import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CardTitle } from "@/components/ui/card";
import { ALL_STATUSES } from "./constants";

interface BookingListToolbarProps {
  totalRecords: number;
  search: string;
  onSearchChange: (val: string) => void;
  statusFilter: string;
  onStatusFilterChange: (val: string) => void;
}

export function BookingListToolbar({
  totalRecords,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
}: BookingListToolbarProps) {
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
    </div>
  );
}
