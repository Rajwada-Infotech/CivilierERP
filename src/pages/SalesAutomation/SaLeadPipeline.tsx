import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { LEAD_STAGES } from "@/components/sa/leadStages";
import { StatusBadge } from "@/components/StatusBadge";

// Split out of SaLeadManagement.tsx — the Kanban board used to be one tab of
// a 4-in-1 page (grid/kanban/tracking/audit); it gets its own page/route so
// the leads grid stops trying to be five different UIs at once. Fetches the
// same "sa-leads" query key as the grid, so react-query serves this from the
// same cache when a user has both open.
const API = "/api/sa/leads";

async function fetchLeads(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch leads");
  return res.json().catch(() => []);
}


const SaLeadPipeline: React.FC = () => {
  usePageRights("sa-leads");
  const { data: leads = [], isLoading, isFetching, dataUpdatedAt, refetch, error } = useQuery({
    queryKey: ["sa-leads"], queryFn: fetchLeads, staleTime: 30_000,
  });

  const stageMap = useMemo(() => {
    const map: Record<string, any[]> = {};
    LEAD_STAGES.forEach((s) => { map[s.key] = (leads as any[]).filter((l) => l.Status === s.key); });
    return map;
  }, [leads]);

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading pipeline...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load pipeline.</div>;

  return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Lead Management", "Pipeline"]} title="Lead Pipeline" subtitle="Where every lead sits right now, stage by stage"
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-3 min-w-max">
          {LEAD_STAGES.map((stage) => {
            const stageLeads = stageMap[stage.key] || [];
            return (
              <div key={stage.key} className={`w-52 shrink-0 rounded-lg border-t-2 border border-border ${stage.boardClass}`}>
                <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">{stage.label}</span>
                  <span className="text-xs font-bold text-muted-foreground bg-background rounded-full px-2 py-0.5 border border-border">{stageLeads.length}</span>
                </div>
                <div className="p-2 space-y-1.5 max-h-[calc(100vh-300px)] overflow-y-auto">
                  {stageLeads.length === 0 ? (
                    <p className="text-[0.6875rem] text-muted-foreground text-center py-4">No leads</p>
                  ) : stageLeads.map((l) => (
                    <div key={l.Id} className="bg-background rounded-md border border-border p-2 space-y-1">
                      <p className="text-xs font-medium text-foreground truncate">{l.CustomerName}</p>
                      <p className="text-[0.625rem] text-muted-foreground">{l.Mobile}</p>
                      {l.Classification && <StatusBadge status={l.Classification} className="text-[0.5625rem] px-1.5 py-0.5" />}
                      {l.SalespersonName && <p className="text-[0.625rem] text-muted-foreground truncate">{l.SalespersonName}</p>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SalesAutoShell>
  );
};

export default SaLeadPipeline;
