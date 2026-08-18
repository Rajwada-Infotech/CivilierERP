import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Trash2, ChevronDown, ChevronRight, Play, ToggleLeft, ToggleRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/sa/distribution-rules";

async function fetchRules(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error("Failed to fetch rules");
  return r.json().catch(() => ({}));
}
async function fetchUserOptions(): Promise<{ value: string; label: string }[]> {
  const r = await fetchWithAuth("/api/sa/leads/users");
  if (!r.ok) return [];
  const data: any[] = await r.json().catch(() => ({}));
  return data.map((u) => ({ value: String(u.Id), label: `${u.Name} (${u.role.replace(/_/g, " ")})` }));
}
async function fetchCampaignOptions(): Promise<{ value: string; label: string }[]> {
  const r = await fetchWithAuth("/api/sa/campaigns/dropdown");
  if (!r.ok) return [];
  const data: any[] = await r.json().catch(() => ({}));
  return data.map((c) => ({ value: String(c.Id), label: `${c.CampaignCode} - ${c.Name}` }));
}

const METHODS = ["RoundRobin", "Weighted", "Manual"];
const SCOPE_TYPES = ["Global", "Campaign", "TeamLead"];
const LEVELS = [
  { value: 1, label: "Level 1 — Admin → Team Lead" },
  { value: 2, label: "Level 2 — Team Lead → Salesperson" },
];

const methodBadge = (m: string) => {
  const colors: Record<string, string> = {
    RoundRobin: "bg-blue-500/10 text-blue-600",
    Weighted: "bg-purple-500/10 text-purple-600",
    Manual: "bg-muted text-muted-foreground",
  };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${colors[m] ?? "bg-muted text-muted-foreground"}`}>{m}</span>;
};

const EMPTY_FORM = { Level: 1, ScopeType: "Global", ScopeId: "", Method: "RoundRobin" };

const SaDistributionRules: React.FC = () => {
  const { canDoAction } = useAuth();
  const canManage = canDoAction("sa-distribution-rules", "create");
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [members, setMembers] = useState<{ UserId: string; Weight: string }[]>([{ UserId: "", Weight: "1" }]);
  const [saving, setSaving] = useState(false);
  const [runningLevel, setRunningLevel] = useState<number | null>(null);

  const { data: rules = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["sa-distribution-rules"], queryFn: fetchRules, staleTime: 30_000 });
  const { data: userOptions = [] } = useQuery({ queryKey: ["sa-user-options"], queryFn: fetchUserOptions, staleTime: 5 * 60_000 });
  const { data: campaignOptions = [] } = useQuery({ queryKey: ["sa-campaign-options"], queryFn: fetchCampaignOptions, staleTime: 5 * 60_000 });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["sa-distribution-rules"] });

  const toggle = (id: number) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleToggleActive = async (rule: any) => {
    try {
      const r = await fetchWithAuth(`${API}/${rule.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Method: rule.Method, IsActive: !rule.IsActive }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      toast.success(rule.IsActive ? "Rule deactivated" : "Rule activated");
      await invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Deactivate this rule?")) return;
    try {
      const r = await fetchWithAuth(`${API}/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).error);
      toast.success("Rule deactivated");
      await invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleRunNow = async (level: number) => {
    setRunningLevel(level);
    try {
      const r = await fetchWithAuth(`${API}/run-now/${level}`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      toast.success(data.message);
      await qc.invalidateQueries({ queryKey: ["sa-leads"] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRunningLevel(null); }
  };

  const handleAddMember = () => setMembers((m) => [...m, { UserId: "", Weight: "1" }]);
  const handleRemoveMember = (i: number) => setMembers((m) => m.filter((_, idx) => idx !== i));
  const handleMemberChange = (i: number, field: "UserId" | "Weight", val: string) =>
    setMembers((m) => m.map((item, idx) => idx === i ? { ...item, [field]: val } : item));

  const handleSave = async () => {
    if (!form.Method) return toast.error("Select a method");
    const validMembers = members.filter((m) => m.UserId);
    if (!validMembers.length) return toast.error("Add at least one member");
    setSaving(true);
    try {
      const r = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Level: form.Level,
          ScopeType: form.ScopeType,
          ScopeId: form.ScopeType !== "Global" && form.ScopeId ? parseInt(form.ScopeId) : null,
          Method: form.Method,
          members: validMembers.map((m) => ({ UserId: parseInt(m.UserId), Weight: parseFloat(m.Weight) || 1 })),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      toast.success("Distribution rule created");
      setAddOpen(false);
      setForm({ ...EMPTY_FORM });
      setMembers([{ UserId: "", Weight: "1" }]);
      await invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const level1Rules = (rules as any[]).filter((r: any) => r.Level === 1);
  const level2Rules = (rules as any[]).filter((r: any) => r.Level === 2);

  const memberColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "UserName", header: "Member", size: 150,
      cell: (i) => <span className="text-foreground font-medium">{i.getValue() as string}</span> },
    { accessorKey: "Weight", header: "Weight", size: 100,
      cell: (i) => <span className="text-muted-foreground">{i.row.original.Weight}</span> },
    { id: "order", header: "Order", size: 100, enableSorting: false,
      cell: (i) => <span className="text-muted-foreground">{i.row.index + 1}</span> },
  ];

  const RuleGroup = ({ title, groupRules, level }: { title: string; groupRules: any[]; level: number }) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <button
          onClick={() => handleRunNow(level)}
          disabled={runningLevel === level}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border border-emerald-500/30 disabled:opacity-40 transition-colors"
        >
          <Play size={11} /> {runningLevel === level ? "Running..." : "Run Auto-Distribute Now"}
        </button>
      </div>
      {groupRules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No rules configured for this level
        </div>
      ) : groupRules.map((rule: any) => (
        <div key={rule.Id} className={`rounded-lg border overflow-hidden ${rule.IsActive ? "border-border" : "border-border/50 opacity-60"}`}>
          <div
            className="flex items-center justify-between px-4 py-3 bg-muted/20 cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => toggle(rule.Id)}
          >
            <div className="flex items-center gap-3">
              {expanded.has(rule.Id) ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {rule.ScopeType === "Global" ? "Global"
                      : rule.ScopeType === "Campaign" ? `Campaign: ${rule.ScopeCampaignName || rule.ScopeId}`
                      : `Team Lead: ${rule.ScopeTeamLeadName || rule.ScopeId}`}
                  </span>
                  {methodBadge(rule.Method)}
                  {!rule.IsActive && <span className="text-[10px] text-muted-foreground italic">inactive</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{rule.members.length} member{rule.members.length !== 1 ? "s" : ""}</p>
              </div>
            </div>
            {canManage && (
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => handleToggleActive(rule)} className="text-muted-foreground hover:text-foreground transition-colors" title={rule.IsActive ? "Deactivate" : "Activate"}>
                  {rule.IsActive ? <ToggleRight size={18} className="text-emerald-500" /> : <ToggleLeft size={18} />}
                </button>
                <button onClick={() => handleDelete(rule.Id)} className="p-1 text-muted-foreground hover:text-red-500 transition-colors" title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
          {expanded.has(rule.Id) && (
            <div className="px-4 py-3 border-t border-border">
              {rule.members.length === 0 ? (
                <p className="text-xs text-muted-foreground">No members</p>
              ) : (
                <DataTable
                  data={rule.members}
                  columns={memberColumns}
                  searchable={false}
                  paginated={false}
                  emptyMessage="No members"
                />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading distribution rules...</div>;

  return (
    <SalesAutoShell title="Distribution Rules" subtitle="Configure how leads are automatically assigned to team leads and salespersons"
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          {canManage && (
            <button
              onClick={() => { setAddOpen(true); setForm({ ...EMPTY_FORM }); setMembers([{ UserId: "", Weight: "1" }]); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus size={13} /> Add Rule
            </button>
          )}
        </div>

        <RuleGroup title="Level 1 — Admin → Team Lead" groupRules={level1Rules} level={1} />
        <RuleGroup title="Level 2 — Team Lead → Salesperson" groupRules={level2Rules} level={2} />
      </div>

      {/* Add Rule Dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) setAddOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading text-base">Add Distribution Rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Level <span className="text-destructive">*</span></label>
                <select value={form.Level} onChange={(e) => setForm((f) => ({ ...f, Level: parseInt(e.target.value) }))}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background">
                  {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Method <span className="text-destructive">*</span></label>
                <select value={form.Method} onChange={(e) => setForm((f) => ({ ...f, Method: e.target.value }))}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background">
                  {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Scope Type</label>
                <select value={form.ScopeType} onChange={(e) => setForm((f) => ({ ...f, ScopeType: e.target.value, ScopeId: "" }))}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background">
                  {SCOPE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {form.ScopeType === "Campaign" && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">Campaign</label>
                  <select value={form.ScopeId} onChange={(e) => setForm((f) => ({ ...f, ScopeId: e.target.value }))}
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background">
                    <option value="">Select campaign...</option>
                    {(campaignOptions as any[]).map((c: any) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              )}
              {form.ScopeType === "TeamLead" && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">Team Lead</label>
                  <select value={form.ScopeId} onChange={(e) => setForm((f) => ({ ...f, ScopeId: e.target.value }))}
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background">
                    <option value="">Select team lead...</option>
                    {(userOptions as any[]).filter((u: any) => u.label.includes("team lead")).map((u: any) => <option key={u.value} value={u.value}>{u.label}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Members */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground">Members <span className="text-destructive">*</span></label>
                <button onClick={handleAddMember} className="text-xs text-primary hover:underline flex items-center gap-1">
                  <Plus size={11} /> Add member
                </button>
              </div>
              <div className="space-y-2">
                {members.map((m, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <select value={m.UserId} onChange={(e) => handleMemberChange(i, "UserId", e.target.value)}
                      className="flex-1 text-sm border border-border rounded-lg px-2 py-1.5 bg-background">
                      <option value="">Select user...</option>
                      {(userOptions as any[]).map((u: any) => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                    <input type="number" value={m.Weight} onChange={(e) => handleMemberChange(i, "Weight", e.target.value)}
                      className="w-16 text-sm border border-border rounded-lg px-2 py-1.5 bg-background text-center" placeholder="Wt" min="0.1" step="0.1" title="Weight" />
                    {members.length > 1 && (
                      <button onClick={() => handleRemoveMember(i)} className="p-1 text-muted-foreground hover:text-red-500 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {form.Method === "Weighted" && (
                <p className="text-[10px] text-muted-foreground mt-1.5">Weight determines relative share of leads (e.g. 2 gets twice as many as 1)</p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1 border-t border-border">
              <button onClick={() => setAddOpen(false)} className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">
                {saving ? "Saving..." : "Create Rule"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default SaDistributionRules;
