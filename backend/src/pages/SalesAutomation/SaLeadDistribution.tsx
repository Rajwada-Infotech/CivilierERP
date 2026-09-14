import React, { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

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
async function fetchRules(): Promise<any[]> {
  const res = await fetchWithAuth(RULES_API);
  if (!res.ok) throw new Error("Failed to fetch distribution rules");
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
  const [tab, setTab] = useState<"distribute" | "history" | "rules">("distribute");

  const { data: pending = [], isLoading: loadingPending } = useQuery({
    queryKey: ["sa-pending-leads", level],
    queryFn: () => fetchPending(level),
    staleTime: 60_000,
  });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });
  const { data: history = [], isLoading: loadingHistory } = useQuery({ queryKey: ["sa-dist-history"], queryFn: fetchHistory, staleTime: 60_000 });
  const { data: rules = [], isLoading: loadingRules } = useQuery({ queryKey: ["sa-dist-rules"], queryFn: fetchRules, staleTime: 60_000 });
  const [newRule, setNewRule] = React.useState({ Level: 1, ScopeType: "Global", ScopeId: "", Method: "Percentage", members: [] as { UserId: number; Weight: number }[] });
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
      if (!res.ok) throw new Error((await res.json()).error || "Distribution failed");
      toast.success(`${selectedLeads.length} leads distributed!`);
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
      cell: (i) => <span className="text-muted-foreground">{i.row.original.PlatformName || "�"}</span> },
    { accessorKey: "CampaignName", header: "Campaign", size: 130,
      cell: (i) => <span className="text-muted-foreground">{i.row.original.CampaignName || "�"}</span> },
    { accessorKey: "DateGenerated", header: "Date", size: 100,
      cell: (i) => <span className="text-muted-foreground">{i.row.original.DateGenerated ? String(i.row.original.DateGenerated).slice(0, 10) : "�"}</span> },
    ...(method === "Manual" ? [{
      id: "assignTo", header: "Assign To", size: 130, enableSorting: false,
      cell: (i: any) => (
        <select value={assignments[i.row.original.Id] || ""} onChange={(e) => setAssignments((a) => ({ ...a, [i.row.original.Id]: parseInt(e.target.value) }))}
          className="text-xs border border-border rounded px-2 py-1 bg-background">
          <option value="">Select</option>
          {eligibleUsers.map((u: any) => <option key={u.Id} value={u.Id}>{u.Name}</option>)}
        </select>
      ),
    } as ColumnDef<any, unknown>] : []),
  ];

  const historyColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "LeadUid", header: "Lead", size: 100,
      cell: (i) => <span className="text-xs text-muted-foreground font-mono">{i.getValue() as string}</span> },
    { accessorKey: "CustomerName", header: "Customer", size: 150,
      cell: (i) => <span className="font-medium text-foreground">{i.getValue() as string}</span> },
    { accessorKey: "FromUserName", header: "From", size: 120,
      cell: (i) => <span className="text-muted-foreground">{i.row.original.FromUserName || "�"}</span> },
    { accessorKey: "ToUserName", header: "To", size: 120,
      cell: (i) => <span className="text-muted-foreground">{i.row.original.ToUserName || "�"}</span> },
    { accessorKey: "Level", header: "Level", size: 80,
      cell: (i) => <span className="text-muted-foreground">L{i.row.original.Level}</span> },
    { accessorKey: "Method", header: "Method", size: 110, cell: (i) => <span className="text-muted-foreground">{i.getValue() as string}</span> },
    { accessorKey: "DistributedAt", header: "Date", size: 140,
      cell: (i) => <span className="text-muted-foreground">{i.row.original.DistributedAt ? String(i.row.original.DistributedAt).slice(0, 16).replace("T", " ") : "�"}</span> },
  ];

  return (
    <SalesAutoShell title="Lead Distribution" subtitle="Allocate leads to team leaders (L1) and sales persons (L2)">
      <Breadcrumbs items={["Sales Automation", "Lead Distribution"]} />
      <div className="space-y-6">

        {/* Tabs */}
        <div className="flex gap-2 border-b border-border">
          {(["distribute", "history", "rules"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`}>
              {t === "distribute" ? "Distribute Leads" : t === "history" ? "Distribution History" : "Auto-Distribution Rules"}
            </button>
          ))}
        </div>

        {tab === "distribute" && (
          <div className="space-y-4">
            {/* Controls */}
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Distribution Level</label>
                <div className="flex gap-2">
                  {([1, 2] as const).map((l) => (
                    <button key={l} onClick={() => { setLevel(l); setSelectedLeads([]); }}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${level === l ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-accent"}`}>
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
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${method === m ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-accent"}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={handleDistribute} disabled={!selectedLeads.length}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors">
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
                    Total: {pctTotal}% {pctOk ? "?" : `� must equal 100%`}
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
        {tab === "rules" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Auto-Distribution Rules</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Configure weighted splits. The engine uses a running-total deficit algorithm to stay on-ratio over time.</p>
              </div>
            </div>
            {loadingRules ? (
              <div className="text-sm text-muted-foreground">Loading rules...</div>
            ) : rules.length === 0 ? (
              <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">No distribution rules configured yet. Create one below.</div>
            ) : (
              <div className="space-y-3">
                {rules.map((r: any) => (
                  <div key={r.Id} className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">L{r.Level}</span>
                        <span className="text-sm font-medium text-foreground">{r.ScopeType === "Global" ? "Global" : r.ScopeType === "Campaign" ? `Campaign: ${r.ScopeCampaignName || r.ScopeId}` : `Team Lead: ${r.ScopeTeamLeadName || r.ScopeId}`}</span>
                        <span className="text-xs text-muted-foreground">� {r.Method}</span>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.IsActive ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground"}`}>{r.IsActive ? "Active" : "Inactive"}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(r.members || []).map((m: any) => (
                        <div key={m.Id} className="flex items-center gap-1.5 text-xs bg-muted/40 rounded px-2 py-1">
                          <span className="text-foreground font-medium">{m.UserName}</span>
                          <span className="text-muted-foreground">{m.Weight}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="rounded-lg border border-border p-4 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Create New Rule</h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Level</label>
                  <select value={newRule.Level} onChange={(e) => setNewRule((r) => ({ ...r, Level: parseInt(e.target.value) as 1|2 }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                    <option value={1}>Level 1 (Admin ? Team Lead)</option>
                    <option value={2}>Level 2 (Team Lead ? Salesperson)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Scope</label>
                  <select value={newRule.ScopeType} onChange={(e) => setNewRule((r) => ({ ...r, ScopeType: e.target.value, ScopeId: "" }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                    <option value="Global">Global (all leads at this level)</option>
                    {newRule.Level === 1 && <option value="Campaign">Campaign-specific</option>}
                    {newRule.Level === 2 && <option value="TeamLead">Team Lead-specific</option>}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Method</label>
                  <select value={newRule.Method} onChange={(e) => setNewRule((r) => ({ ...r, Method: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                    <option value="Percentage">Percentage</option>
                    <option value="FixedCount">Fixed Count</option>
                  </select>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-muted-foreground">Members &amp; Weights</label>
                  <button onClick={() => setNewRule((r) => ({ ...r, members: [...r.members, { UserId: 0, Weight: 0 }] }))}
                    className="text-xs text-primary hover:underline">+ Add member</button>
                </div>
                {newRule.members.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 mb-2">
                    <select value={m.UserId} onChange={(e) => setNewRule((r) => { const ms = [...r.members]; ms[i] = { ...ms[i], UserId: parseInt(e.target.value) }; return { ...r, members: ms }; })}
                      className="flex-1 text-sm border border-border rounded px-2 py-1.5 bg-background">
                      <option value={0}>Select user</option>
                      {users.map((u: any) => <option key={u.Id} value={u.Id}>{u.Name}</option>)}
                    </select>
                    <input type="number" min={0} max={100} value={m.Weight}
                      onChange={(e) => setNewRule((r) => { const ms = [...r.members]; ms[i] = { ...ms[i], Weight: parseFloat(e.target.value) || 0 }; return { ...r, members: ms }; })}
                      className="w-20 text-sm border border-border rounded px-2 py-1.5 bg-background" placeholder="Weight" />
                    <button onClick={() => setNewRule((r) => ({ ...r, members: r.members.filter((_, j) => j !== i) }))}
                      className="text-xs text-red-500 hover:underline">Remove</button>
                  </div>
                ))}
              </div>
              <button onClick={async () => {
                if (!newRule.members.length || newRule.members.some(m => !m.UserId)) return toast.error("Add at least one member with a user selected");
                try {
                  const res = await fetchWithAuth(RULES_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Level: newRule.Level, ScopeType: newRule.ScopeType, ScopeId: newRule.ScopeId ? parseInt(newRule.ScopeId) : null, Method: newRule.Method, members: newRule.members }) });
                  if (!res.ok) throw new Error((await res.json()).error || "Failed to create rule");
                  toast.success("Rule created");
                  setNewRule({ Level: 1, ScopeType: "Global", ScopeId: "", Method: "Percentage", members: [] });
                  await queryClient.invalidateQueries({ queryKey: ["sa-dist-rules"] });
                } catch (err: any) { toast.error(err.message); }
              }} className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors">
                Create Rule
              </button>
            </div>
          </div>
        )}
      </div>
    </SalesAutoShell>
  );
};

export default SaLeadDistribution;