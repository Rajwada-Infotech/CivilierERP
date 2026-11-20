import React, { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SearchNormal1 } from "iconsax-react";
import { useProjectScope } from "@/components/legal/ProjectPicker";

/** What a paged Legal queue sends back besides its list. */
export interface PageInfo { total?: number; page?: number; pageSize?: number }

/** Query string for one page: page, size, search, the header's project and an optional named subset. */
export const pageQs = (o: { page: number; pageSize?: number; q?: string; project?: string; kind?: string }) =>
  new URLSearchParams(Object.entries({ pageSize: 20, ...o }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();

/**
 * One page of a Legal work queue from the server (20 rows), following the Legal project picker, with a search box
 * and a pager to render. `fetch` gets the query string (page, pageSize, q, project, kind).
 */
export function usePaged<T extends PageInfo>(key: unknown[], fetch: (qs: string) => Promise<T>, opts: { kind?: string; pageSize?: number; enabled?: boolean } = {}) {
  const { scope } = useProjectScope();
  const project = String(scope);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); }, [term, project, opts.kind]);
  const qs = pageQs({ page, pageSize: opts.pageSize, q: term, project, kind: opts.kind });
  const query = useQuery({ queryKey: [...key, "page", qs], queryFn: () => fetch(qs), placeholderData: keepPreviousData, enabled: opts.enabled !== false });
  const total = query.data?.total ?? 0;
  const pageSize = query.data?.pageSize ?? opts.pageSize ?? 20;
  const search = (placeholder = "Search…") => (
    <div className="mb-3 flex h-9 w-full items-center gap-2 border border-foreground/40 bg-background px-2.5 focus-within:border-foreground sm:max-w-sm">
      <SearchNormal1 size={14} className="text-muted-foreground" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-full flex-1 bg-transparent text-sm outline-none" />
    </div>
  );
  const pager = <Pager page={page} pageSize={pageSize} total={total} loading={query.isFetching} onPage={setPage} />;
  return { ...query, page, setPage, q, setQ, total, pageSize, search, pager };
}

/** "Showing 21–40 of 312" and ‹ Prev · 1 … 4 5 6 … 16 · Next ›; nothing when everything fits on one page. */
export function Pager({ page, pageSize, total, loading, onPage }: { page: number; pageSize: number; total: number; loading?: boolean; onPage: (p: number) => void }) {
  if (total <= pageSize) return total ? <p className="mt-3 text-xs text-muted-foreground">{total} in all</p> : null;
  const pages = Math.ceil(total / pageSize);
  const p = Math.min(page, pages);
  const nums = Array.from(new Set([1, p - 1, p, p + 1, pages])).filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const b = (on: boolean) => `h-8 min-w-8 border px-2 text-xs tabular-nums disabled:opacity-40 ${on ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground"}`;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
      <span className="text-xs text-muted-foreground">{loading ? "Loading… " : ""}Showing <b className="tabular-nums text-foreground">{(p - 1) * pageSize + 1}–{Math.min(total, p * pageSize)}</b> of <b className="tabular-nums text-foreground">{total}</b></span>
      <div className="flex items-center gap-1">
        <button className={b(false)} disabled={p <= 1} onClick={() => onPage(p - 1)}>‹ Prev</button>
        {nums.map((n, i) => (
          <React.Fragment key={n}>
            {i > 0 && n - nums[i - 1] > 1 && <span className="px-1 text-xs text-muted-foreground">…</span>}
            <button className={b(n === p)} onClick={() => onPage(n)}>{n}</button>
          </React.Fragment>
        ))}
        <button className={b(false)} disabled={p >= pages} onClick={() => onPage(p + 1)}>Next ›</button>
      </div>
    </div>
  );
}
