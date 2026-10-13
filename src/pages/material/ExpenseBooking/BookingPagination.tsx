import { ChevronLeft, ChevronRight } from "lucide-react";

interface BookingPaginationProps {
  page: number;
  totalPages: number;
  totalRecords: number;
  onPageChange: (page: number) => void;
}

// A ruled bar: the count on the left, a segmented control on the right (.label and .seg come from the sheet frame).
export function BookingPagination({ page, totalPages, totalRecords, onPageChange }: BookingPaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-3 py-3" style={{ borderTop: "1px solid hsl(var(--foreground))" }}>
      <p className="label">
        Page {page} of {totalPages} · {totalRecords} in all
      </p>
      <div className="seg">
        <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1} className="disabled:opacity-40" aria-label="Previous page">
          <ChevronLeft size={13} />
        </button>
        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          const pg = page <= 3 ? i + 1 : page - 2 + i;
          if (pg < 1 || pg > totalPages) return null;
          return (
            <button key={pg} onClick={() => onPageChange(pg)} className={pg === page ? "on" : undefined}>
              {pg}
            </button>
          );
        })}
        <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="disabled:opacity-40" aria-label="Next page">
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}
