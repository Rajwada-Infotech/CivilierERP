import { createContext, useContext, useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  DOC_SEARCH_MIN_LEN,
  searchDocuments,
  type DocSearchResponse,
  type DocSearchResult,
} from "./docFinderApi";

export interface DocFinderContextValue {
  open: boolean;
  openDocFinder: () => void;
  closeDocFinder: () => void;
  /** Close and go to the document's page, which opens its own detail view. */
  openResult: (r: DocSearchResult) => void;
}

// Kept apart from the provider so anything that only needs to *open* the
// finder (the navbar button) doesn't import the dialog.
export const DocFinderContext = createContext<DocFinderContextValue | null>(null);

export function useDocFinder(): DocFinderContextValue {
  const ctx = useContext(DocFinderContext);
  if (!ctx) throw new Error("useDocFinder must be used inside <DocFinderProvider>");
  return ctx;
}

export const DOC_FINDER_DEBOUNCE_MS = 250;

export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Debounced lookup. `typed` is the raw input; nothing is requested below the minimum length. */
export function useDocSearch(typed: string, enabled: boolean) {
  const trimmed = typed.trim();
  const debounced = useDebouncedValue(trimmed, DOC_FINDER_DEBOUNCE_MS);
  const active = enabled && debounced.length >= DOC_SEARCH_MIN_LEN;
  const query = useQuery<DocSearchResponse>({
    queryKey: ["doc-finder", debounced],
    queryFn: ({ signal }) => searchDocuments(debounced, signal),
    enabled: active,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return {
    ...query,
    /** Typing has moved on from what the shown results were fetched for. */
    pending: trimmed !== debounced || (active && query.isFetching),
    belowMin: trimmed.length < DOC_SEARCH_MIN_LEN,
    results: active ? (query.data?.results ?? []) : [],
  };
}
