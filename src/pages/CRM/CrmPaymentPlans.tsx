import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Trash2, Building2, Layers, Pencil, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/crm/payment-plans";
const COMPANY_API = "/api/business/dropdown";
const UNIT_API = "/api/unit-master";
const BLOCK_API = "/api/block-master";
const MILESTONE_MASTER_API = "/api/crm/milestone-master";

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchCompanies(): Promise<any[]> {
  try {
    const r = await fetchWithAuth(COMPANY_API);
    if (!r.ok) return [];
    const data = await r.json();
    return (data.companies || []).map((c: any) => ({ Id: c.id, Name: c.name }));
  } catch { return []; }
}
async function fetchProjects(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${UNIT_API}/projects`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBlocks(): Promise<any[]> {
  try { const r = await fetchWithAuth(BLOCK_API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchMilestoneMaster(): Promise<any[]> {
  try { const r = await fetchWithAuth(MILESTONE_MASTER_API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchPlanDetail(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  return r.ok ? r.json() : null;
}

const CrmPaymentPlans: React.FC = () => {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [planName, setPlanName] = useState("");
  const [description, setDescription] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [items, setItems] = useState([{ MilestoneMasterId: "", MilestoneName: "Booking", Percent: "" }]);
  const [saving, setSaving] = useState(false);
  // Opens locked whenever editing an existing plan — "New Plan" opens unlocked.
  const [locked, setLocked] = useState(false);
  const inputCls = `w-full text-sm border border-border rounded px-2 py-1.5 bg-background ${locked ? "opacity-70 cursor-not-allowed bg-muted/30" : ""}`;

  const { data: plans = [], isLoading } = useQuery({ queryKey: ["crm-payment-plans"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: companies = [] } = useQuery({ queryKey: ["crm-companies-dropdown"], queryFn: fetchCompanies, staleTime: 5 * 60_000 });
  const { data: projects = [] } = useQuery({ queryKey: ["unit-master-projects"], queryFn: fetchProjects, staleTime: 5 * 60_000 });
  const { data: blocks = [] } = useQuery({ queryKey: ["block-master"], queryFn: fetchBlocks, staleTime: 5 * 60_000 });
  const { data: milestoneMaster = [] } = useQuery({ queryKey: ["crm-milestone-master"], queryFn: fetchMilestoneMaster, staleTime: 5 * 60_000 });

  const projectsForCompany = useMemo(() => {
    if (!companyId) return projects as any[];
    return (projects as any[]).filter((p: any) => String(p.CompanyId) === companyId);
  }, [projects, companyId]);
  const blocksForProject = useMemo(() => {
    if (!projectId) return blocks as any[];
    return (blocks as any[]).filter((b: any) => String(b.ProjectId) === projectId);
  }, [blocks, projectId]);

  const totalPct = items.reduce((s, i) => s + (parseFloat(i.Percent) || 0), 0);

  const resetForm = () => {
    setEditingId(null);
    setPlanName(""); setDescription(""); setCompanyId(""); setProjectId(""); setBlockId("");
    setItems([{ MilestoneMasterId: "", MilestoneName: "Booking", Percent: "" }]);
    setLocked(false);
  };

  const openEdit = async (id: number) => {
    const detail = await fetchPlanDetail(id);
    if (!detail) { toast.error("Could not load plan"); return; }
    const { plan, items: planItems } = detail;
    setEditingId(id);
    setLocked(true);
    setPlanName(plan.PlanName);
    setDescription(plan.Description || "");
    setCompanyId(plan.CompanyId ? String(plan.CompanyId) : "");
    setProjectId(plan.ProjectId ? String(plan.ProjectId) : "");
    setBlockId(plan.BlockId ? String(plan.BlockId) : "");
    setItems(
      (planItems as any[]).length
        ? planItems.map((i: any) => ({
            MilestoneMasterId: i.MilestoneMasterId ? String(i.MilestoneMasterId) : "",
            MilestoneName: i.MilestoneName, Percent: String(i.Percent),
          }))
        : [{ MilestoneMasterId: "", MilestoneName: "Booking", Percent: "" }],
    );
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!planName.trim()) { toast.error("Plan name is required"); return; }
    if (Math.round(totalPct * 100) !== 10000) { toast.error(`Percentages must sum to 100 (currently ${totalPct})`); return; }
    setSaving(true);
    try {
      const isEdit = editingId != null;
      const res = await fetchWithAuth(isEdit ? `${API}/${editingId}` : API, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          PlanName: planName, Description: description, Items: items,
          CompanyId: companyId || null, ProjectId: projectId || null, BlockId: blockId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (isEdit && data.bookingsUsingPlan > 0) {
        toast.success(
          `Payment plan updated. Note: ${data.bookingsUsingPlan} existing booking(s) already generated their schedule from the old split and are unaffected — only new bookings use the updated split.`,
          { duration: 7000 },
        );
      } else {
        toast.success(isEdit ? "Payment plan updated" : "Payment plan created");
      }
      setDialogOpen(false);
      setLocked(true);
      resetForm();
      qc.invalidateQueries({ queryKey: ["crm-payment-plans"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SalesAutoShell
      title="CRM — Payment Plan Master"
      subtitle="Reusable milestone templates — scoped globally, or to a specific company/project/block"
      action={
        <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> New Plan
        </button>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading ? (
          <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
        ) : plans.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">No payment plans defined</div>
        ) : (plans as any[]).map((p: any) => (
          <div key={p.Id} className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium">{p.PlanName}</span>
              <div className="flex items-center gap-1.5">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${p.IsActive ? "text-green-600 bg-green-50 border-green-200" : "text-muted-foreground bg-muted/50 border-border"}`}>
                  {p.IsActive ? "Active" : "Inactive"}
                </span>
                <button onClick={() => openEdit(p.Id)} className="p-1 text-muted-foreground hover:text-primary" title="Edit plan">
                  <Pencil size={13} />
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-2">{p.Description || "—"}</p>
            <div className="flex items-center gap-1.5 text-xs mb-2">
              {!p.CompanyId && !p.ProjectId && !p.BlockId ? (
                <span className="px-1.5 py-0.5 rounded border border-violet-200 bg-violet-50 text-violet-600 flex items-center gap-1"><Layers size={10} /> Global default</span>
              ) : (
                <span className="px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-600 flex items-center gap-1">
                  <Building2 size={10} /> {[p.CompanyName, p.ProjectName, p.BlockName].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">{p.ItemCount} milestone(s) · {p.TotalPercent}% total</div>
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); resetForm(); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center justify-between gap-2 pr-6">
              <span>{editingId != null ? "Edit Payment Plan" : "New Payment Plan"}</span>
              {editingId != null && locked && (
                <button onClick={() => setLocked(false)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors shrink-0">
                  <Pencil size={12} /> Edit
                </button>
              )}
            </DialogTitle>
          </DialogHeader>
          {editingId != null && locked && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-1.5 -mt-1">
              <Lock size={11} /> Locked for viewing — click "Edit" above to make changes.
            </div>
          )}
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Plan Name *</label>
              <input type="text" value={planName} readOnly={locked} onChange={(e) => setPlanName(e.target.value)}
                className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Description</label>
              <input type="text" value={description} readOnly={locked} onChange={(e) => setDescription(e.target.value)}
                className={inputCls} />
            </div>

            <div className="rounded-lg border border-border p-3 space-y-2">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Building2 size={12} /> Scope (leave blank for a global default plan)</label>
              <div className="grid grid-cols-3 gap-2">
                <select value={companyId} disabled={locked} onChange={(e) => { setCompanyId(e.target.value); setProjectId(""); setBlockId(""); }}
                  className={inputCls}>
                  <option value="">Any company</option>
                  {(companies as any[]).map((c: any) => <option key={c.Id} value={String(c.Id)}>{c.Name}</option>)}
                </select>
                <select value={projectId} disabled={locked} onChange={(e) => { setProjectId(e.target.value); setBlockId(""); }}
                  className={inputCls}>
                  <option value="">Any project</option>
                  {(projectsForCompany as any[]).map((p: any) => <option key={p.Id} value={String(p.Id)}>{p.Name}</option>)}
                </select>
                <select value={blockId} disabled={locked} onChange={(e) => setBlockId(e.target.value)}
                  className={inputCls}>
                  <option value="">Any block</option>
                  {(blocksForProject as any[]).map((b: any) => <option key={b.Id} value={String(b.Id)}>{b.BlockName}</option>)}
                </select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted-foreground">Milestones (must total 100%)</label>
                <span className={`text-xs font-medium ${Math.round(totalPct * 100) === 10000 ? "text-green-600" : "text-red-600"}`}>{totalPct}%</span>
              </div>
              <div className="space-y-2">
                {items.map((it, idx) => (
                  <div key={idx} className="flex gap-2">
                    <select value={it.MilestoneMasterId} disabled={locked}
                      onChange={(e) => {
                        const master = (milestoneMaster as any[]).find((m: any) => String(m.Id) === e.target.value);
                        setItems((arr) => arr.map((x, i) => i === idx ? {
                          ...x,
                          MilestoneMasterId: e.target.value,
                          MilestoneName: master ? master.Name : x.MilestoneName,
                          Percent: master?.DefaultPercent != null && !x.Percent ? String(master.DefaultPercent) : x.Percent,
                        } : x));
                      }}
                      className={`flex-1 ${inputCls}`}>
                      <option value="">Custom (type below)</option>
                      {(milestoneMaster as any[]).filter((m: any) => m.IsActive).map((m: any) => (
                        <option key={m.Id} value={String(m.Id)}>{m.Name}</option>
                      ))}
                    </select>
                    <input type="text" placeholder="Milestone name" value={it.MilestoneName} readOnly={locked}
                      onChange={(e) => setItems((arr) => arr.map((x, i) => i === idx ? { ...x, MilestoneName: e.target.value, MilestoneMasterId: "" } : x))}
                      className={`flex-1 ${inputCls}`} />
                    <input type="number" placeholder="%" value={it.Percent} readOnly={locked}
                      onChange={(e) => setItems((arr) => arr.map((x, i) => i === idx ? { ...x, Percent: e.target.value } : x))}
                      className={`w-20 ${inputCls}`} />
                    <button onClick={() => setItems((arr) => arr.filter((_, i) => i !== idx))} disabled={locked}
                      className="p-1.5 text-muted-foreground hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
              <button onClick={() => setItems((arr) => [...arr, { MilestoneMasterId: "", MilestoneName: "", Percent: "" }])} disabled={locked}
                className="text-xs text-primary hover:underline mt-2 disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">+ Add milestone</button>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            {editingId != null && locked ? (
              <button onClick={() => { setDialogOpen(false); resetForm(); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
            ) : (
              <>
                <button onClick={() => { setDialogOpen(false); resetForm(); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
                <button onClick={handleSave} disabled={saving}
                  className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                  {saving ? "Saving..." : editingId != null ? "Save Changes" : "Create"}
                </button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmPaymentPlans;
