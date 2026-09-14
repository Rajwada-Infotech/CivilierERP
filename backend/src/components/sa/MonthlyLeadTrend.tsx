import React from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { TrendingUp } from "lucide-react";

interface TrendPoint { month: string; count: number; }

async function fetchTrends(): Promise<TrendPoint[]> {
  try {
    const res = await fetchWithAuth("/api/sa/dashboard/trends");
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

function shortMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("default", { month: "short" });
}

export const MonthlyLeadTrend: React.FC = () => {
  const { data = [] } = useQuery<TrendPoint[]>({
    queryKey: ["sa-dashboard-trends"],
    queryFn: fetchTrends,
    staleTime: 2 * 60_000,
  });

  const max = Math.max(...data.map((d) => d.count), 1);
  const BAR_H = 80;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={16} className="text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Monthly Lead Trend</h3>
        <span className="text-xs text-muted-foreground ml-auto">Last 6 months</span>
      </div>

      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No trend data yet</p>
      ) : (
        <div className="flex items-end gap-2 h-28">
          {data.map((d) => {
            const barH = Math.max(4, Math.round((d.count / max) * BAR_H));
            return (
              <div key={d.month} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                <span className="text-[10px] font-semibold text-primary">{d.count}</span>
                <div
                  className="w-full rounded-t-sm bg-primary/70 hover:bg-primary transition-colors"
                  style={{ height: `${barH}px` }}
                  title={`${d.month}: ${d.count} leads`}
                />
                <span className="text-[10px] text-muted-foreground truncate">{shortMonth(d.month)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
