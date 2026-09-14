// The active financial year, as a plain "2024-25" string — the mobile
// stand-in for the web app's useFinYear() context. Most FA transactions
// derive FinYear server-side from the Doc Date; this is only a form default
// and a list-filter option.
import { useQuery } from "@tanstack/react-query";
import { getFinYears, type FinYearRow } from "@/api/mastersApi";

export function useActiveFinYear() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["fin-years"],
    queryFn: getFinYears,
    staleTime: 5 * 60 * 1000,
  });

  const rows = data as FinYearRow[];
  const active = rows.find((f) => f.FStatus && !f.FisLocked) ?? rows.find((f) => f.FStatus);
  const options = rows
    .map((f) => f.FName)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));

  return { activeFinYear: active?.FName ?? "", finYearOptions: options, isLoading };
}
