import React, { useState } from "react";
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
    // Reset to page 0 when filter changes
    autoResetPageIndex: true,
  });

  const { rows } = table.getRowModel();
  const totalFiltered = table.getFilteredRowModel().rows.length;

  return (
    <div className={className}>
      {/* ── Search bar ── */}
      {searchable && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-5 py-3 sm:py-3.5 border-b border-border bg-card/60">
          <p className="text-[11px] text-muted-foreground">
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

      {/* ── Table ── */}
      <div className="overflow-x-auto thin-scroll">
        {(() => {
          const allCols = table.getAllLeafColumns();
          const totalSize = allCols.reduce((s, c) => s + (c.columnDef.size ?? 0), 0);
          const pctOf = (size: number | undefined) =>
            totalSize > 0 && size ? `${((size / totalSize) * 100).toFixed(2)}%` : undefined;
          return (
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
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
                      style={{ width: pctOf(header.column.columnDef.size) }}
                      className={`px-5 py-3.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap select-none ${header.column.id === "actions" ? "text-right" : "text-left"} ${
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
                  className="px-4 py-10 text-center text-muted-foreground text-sm"
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

      {/* ── Pagination ── */}
      {paginated && !loading && totalFiltered > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-t border-border bg-card/40">
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
              className="text-xs rounded-md bg-muted border border-border px-1.5 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
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
