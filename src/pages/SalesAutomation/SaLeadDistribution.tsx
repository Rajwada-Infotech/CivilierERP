import React, { useState, useMemo } from "react";
import { fmtIstIso } from "@/lib/istTime";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { Link } from "react-router-dom";
import { Settings2 } from "lucide-react";
import { SaTabs } from "@/components/sa/SaTabs";

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

const SaLeadDistribution: React.FC = () => {
  usePageRights("sa-lead-distribution");
  const { canDoAction } = useAuth();
  const canAutoDistribute = canDoAction("sa-lead-distribution", "edit");
  const queryClient = useQueryClient();
  const [level, setLevel] = useState<1 | 2>(1);
  const [method, setMethod] = useState<"Equal" | "Percentage" | "Manual">("Equal");
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

  const handleDistribute = async () => {
    if (!selectedLeads.length) return toast.error("Select at least one lead");
    if (!eligibleUsers.length) return toast.error("No eligible users found");
    if (method === "Percentage") {
      const pctTotal = eligibleUsers.reduce((s: number, u: any) => s + (percentages[u.Id] || 0), 0);
      if (pctTotal !== 100) return toast.error(`Percentages must sum to 100% (currently ${pctTotal}%)`);
    }

    let assignmentList: { userId: number; leadIdList: number[] }[] = [];

    if (method === "Equal") {
      const perUser = Math.floor(selectedLeads.length / eligibleUsers.length);
      const remainder = selectedLeads.length % eligibleUsers.length;
      let idx = 0;
      for (let i = 0; i < eligibleUsers.length; i++) {
        const count = perUser + (i < remainder ? 1 : 0);
        if (count > 0) {
          assignmentList.push({ userId: eligibleUsers[i].Id, leadIdList: selectedLeads.slice(idx, idx + count) });
          idx += count;
        }
      }
    } else if (method === "Percentage") {
      let idx = 0;
      for (const u of eligibleUsers) {
        const pct = percentages[u.Id] || 0;
        const count = Math.round((pct / 100) * selectedLeads.length);
        if (count > 0) {
          assignmentList.push({ userId: u.Id, leadIdList: selectedLeads.slice(idx, idx + count) });
          idx += count;
        }
      }
    } else {
      for (const [leadId, userIdStr] of Object.entries(assignments)) {
        const uid = Number(userIdStr);
        const existing = assignmentList.find((a) => a.userId === uid);
        if (existing) existing.leadIdList.push(parseInt(leadId));
        else assignmentList.push({ userId: uid, leadIdList: [parseInt(leadId)] });
      }
    }

    if (!assignmentList.length) return toast.error("No valid assignments computed");

    try {
      const res = await fetchWithAuth(`${API}/distribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: selectedLeads, assignments: assignmentList, method, level }),
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
    { accessorKey: "CustomerName", header: "Customer", size: 150,
      cell: (i) => <span className="font-medium text-foreground">{i.getValue() as string}</span> },
    { accessorKey: "Mobile", header: "Mobile", size: 110, cell: (i) => <span className="text-muted-foreground">{i.getValue() as string}</span> },
    { accessorKey: "PlatformName", header: "Source", size: 110,
      cell: (i) => <span className="text-muted-foreground">{i.row.original.PlatformName || "—"}</span> },
    { accessorKey: "CampaignName", header: "Campaign", size: 130,
      cell: (i) => <span className="text-muted-foreground">{i.row.original.CampaignName || "—"}</span> },
    { accessorKey: "DateGenerated", header: "Date", size: 100,
      cell: (i) => <span className="text-muted-foreground">{i.row.original.DateGenerated ? String(i.row.original.DateGenerated).slice(0, 10) : "—"}</span> },
    ...(method === "Manual" ? [{
      id: "assignTo", header: "Assign To", size: 130, enableSorting: false,
      cell: (i: any) => (
        <SearchableNativeSelect value={assignments[i.row.original.Id] || ""} onChange={(e) => setAssignments((a) => ({ ...a, [i.row.original.Id]: parseInt(e.target.value) }))}
          className="text-xs border border-border rounded px-2 py-1 bg-background">
          <option value="">Select</option>
          {eligibleUsers.map((u: any) => <option key={u.Id} value={u.Id}>{u.Name}</option>)}
        </SearchableNativeSelect>
      ),
    } as ColumnDef<any, unknown>] : []),
  ];

  const historyColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "LeadUid", header: "Lead", size: 100,
      cell: (i) => <span className="text-xs text-muted-foreground font-mono">{i.getValue() as string}</span> },
    { accessorKey: "CustomerName", header: "Customer", size: 150,
      cell: (i) => <span className="font-medium text-foreground">{i.getValue() as string}</span> },
    { accessorKey: "FromUserName", header: "From", size: 120,
      cell: (i) => <span className="text-muted-foreground">{i.row.original.FromUserName || "—"}</span> },
    { accessorKey: "ToUserName", header: "To", size: 120,
      cell: (i) => <span className="text-muted-foreground">{i.row.original.ToUserName || "—"}</span> },
    { accessorKey: "Level", header: "Level", size: 80,
      cell: (i) => <span className="text-muted-foreground">L{i.row.original.Level}</span> },
    { accessorKey: "Method", header: "Method", size: 110, cell: (i) => <span className="text-muted-foreground">{i.getValue() as string}</span> },
    { accessorKey: "DistributedAt", header: "Date", size: 140,
      cell: (i) => <span className="text-muted-foreground">{i.row.original.DistributedAt ? fmtIstIso(i.row.original.DistributedAt) : "—"}</span> },
  ];

  return (
    <SalesAutoShell title="Lead Distribution" subtitle="Manually distribute pending leads right now, or see what's already been distributed"
      action={
        <Link to="/sales-automation/distribution-rules"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-accent transition-colors">
          <Settings2 size={13} /> Manage standing rules
        </Link>
      }>
      <Breadcrumbs items={["Sales Automation", "Lead Distribution"]} />
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
            { key: "distribute", label: "Distribute Leads" },
            { key: "history", label: "Distribution History" },
          ]}
          active={tab}
          onChange={(key) => setTab(key)}
        />

        {tab === "distribute" && (
          <div className="space-y-4">
            {/* Controls */}
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Distribution Level</label>
                <div className="flex gap-2">
                  {([1, 2] as const).map((l) => (
                    <button key={l} onClick={() => { setLevel(l); setSelectedLeads([]); }}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${level === l ? "btn-module text-white border-primary" : "border-border text-muted-foreground hover:bg-accent"}`}>
                      Level {l} {l === 1 ? "(Admin ? TL)" : "(TL ? SP)"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Method</label>
                <div className="flex gap-2">
                  {(["Equal", "Percentage", "Manual"] as const).map((m) => (
                    <button key={m} onClick={() => setMethod(m)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${method === m ? "btn-module text-white border-primary" : "border-border text-muted-foreground hover:bg-accent"}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={handleDistribute} disabled={!selectedLeads.length}
                className="px-4 py-2 rounded-md btn-module text-white text-sm font-medium disabled:opacity-40 transition-colors">
                Distribute {selectedLeads.length ? `(${selectedLeads.length})` : ""}
              </button>
              {canAutoDistribute && (
                <button onClick={() => handleRunAuto(level)} disabled={runningAuto}
                  className="px-4 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-40 transition-colors">
                  {runningAuto ? "Running..." : `Auto-Distribute L${level}`}
                </button>
              )}
            </div>

            {/* Percentage inputs */}
            {method === "Percentage" && (() => {
              const pctTotal = eligibleUsers.reduce((s: number, u: any) => s + (percentages[u.Id] || 0), 0);
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
                    Total: {pctTotal}% {pctOk ? "✓" : `— must equal 100%`}
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
              emptyMessage={`No pending leads for Level ${level}`}
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