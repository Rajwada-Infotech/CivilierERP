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
  | (string & {});

async function fetchLookup(type: string): Promise<string[]> {
  const res = await fetchWithAuth(`/api/lookups?type=${encodeURIComponent(type)}`);
  if (!res.ok) throw new Error(`Failed to fetch lookup: ${type}`);
  const json = await res.json();
  return Array.isArray(json) ? json : (json.data ?? []);
}

export function useLookupQuery(type: LookupType) {
  return useQuery<string[]>({
    queryKey: ["lookup", type],
    queryFn: () => fetchLookup(type),
    staleTime: 10 * 60 * 1000,
    gcTime:    30 * 60 * 1000,
    placeholderData: [],
  });
}

export function useLookup(type: LookupType, fallback: string[] = []): string[] {
  const { data } = useLookupQuery(type);
  return data && data.length > 0 ? data : fallback;
}
