import React, { useEffect, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type PaginationState,
  type RowData,
  type Row,
} from "@tanstack/react-table";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
} from "lucide-react";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";

// ─── Re-export ColumnDef so pages only import from here ──────────────────────
export type { ColumnDef };
export type { ExportColumn };

// ─── Props ────────────────────────────────────────────────────────────────────
interface DataTableProps<TData extends RowData> {
  /** Row data array */
  data: TData[];
  /** TanStack column definitions */
  columns: ColumnDef<TData, unknown>[];
  /** Show the built-in global search bar */
  searchable?: boolean;
  /** Placeholder for the search input */
  searchPlaceholder?: string;
  /** Enable client-side pagination (default true) */
  paginated?: boolean;
  /** Rows per page options */
  pageSizeOptions?: number[];
  /** Default rows per page */
  defaultPageSize?: number;
  /** Message shown when no rows match */
  emptyMessage?: string;
  /** Extra className on the wrapper div */
  className?: string;
  /**
   * Row className — receives the row and returns a className string.
   * Use this for highlight-on-edit patterns: (row) => isEditing(row.original.id) ? "bg-primary/5 border-l-2 border-l-primary" : ""
   */
  rowClassName?: (row: Row<TData>) => string;
  /** Stable row id for React/TanStack when data has a database primary key */
  getRowId?: (originalRow: TData, index: number, parent?: Row<TData>) => string;
  /** Show loading skeleton instead of rows */
  loading?: boolean;
  /** Number of skeleton rows to show when loading */
  skeletonRows?: number;
  /**
   * When provided, an Export button appears in the toolbar.
   * Pass ExportColumn[] — plain { header, accessor } descriptors separate
   * from TanStack's ColumnDef so the export layer stays dependency-free.
   *
   * @example
   * exportConfig={{
   *   title: "Bank Master",
   *   filename: "bank-master",
   *   columns: [
   *     { header: "Bank Name", accessor: "bankName" },
   *     { header: "Account No", accessor: "accountNo" },
   *   ],
   * }}
   */
  exportConfig?: {
    title: string;
    filename?: string;
    subtitle?: string;
    columns: ExportColumn[];
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
export function DataTable<TData extends RowData>({
  data,
  columns,
  searchable = true,
  searchPlaceholder = "Search...",
  paginated = true,
  pageSizeOptions = [10, 25, 50, 100],
  defaultPageSize = 10,
  emptyMessage = "No records found.",
  className,
  rowClassName,
  getRowId,
  loading = false,
  skeletonRows = 5,
  exportConfig,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize,
  });

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      globalFilter,
      columnFilters,
      pagination,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId,
    // TanStack's own autoResetPageIndex fires on ANY change to `data`
    // (by reference), not just a real content change — and every caller
    // of this component passes `data` as a fresh array literal each
    // render (e.g. `data={records.filter(...)}`), so any unrelated
    // parent re-render (a scroll-position state update, a sibling
    // effect, anything) silently bounced the user back to page 1 while
    // they were browsing page 2/3. Disabled here; the effect below
    // resets the page only for the cases that should actually reset it
    // (the filter text itself changing), not on every render.
    autoResetPageIndex: false,
  });

  // Reset to page 0 only when the search/filter actually changes — not on
  // every `data` reference change (see autoResetPageIndex comment above).
  useEffect(() => {
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalFilter, columnFilters]);

  const { rows } = table.getRowModel();
  const totalFiltered = table.getFilteredRowModel().rows.length;

  // Clamp — but never reset to 0 — if the current page fell out of range
  // (e.g. a row was deleted and page 3 no longer exists). A same-length
  // `data` update that's still in range is a no-op, so this doesn't
  // reproduce the scroll-reset bug the two changes above just fixed.
  const pageCount = table.getPageCount();
  useEffect(() => {
    if (pageCount > 0 && pagination.pageIndex > pageCount - 1) {
      setPagination((p) => ({ ...p, pageIndex: pageCount - 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount]);

  return (
    <div className={className}>
      {/* ── Search bar ── */}
      {searchable && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-5 py-3 sm:py-3.5 border-b border-border bg-card/60">
          <p className="text-[11px] font-body text-muted-foreground">
            {loading
              ? "Loading..."
              : `${totalFiltered} record${totalFiltered !== 1 ? "s" : ""}`}
          </p>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {exportConfig && (
              <ExportMenu
                data={table
                  .getFilteredRowModel()
                  .rows.map((r) => r.original as Record<string, unknown>)}
                columns={exportConfig.columns}
                title={exportConfig.title}
                filename={exportConfig.filename}
                subtitle={exportConfig.subtitle}
                disabled={loading || data.length === 0}
              />
            )}
            <div className="relative flex-1 sm:flex-none">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <input
                type="text"
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-8 pr-3 py-1.5 rounded-lg text-xs font-body bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 w-full sm:w-44"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Table (large screens only) ── */}
      <div className="hidden lg:block overflow-x-auto thin-scroll">
        {(() => {
          const allCols = table.getAllLeafColumns();
          // Percentage widths always squeezed every column into exactly the
          // container's width, no matter how many/wide the columns were —
          // a table with a dozen columns just overlapped its own header
          // text instead of ever scrolling. Pixel widths (default 150,
          // matching TanStack's own column default) let the table's natural
          // width exceed the container so the wrapper's overflow-x-auto can
          // actually kick in; min-width:100% keeps narrow tables filling
          // the container exactly as before.
          const totalSize = allCols.reduce((s, c) => s + (c.columnDef.size ?? 150), 0);
          const widthOf = (size: number | undefined) => size ?? 150;
          return (
        <table className="text-sm font-body" style={{ tableLayout: "fixed", width: totalSize, minWidth: "100%" }}>
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {table.getHeaderGroups().map((hg) =>
                hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      style={{ width: widthOf(header.column.columnDef.size) }}
                      className={`px-5 py-3.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap select-none text-left ${
                        canSort
                          ? "cursor-pointer hover:text-foreground transition-colors"
                          : ""
                      } ${(header.column.columnDef.meta as any)?.className ?? ""}`}
                      onClick={
                        canSort
                          ? header.column.getToggleSortingHandler()
                          : undefined
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                        {canSort && (
                          <span className="text-muted-foreground/50">
                            {sorted === "asc" ? (
                              <ChevronUp size={11} className="text-emerald-500" />
                            ) : sorted === "desc" ? (
                              <ChevronDown size={11} className="text-emerald-500" />
                            ) : (
                              <ChevronsUpDown size={11} />
                            )}
                          </span>
                        )}
                      </span>
                    </th>
                  );
                }),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              // ── Skeleton rows ──
              Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {columns.map((_, j) => (
                    <td key={j} className="px-5 py-4">
                      <div className="h-4 bg-muted rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              // ── Empty state ──
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-muted-foreground text-sm font-body"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              // ── Data rows ──
              rows.map((row) => (
                <tr
                  key={row.id ? `row-${row.id}` : `row-${row.index}`}
                  className={`hover:bg-muted/20 transition-colors ${
                    rowClassName ? rowClassName(row) : ""
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={`px-5 py-4 text-foreground text-sm align-middle overflow-hidden ${(cell.column.columnDef.meta as any)?.className ?? ""}`}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
          );
        })()}
      </div>

      {/* ── Cards (mobile + tablet, below lg) ── */}
      <div className="lg:hidden font-body">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: skeletonRows }).map((_, i) => (
              <div key={i} className="p-4 space-y-2.5">
                <div className="h-4 w-2/3 bg-muted rounded animate-pulse" />
                <div className="h-3 w-1/2 bg-muted rounded animate-pulse" />
                <div className="h-3 w-1/3 bg-muted rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-muted-foreground text-sm">
            {emptyMessage}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((row) => {
              const headers = table.getFlatHeaders();
              const cells = row.getVisibleCells();
              return (
                <div
                  key={row.id ? `card-${row.id}` : `card-${row.index}`}
                  className={`p-4 space-y-2.5 ${rowClassName ? rowClassName(row) : ""}`}
                >
                  {cells.map((cell, i) => {
                    const header = headers[i];
                    const label = header
                      ? flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      : null;
                    return (
                      <div
                        key={cell.id}
                        className="flex items-start justify-between gap-4"
                      >
                        {label && (
                          <span className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground shrink-0 pt-0.5">
                            {label}
                          </span>
                        )}
                        <span className="text-sm text-foreground text-right min-w-0">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Pagination ── */}
      {paginated && !loading && totalFiltered > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-t border-border bg-card/40 font-body">
          {/* Page size selector */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">Rows</span>
            <select
              value={pagination.pageSize}
              onChange={(e) =>
                setPagination((p) => ({
                  ...p,
                  pageSize: Number(e.target.value),
                  pageIndex: 0,
                }))
              }
              className="text-xs font-body rounded-md bg-muted border border-border px-1.5 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
            >
              {pageSizeOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Page info */}
          <span className="text-xs text-muted-foreground shrink-0">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()} &middot; {totalFiltered} total
          </span>

          {/* Nav buttons — pushed to right */}
          <div className="flex items-center gap-1 ml-auto shrink-0">
            {[
              {
                icon: ChevronsLeft,
                fn: () => table.setPageIndex(0),
                disabled: !table.getCanPreviousPage(),
                label: "First",
              },
              {
                icon: ChevronLeft,
                fn: () => table.previousPage(),
                disabled: !table.getCanPreviousPage(),
                label: "Prev",
              },
              {
                icon: ChevronRight,
                fn: () => table.nextPage(),
                disabled: !table.getCanNextPage(),
                label: "Next",
              },
              {
                icon: ChevronsRight,
                fn: () => table.setPageIndex(table.getPageCount() - 1),
                disabled: !table.getCanNextPage(),
                label: "Last",
              },
            ].map(({ icon: Icon, fn, disabled, label }) => (
              <button
                key={label}
                onClick={fn}
                disabled={disabled}
                title={label}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
