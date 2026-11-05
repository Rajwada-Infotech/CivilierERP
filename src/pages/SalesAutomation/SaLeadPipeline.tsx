import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { LEAD_CLOSED_STATUSES, LEAD_STAGES } from "@/components/sa/leadStages";
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


// Finished leads are never flagged as gone quiet.
const CLOSED_STAGES = LEAD_CLOSED_STATUSES;
const QUIET_DAYS = 7;
const UNASSIGNED = "__none";
const daysSince = (d: unknown) =>
  d ? Math.max(0, Math.floor((Date.now() - new Date(String(d)).getTime()) / 86_400_000)) : 0;

const SaLeadPipeline: React.FC = () => {
  usePageRights("sa-leads");
  const { data: leads = [], isLoading, isFetching, dataUpdatedAt, refetch, error } = useQuery({
    queryKey: ["sa-leads"], queryFn: fetchLeads, staleTime: 30_000,
  });

  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("All");
  const owners = useMemo(
    () => Array.from(new Set((leads as any[]).map((l) => l.SalespersonName).filter(Boolean))).sort() as string[],
    [leads],
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (leads as any[]).filter((l) =>
      (owner === "All" || (owner === UNASSIGNED ? !l.SalespersonName : l.SalespersonName === owner))
      && (!q || [l.CustomerName, l.Mobile, l.LeadUid].some((v) => String(v ?? "").toLowerCase().includes(q))));
  }, [leads, search, owner]);
  const stageMap = useMemo(() => {
    const map: Record<string, any[]> = {};
    LEAD_STAGES.forEach((s) => { map[s.key] = shown.filter((l) => l.Status === s.key); });
    return map;
  }, [shown]);

  if (isLoading || error) return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Pipeline", "Stage Board"]} title="Stage Board">
      <div className={`p-6 text-sm ${error ? "text-red-500" : "text-muted-foreground"}`}>
        {error ? "Couldn't load leads. Refresh the page to try again." : "Loading…"}
      </div>
    </SalesAutoShell>
  );

  const quiet = shown.filter((l) => !CLOSED_STAGES.includes(l.Status) && daysSince(l.LastActivityAt ?? l.DateGenerated) > QUIET_DAYS).length;

  return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Pipeline", "Stage Board"]} title="Stage Board"
      subtitle={`Where every lead sits right now — ${shown.length} shown, ${quiet} open lead${quiet === 1 ? "" : "s"} untouched for over ${QUIET_DAYS} days`}
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <label className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 bg-background w-full sm:w-64">
          <Search size={14} className="text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, mobile or lead ID" className="flex-1 bg-transparent text-sm outline-none" />
        </label>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
          <option value="All">Everyone</option>
          <option value={UNASSIGNED}>No salesperson yet</option>
          {owners.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-3 min-w-max">
          {LEAD_STAGES.map((stage) => {
            const stageLeads = stageMap[stage.key] || [];
            return (
              <div key={stage.key} className={`w-56 shrink-0 rounded-lg border-t-2 border border-border ${stage.boardClass}`}>
                <div className="px-3 py-2 border-b border-border">
                  <div className="flex items-center justify-between">
                    <Link to={stage.path} className="text-xs font-semibold text-foreground hover:text-primary hover:underline" title={`Work these leads on their page`}>{stage.label}</Link>
                    <span className="text-xs font-bold text-muted-foreground bg-background rounded-full px-2 py-0.5 border border-border">{stageLeads.length}</span>
                  </div>
                  <p className="text-[0.625rem] text-muted-foreground">{stage.hint}</p>
                </div>
                <div className="p-2 space-y-1.5 max-h-[calc(100vh-340px)] overflow-y-auto">
                  {stageLeads.length === 0 ? (
                    <p className="text-[0.6875rem] text-muted-foreground text-center py-4">No leads</p>
                  ) : stageLeads.map((l) => {
                    const idle = daysSince(l.LastActivityAt ?? l.DateGenerated);
                    const stale = !CLOSED_STAGES.includes(l.Status) && idle > QUIET_DAYS;
                    return (
                      <div key={l.Id} className={`bg-background rounded-md border p-2 space-y-1 ${stale ? "border-amber-300" : "border-border"}`}>
                        <div className="flex items-start justify-between gap-1">
                          <p className="text-xs font-medium text-foreground truncate">{l.CustomerName}</p>
                          {l.Classification && <StatusBadge status={l.Classification} className="text-[0.5625rem] px-1.5 py-0.5" />}
                        </div>
                        <p className="text-[0.625rem] text-muted-foreground">
                          {l.Mobile ? <a href={`tel:${l.Mobile}`} className="hover:text-primary">{l.Mobile}</a> : "—"}
                        </p>
                        <p className="text-[0.625rem] text-muted-foreground truncate">{l.SalespersonName || "No salesperson yet"}</p>
                        <p className={`text-[0.625rem] ${stale ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
                          {l.LastActivityAt ? `Last touched ${idle === 0 ? "today" : `${idle}d ago`}` : `Never contacted · ${idle}d old`}
                        </p>
                      </div>
                    );
                  })}
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
