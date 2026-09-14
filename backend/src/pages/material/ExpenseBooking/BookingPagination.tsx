import { ChevronLeft, ChevronRight } from "lucide-react";

interface BookingPaginationProps {
  page: number;
  totalPages: number;
  totalRecords: number;
  onPageChange: (page: number) => void;
}

export function BookingPagination({
  page,
  totalPages,
  totalRecords,
  onPageChange,
}: BookingPaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
      <p className="text-xs text-muted-foreground text-center sm:text-left">
        Page {page} of {totalPages} · {totalRecords} total
      </p>
      <div className="flex flex-wrap items-center justify-center gap-1 mt-2 sm:mt-0">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
        >
          <ChevronLeft size={14} />
        </button>
        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          const pg = page <= 3 ? i + 1 : page - 2 + i;
          if (pg < 1 || pg > totalPages) return null;
          return (
            <button
              key={pg}
              onClick={() => onPageChange(pg)}
              className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${pg === page ? "border-emerald-500 bg-emerald-500 text-white" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            >
              {pg}
            </button>
          );
        })}
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
