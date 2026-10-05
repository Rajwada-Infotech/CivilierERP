import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { pickLockedFinYear } from "@/utils/finYearLock";

export interface LockedFinYear {
  id: number;
  label: string;
}

// The financial year new documents are locked to: the open year containing
// today, else the most recent open year. Uses the same list every
// transaction dropdown uses (active, unlocked years), so a year that is
// closed or locked is never picked.
async function fetchLockedFinYear(): Promise<LockedFinYear | null> {
  const res = await fetchWithAuth("/api/fin-year");
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const rows: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  const open = rows.filter((r) => (r.FStatus === 1 || r.FStatus === true) && !r.FisLocked && !r.FLocked);
  const picked = pickLockedFinYear(open, (r) => ({ start: r.FStartDate, end: r.FEndDate }));
  return picked ? { id: Number(picked.FId), label: String(picked.FName) } : null;
}

/**
 * `enabled` should be true only while a NEW record is being created — an
 * existing record keeps the year it was saved with.
 */
export function useLockedFinYear(enabled: boolean) {
  const { data } = useQuery({
    queryKey: ["locked-fin-year"],
    queryFn: fetchLockedFinYear,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
  return data ?? null;
}
