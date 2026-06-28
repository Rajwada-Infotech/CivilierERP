import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/sa/lead-distribution";

async function fetchPending(level: number): Promise<any[]> {
  const res = await fetchWithAuth(`${API}/pending?level=${level}`);
  if (!res.ok) throw new Error("Failed to fetch pending leads");
  return res.json();
}
async function fetchUsers(): Promise<any[]> {
  const res = await fetchWithAuth("/api/sa/leads/users");
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}
async function fetchHistory(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch distribution history");
  return res.json();
}

const SaLeadDistribution: React.FC = () => {
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

  const eligibleUsers = useMemo(() => {
    if (level === 1) return users.filter((u: any) => u.role === "team_leader" || u.role === "admin");
    return users.filter((u: any) => u.role === "sales_executive" || u.role === "salesperson" || u.role === "staff");
  }, [users, level]);

  const toggleLead = (id: number) => {
    setSelectedLeads((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const handleDistribute = async () => {
    if (!selectedLeads.length) return toast.error("Select at least one lead");
    if (!eligibleUsers.length) return toast.error("No eligible users found");

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
      for (const [leadId, userId] of Object.entries(assignments)) {
        const existing = assignmentList.find((a) => a.userId === userId);
        if (existing) existing.leadIdList.push(parseInt(leadId));
        else assignmentList.push({ userId, leadIdList: [parseInt(leadId)] });
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

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Sales Automation", "Lead Distribution"]} />
      <div className="space-y-6 mt-6">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground">Lead Distribution</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Allocate leads to team leaders (L1) and sales persons (L2)</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-border">
          {(["distribute", "history"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`}>
              {t === "distribute" ? "Distribute Leads" : "Distribution History"}
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
                      Level {l} {l === 1 ? "(Admin → TL)" : "(TL → SP)"}
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
            </div>

            {/* Percentage inputs */}
            {method === "Percentage" && (
              <div className="flex flex-wrap gap-3 p-3 bg-muted/30 rounded-lg">
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
            )}

            {/* Pending leads table */}
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="p-3 text-left w-8">
                      <input type="checkbox" checked={selectedLeads.length === pending.length && pending.length > 0}
                        onChange={(e) => setSelectedLeads(e.target.checked ? pending.map((l: any) => l.Id) : [])} />
                    </th>
                    <th className="p-3 text-left text-xs font-medium text-muted-foreground">Customer</th>
                    <th className="p-3 text-left text-xs font-medium text-muted-foreground">Mobile</th>
                    <th className="p-3 text-left text-xs font-medium text-muted-foreground">Source</th>
                    <th className="p-3 text-left text-xs font-medium text-muted-foreground">Campaign</th>
                    <th className="p-3 text-left text-xs font-medium text-muted-foreground">Date</th>
                    {method === "Manual" && <th className="p-3 text-left text-xs font-medium text-muted-foreground">Assign To</th>}
                  </tr>
                </thead>
                <tbody>
                  {loadingPending ? (
                    <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading...</td></tr>
                  ) : pending.length === 0 ? (
                    <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No pending leads for Level {level}</td></tr>
                  ) : pending.map((l: any) => (
                    <tr key={l.Id} className="border-t border-border hover:bg-muted/20 transition-colors">
                      <td className="p-3"><input type="checkbox" checked={selectedLeads.includes(l.Id)} onChange={() => toggleLead(l.Id)} /></td>
                      <td className="p-3 font-medium text-foreground">{l.CustomerName}</td>
                      <td className="p-3 text-muted-foreground">{l.Mobile}</td>
                      <td className="p-3 text-muted-foreground">{l.PlatformName || "—"}</td>
                      <td className="p-3 text-muted-foreground">{l.CampaignName || "—"}</td>
                      <td className="p-3 text-muted-foreground">{l.DateGenerated ? String(l.DateGenerated).slice(0, 10) : "—"}</td>
                      {method === "Manual" && (
                        <td className="p-3">
                          <select value={assignments[l.Id] || ""} onChange={(e) => setAssignments((a) => ({ ...a, [l.Id]: parseInt(e.target.value) }))}
                            className="text-xs border border-border rounded px-2 py-1 bg-background">
                            <option value="">Select</option>
                            {eligibleUsers.map((u: any) => <option key={u.Id} value={u.Id}>{u.Name}</option>)}
                          </select>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "history" && (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground">Lead</th>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground">Customer</th>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground">From</th>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground">To</th>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground">Level</th>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground">Method</th>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground">Date</th>
                </tr>
              </thead>
              <tbody>
                {loadingHistory ? (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading...</td></tr>
                ) : history.length === 0 ? (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No distribution history yet</td></tr>
                ) : history.map((d: any) => (
                  <tr key={d.Id} className="border-t border-border hover:bg-muted/20 transition-colors">
                    <td className="p-3 text-xs text-muted-foreground font-mono">{d.LeadUid}</td>
                    <td className="p-3 font-medium text-foreground">{d.CustomerName}</td>
                    <td className="p-3 text-muted-foreground">{d.FromUserName || "—"}</td>
                    <td className="p-3 text-muted-foreground">{d.ToUserName || "—"}</td>
                    <td className="p-3 text-muted-foreground">L{d.Level}</td>
                    <td className="p-3 text-muted-foreground">{d.Method}</td>
                    <td className="p-3 text-muted-foreground">{d.DistributedAt ? String(d.DistributedAt).slice(0, 16).replace("T", " ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};

export default SaLeadDistribution;