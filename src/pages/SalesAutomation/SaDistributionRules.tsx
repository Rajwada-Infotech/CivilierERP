import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Trash2, ChevronDown, ChevronRight, Play, ToggleLeft, ToggleRight, Shuffle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { Link } from "react-router-dom";

const API = "/api/sa/distribution-rules";

async function fetchRules(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error("Failed to fetch rules");
  return r.json().catch(() => ({}));
}
async function fetchUserOptions(): Promise<{ value: string; label: string; role: string }[]> {
  const r = await fetchWithAuth("/api/sa/leads/users");
  if (!r.ok) return [];
  const data: any[] = await r.json().catch(() => ({}));
  return data.map((u) => ({ value: String(u.Id), label: `${u.Name} (${u.role.replace(/_/g, " ")})`, role: u.role }));
}
async function fetchCampaignOptions(): Promise<{ value: string; label: string }[]> {
  const r = await fetchWithAuth("/api/sa/campaigns/dropdown");
  if (!r.ok) return [];
  const data: any[] = await r.json().catch(() => ({}));
  return data.map((c) => ({ value: String(c.Id), label: `${c.CampaignCode} - ${c.Name}` }));
}

// Codes are what the backend stores; label/hint are what staff read.
const METHODS: Record<string, { label: string; hint: string; cls: string }> = {
  RoundRobin: { label: "Take turns", hint: "Each new lead goes to the next member in order.", cls: "bg-blue-500/10 text-blue-600" },
  Weighted: { label: "Weighted", hint: "Members get leads in proportion to their weight (2 gets twice as many as 1).", cls: "bg-purple-500/10 text-purple-600" },
  Manual: { label: "Manual", hint: "Nothing is assigned automatically — leads wait on the Distribution page.", cls: "bg-muted text-muted-foreground" },
};
const SCOPE_TYPES: Record<string, string> = { Global: "All leads", Campaign: "Leads from one campaign", TeamLead: "One team lead's leads" };
const LEVELS = [
  { value: 1, label: "Level 1 — New leads to team leads", hint: "Who receives each new lead first." },
  { value: 2, label: "Level 2 — Team lead to salesperson", hint: "How a team lead's leads are passed to their salespeople." },
];
const TEAM_LEAD_ROLE = "sales_team_lead";
// Which scopes the engine actually reads at each level
// (backend/services/saDistributionEngine.js findApplicableRule): level 1
// tries the lead's campaign rule, then the all-leads rule; level 2 only
// ever uses the team lead's own rule.
const SCOPES_BY_LEVEL: Record<number, string[]> = { 1: ["Global", "Campaign"], 2: ["TeamLead"] };
const scopeKey = (r: any) => `${r.Level}|${r.ScopeType}|${r.ScopeId ?? ""}`;

const methodBadge = (m: string) =>
  <span title={METHODS[m]?.hint} className={`px-2 py-0.5 rounded-full text-[0.625rem] font-semibold ${METHODS[m]?.cls ?? "bg-muted text-muted-foreground"}`}>{METHODS[m]?.label ?? m}</span>;

const EMPTY_FORM = { Level: 1, ScopeType: "Global", ScopeId: "", Method: "RoundRobin" };

const SaDistributionRules: React.FC = () => {
  usePageRights("sa-distribution-rules");
  const { canDoAction } = useAuth();
  const canManage = canDoAction("sa-distribution-rules", "create");
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [members, setMembers] = useState<{ UserId: string; Weight: string }[]>([{ UserId: "", Weight: "1" }]);
  const [saving, setSaving] = useState(false);
  const [runningLevel, setRunningLevel] = useState<number | null>(null);

  const { data: rules = [], isLoading, error, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["sa-distribution-rules"], queryFn: fetchRules, staleTime: 30_000 });
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

  const activeByScope = (rules as any[]).filter((r: any) => r.IsActive)
    .reduce((m: Record<string, number>, r: any) => ({ ...m, [scopeKey(r)]: (m[scopeKey(r)] ?? 0) + 1 }), {});
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

  const RuleGroup = ({ title, hint, groupRules, level }: { title: string; hint: string; groupRules: any[]; level: number }) => (
    <section className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">{hint} {groupRules.filter((r) => r.IsActive).length} of {groupRules.length} rule{groupRules.length === 1 ? "" : "s"} on.</p>
        </div>
        {canManage && (
          <button
            onClick={() => handleRunNow(level)}
            disabled={runningLevel === level}
            title="Assign every waiting lead at this level now, using the rules that are on"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border border-emerald-500/30 disabled:opacity-40 transition-colors"
          >
            <Play size={11} /> {runningLevel === level ? "Assigning…" : "Assign waiting leads now"}
          </button>
        )}
      </div>
      {groupRules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No rules at this level yet — leads wait on the Distribution page until someone assigns them.
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
                    {rule.ScopeType === "Global" ? "All leads"
                      : rule.ScopeType === "Campaign" ? `Campaign: ${rule.ScopeCampaignName || rule.ScopeId}`
                      : `Team lead: ${rule.ScopeTeamLeadName || rule.ScopeId}`}
                  </span>
                  {methodBadge(rule.Method)}
                </div>
                {!SCOPES_BY_LEVEL[level].includes(rule.ScopeType) && (
                  <p className="text-xs text-amber-600 mt-0.5">Never used — at this level only {SCOPES_BY_LEVEL[level].map((s) => SCOPE_TYPES[s].toLowerCase()).join(" or ")} rules apply.</p>
                )}
                {rule.IsActive && activeByScope[scopeKey(rule)] > 1 && (
                  <p className="text-xs text-amber-600 mt-0.5">Another rule for the same leads is also on — only one of them is used. Turn one off.</p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {rule.members.length
                    ? rule.members.slice(0, 4).map((m: any) => m.UserName).join(", ") + (rule.members.length > 4 ? ` +${rule.members.length - 4} more` : "")
                    : "No members"}
                </p>
              </div>
            </div>
            {canManage ? (
              <button onClick={(e) => { e.stopPropagation(); handleToggleActive(rule); }}
                className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${rule.IsActive ? "text-emerald-600 hover:bg-emerald-50" : "text-muted-foreground hover:bg-muted"}`}
                title={rule.IsActive ? "Turn this rule off" : "Turn this rule on"}>
                {rule.IsActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />} {rule.IsActive ? "On" : "Off"}
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">{rule.IsActive ? "On" : "Off"}</span>
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
    </section>
  );

  if (isLoading || error) return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Setup", "Distribution Rules"]} title="Distribution Rules">
      <div className={`p-6 text-sm ${error ? "text-red-500" : "text-muted-foreground"}`}>
        {error ? "Couldn't load distribution rules. Refresh the page to try again." : "Loading distribution rules…"}
      </div>
    </SalesAutoShell>
  );

  return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Setup", "Distribution Rules"]} title="Distribution Rules" subtitle="Who gets each new lead automatically. Level 1 uses the lead's campaign rule if there is one, otherwise the all-leads rule; level 2 uses each team lead's own rule."
      action={
        <div className="flex items-center gap-2">
          <Link to="/sales-automation/distribution"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-accent transition-colors">
            <Shuffle size={13} /> Manually distribute pending leads
          </Link>
          <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
        </div>
      }>
      <div className="space-y-6">
        {canManage && (
          <button
            onClick={() => { setAddOpen(true); setForm({ ...EMPTY_FORM }); setMembers([{ UserId: "", Weight: "1" }]); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold btn-module text-white transition-colors"
          >
            <Plus size={13} /> Add rule
          </button>
        )}

        <RuleGroup title={LEVELS[0].label} hint={LEVELS[0].hint} groupRules={level1Rules} level={1} />
        <RuleGroup title={LEVELS[1].label} hint={LEVELS[1].hint} groupRules={level2Rules} level={2} />
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
                <select value={form.Level} onChange={(e) => { const Level = parseInt(e.target.value); setForm((f) => ({ ...f, Level, ScopeType: SCOPES_BY_LEVEL[Level][0], ScopeId: "" })); }}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background">
                  {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">How to share <span className="text-destructive">*</span></label>
                <select value={form.Method} onChange={(e) => setForm((f) => ({ ...f, Method: e.target.value }))}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background">
                  {Object.entries(METHODS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Applies to</label>
                <select value={form.ScopeType} onChange={(e) => setForm((f) => ({ ...f, ScopeType: e.target.value, ScopeId: "" }))}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background">
                  {SCOPES_BY_LEVEL[form.Level].map((k) => <option key={k} value={k}>{SCOPE_TYPES[k]}</option>)}
                </select>
              </div>
              <p className="col-span-2 -mt-1 text-[0.6875rem] text-muted-foreground">{METHODS[form.Method]?.hint}</p>
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
                  <SearchableNativeSelect value={form.ScopeId} onChange={(e) => setForm((f) => ({ ...f, ScopeId: e.target.value }))}
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background">
                    <option value="">Select team lead...</option>
                    {userOptions.filter((u) => u.role === TEAM_LEAD_ROLE).map((u: any) => <option key={u.value} value={u.value}>{u.label}</option>)}
                  </SearchableNativeSelect>
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
                    <SearchableNativeSelect value={m.UserId} onChange={(e) => handleMemberChange(i, "UserId", e.target.value)}
                      className="flex-1 text-sm border border-border rounded-lg px-2 py-1.5 bg-background">
                      <option value="">Select user...</option>
                      {(userOptions as any[]).map((u: any) => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </SearchableNativeSelect>
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
              <p className="text-[0.625rem] text-muted-foreground mt-1.5">
                {form.Method === "Weighted" ? "The number beside each member is their weight." : "Members take turns in this order."}
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-1 border-t border-border">
              <button onClick={() => setAddOpen(false)} className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold btn-module text-white disabled:opacity-40 transition-colors">
                {saving ? "Saving…" : "Create rule"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default SaDistributionRules;
