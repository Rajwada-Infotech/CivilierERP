import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Home, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { LayoutType } from "@/api/unitBhkConfigApi";

export const VILLA_TYPE_API = "/api/villa-type-master";

// A villa design a plotted layout offers (dbo.VillaTypeMaster, per project).
export type VillaType = {
  Id: number; ProjectId: number; Code: string; Name: string;
  LayoutTypeId?: number | null; LayoutLabel?: string | null;
  BaseLandAreaSqFt?: number | null; BuiltUpAreaSqFt: number; SuperBuiltUpAreaSqFt?: number | null;
  SortOrder?: number; IsActive?: boolean; PlotCount?: number; VillaCount?: number;
};

export async function fetchVillaTypes(projectId: number | string, all = false): Promise<VillaType[]> {
  const response = await fetchWithAuth(`${VILLA_TYPE_API}?projectId=${projectId}${all ? "&all=1" : ""}`);
  if (!response.ok) throw new Error("Could not load villa types");
  return response.json();
}

export const villaTypesKey = (projectId: number | string | null | undefined) => ["villa-types", String(projectId ?? "")];

const fieldCls = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm";
const sqft = (v?: number | null) => (v == null ? "—" : Number(v).toLocaleString("en-IN"));

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: { ProjectId: number; ProjectName: string }[];
  initialProjectId?: number | null;
  layoutTypes: LayoutType[];
  /** Ticked, unconverted plots of one project: offered for "plan this type". */
  selectedPlotIds: number[];
  selectedProjectId?: number | null;
  onPlotsChanged: () => void;
};

// Villa types are managed in place from Plot Master, as facings are: they have
// no meaning outside a plotted layout.
export function VillaTypesDialog({ open, onOpenChange, projects, initialProjectId, layoutTypes, selectedPlotIds, selectedProjectId, onPlotsChanged }: Props) {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState<string>("");
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [assignTo, setAssignTo] = useState("");

  useEffect(() => {
    if (!open) return;
    const start = selectedProjectId ?? initialProjectId ?? (projects.length === 1 ? projects[0].ProjectId : null);
    setProjectId(start != null ? String(start) : "");
    setDraft({}); setAssignTo("");
  }, [open, selectedProjectId, initialProjectId, projects]);

  const { data: types = [] } = useQuery({
    queryKey: [...villaTypesKey(projectId), "all"], queryFn: () => fetchVillaTypes(projectId, true), enabled: open && !!projectId,
  });
  const activeTypes = types.filter((t) => t.IsActive !== false);
  const canAssign = selectedPlotIds.length > 0 && selectedProjectId != null && String(selectedProjectId) === projectId;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["villa-types"] });

  const save = async () => {
    if (!projectId) { toast.error("Choose a project"); return; }
    if (!String(draft.Code || "").trim() || !String(draft.Name || "").trim()) { toast.error("Code and name are both required"); return; }
    if (!(Number(draft.BuiltUpAreaSqFt) > 0)) { toast.error("Built-up area is required"); return; }
    setSaving(true);
    try {
      const editing = draft.Id != null;
      const response = await fetchWithAuth(editing ? `${VILLA_TYPE_API}/${draft.Id}` : VILLA_TYPE_API, {
        method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, ProjectId: Number(projectId) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not save the villa type");
      toast.success(editing ? "Villa type updated" : "Villa type added");
      setDraft({}); refresh();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const remove = async (type: VillaType) => {
    if (!window.confirm(`Remove villa type ${type.Code}?`)) return;
    try {
      const response = await fetchWithAuth(`${VILLA_TYPE_API}/${type.Id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not remove the villa type");
      toast.success("Villa type removed"); refresh();
    } catch (e: any) { toast.error(e.message); }
  };

  const assign = async () => {
    try {
      const response = await fetchWithAuth("/api/plot-master/planned-villa-type", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ PlotIds: selectedPlotIds, VillaTypeId: assignTo ? Number(assignTo) : null }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not set the villa type");
      toast.success(assignTo ? `Villa type planned on ${body.updated} plot(s)` : `Villa type cleared on ${body.updated} plot(s)`);
      refresh(); onPlotsChanged();
    } catch (e: any) { toast.error(e.message); }
  };

  const setField = (key: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [key]: event.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent accent="crm" className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Home size={17} className="text-primary" /> Villa types</DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">The villa designs this layout offers. Converting plots to a villa takes its areas from the type planned on them.</p>
        </DialogHeader>
        <div className="max-w-xs">
          <label className="mb-1 block text-xs text-muted-foreground">Project</label>
          <select value={projectId} onChange={(event) => { setProjectId(event.target.value); setDraft({}); }} className={fieldCls}>
            <option value="">Choose a project</option>
            {projects.map((p) => <option key={p.ProjectId} value={p.ProjectId}>{p.ProjectName}</option>)}
          </select>
        </div>
        {projectId && (
          <>
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Code</th>
                    <th className="px-3 py-2 text-left font-medium">Name</th>
                    <th className="px-3 py-2 text-left font-medium">Layout</th>
                    <th className="px-3 py-2 text-right font-medium">Base land</th>
                    <th className="px-3 py-2 text-right font-medium">Built-up</th>
                    <th className="px-3 py-2 text-right font-medium">Super built-up</th>
                    <th className="px-3 py-2 text-right font-medium">Plots</th>
                    <th className="px-3 py-2 text-right font-medium">Villas</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {types.map((t) => (
                    <tr key={t.Id} className={`border-t border-border ${t.IsActive === false ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2 font-mono text-xs">{t.Code}</td>
                      <td className="px-3 py-2">{t.Name}{t.IsActive === false && <span className="ml-2 text-[0.6875rem] text-muted-foreground">Inactive</span>}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{t.LayoutLabel || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{sqft(t.BaseLandAreaSqFt)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{sqft(t.BuiltUpAreaSqFt)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{sqft(t.SuperBuiltUpAreaSqFt)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{t.PlotCount ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{t.VillaCount ?? 0}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setDraft({ ...t })} className="p-1.5 rounded hover:bg-muted" title="Edit"><Pencil size={14} /></button>
                          <button onClick={() => remove(t)} disabled={t.IsActive === false} title="Remove (blocked while unconverted plots plan it)"
                            className="p-1.5 rounded text-destructive hover:bg-destructive/10 disabled:opacity-35"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {types.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No villa types for this project yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 sm:grid-cols-4 items-end">
              <div><label className="mb-1 block text-xs text-muted-foreground">Code *</label><input value={draft.Code || ""} maxLength={20} onChange={setField("Code")} placeholder="T4" className={`${fieldCls} font-mono`} /></div>
              <div><label className="mb-1 block text-xs text-muted-foreground">Name *</label><input value={draft.Name || ""} maxLength={100} onChange={setField("Name")} placeholder="Villa Type 4" className={fieldCls} /></div>
              <div><label className="mb-1 block text-xs text-muted-foreground">Room layout</label>
                <select value={draft.LayoutTypeId ?? ""} onChange={setField("LayoutTypeId")} className={fieldCls}>
                  <option value="">Not set</option>
                  {layoutTypes.filter((l) => l.roomCount > 0 || l.id === Number(draft.LayoutTypeId)).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select></div>
              <div><label className="mb-1 block text-xs text-muted-foreground">Sort order</label><input type="number" min="0" value={draft.SortOrder ?? ""} onChange={setField("SortOrder")} placeholder="100" className={fieldCls} /></div>
              <div><label className="mb-1 block text-xs text-muted-foreground">Base land area (sq ft)</label><input type="number" min="0" step="0.01" value={draft.BaseLandAreaSqFt ?? ""} onChange={setField("BaseLandAreaSqFt")} className={`${fieldCls} tabular-nums`} /></div>
              <div><label className="mb-1 block text-xs text-muted-foreground">Built-up area (sq ft) *</label><input type="number" min="0" step="0.01" value={draft.BuiltUpAreaSqFt ?? ""} onChange={setField("BuiltUpAreaSqFt")} className={`${fieldCls} tabular-nums`} /></div>
              <div><label className="mb-1 block text-xs text-muted-foreground">Super built-up (sq ft)</label><input type="number" min="0" step="0.01" value={draft.SuperBuiltUpAreaSqFt ?? ""} onChange={setField("SuperBuiltUpAreaSqFt")} placeholder="Optional" className={`${fieldCls} tabular-nums`} /></div>
              <div className="flex gap-2">
                {draft.Id != null && <button onClick={() => setDraft({})} className="h-9 px-3 text-xs border border-border rounded-lg hover:bg-muted">New</button>}
                <button onClick={save} disabled={saving} className="h-9 flex-1 px-3 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">
                  {saving ? "Saving..." : draft.Id != null ? "Update" : "Add villa type"}
                </button>
              </div>
            </div>
            {draft.Id != null && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.IsActive !== false} onChange={(event) => setDraft((d) => ({ ...d, IsActive: event.target.checked }))} /> Active
                <span className="text-xs text-muted-foreground">(changes apply to future conversions; villas already created keep their areas)</span>
              </label>
            )}
            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <div className="min-w-[220px]">
                <label className="mb-1 block text-xs text-muted-foreground">
                  Plan a type on the {selectedPlotIds.length} ticked plot{selectedPlotIds.length === 1 ? "" : "s"}
                </label>
                <select value={assignTo} onChange={(event) => setAssignTo(event.target.value)} disabled={!canAssign} className={`${fieldCls} disabled:opacity-50`}>
                  <option value="">No villa type (clear)</option>
                  {activeTypes.map((t) => <option key={t.Id} value={t.Id}>{t.Code} — {t.Name}</option>)}
                </select>
              </div>
              <button onClick={assign} disabled={!canAssign} className="h-9 px-3 text-xs font-semibold border border-border rounded-lg hover:bg-muted disabled:opacity-40">Apply to ticked plots</button>
              {!canAssign && <span className="text-xs text-muted-foreground">Tick plots of this project in Plot Master to plan a type on them.</span>}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
