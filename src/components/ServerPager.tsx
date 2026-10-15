import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Footer for a server-paged list that isn't a DataTable: Rows selector, "Showing a–b of N", Previous / Next.
 * `page` is 1-based; changing the row count goes back to page 1. Renders nothing while there are no rows.
 */
export function ServerPager({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [20, 50, 100],
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
}) {
  if (total <= 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-t border-border bg-muted/10 text-xs text-muted-foreground">
      <label className="flex items-center gap-2">
        Rows
        <select
          value={pageSize}
          onChange={(e) => { onPageSizeChange(Number(e.target.value)); onPageChange(1); }}
          className="rounded-md bg-muted border border-border px-1.5 py-1 text-foreground focus:outline-none"
        >
          {pageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <span>
        Showing <span className="font-medium text-foreground">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}</span> of{" "}
        <span className="font-medium text-foreground">{total}</span>
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            title="Previous"
            className="p-1.5 rounded-md hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="px-2">Page {page} of {totalPages}</span>
          <button
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            title="Next"
            className="p-1.5 rounded-md hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
