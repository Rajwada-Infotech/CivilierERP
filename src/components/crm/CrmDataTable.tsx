import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import type { CrmSort } from "@/hooks/useCrmListState";

// ── Row overflow menu ─────────────────────────────────────────────────────────
// Portal + fixed positioning so the table's overflow-x container never clips it.
export interface RowMenuItem {
  label?: string;
  icon?: React.ElementType;
  onClick?: () => void;
  danger?: boolean;
  heading?: string;
  hidden?: boolean;
}

export function CrmRowMenu({ items }: { items: RowMenuItem[] }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const visible = items.filter((i) => !i.hidden);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [pos]);

  if (visible.length === 0) return <span className="inline-block w-[22px] shrink-0" aria-hidden />;

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    const r = btnRef.current!.getBoundingClientRect();
    const estHeight = visible.length * 32 + 16;
    const right = window.innerWidth - r.right;
    setPos(r.bottom + estHeight + 8 > window.innerHeight
      ? { bottom: window.innerHeight - r.top + 4, right }
      : { top: r.bottom + 4, right });
  };

  return (
    <>
      <button ref={btnRef} type="button" onClick={toggle} aria-label="More actions" aria-haspopup="menu" aria-expanded={!!pos}
        className="p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <MoreHorizontal size={15} />
      </button>
      {pos && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={(e) => { e.stopPropagation(); setPos(null); }} />
          <div role="menu" style={{ top: pos.top, bottom: pos.bottom, right: pos.right }}
            className="fixed z-[61] min-w-[200px] rounded-lg border border-border bg-card shadow-lg py-1">
            {visible.map((it, i) => it.heading ? (
              <div key={`h${i}`} className="px-3 pt-2 pb-1 text-[0.6875rem] font-medium text-muted-foreground border-t border-border mt-1">{it.heading}</div>
            ) : (
              <button key={it.label} role="menuitem" type="button"
                onClick={(e) => { e.stopPropagation(); setPos(null); it.onClick?.(); }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted",
                  it.danger ? "text-red-600" : "text-foreground",
                )}>
                {it.icon && <it.icon size={13} className="shrink-0" />}{it.label}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

// ── Data table ────────────────────────────────────────────────────────────────
export interface CrmColumn<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  sortKey?: string;
  align?: "left" | "right" | "center";
  /** Applied to both <th> and <td> — use for responsive hiding, e.g. "hidden lg:table-cell". */
  className?: string;
}

interface CrmDataTableProps<T> {
  columns: CrmColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  fetching?: boolean;
  error?: string | null;
  onRetry?: () => void;
  sort?: CrmSort;
  onSort?: (sortKey: string) => void;
  onRowClick?: (row: T) => void;
  activeKey?: string | number | null;
  /** Tailwind border-l colour class for the status stripe, e.g. "border-l-green-500". */
  rowAccent?: (row: T) => string | undefined;
  empty?: React.ReactNode;
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

export function CrmDataTable<T>({
  columns, rows, rowKey, loading, fetching, error, onRetry, sort, onSort, onRowClick, activeKey,
  rowAccent, empty, page, pageSize, total, onPage,
}: CrmDataTableProps<T>) {
  const showSkeleton = !!loading && rows.length === 0;
  const clickable = !!onRowClick;

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className={cn("overflow-x-auto transition-opacity", fetching && !showSkeleton && "opacity-60")}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                {columns.map((col, i) => {
                  const active = !!sort && col.sortKey === sort.key;
                  const SortIcon = !active ? ArrowUpDown : sort!.dir === "asc" ? ArrowUp : ArrowDown;
                  return (
                    <th key={col.key} scope="col"
                      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                      className={cn(
                        "px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap",
                        ALIGN[col.align ?? "left"], col.className,
                        i === 0 && "border-l-[3px] border-l-transparent",
                      )}>
                      {col.sortKey && onSort ? (
                        <button type="button" onClick={() => onSort(col.sortKey!)}
                          className="inline-flex items-center gap-1 hover:text-foreground focus:outline-none focus-visible:underline">
                          {col.header}
                          <SortIcon size={11} className={active ? "text-foreground" : "opacity-40"} />
                        </button>
                      ) : col.header}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {showSkeleton ? (
                Array.from({ length: 6 }).map((_, r) => (
                  <tr key={r} className="border-b border-border/60 last:border-0">
                    {columns.map((col, i) => (
                      <td key={col.key} className={cn("px-3 py-3", col.className, i === 0 && "border-l-[3px] border-l-transparent")}>
                        <div className="h-3 rounded bg-muted animate-pulse" style={{ width: `${55 + ((r + i) % 4) * 10}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr><td colSpan={columns.length} className="py-10 text-center text-sm text-red-600">
                  Failed to load: {error}{" "}
                  {onRetry && <button onClick={onRetry} className="underline font-medium ml-1">Retry</button>}
                </td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={columns.length} className="py-12 text-center text-sm text-muted-foreground">{empty ?? "Nothing to show."}</td></tr>
              ) : rows.map((row) => {
                const key = rowKey(row);
                return (
                  <tr key={key}
                    onClick={clickable ? () => onRowClick!(row) : undefined}
                    onKeyDown={clickable ? (e) => { if (e.key === "Enter" && e.target === e.currentTarget) onRowClick!(row); } : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    className={cn(
                      "border-b border-border/60 last:border-0 transition-colors",
                      clickable && "cursor-pointer hover:bg-muted/40 focus:outline-none focus-visible:bg-muted/50",
                      activeKey != null && activeKey === key && "bg-primary/5",
                    )}>
                    {columns.map((col, i) => (
                      <td key={col.key}
                        className={cn(
                          "px-3 py-2.5 align-middle",
                          ALIGN[col.align ?? "left"], col.className,
                          i === 0 && cn("border-l-[3px]", rowAccent?.(row) ?? "border-l-transparent"),
                        )}>
                        {col.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <CrmPaginationBar page={page} pageSize={pageSize} total={total} onPage={onPage} />
    </div>
  );
}