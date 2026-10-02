import React, { useCallback, useEffect, useRef, useState } from "react";
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
  /** Called when anywhere on a data row is clicked. Makes rows look interactive (cursor-pointer). */
  onRowClick?: (row: Row<TData>) => void;
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
  onRowClick,
  getRowId,
  loading = false,
  skeletonRows = 5,
  exportConfig,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  // Horizontal-scroll edge fades: shown only while there's more table to
  // scroll to on that side.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateEdges();
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [updateEdges]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize,
  });

  // Status sits immediately left of the row-actions column (or last when
  // there's none), so it can be pinned right beside Actions while the other
  // columns scroll (see .sticky-status in index.css). Display order only —
  // data, sorting and export are unaffected.
  const orderedColumns = React.useMemo(() => {
    const hdr = (c: ColumnDef<TData, unknown>) => (typeof c.header === "string" ? c.header.trim() : "");
    const key = (c: ColumnDef<TData, unknown>) =>
      String((c as { id?: string }).id ?? (c as { accessorKey?: string }).accessorKey ?? "").toLowerCase();
    const statusIdx = columns.findIndex((c) => /^status$/i.test(hdr(c)) || key(c) === "status");
    if (statusIdx < 0) return columns;
    const lastIdx = columns.length - 1;
    const last = columns[lastIdx];
    const hasActions = lastIdx !== statusIdx && (key(last) === "actions" || /^actions?$/i.test(hdr(last)) || (!hdr(last) && typeof last.header !== "function"));
    const target = hasActions ? lastIdx - 1 : lastIdx;
    if (statusIdx === target) return columns;
    const next = columns.slice();
    const [status] = next.splice(statusIdx, 1);
    next.splice(target, 0, status);
    return next;
  }, [columns]);

  const table = useReactTable({
    data,
    columns: orderedColumns,
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
      {/* ── Search bar / export toolbar ──
          Shown whenever either the built-in search or an export button is
          wanted — searchable=false pages (which run their own page-level
          search) still need this row rendered so exportConfig's ExportMenu
          isn't silently dropped. */}
      {(searchable || exportConfig) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-5 py-3 sm:py-3.5 border-b border-border bg-card/60">
          <p className="text-[0.6875rem] font-body text-muted-foreground">
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
            {searchable && (
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
            )}
          </div>
        </div>
      )}

      {/* ── Table (tablet & desktop) — scrolls sideways inside its card, the
          actions column stays pinned on the right (see index.css). ── */}
      <div className="relative hidden md:block">
      {edges.left && <div className="pointer-events-none absolute inset-y-0 left-0 w-6 z-[4] bg-gradient-to-r from-card to-transparent" />}
      {edges.right && <div className="pointer-events-none absolute inset-y-0 right-0 w-4 z-[1] bg-gradient-to-l from-black/[0.04] to-transparent" />}
      <div ref={scrollRef} onScroll={updateEdges} className="overflow-x-auto overscroll-x-contain thin-scroll scroll-smooth">
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
          // Column sizes are authored in px but applied in rem (size / 16) so
          // they scale together with the rem-based text (e.g. the laptop
          // 110% root size) instead of the text outgrowing its column and
          // breaking IDs, dates and badges onto several lines.
          const widthOf = (size: number | undefined) => `${(size ?? 150) / 16}rem`;
          return (
        <table className="text-sm font-body" style={{ tableLayout: "auto", width: "100%", minWidth: `${totalSize / 16}rem` }}>
          <thead>
            <tr className="border-b border-border bg-muted">
              {table.getHeaderGroups().map((hg) =>
                hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      style={{ width: widthOf(header.column.columnDef.size) }}
                      className={`px-4 py-3 text-[0.625rem] font-heading font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap select-none text-left ${
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
                    <td key={j} className="px-4 py-3.5">
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
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`even:bg-muted/[0.18] hover:bg-primary/[0.04] transition-colors ${onRowClick ? "cursor-pointer" : ""} ${
                    rowClassName ? rowClassName(row) : ""
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={`px-4 py-3 text-foreground text-[0.8125rem] leading-snug align-middle break-words ${(cell.column.columnDef.meta as any)?.className ?? ""}`}
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
      </div>

      {/* ── Cards (phones) ── */}
      <div className="md:hidden font-body">
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
          <div className="p-3 space-y-2.5">
            {rows.map((row) => {
              const headers = table.getFlatHeaders();
              const cells = row.getVisibleCells();
              const labelOf = (i: number) => {
                const h = headers[i];
                return h && !h.isPlaceholder ? flexRender(h.column.columnDef.header, h.getContext()) : null;
              };
              // The actions column (id "actions", or an empty header) goes in
              // the card footer; the first column is the card's title.
              const isActionCol = (i: number) => {
                const h = headers[i];
                const hdr = h?.column.columnDef.header;
                return h?.column.id === "actions" || (typeof hdr === "string" && /^actions?$/i.test(hdr.trim())) || hdr === "" || hdr == null;
              };
              const titleCell = cells[0];
              const actionIdx = cells.findIndex((_, i) => i > 0 && isActionCol(i));
              const detailIdx = cells.map((_, i) => i).filter((i) => i > 0 && i !== actionIdx);
              return (
                <div
                  data-row
                  key={row.id ? `card-${row.id}` : `card-${row.index}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`rounded-xl border border-border bg-card shadow-sm overflow-hidden ${onRowClick ? "cursor-pointer active:bg-muted/40" : ""} ${rowClassName ? rowClassName(row) : ""}`}
                >
                  {titleCell && (
                    <div className="px-3.5 pt-3 pb-2 text-sm font-semibold text-foreground break-words">
                      {flexRender(titleCell.column.columnDef.cell, titleCell.getContext())}
                    </div>
                  )}
                  {detailIdx.length > 0 && (
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 px-3.5 pb-3">
                      {detailIdx.map((i) => (
                        <div key={cells[i].id} className="min-w-0">
                          <dt className="text-[0.625rem] font-heading uppercase tracking-wider text-muted-foreground">{labelOf(i)}</dt>
                          <dd className="text-[0.8125rem] text-foreground break-words mt-0.5">
                            {flexRender(cells[i].column.columnDef.cell, cells[i].getContext())}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {actionIdx > 0 && (
                    <div className="flex justify-end px-3 py-2 border-t border-border/70 bg-muted/20">
                      {flexRender(cells[actionIdx].column.columnDef.cell, cells[actionIdx].getContext())}
                    </div>
                  )}
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
            {(() => {
              const { pageIndex, pageSize } = table.getState().pagination;
              const from = pageIndex * pageSize + 1;
              const to = Math.min(totalFiltered, (pageIndex + 1) * pageSize);
              return <>Showing <span className="font-medium text-foreground">{from}–{to}</span> of <span className="font-medium text-foreground">{totalFiltered}</span></>;
            })()}
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
            ].map(({ icon: Icon, fn, disabled, label }, idx) => (
              <React.Fragment key={label}>
                {/* Page numbers (current ±1) between Prev and Next — hidden on phones. */}
                {idx === 2 && (() => {
                  const cur = table.getState().pagination.pageIndex;
                  const count = table.getPageCount();
                  const pages = [cur - 1, cur, cur + 1].filter((p) => p >= 0 && p < count);
                  return pages.map((p) => (
                    <button
                      key={`p${p}`}
                      onClick={() => table.setPageIndex(p)}
                      className={`hidden sm:inline-flex min-w-[1.75rem] h-7 items-center justify-center rounded-md text-xs font-medium transition-colors ${
                        p === cur ? "bg-primary/10 text-primary border border-primary/30" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {p + 1}
                    </button>
                  ));
                })()}
                <button
                  onClick={fn}
                  disabled={disabled}
                  title={label}
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Icon size={14} />
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
