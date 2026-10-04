import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";

export type SortDir = "asc" | "desc";
export interface CrmSort { key: string; dir: SortDir }

export interface CrmListQuery {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  sortKey: string;
  sortDir: SortDir;
  companyId: string;
  projectId: string;
  blockId: string;
}

const EMPTY_CPB: CrmCompanyProjectBlockValue = { companyId: "", projectId: "", blockId: "" };

/** Keeps showing the previous result while the next page/filter is loading (works on TanStack Query v4 and v5). */
export function useSticky<T>(value: T | undefined): T | undefined {
  const ref = useRef<T | undefined>(value);
  if (value !== undefined) ref.current = value;
  return value !== undefined ? value : ref.current;
}

/** Query string for the server-side list contract: page, pageSize, search, status, sortKey, sortDir, company/project/block. */
export function listParams(q: CrmListQuery, allKey = "All"): URLSearchParams {
  const p = new URLSearchParams({
    page: String(q.page),
    pageSize: String(q.pageSize),
    sortKey: q.sortKey,
    sortDir: q.sortDir,
  });
  if (q.search) p.set("search", q.search);
  if (q.status && q.status !== allKey) p.set("status", q.status);
  if (q.companyId) p.set("companyId", q.companyId);
  if (q.projectId) p.set("projectId", q.projectId);
  if (q.blockId) p.set("blockId", q.blockId);
  return p;
}

interface Options {
  pageSize?: number;
  defaultSort: CrmSort;
  defaultStatus?: string;
}

/**
 * One place for the state every CRM list page repeats: page, debounced search,
 * status tab, sort, and the Company/Project/Block filter. Any filter change
 * resets to page 1.
 */
export function useCrmListState({ pageSize = 25, defaultSort, defaultStatus = "All" }: Options) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatusRaw] = useState(defaultStatus);
  const [sort, setSort] = useState<CrmSort>(defaultSort);
  const [cpb, setCpbRaw] = useState<CrmCompanyProjectBlockValue>(EMPTY_CPB);
  const lastSearch = useRef("");

  useEffect(() => {
    const t = setTimeout(() => {
      const v = searchInput.trim();
      if (v !== lastSearch.current) {
        lastSearch.current = v;
        setSearch(v);
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const setStatus = useCallback((s: string) => { setStatusRaw(s); setPage(1); }, []);
  const setCpb = useCallback((v: CrmCompanyProjectBlockValue) => { setCpbRaw(v); setPage(1); }, []);
  const toggleSort = useCallback((key: string) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    setPage(1);
  }, []);
  const reset = useCallback(() => {
    setSearchInput(""); setSearch(""); lastSearch.current = "";
    setStatusRaw(defaultStatus); setCpbRaw(EMPTY_CPB); setSort(defaultSort); setPage(1);
  }, [defaultStatus, defaultSort]);

  const query: CrmListQuery = useMemo(
    () => ({
      page, pageSize, search, status,
      sortKey: sort.key, sortDir: sort.dir,
      companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId,
    }),
    [page, pageSize, search, status, sort, cpb],
  );

  const hasFilters = !!(search || status !== defaultStatus || cpb.companyId || cpb.projectId || cpb.blockId);

  return { query, page, setPage, pageSize, searchInput, setSearchInput, status, setStatus, sort, toggleSort, cpb, setCpb, hasFilters, reset };
}