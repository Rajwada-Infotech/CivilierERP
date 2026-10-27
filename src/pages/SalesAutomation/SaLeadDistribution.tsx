import React, { useState, useMemo } from "react";
import { fmtIstIso } from "@/lib/istTime";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { Link } from "react-router-dom";
import { Settings2 } from "lucide-react";
import { SaTabs } from "@/components/sa/SaTabs";
import { TitleCell } from "@/components/sa/saCells";

const API = "/api/sa/lead-distribution";
const RULES_API = "/api/sa/distribution-rules";

async function fetchPending(level: number): Promise<any[]> {
  const res = await fetchWithAuth(`${API}/pending?level=${level}`);
  if (!res.ok) throw new Error("Failed to fetch pending leads");
  return res.json().catch(() => ({}));
}
async function fetchUsers(): Promise<any[]> {
  const res = await fetchWithAuth("/api/sa/leads/users");
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json().catch(() => ({}));
}
async function fetchHistory(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch distribution history");
  return res.json().catch(() => ({}));
}

type Method = "Equal" | "Percentage" | "Manual";
const METHOD_HINTS: Record<Method, string> = {
  Equal: "Splits the ticked leads evenly, in list order.",
  Percentage: "Give each person a share; shares must add up to 100%.",
  Manual: "Pick who gets each ticked lead in the last column.",
};
const LEVEL_LABELS: Record<1 | 2, string> = { 1: "Level 1 — to team leads", 2: "Level 2 — to salespeople" };
const fmtDay = (d: unknown) =>
  d ? new Date(String(d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/**
 * Who gets which of the ticked leads. One function for both the preview and
 * the request, so what you see is what is sent. Percentage uses
 * largest-remainder rounding so every ticked lead is assigned exactly once
 * (rounding each share on its own could drop or double-count leads).
 */
function computeAssignments(
  method: Method, leadIds: number[], users: any[],
  percentages: Record<number, number>, manual: Record<number, number>,
): { userId: number; leadIdList: number[] }[] {
  if (!leadIds.length) return [];
  if (method === "Manual") {
    const byUser = new Map<number, number[]>();
    leadIds.forEach((id) => {
      const uid = manual[id];
      if (uid) byUser.set(uid, [...(byUser.get(uid) ?? []), id]);
    });
    return [...byUser].map(([userId, leadIdList]) => ({ userId, leadIdList }));
  }
  let counts: number[];
  if (method === "Equal") {
    if (!users.length) return [];
    const per = Math.floor(leadIds.length / users.length), extra = leadIds.length % users.length;
    counts = users.map((_, i) => per + (i < extra ? 1 : 0));
  } else {
    const exact = users.map((u) => ((percentages[u.Id] || 0) / 100) * leadIds.length);
    counts = exact.map(Math.floor);
    let left = leadIds.length - counts.reduce((s, n) => s + n, 0);
    exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r)
      .forEach(({ i }) => { if (left > 0 && (percentages[users[i].Id] || 0) > 0) { counts[i]++; left--; } });
  }
  const out: { userId: number; leadIdList: number[] }[] = [];
  let idx = 0;
  users.forEach((u, i) => {
    if (counts[i] > 0) { out.push({ userId: u.Id, leadIdList: leadIds.slice(idx, idx + counts[i]) }); idx += counts[i]; }
  });
  return out;
}

const SaLeadDistribution: React.FC = () => {
  usePageRights("sa-lead-distribution");
  const { canDoAction } = useAuth();
  const canAutoDistribute = canDoAction("sa-lead-distribution", "edit");
  const queryClient = useQueryClient();
  const [level, setLevel] = useState<1 | 2>(1);
  const [method, setMethod] = useState<Method>("Equal");
  const [selectedLeads, setSelectedLeads] = useState<number[]>([]);
  const [assignments, setAssignments] = useState<Record<number, number>>({});
  const [percentages, setPercentages] = useState<Record<number, number>>({});
  const [tab, setTab] = useState<"distribute" | "history">("distribute");

  const { data: pending = [], isLoading: loadingPending } = useQuery({
    queryKey: ["sa-pending-leads", level],
    queryFn: () => fetchPending(level),
    staleTime: 60_000,
  });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });
  const { data: history = [], isLoading: loadingHistory } = useQuery({ queryKey: ["sa-dist-history"], queryFn: fetchHistory, staleTime: 60_000 });
  const [runningAuto, setRunningAuto] = React.useState(false);

  const handleRunAuto = async (level: 1 | 2) => {
    setRunningAuto(true);
    try {
      const res = await fetchWithAuth(`${RULES_API}/run-now/${level}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Auto-distribution failed");
      toast.success(`Auto-distributed ${data.distributedCount} of ${data.eligibleCount} leads`);
      await queryClient.invalidateQueries({ queryKey: ["sa-pending-leads"] });
      await queryClient.invalidateQueries({ queryKey: ["sa-dist-history"] });
      await queryClient.invalidateQueries({ queryKey: ["sa-leads"] });
    } catch (err: any) {
      toast.error(err.message || "Auto-distribution failed");
    } finally {
      setRunningAuto(false);
    }
  };

  const eligibleUsers = useMemo(() => {
    if (level === 1) return users.filter((u: any) => u.role === "sales_team_lead" || u.role === "admin" || u.role === "super_admin");
    return users.filter((u: any) => u.role === "sales_person");
  }, [users, level]);

  const toggleLead = (id: number) => {
    setSelectedLeads((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const pctTotal = eligibleUsers.reduce((s: number, u: any) => s + (percentages[u.Id] || 0), 0);
  const plan = useMemo(
    () => computeAssignments(method, selectedLeads, eligibleUsers, percentages, assignments),
    [method, selectedLeads, eligibleUsers, percentages, assignments],
  );
  const planned = plan.reduce((s, a) => s + a.leadIdList.length, 0);
  const unassigned = selectedLeads.length - planned;
  const nameOf = (id: number) => eligibleUsers.find((u: any) => u.Id === id)?.Name ?? `User ${id}`;
  const blocker = !selectedLeads.length ? "Tick the leads to hand out."
    : !eligibleUsers.length ? "Nobody can receive leads at this level."
    : method === "Percentage" && pctTotal !== 100 ? `Shares add up to ${pctTotal}% — they must total 100%.`
    : method === "Manual" && unassigned > 0 ? `Pick who gets ${unassigned} more ticked lead${unassigned === 1 ? "" : "s"}.`
    : null;

  const handleDistribute = async () => {
    if (blocker) return toast.error(blocker);
    // Only the leads actually in the plan are sent.
    const leadIds = plan.flatMap((a) => a.leadIdList);
    try {
      const res = await fetchWithAuth(`${API}/distribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds, assignments: plan, method, level }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Distribution failed");
      toast.success(`${data.distributed ?? selectedLeads.length} leads distributed!`);
      if (data.skipped) toast.warning(`${data.skipped} lead${data.skipped === 1 ? " had" : "s had"} already moved on and ${data.skipped === 1 ? "was" : "were"} skipped`);
      setSelectedLeads([]);
      setAssignments({});
      setPercentages({});
      await queryClient.invalidateQueries({ queryKey: ["sa-pending-leads"] });
      await queryClient.invalidateQueries({ queryKey: ["sa-dist-history"] });
      await queryClient.invalidateQueries({ queryKey: ["sa-leads"] });
    } catch (err: any) {
      toast.error(err.message || "Distribution failed");
    }
  };

  const pendingColumns: ColumnDef<any, unknown>[] = [
    { id: "select", header: () => (
        <input type="checkbox" checked={selectedLeads.length === pending.length && pending.length > 0}
          onChange={(e) => setSelectedLeads(e.target.checked ? pending.map((l: any) => l.Id) : [])} />
      ), size: 40, enableSorting: false,
      cell: (i) => <input type="checkbox" checked={selectedLeads.includes(i.row.original.Id)} onChange={() => toggleLead(i.row.original.Id)} /> },
    { accessorKey: "CustomerName", header: "Lead", size: 160,
      cell: (i) => TitleCell(i.row.original.CustomerName, i.row.original.Mobile) },
    { accessorKey: "CampaignName", header: "Came from", size: 160,
      cell: (i) => TitleCell(i.row.original.CampaignName || "—", i.row.original.PlatformName) },
    { accessorKey: "DateGenerated", header: "Received", size: 110,
      cell: (i) => <span className="text-muted-foreground whitespace-nowrap">{fmtDay(i.row.original.DateGenerated)}</span> },
    ...(method === "Manual" ? [{
      id: "assignTo", header: "Give to", size: 140, enableSorting: false,
      cell: (i: any) => (
        <SearchableNativeSelect value={assignments[i.row.original.Id] || ""}
          onChange={(e) => {
            const id = i.row.original.Id;
            setAssignments((a) => ({ ...a, [id]: parseInt(e.target.value) }));
            // Picking someone for a lead means you want it handed out.
            if (e.target.value) setSelectedLeads((s) => (s.includes(id) ? s : [...s, id]));
          }}
          className="text-xs border border-border rounded px-2 py-1 bg-background">
          <option value="">Select</option>
          {eligibleUsers.map((u: any) => <option key={u.Id} value={u.Id}>{u.Name}</option>)}
        </SearchableNativeSelect>
      ),
    } as ColumnDef<any, unknown>] : []),
  ];

  const historyColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "DistributedAt", header: "When", size: 140,
      cell: (i) => <span className="text-muted-foreground whitespace-nowrap">{i.row.original.DistributedAt ? fmtIstIso(i.row.original.DistributedAt) : "—"}</span> },
    { accessorKey: "CustomerName", header: "Lead", size: 160,
      cell: (i) => TitleCell(i.row.original.CustomerName, i.row.original.LeadUid) },
    { accessorKey: "ToUserName", header: "Given to", size: 150,
      cell: (i) => TitleCell(i.row.original.ToUserName || "—", i.row.original.FromUserName ? `by ${i.row.original.FromUserName}` : "") },
    { accessorKey: "Level", header: "Level", size: 120,
      cell: (i) => <span className="text-muted-foreground text-xs">{LEVEL_LABELS[i.row.original.Level as 1 | 2] ?? `Level ${i.row.original.Level}`}</span> },
    { accessorKey: "Method", header: "How", size: 110, cell: (i) => <span className="text-muted-foreground">{i.getValue() as string}</span> },
  ];

  return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Leads", "Distribution"]} title="Lead Distribution"
      subtitle={`${pending.length} lead${pending.length === 1 ? "" : "s"} waiting at ${LEVEL_LABELS[level].toLowerCase()}. Hand them out now, or let the standing rules do it.`}
      action={
        <Link to="/sales-automation/distribution-rules"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-accent transition-colors">
          <Settings2 size={13} /> Manage standing rules
        </Link>
      }>
      <div className="space-y-6">

        {/* Tabs — "Auto-Distribution Rules" used to be a 3rd tab here,
            duplicating SaDistributionRules.tsx's own rule CRUD with a
            thinner, inconsistent method vocabulary (Percentage/FixedCount
            here vs RoundRobin/Weighted/Manual there). Standing rule
            management now lives in exactly one place — see the link above —
            this page keeps only what's genuinely distinct: manual ad-hoc
            distribution of leads pending right now, and the resulting
            history. */}
        <SaTabs
          tabs={[
            { key: "distribute", label: `Waiting (${pending.length})` },
            { key: "history", label: "History" },
          ]}
          active={tab}
          onChange={(key) => setTab(key)}
        />

        {tab === "distribute" && (
          <div className="space-y-4">
            {/* Controls */}
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Level</label>
                <div className="flex gap-2">
                  {([1, 2] as const).map((l) => (
                    <button key={l} onClick={() => { setLevel(l); setSelectedLeads([]); setAssignments({}); setPercentages({}); }}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${level === l ? "btn-module text-white border-primary" : "border-border text-muted-foreground hover:bg-accent"}`}>
                      {LEVEL_LABELS[l]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">How to split</label>
                <div className="flex gap-2">
                  {(Object.keys(METHOD_HINTS) as Method[]).map((m) => (
                    <button key={m} onClick={() => setMethod(m)} title={METHOD_HINTS[m]}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${method === m ? "btn-module text-white border-primary" : "border-border text-muted-foreground hover:bg-accent"}`}>
                      {m === "Percentage" ? "By share" : m === "Equal" ? "Evenly" : "Pick each"}
                    </button>
                  ))}
                </div>
              </div>
              {canAutoDistribute && (
                <button onClick={() => handleRunAuto(level)} disabled={runningAuto}
                  title="Hand out every waiting lead at this level using the standing rules"
                  className="ml-auto px-4 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-40 transition-colors">
                  {runningAuto ? "Assigning…" : "Use standing rules"}
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground -mt-2">{METHOD_HINTS[method]}</p>

            {/* What will happen — the same plan that is sent */}
            <div className={`rounded-lg border p-3 flex flex-wrap items-center gap-3 ${blocker ? "border-border bg-muted/20" : "border-emerald-300 bg-emerald-500/5"}`}>
              <div className="flex-1 min-w-[14rem] text-sm">
                {blocker ? <span className="text-muted-foreground">{blocker}</span> : (
                  <span>
                    <span className="font-medium">{planned} lead{planned === 1 ? "" : "s"}:</span>{" "}
                    {plan.map((a) => `${nameOf(a.userId)} ${a.leadIdList.length}`).join(" · ")}
                  </span>
                )}
              </div>
              <button onClick={handleDistribute} disabled={!!blocker}
                className="px-4 py-2 rounded-md btn-module text-white text-sm font-medium disabled:opacity-40 transition-colors">
                Hand out {planned ? planned : ""} lead{planned === 1 ? "" : "s"}
              </button>
            </div>

            {/* Percentage inputs */}
            {method === "Percentage" && (() => {
              const pctOk = pctTotal === 100;
              return (
                <div className="p-3 bg-muted/30 rounded-lg space-y-2">
                  <div className="flex flex-wrap gap-3">
                    {eligibleUsers.map((u: any) => (
                      <div key={u.Id} className="flex items-center gap-2">
                        <span className="text-xs text-foreground">{u.Name}</span>
                        <input type="number" min={0} max={100} value={percentages[u.Id] || 0}
                          onChange={(e) => setPercentages((p) => ({ ...p, [u.Id]: parseInt(e.target.value) || 0 }))}
                          className="w-16 px-2 py-1 text-xs border border-border rounded bg-background" />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                    ))}
                  </div>
                  <p className={`text-xs font-medium ${pctOk ? "text-emerald-600" : "text-amber-500"}`}>
                    Total: {pctTotal}%{pctOk ? "" : " — must equal 100%"}
                  </p>
                </div>
              );
            })()}

            {/* Pending leads table */}
            <DataTable
              data={pending}
              columns={pendingColumns}
              searchable={false}
              loading={loadingPending}
              emptyMessage={`Nothing waiting at ${LEVEL_LABELS[level].toLowerCase()}.`}
              className="rounded-lg border border-border overflow-hidden bg-card"
            />
          </div>
        )}

        {tab === "history" && (
          <DataTable
            data={history}
            columns={historyColumns}
            searchable={false}
            loading={loadingHistory}
            emptyMessage="No distribution history yet"
            className="rounded-lg border border-border overflow-hidden bg-card"
          />
        )}
      </div>
    </SalesAutoShell>
  );
};

export default SaLeadDistribution;