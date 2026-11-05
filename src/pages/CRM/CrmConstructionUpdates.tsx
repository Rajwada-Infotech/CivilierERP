import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { HardHat, Plus, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT, TEXTAREA } from "./customers/config";
import { localDay } from "./salesDeed/config";

const API = "/api/crm/construction-updates";
const UNIT_API = "/api/unit-master";
const STAGES = ["Foundation", "Superstructure", "Finishing", "Handover-Ready"];

const emptyForm = () => ({ ProjectId: "", UpdateDate: localDay(), PercentComplete: "", Stage: "Foundation", Summary: "" });

async function fetchAll(): Promise<any[]> {
  // A failed load used to read as "No construction updates logged".
  const r = await fetchWithAuth(API);
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error || `Could not load the updates (${r.status}).`);
  return Array.isArray(data) ? data : [];
}
async function fetchProjects(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${UNIT_API}/projects`); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmConstructionUpdates: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("crm-construction-updates");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");

  const { data: updates = [], isLoading, isError, error, isFetching, refetch } = useQuery({ queryKey: ["crm-construction-updates"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: projects = [] } = useQuery({ queryKey: ["unit-master-projects"], queryFn: fetchProjects, staleTime: 5 * 60_000 });

  // The latest update per project: where each one stands.
  const latest = useMemo(() => {
    const m = new Map<number, any>();
    for (const u of updates as any[]) if (!m.has(u.ProjectId)) m.set(u.ProjectId, u);
    return [...m.values()];
  }, [updates]);
  const shown = useMemo(() => (projectFilter ? (updates as any[]).filter((u) => String(u.ProjectId) === projectFilter) : (updates as any[])), [updates, projectFilter]);

  const handleCreate = async () => {
    if (!form.ProjectId) { toast.error("Project is required"); return; }
    const pct = form.PercentComplete === "" ? null : Number(form.PercentComplete);
    if (pct != null && !(pct >= 0 && pct <= 100)) { toast.error("% complete must be between 0 and 100"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ProjectId: parseInt(form.ProjectId), PercentComplete: pct }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success("Construction update logged");
      setDialogOpen(false);
      setForm(emptyForm());
      qc.invalidateQueries({ queryKey: ["crm-construction-updates"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const figures = [
    { label: "Updates", value: updates.length, note: "Shared with buyers" },
    { label: "Projects reported", value: latest.length, note: "With at least one update" },
    { label: "Finishing", value: latest.filter((u) => u.Stage === "Finishing").length, note: "Latest stage" },
    { label: "Handover-ready", value: latest.filter((u) => u.Stage === "Handover-Ready").length, note: "Latest stage" },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Construction Updates"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · After-sales"
        title="Construction Updates"
        subtitle="Progress logs for each project, from foundation to handover-ready, shared with its buyers."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {/* The server logs under the create right; the button was offered to everyone. */}
            {rights.canCreate && <button onClick={() => setDialogOpen(true)} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> Log update</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <span className="label">{x.label}</span>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 flex items-center gap-3 flex-wrap" style={{ borderBottom: RULE }}>
              <span className={LBL}>Project</span>
              <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className={`${INP} max-w-xs text-xs`}>
                <option value="">All projects ({updates.length})</option>
                {latest.map((u) => <option key={u.ProjectId} value={String(u.ProjectId)}>{u.ProjectName}</option>)}
              </select>
            </div>
            {isError ? (
              <p className="p-6 text-center text-sm text-destructive">{(error as Error)?.message}</p>
            ) : isLoading ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : shown.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">No construction updates logged yet.</p>
            ) : shown.map((u: any) => {
              const pct = u.PercentComplete != null ? Math.min(100, Math.max(0, Number(u.PercentComplete))) : null;
              const stageIdx = STAGES.indexOf(u.Stage);
              return (
                <div key={u.Id} className="px-5 py-4" style={{ borderBottom: RULE_SOFT }}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <HardHat size={15} className="shrink-0" />
                      <span className="font-semibold">{u.ProjectName}</span>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">{String(u.UpdateDate).slice(0, 10)}</span>
                  </div>
                  {/* The four stages, the reached ones inked */}
                  <div className="mt-3 flex items-center gap-1 flex-wrap">
                    {STAGES.map((s, i) => (
                      <span key={s} className={`font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border ${
                        i < stageIdx ? "border-foreground/50" : i === stageIdx ? "bg-foreground text-card border-foreground" : "border-foreground/15 text-muted-foreground/60"}`}>{s}</span>
                    ))}
                  </div>
                  {pct != null && (
                    <div className="mt-3 flex items-center gap-3">
                      <div className="h-2 flex-1" style={{ border: RULE_SOFT }}><div className="h-full bg-foreground" style={{ width: `${pct}%` }} /></div>
                      <span className="font-heading text-sm font-semibold tabular-nums w-12 text-right">{pct}%</span>
                    </div>
                  )}
                  {u.Summary && <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{u.Summary}</p>}
                  <div className="text-xs text-muted-foreground mt-2">By {u.CreatedByName || "—"}</div>
                </div>
              );
            })}
          </div>
        </div>

        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm(emptyForm()); } }}>
          <DialogContent className="max-w-md rounded-none p-5 gap-4" style={{ border: RULE }}>
            <DialogHeader><DialogTitle className="font-heading">Log construction update</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Project *</label>
                <select value={form.ProjectId} onChange={(e) => setForm((f) => ({ ...f, ProjectId: e.target.value }))} className={INP}>
                  <option value="">Select project</option>
                  {(projects as any[]).map((p: any) => <option key={p.Id} value={String(p.Id)}>{p.Name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className={`block ${LBL}`}>Date</label>
                  <DateInput value={form.UpdateDate} max={localDay()} onChange={(e) => setForm((f) => ({ ...f, UpdateDate: e.target.value }))} className={INP} />
                </div>
                <div className="space-y-1">
                  <label className={`block ${LBL}`}>Stage</label>
                  <select value={form.Stage} onChange={(e) => setForm((f) => ({ ...f, Stage: e.target.value }))} className={INP}>
                    {STAGES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={`block ${LBL}`}>% complete</label>
                  <input type="number" min={0} max={100} value={form.PercentComplete} onChange={(e) => setForm((f) => ({ ...f, PercentComplete: e.target.value }))} className={`${INP} tabular-nums`} />
                </div>
              </div>
              <div className="space-y-1">
                <label className={`block ${LBL}`}>Summary</label>
                <textarea value={form.Summary} onChange={(e) => setForm((f) => ({ ...f, Summary: e.target.value }))} rows={3} className={TEXTAREA} />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <button onClick={() => { setDialogOpen(false); setForm(emptyForm()); }} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleCreate} disabled={saving} className={`${KEY_INK} h-9 px-4`}>{saving ? "Logging…" : "Log update"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetShell>
    </>
  );
};

export default CrmConstructionUpdates;
