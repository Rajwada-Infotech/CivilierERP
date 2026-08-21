import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, HardHat } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const API = "/api/crm/construction-updates";
const UNIT_API = "/api/unit-master";
const STAGES = ["Foundation", "Superstructure", "Finishing", "Handover-Ready"];

const EMPTY_FORM = { ProjectId: "", UpdateDate: "", PercentComplete: "", Stage: "Foundation", Summary: "" };

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchProjects(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${UNIT_API}/projects`); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmConstructionUpdates: React.FC = () => {
  const qc = useQueryClient();
  usePageRights("crm-construction-updates");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const { data: updates = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["crm-construction-updates"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: projects = [] } = useQuery({ queryKey: ["unit-master-projects"], queryFn: fetchProjects, staleTime: 5 * 60_000 });

  const handleCreate = async () => {
    if (!form.ProjectId) { toast.error("Project is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ProjectId: parseInt(form.ProjectId), PercentComplete: form.PercentComplete || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Construction update logged");
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["crm-construction-updates"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Construction Updates"]} />
      <CrmShell
        title="CRM — Construction Updates"
      subtitle="Progress logs shared with buyers"
      action={
          <div className="flex items-center gap-3">
          <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
          <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> Log Update
        </button>
        </div>
      }
    >
      <div className="space-y-3">
        {isLoading ? (
          <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
        ) : updates.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">No construction updates logged</div>
        ) : (updates as any[]).map((u: any) => (
          <div key={u.Id} className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <HardHat size={16} className="text-muted-foreground" />
                <span className="font-medium">{u.ProjectName}</span>
                <span className="text-xs text-muted-foreground">· {u.Stage}</span>
              </div>
              <span className="text-xs text-muted-foreground">{String(u.UpdateDate).slice(0,10)}</span>
            </div>
            {u.PercentComplete != null && (
              <div className="w-full bg-muted rounded-full h-2 mb-2">
                <div className="bg-primary h-2 rounded-full" style={{ width: `${Math.min(100, u.PercentComplete)}%` }} />
              </div>
            )}
            {u.Summary && <p className="text-sm text-muted-foreground">{u.Summary}</p>}
            <div className="text-xs text-muted-foreground mt-1">By {u.CreatedByName || "—"}</div>
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">Log Construction Update</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Project *</label>
              <select value={form.ProjectId} onChange={(e) => setForm((f) => ({ ...f, ProjectId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select project</option>
                {(projects as any[]).map((p: any) => (
                  <option key={p.Id} value={String(p.Id)}>{p.Name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Stage</label>
                <select value={form.Stage} onChange={(e) => setForm((f) => ({ ...f, Stage: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  {STAGES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">% Complete</label>
                <input type="number" min={0} max={100} value={form.PercentComplete} onChange={(e) => setForm((f) => ({ ...f, PercentComplete: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Summary</label>
              <textarea value={form.Summary} onChange={(e) => setForm((f) => ({ ...f, Summary: e.target.value }))}
                rows={3} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Logging..." : "Log Update"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      </CrmShell>
    </>
  );
};

export default CrmConstructionUpdates;
