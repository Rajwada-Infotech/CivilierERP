// src/hooks/useLookup.ts
//
// Drop-in replacement for hardcoded const string arrays.
//
// Usage:
//   const currencies = useLookup("CURRENCY");
//   // returns string[] — same shape as the old hardcoded const
//
//   const { data, isLoading } = useLookupQuery("CURRENCY");
//   // returns full React Query result if you need loading state
//
// Available types (seeded in migration 072):
//   CO_TYPE | INDUSTRY | CURRENCY | GST_STATUS | FISCAL_YEAR_START
//   PROJECT_TYPE | PROJECT_STATUS | PROJECT_PRIORITY
//   BOOKING_STATUS | PAYMENT_MODE | UNIT_TYPE | APPLICATION_STATUS

import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export type LookupType =
  | "CO_TYPE"
  | "INDUSTRY"
  | "CURRENCY"
  | "GST_STATUS"
  | "FISCAL_YEAR_START"
  | "PROJECT_TYPE"
  | "PROJECT_STATUS"
  | "PROJECT_PRIORITY"
  | "BOOKING_STATUS"
  | "PAYMENT_MODE"
  | "UNIT_TYPE"
  | "APPLICATION_STATUS"
  | (string & {}); // allow arbitrary types for future lookups

async function fetchLookup(type: string): Promise<string[]> {
  const res = await fetchWithAuth(`/api/lookups?type=${encodeURIComponent(type)}`);
  if (!res.ok) throw new Error(`Failed to fetch lookup: ${type}`);
  return res.json();
}

/**
 * Returns the full React Query result — use when you need isLoading / error.
 */
export function useLookupQuery(type: LookupType) {
  return useQuery<string[]>({
    queryKey: ["lookup", type],
    queryFn: () => fetchLookup(type),
    staleTime: 10 * 60 * 1000,   // 10 min — lookups rarely change
    gcTime:    30 * 60 * 1000,   // 30 min cache
    placeholderData: [],
  });
}

/**
 * Convenience hook — returns string[] directly (empty array while loading).
 * Identical drop-in for old hardcoded const arrays.
 *
 * @param fallback  Optional static fallback shown while loading or on error.
 *                  Defaults to [].
 */
export function useLookup(type: LookupType, fallback: string[] = []): string[] {
  const { data } = useLookupQuery(type);
  return data && data.length > 0 ? data : fallback;
}