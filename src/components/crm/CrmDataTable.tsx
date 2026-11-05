import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown, ArrowUp, ArrowUpDown, MoreHorizontal, Bookmark, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Columns3, Search, Trash2, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { exportToCsv } from "@/lib/export";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import type { CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import type { CrmSort } from "@/hooks/useCrmListState";
import { SentBackPanel } from "@/components/crm/CrmListToolbar";
import { getStatusLabel, statusBadgeTone } from "@/components/StatusBadge";

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
        className="h-7 w-7 inline-flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <MoreHorizontal size={15} />
      </button>
      {pos && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={(e) => { e.stopPropagation(); setPos(null); }} />
          <div role="menu" style={{ top: pos.top, bottom: pos.bottom, right: pos.right, border: "1px solid hsl(var(--foreground))" }}
            className="fixed z-[61] min-w-[200px] bg-card py-1">
            {visible.map((it, i) => it.heading ? (
              <div key={`h${i}`} className="px-3 pt-2 pb-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground border-t border-foreground/15 mt-1">{it.heading}</div>
            ) : (
              <button key={it.label} role="menuitem" type="button"
                onClick={(e) => { e.stopPropagation(); setPos(null); it.onClick?.(); }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-primary/10",
                  it.danger ? "text-destructive" : "text-foreground",
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
  /** Tailwind border-l colour class for the status stripe, e.g. "border-l-foreground". */
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

  // The row count can shrink for reasons other than a filter change (another
  // user deletes the last row on this page, a live status update moves a row
  // off the current tab) — without this, the page stays stuck past the real
  // last page with nothing to show and only "Prev" to click back out.
  useEffect(() => {
    if (loading || total <= 0) return;
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    if (page > lastPage) onPage(lastPage);
  }, [loading, total, pageSize, page, onPage]);

  return (
    <div className="space-y-2">
      <div className="bg-card overflow-hidden" style={{ border: "1px solid hsl(var(--foreground))" }}>
        <div className={cn("overflow-x-auto transition-opacity", fetching && !showSkeleton && "opacity-60")}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
                {columns.map((col, i) => {
                  const active = !!sort && col.sortKey === sort.key;
                  const SortIcon = !active ? ArrowUpDown : sort!.dir === "asc" ? ArrowUp : ArrowDown;
                  return (
                    <th key={col.key} scope="col"
                      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                      className={cn(
                        "px-3 py-2.5 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap",
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
                        <div className="h-3 bg-muted animate-pulse" style={{ width: `${55 + ((r + i) % 4) * 10}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr><td colSpan={columns.length} className="py-10 text-center text-sm text-destructive">
                  {error}{" "}
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
                      "border-b border-foreground/10 last:border-0 transition-colors",
                      clickable && "cursor-pointer hover:bg-primary/5 focus:outline-none focus-visible:bg-primary/10",
                      activeKey != null && activeKey === key && "bg-primary/10",
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

// ══ Record list & record page kit (Customer 360, Cancellations, …) ═════════════
// A Lightning-style object list and record page in the app's own colours: a page header card, list views with counts,
// a totals strip, a toolbar, a grid with a solid sticky header, server sort, per-viewer column show / order / width,
// named saved views, rows per page and an Excel (CSV) export; and on the record page a highlights panel, a stage path
// and related-list cards. A page built from it does not sit in the sheet frame (components/sheet/Sheet.tsx), so
// nothing squares its corners or takes its shadows; its tables also carry class sheet-grid for any page that does.

export const GRID_PAGE_SIZES = [25, 50, 100, 200] as const;
const GRID_MIN_COL_WIDTH = 64;
/** A white card on the page ground: rounded, a hairline border and a soft drop. */
export const GRID_CARD = "bg-card border border-border rounded-lg shadow-[0_2px_3px_0_hsl(var(--foreground)/0.07)]";
// Solid header (rows scroll under it, so it must not be see-through), in normal case.
export const GRID_TH = "h-8 px-3 text-xs font-semibold normal-case tracking-normal text-muted-foreground whitespace-nowrap bg-muted border-b border-border";
export const GRID_TD = "h-9 px-3 border-b border-border/70 align-middle";
/** The neutral button (brand-coloured text); GRID_BTN_BRAND is the one main action on a page. */
export const GRID_BTN = "inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md border border-border bg-card text-primary hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40 disabled:cursor-not-allowed";
export const GRID_BTN_BRAND = "inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-semibold rounded-md border border-primary bg-primary text-primary-foreground hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40 disabled:cursor-not-allowed";
export const GRID_LABEL = "text-xs text-muted-foreground";
export const GRID_INPUT = "w-full h-9 px-2.5 text-xs rounded-md border border-border bg-card text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
const GRID_MENU = "absolute right-0 top-10 z-30 bg-card border border-border rounded-lg shadow-lg py-1";
const GRID_MENU_HEAD = "px-3 py-1.5 text-xs font-semibold text-muted-foreground";

// ── Page ─────────────────────────────────────────────────────────────────────
/** The page: its header card (icon tile, section, title, main actions), the sent-back notices, then the content. */
export function CrmAppPage({ icon: Icon, section, title, subtitle, actions, children }: {
  icon: React.ElementType; section: string; title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className={cn(GRID_CARD, "px-4 py-3 flex flex-wrap items-center gap-3")}>
        <span className="w-9 h-9 rounded-md bg-primary text-primary-foreground flex items-center justify-center shrink-0"><Icon size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className={GRID_LABEL}>{section}</div>
          <h1 className="text-lg font-bold leading-tight">{title}</h1>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5 max-w-[80ch]">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {/* On a CRM page: that page's entries sent back / resubmitted (renders nothing elsewhere). */}
      <SentBackPanel />
      {children}
    </div>
  );
}

// ── Status pill ──────────────────────────────────────────────────────────────
// The pill's colour comes from the status's own meaning (StatusBadge's tone): settled, waiting, under way, stopped, draft.
const PILL_TONE: Record<ReturnType<typeof statusBadgeTone>, string> = {
  done: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
  waiting: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  moving: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25",
  stopped: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25",
  draft: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/25",
};
export function GridStatusPill({ status, label }: { status: string | null | undefined; label?: string }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex items-center h-5 px-2 rounded-full border text-[0.6875rem] font-semibold whitespace-nowrap", PILL_TONE[statusBadgeTone(status)])}>
      {label ?? getStatusLabel(status)}
    </span>
  );
}

// ── Record page parts ────────────────────────────────────────────────────────
/** A record's highlights panel: icon tile, object, name, status, actions, then the key fields in one row. */
export function GridHighlights({ icon: Icon, object, title, sub, status, actions, fields }: {
  icon: React.ElementType; object: string; title: React.ReactNode; sub?: React.ReactNode; status?: React.ReactNode;
  actions?: React.ReactNode; fields: { label: string; value: React.ReactNode }[];
}) {
  return (
    <section className={GRID_CARD}>
      <div className="px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="w-10 h-10 rounded-md bg-primary text-primary-foreground flex items-center justify-center shrink-0"><Icon size={20} /></span>
        <div className="min-w-0 flex-1">
          <div className={GRID_LABEL}>{object}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold leading-tight">{title}</h2>
            {status}
          </div>
          {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {fields.length > 0 && (
        <dl className="px-4 py-2.5 border-t border-border grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-2">
          {fields.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className={GRID_LABEL}>{f.label}</dt>
              <dd className="mt-0.5 text-[0.8125rem] font-medium tabular-nums truncate">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export type GridPathState = "done" | "current" | "failed" | "todo";
/** The record's stages as a chevron path: done (filled), the current one (brand), a stopped one (red), then the rest. */
export function GridPath({ steps }: { steps: { label: string; state: GridPathState; note?: string }[] }) {
  const tone: Record<GridPathState, string> = {
    done: "bg-emerald-600 text-white",
    current: "bg-primary text-primary-foreground",
    failed: "bg-rose-600 text-white",
    todo: "bg-muted text-muted-foreground",
  };
  return (
    <section className={cn(GRID_CARD, "p-3")}>
      <ol className="flex w-full overflow-x-auto" aria-label="Stages">
        {steps.map((s, i) => (
          <li key={s.label} aria-current={s.state === "current" ? "step" : undefined}
            className={cn("relative flex-1 min-w-[8rem] h-9 flex items-center justify-center gap-1.5 px-6 text-xs font-semibold", tone[s.state],
              i === 0 ? "rounded-l-full" : "", i === steps.length - 1 ? "rounded-r-full" : "")}
            style={{ clipPath: i === steps.length - 1 ? undefined : "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 0 0)", marginRight: i === steps.length - 1 ? 0 : -8 }}
            title={s.note}>
            {s.state === "done" && <Check size={12} />}
            {s.state === "failed" && <X size={12} />}
            <span className="truncate">{s.label}</span>
          </li>
        ))}
      </ol>
      {steps.some((s) => s.note && (s.state === "current" || s.state === "failed")) && (
        <p className="mt-2 px-1 text-xs text-muted-foreground">{steps.find((s) => s.note && (s.state === "current" || s.state === "failed"))!.note}</p>
      )}
    </section>
  );
}

/** A related-list card on a record page: icon tile, title, count, and an action on the right. */
export function GridRelated({ icon: Icon, title, count, action, children }: {
  icon: React.ElementType; title: string; count?: number; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className={cn(GRID_CARD, "overflow-hidden")}>
      <header className="h-11 px-3 flex items-center gap-2 border-b border-border">
        <span className="w-6 h-6 rounded bg-primary/10 text-primary flex items-center justify-center shrink-0"><Icon size={13} /></span>
        <h3 className="text-[0.8125rem] font-bold">{title}{count != null && <span className="font-normal text-muted-foreground tabular-nums"> ({count})</span>}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </header>
      {children}
    </section>
  );
}

/** Label / value pairs in two columns: a record's details section. */
export function GridFields({ fields }: { fields: { label: string; value: React.ReactNode; wide?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 px-4 py-2">
      {fields.map((f) => (
        <div key={f.label} className={cn("py-2 border-b border-border/70 min-w-0", f.wide && "sm:col-span-2")}>
          <dt className={GRID_LABEL}>{f.label}</dt>
          <dd className="mt-0.5 text-[0.8125rem] break-words">{f.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Grid columns ─────────────────────────────────────────────────────────────
export interface GridCol<T> {
  id: string;
  label: string;
  sortKey?: string;
  align?: "right";
  /** Always shown; can't be hidden. */
  locked?: boolean;
  hiddenByDefault?: boolean;
  cell: (row: T) => React.ReactNode;
  /** The value the Excel export writes; a column without one is left out of the export. */
  csv?: (row: T) => unknown;
}

// ── Per-viewer layout and saved views, kept in this browser only ─────────────
function readStore<T>(key: string, fallback: T): T {
  try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v ?? fallback; } catch { return fallback; }
}
function writeStore(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not kept: fine */ }
}

export interface GridPrefs { order: string[]; hidden: string[]; widths: Record<string, number> }
export function gridDefaultPrefs<T>(cols: GridCol<T>[]): GridPrefs {
  return { order: cols.map((c) => c.id), hidden: cols.filter((c) => c.hiddenByDefault).map((c) => c.id), widths: {} };
}
/** The viewer's column order, hidden columns and widths for one grid. */
export function useGridPrefs<T>(storageKey: string, cols: GridCol<T>[]): [GridPrefs, (p: GridPrefs) => void] {
  const [prefs, setPrefs] = useState<GridPrefs>(() => {
    const saved = readStore<Partial<GridPrefs>>(storageKey, {});
    const known = (ids: unknown) => (Array.isArray(ids) ? ids.filter((id) => cols.some((c) => c.id === id)) : null);
    const defaults = gridDefaultPrefs(cols);
    const order = known(saved.order) ?? defaults.order;
    // a column added since the layout was saved goes on the end
    for (const c of cols) if (!order.includes(c.id)) order.push(c.id);
    return { order, hidden: known(saved.hidden) ?? defaults.hidden, widths: saved.widths && typeof saved.widths === "object" ? saved.widths : {} };
  });
  const save = (p: GridPrefs) => { setPrefs(p); writeStore(storageKey, p); };
  return [prefs, save];
}
export function gridVisibleCols<T>(cols: GridCol<T>[], prefs: GridPrefs): GridCol<T>[] {
  return prefs.order.map((id) => cols.find((c) => c.id === id)).filter((c): c is GridCol<T> => !!c && (!!c.locked || !prefs.hidden.includes(c.id)));
}

/** A small menu that closes on an outside click or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return { open, setOpen, ref };
}

export function GridColumnChooser<T>({ cols, prefs, onChange }: { cols: GridCol<T>[]; prefs: GridPrefs; onChange: (p: GridPrefs) => void }) {
  const { open, setOpen, ref } = usePopover();
  const toggle = (id: string) => onChange({ ...prefs, hidden: prefs.hidden.includes(id) ? prefs.hidden.filter((x) => x !== id) : [...prefs.hidden, id] });
  const move = (i: number, by: -1 | 1) => {
    const order = [...prefs.order];
    [order[i], order[i + by]] = [order[i + by], order[i]];
    onChange({ ...prefs, order });
  };
  return (
    <div ref={ref} className="relative">
      <button type="button" className={GRID_BTN} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} title="Columns">
        <Columns3 size={13} /> <span className="hidden md:inline">Columns</span>
      </button>
      {open && (
        <div role="menu" className={cn(GRID_MENU, "w-64")}>
          <div className={GRID_MENU_HEAD}>Show and order columns</div>
          {prefs.order.map((id, i) => {
            const c = cols.find((x) => x.id === id);
            if (!c) return null;
            const on = c.locked || !prefs.hidden.includes(id);
            return (
              <div key={id} className="flex items-center gap-1 pr-2 hover:bg-muted">
                <button type="button" role="menuitemcheckbox" aria-checked={on} disabled={c.locked} onClick={() => toggle(id)}
                  className="flex-1 flex items-center gap-2 px-3 h-8 text-xs text-left disabled:opacity-60">
                  <span className={cn("w-3.5 h-3.5 rounded-sm border flex items-center justify-center", on ? "bg-primary border-primary text-primary-foreground" : "border-border")}>
                    {on && <Check size={10} />}
                  </span>
                  {c.label}
                </button>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${c.label} up`}
                  className="h-6 w-6 rounded inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card disabled:opacity-25"><ArrowUp size={12} /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === prefs.order.length - 1} aria-label={`Move ${c.label} down`}
                  className="h-6 w-6 rounded inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card disabled:opacity-25"><ArrowDown size={12} /></button>
              </div>
            );
          })}
          <div className="border-t border-border mt-1 pt-1">
            <button type="button" onClick={() => onChange(gridDefaultPrefs(cols))} className="w-full px-3 h-8 text-xs text-left text-primary hover:bg-muted">
              Reset columns, order and widths
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export interface GridSavedView {
  name: string; status: string; search: string; cpb: CrmCompanyProjectBlockValue; sort: CrmSort; pageSize: number;
  /** The page's own filters beyond the common ones (a date range, a toggle), as the page reads them back. */
  extra?: Record<string, unknown>;
}


export function GridSavedViews({ storageKey, current, onApply }: { storageKey: string; current: Omit<GridSavedView, "name">; onApply: (v: GridSavedView) => void }) {
  const { open, setOpen, ref } = usePopover();
  const [views, setViews] = useState<GridSavedView[]>(() => {
    const v = readStore<GridSavedView[]>(storageKey, []);
    return Array.isArray(v) ? v.filter((x) => x && typeof x.name === "string") : [];
  });
  const [name, setName] = useState("");
  const keep = (next: GridSavedView[]) => { setViews(next); writeStore(storageKey, next); };
  const save = () => {
    const n = name.trim();
    if (!n) return;
    keep([...views.filter((v) => v.name !== n), { name: n, ...current }].sort((a, b) => a.name.localeCompare(b.name)));
    setName("");
  };
  return (
    <div ref={ref} className="relative">
      <button type="button" className={GRID_BTN} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} title="My views">
        <Bookmark size={13} /> <span className="hidden md:inline">My views</span>
        {views.length ? <span className="tabular-nums text-muted-foreground">{views.length}</span> : null}
      </button>
      {open && (
        <div role="menu" className={cn(GRID_MENU, "w-72")}>
          <div className={GRID_MENU_HEAD}>Saved views</div>
          {views.length === 0 && <div className="px-3 pb-2 text-xs text-muted-foreground">None yet. Set the view, filters and sort, then save them here.</div>}
          {views.map((v) => (
            <div key={v.name} className="flex items-center hover:bg-muted">
              <button type="button" role="menuitem" onClick={() => { onApply(v); setOpen(false); }} className="flex-1 min-w-0 px-3 h-8 text-xs text-left truncate">{v.name}</button>
              <button type="button" onClick={() => keep(views.filter((x) => x.name !== v.name))} aria-label={`Delete view ${v.name}`}
                className="h-8 w-8 inline-flex items-center justify-center text-muted-foreground hover:text-destructive"><Trash2 size={12} /></button>
            </div>
          ))}
          <form className="border-t border-border mt-1 p-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this view" aria-label="View name" maxLength={60} className={GRID_INPUT} />
            <button type="submit" disabled={!name.trim()} className={GRID_BTN_BRAND}>Save</button>
          </form>
          <div className="px-3 pb-2 text-[0.6875rem] text-muted-foreground">Saved in this browser only.</div>
        </div>
      )}
    </div>
  );
}

/** Underlined tabs with a count each: a list's views, or a record's sections. */
export function GridTabs<K extends string>({ tabs, active, onChange, label, end }: {
  tabs: { key: K; label: string; count?: number | null }[]; active: K; onChange: (k: K) => void; label: string; end?: React.ReactNode;
}) {
  return (
    <div className="flex items-end gap-1 px-3 border-b border-border overflow-x-auto" role="tablist" aria-label={label}>
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.key)}
            className={cn("h-10 px-3 text-[0.8125rem] whitespace-nowrap inline-flex items-center gap-1.5 -mb-px border-b-2 transition-colors",
              on ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border")}>
            {t.label}
            {t.count !== undefined && (
              <span className={cn("tabular-nums px-1.5 min-w-[1.25rem] text-center rounded-full text-[0.6875rem]", on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                {t.count == null ? "…" : t.count.toLocaleString("en-IN")}
              </span>
            )}
          </button>
        );
      })}
      {end && <div className="ml-auto">{end}</div>}
    </div>
  );
}

/** One figure of a totals strip or highlights row. */
export function GridMetric({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="px-4 py-2.5 min-w-0">
      <div className={GRID_LABEL}>{label}</div>
      <div className={cn("mt-0.5 text-base tabular-nums truncate", strong ? "font-bold text-foreground" : "font-semibold")}>{value}</div>
    </div>
  );
}

export function GridSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full sm:w-72">
      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} placeholder={placeholder}
        className={cn(GRID_INPUT, "pl-8 pr-7")} />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X size={12} /></button>
      )}
    </div>
  );
}

/** "12 items · Sorted by Requested · Filtered" under a list's title, like a list view's status line. */
export function gridListMeta<T>(total: number, cols: GridCol<T>[], sort: CrmSort, filtered: boolean): string {
  const by = cols.find((c) => c.sortKey === sort.key)?.label;
  return [
    `${total.toLocaleString("en-IN")} item${total === 1 ? "" : "s"}`,
    by ? `Sorted by ${by} (${sort.dir === "asc" ? "ascending" : "descending"})` : null,
    filtered ? "Filtered" : null,
  ].filter(Boolean).join(" · ");
}

/** Writes rows to an Excel-readable CSV with the grid's shown columns that have an export value. */
export function exportGrid<T>(rows: T[], cols: GridCol<T>[], filename: string) {
  exportToCsv(rows as unknown as Record<string, unknown>[],
    cols.filter((c) => c.csv).map((c) => ({ header: c.label, accessor: (r: Record<string, unknown>) => c.csv!(r as unknown as T) })), filename);
}

function GridSortHead<T>({ col, sort, onSort }: { col: GridCol<T>; sort: CrmSort; onSort: (k: string) => void }) {
  if (!col.sortKey) return <>{col.label}</>;
  const active = sort.key === col.sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button type="button" onClick={() => onSort(col.sortKey!)} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground", col.align === "right" && "flex-row-reverse")}>
      {col.label}<Icon size={11} className={active ? "text-primary" : "opacity-40"} />
    </button>
  );
}

function GridFooter({ page, pageSize, total, onPage, onPageSize }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize: (n: number) => void }) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  const nav = cn(GRID_BTN, "h-7 w-7 px-0");
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground border-t border-border">
      <label className="inline-flex items-center gap-2">
        Rows per page
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="h-7 rounded-md border border-border bg-card px-1.5 text-xs text-foreground">
          {GRID_PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <div className="flex items-center gap-1">
        <span className="tabular-nums mr-2">{from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}</span>
        <button type="button" className={nav} onClick={() => onPage(1)} disabled={page <= 1} aria-label="First page"><ChevronsLeft size={13} /></button>
        <button type="button" className={nav} onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={13} /></button>
        <span className="tabular-nums px-2">Page {page} of {last}</span>
        <button type="button" className={nav} onClick={() => onPage(page + 1)} disabled={page >= last} aria-label="Next page"><ChevronRight size={13} /></button>
        <button type="button" className={nav} onClick={() => onPage(last)} disabled={page >= last} aria-label="Last page"><ChevronsRight size={13} /></button>
      </div>
    </div>
  );
}

interface CrmGridProps<T> {
  cols: GridCol<T>[];
  prefs: GridPrefs;
  onPrefs: (p: GridPrefs) => void;
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  fetching?: boolean;
  error?: string | null;
  onRetry?: () => void;
  sort: CrmSort;
  onSort: (sortKey: string) => void;
  onRowClick?: (row: T) => void;
  activeKey?: string | number | null;
  empty: React.ReactNode;
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
  /** Tick boxes: the picked rows (kept across pages), and the change. Leave out for a grid without them. */
  selected?: ReadonlyMap<string | number, T>;
  onSelect?: (next: Map<string | number, T>) => void;
}

/** The grid itself: row numbers, sortable and resizable headers, the viewer's columns, and the footer pager. */
export function CrmGrid<T>({
  cols: allCols, prefs, onPrefs, rows, rowKey, loading, fetching, error, onRetry, sort, onSort, onRowClick, activeKey, empty,
  page, pageSize, total, onPage, onPageSize, selected, onSelect,
}: CrmGridProps<T>) {
  const cols = gridVisibleCols(allCols, prefs);
  const selectable = !!selected && !!onSelect;
  const pageKeys = rows.map(rowKey);
  const allOnPage = selectable && pageKeys.length > 0 && pageKeys.every((k) => selected!.has(k));
  const someOnPage = selectable && pageKeys.some((k) => selected!.has(k));
  const toggleRow = (row: T) => {
    const next = new Map(selected); const k = rowKey(row);
    if (next.has(k)) next.delete(k); else next.set(k, row);
    onSelect!(next);
  };
  const togglePage = () => {
    const next = new Map(selected);
    if (allOnPage) pageKeys.forEach((k) => next.delete(k)); else rows.forEach((r) => next.set(rowKey(r), r));
    onSelect!(next);
  };
  const extra = selectable ? 2 : 1;
  const showSkeleton = !!loading && rows.length === 0;

  // Same as CrmDataTable: a shrinking total must not strand the page past the last one.
  useEffect(() => {
    if (loading || total <= 0) return;
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    if (page > lastPage) onPage(lastPage);
  }, [loading, total, pageSize, page, onPage]);

  // Column widths: drag the right edge of a header; double-click it to go back to automatic.
  const startResize = (e: React.MouseEvent, id: string) => {
    e.preventDefault(); e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
    const startX = e.clientX, startW = th.getBoundingClientRect().width;
    const move = (ev: MouseEvent) => onPrefs({ ...prefs, widths: { ...prefs.widths, [id]: Math.max(GRID_MIN_COL_WIDTH, Math.round(startW + ev.clientX - startX)) } });
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.body.style.cursor = ""; };
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  const autoWidth = (id: string) => { const { [id]: _gone, ...widths } = prefs.widths; onPrefs({ ...prefs, widths }); };
  const widthStyle = (id: string): React.CSSProperties | undefined => {
    const w = prefs.widths[id];
    return w ? { width: w, minWidth: w, maxWidth: w } : undefined;
  };

  return (
    <>
      <div className={cn("overflow-auto max-h-[calc(100vh-24rem)] min-h-[16rem] transition-opacity", fetching && !showSkeleton && "opacity-60")}>
        <table className="sheet-grid w-full text-[0.8125rem] border-separate border-spacing-0">
          <thead className="sticky top-0 z-20 bg-muted shadow-[0_1px_0_hsl(var(--border))]">
            <tr>
              {selectable && (
                <th scope="col" className={cn(GRID_TH, "w-9 px-0 text-center")}>
                  <input type="checkbox" aria-label="Select every row on this page" checked={allOnPage}
                    ref={(el) => { if (el) el.indeterminate = !allOnPage && someOnPage; }} onChange={togglePage}
                    className="h-3.5 w-3.5 accent-[hsl(var(--primary))] cursor-pointer align-middle" />
                </th>
              )}
              <th scope="col" className={cn(GRID_TH, "w-10 text-right")}>#</th>
              {cols.map((c) => (
                <th key={c.id} scope="col" style={widthStyle(c.id)} className={cn(GRID_TH, "relative", c.align === "right" ? "text-right" : "text-left")}
                  aria-sort={c.sortKey && sort.key === c.sortKey ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                  <GridSortHead col={c} sort={sort} onSort={onSort} />
                  <span role="separator" aria-orientation="vertical" aria-label={`Resize ${c.label}`} title="Drag to resize · double-click for automatic"
                    onMouseDown={(e) => startResize(e, c.id)} onDoubleClick={() => autoWidth(c.id)} onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 top-1.5 bottom-1.5 w-1.5 cursor-col-resize border-r border-border hover:border-primary hover:border-r-2" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showSkeleton ? (
              Array.from({ length: 10 }).map((_, r) => (
                <tr key={r}>
                  {selectable && <td className={GRID_TD} />}
                  <td className={GRID_TD} />
                  {cols.map((c, i) => <td key={c.id} className={GRID_TD}><div className="h-2.5 rounded bg-muted animate-pulse" style={{ width: `${45 + ((r + i) % 4) * 12}%` }} /></td>)}
                </tr>
              ))
            ) : error ? (
              <tr><td colSpan={cols.length + extra} className="py-12 text-center text-sm text-destructive">
                {error} {onRetry && <button type="button" onClick={onRetry} className="underline ml-1">Retry</button>}
              </td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={cols.length + extra} className="py-14 text-center text-sm text-muted-foreground">{empty}</td></tr>
            ) : rows.map((row, i) => {
              const key = rowKey(row);
              return (
                <tr key={key} tabIndex={onRowClick ? 0 : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => { if (e.key === "Enter" && e.target === e.currentTarget) onRowClick(row); } : undefined}
                  className={cn("hover:bg-primary/[0.04]", onRowClick && "cursor-pointer focus:outline-none focus-visible:bg-primary/10",
                    ((activeKey != null && key === activeKey) || (selectable && selected!.has(key))) && "bg-primary/10")}>
                  {selectable && (
                    <td className={cn(GRID_TD, "w-9 px-0 text-center")} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label="Select this row" checked={selected!.has(key)} onChange={() => toggleRow(row)}
                        className="h-3.5 w-3.5 accent-[hsl(var(--primary))] cursor-pointer align-middle" />
                    </td>
                  )}
                  <td className={cn(GRID_TD, "text-right text-muted-foreground tabular-nums text-xs")}>{(page - 1) * pageSize + i + 1}</td>
                  {cols.map((col) => (
                    <td key={col.id} style={widthStyle(col.id)} className={cn(GRID_TD, "whitespace-nowrap overflow-hidden text-ellipsis", col.align === "right" && "text-right")}>{col.cell(row)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <GridFooter page={page} pageSize={pageSize} total={total} onPage={onPage} onPageSize={onPageSize} />
    </>
  );
}

/** The bar that replaces a list's toolbar while rows are ticked: how many, the actions on them, and Clear. */
export function GridBulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-primary/[0.07]" role="region" aria-label="Selected rows">
      <span className="text-xs font-semibold tabular-nums">{count.toLocaleString("en-IN")} selected</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <button type="button" onClick={onClear} className="ml-auto text-xs text-primary hover:underline">Clear selection</button>
    </div>
  );
}

// ── Date range filter ────────────────────────────────────────────────────────
export type GridDatePreset = "any" | "7d" | "30d" | "month" | "fy" | "custom";
export interface GridDateRange { preset: GridDatePreset; from: string; to: string }
export const GRID_ANY_DATE: GridDateRange = { preset: "any", from: "", to: "" };
const DATE_PRESETS: { key: GridDatePreset; label: string }[] = [
  { key: "any", label: "Any time" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "fy", label: "This financial year" },
  { key: "custom", label: "Custom range" },
];
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** The from / to days (YYYY-MM-DD, either may be empty) a range stands for, worked out from today. The financial year
 *  runs April to March. */
export function resolveGridDateRange(r: GridDateRange, today = new Date()): { from: string; to: string } {
  const back = (days: number) => { const d = new Date(today); d.setDate(d.getDate() - days); return isoDay(d); };
  switch (r.preset) {
    case "7d": return { from: back(6), to: isoDay(today) };
    case "30d": return { from: back(29), to: isoDay(today) };
    case "month": return { from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDay(today) };
    case "fy": {
      const startYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
      return { from: isoDay(new Date(startYear, 3, 1)), to: isoDay(today) };
    }
    case "custom": return { from: r.from, to: r.to };
    default: return { from: "", to: "" };
  }
}
export function GridDateFilter({ label, value, onChange }: { label: string; value: GridDateRange; onChange: (v: GridDateRange) => void }) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1.5">
      <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        <select value={value.preset} onChange={(e) => onChange({ ...value, preset: e.target.value as GridDatePreset })}
          className={cn(GRID_INPUT, "w-auto pr-7")} aria-label={`${label} range`}>
          {DATE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </label>
      {value.preset === "custom" && (
        <>
          <input type="date" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })}
            className={cn(GRID_INPUT, "w-auto")} aria-label={`${label} from`} />
          <span className="text-xs text-muted-foreground">to</span>
          <input type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })}
            className={cn(GRID_INPUT, "w-auto")} aria-label={`${label} to`} />
        </>
      )}
    </div>
  );
}

/** A filter that is on or off, with a count: "Overdue refunds 3". */
export function GridToggleChip({ label, on, count, onChange }: { label: string; on: boolean; count?: number | null; onChange: (on: boolean) => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)}
      className={cn("inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-xs font-medium transition-colors",
        on ? "border-rose-500/40 text-rose-700 dark:text-rose-300 bg-rose-500/10" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
      {on && <Check size={12} />}{label}
      {count != null && <span className="tabular-nums font-semibold">{count.toLocaleString("en-IN")}</span>}
    </button>
  );
}

/** A record's small sub-table (a booking's receipts, a customer's applications, …) in the grid's look. */
export interface GridMiniCol<T> { header: string; cell: (row: T) => React.ReactNode; align?: "right" }
export function GridMiniTable<T>({ cols, rows, rowKey, empty }: { cols: GridMiniCol<T>[]; rows: T[] | undefined; rowKey: (r: T) => string | number; empty: string }) {
  if (!rows || rows.length === 0) return <div className="text-xs text-muted-foreground px-4 py-4">{empty}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="sheet-grid w-full text-[0.8125rem] border-separate border-spacing-0">
        <thead>
          <tr>{cols.map((c) => <th key={c.header} scope="col" className={cn(GRID_TH, c.align === "right" ? "text-right" : "text-left")}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="hover:bg-primary/[0.04]">
              {cols.map((c) => <td key={c.header} className={cn(GRID_TD, "h-8 whitespace-nowrap", c.align === "right" && "text-right")}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
