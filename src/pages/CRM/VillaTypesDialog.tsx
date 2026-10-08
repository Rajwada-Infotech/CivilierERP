import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Home, Pencil, Trash2, LayoutGrid, RotateCcw, CheckCircle2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { LayoutType } from "@/api/unitBhkConfigApi";
import { VillaRoomPlanEditor } from "./VillaRoomPlanEditor";

export const VILLA_TYPE_API = "/api/villa-type-master";

// A villa design a plotted layout offers (dbo.VillaTypeMaster, per project).
export type VillaType = {
  Id: number; ProjectId: number; Code: string; Name: string;
  LayoutTypeId?: number | null; LayoutLabel?: string | null;
  BaseLandAreaSqFt?: number | null; BuiltUpAreaSqFt: number; SuperBuiltUpAreaSqFt?: number | null;
  SortOrder?: number; IsActive?: boolean; PlotCount?: number; VillaCount?: number;
  // Set when the type's rooms come from its floor plan (its own layout).
  HasFloorPlan?: boolean; PlanRoomCount?: number; PlanFloorCount?: number;
};

export async function fetchVillaTypes(projectId: number | string, all = false): Promise<VillaType[]> {
  const response = await fetchWithAuth(`${VILLA_TYPE_API}?projectId=${projectId}${all ? "&all=1" : ""}`);
  if (!response.ok) throw new Error("Could not load villa types");
  return response.json();
}

export const villaTypesKey = (projectId: number | string | null | undefined) =>
  ["villa-types", String(projectId ?? "")];

const sqft = (v?: number | null) => (v == null ? "—" : Number(v).toLocaleString("en-IN"));

const inputCls =
  "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";
const labelCls = "mb-1.5 block text-xs font-medium text-muted-foreground";

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
export function VillaTypesDialog({
  open, onOpenChange, projects, initialProjectId, layoutTypes,
  selectedPlotIds, selectedProjectId, onPlotsChanged,
}: Props) {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState<string>("");
  const [draft, setDraft] = useState<Record<string, any>>({});
  // The villa type whose rooms-by-floor editor is open.
  const [planFor, setPlanFor] = useState<VillaType | null>(null);
  const [saving, setSaving] = useState(false);
  const [assignTo, setAssignTo] = useState("");
  // Removed types stay out of the way unless asked for — they can be restored.
  const [showRemoved, setShowRemoved] = useState(false);
  // Ref to the add/edit form so we can scroll to it when the pencil is clicked.
  const formRef = useRef<HTMLDivElement>(null);

  // Pick the starting project once, when the dialog opens. The parent rebuilds
  // `projects` on every render (and refetches in the background), so reacting
  // to it here wiped the user's choice moments after they made it.
  useEffect(() => {
    if (!open) return;
    const start = selectedProjectId ?? initialProjectId ?? (projects.length === 1 ? projects[0].ProjectId : null);
    setProjectId(start != null ? String(start) : "");
    setDraft({}); setAssignTo("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { data: types = [] } = useQuery({
    queryKey: [...villaTypesKey(projectId), "all"],
    queryFn: () => fetchVillaTypes(projectId, true),
    enabled: open && !!projectId,
  });
  const activeTypes = types.filter((t) => t.IsActive !== false);
  const removedCount = types.length - activeTypes.length;
  const shownTypes = showRemoved ? types : activeTypes;
  const canAssign =
    selectedPlotIds.length > 0 && selectedProjectId != null && String(selectedProjectId) === projectId;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["villa-types"] });

  const save = async () => {
    if (!projectId) { toast.error("Choose a project"); return; }
    if (!String(draft.Code || "").trim() || !String(draft.Name || "").trim()) {
      toast.error("Code and name are both required"); return;
    }
    if (!(Number(draft.BuiltUpAreaSqFt) > 0)) { toast.error("Built-up area is required"); return; }
    setSaving(true);
    try {
      const editing = draft.Id != null;
      const response = await fetchWithAuth(
        editing ? `${VILLA_TYPE_API}/${draft.Id}` : VILLA_TYPE_API,
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...draft, ProjectId: Number(projectId) }),
        }
      );
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

  const restore = async (type: VillaType) => {
    try {
      const response = await fetchWithAuth(`${VILLA_TYPE_API}/${type.Id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...type, IsActive: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not restore the villa type");
      toast.success(`Villa type ${type.Code} restored`); refresh();
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
      toast.success(
        assignTo
          ? `Villa type planned on ${body.updated} plot(s)`
          : `Villa type cleared on ${body.updated} plot(s)`
      );
      refresh(); onPlotsChanged();
    } catch (e: any) { toast.error(e.message); }
  };

  const setField = (key: string) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [key]: event.target.value }));

  const startEditing = (type: VillaType) => {
    setDraft({ ...type });
    setPlanFor(null);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent accent="crm" className="max-w-5xl w-[95vw]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Home size={17} className="text-primary" /> Villa types
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            The villa designs this layout offers. Converting plots to a villa takes its areas from the type planned on them.
          </p>
        </DialogHeader>

        {/* Project selector */}
        <div className="w-full sm:max-w-sm">
          <label className={labelCls}>Project</label>
          <Select
            value={projectId}
            onValueChange={(value) => {
              setProjectId(value);
              setDraft({}); setPlanFor(null); setAssignTo("");
            }}
          >
            <SelectTrigger className="h-10">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.ProjectId} value={String(p.ProjectId)}>
                  {p.ProjectName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Fixed body height so choosing / clearing a project doesn't resize the card. */}
        <div className="min-h-[30rem] grid content-start gap-5">
          {!projectId && (
            <div className="min-h-[30rem] grid place-items-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
              Choose a project to see and edit its villa types.
            </div>
          )}

          {projectId && (
            <>
              {removedCount > 0 && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={showRemoved}
                    onChange={(e) => setShowRemoved(e.target.checked)}
                  />
                  Show removed types ({removedCount})
                </label>
              )}

              {/* ── Types table ─────────────────────────────────── */}
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
                    {shownTypes.map((t) => (
                      <tr
                        key={t.Id}
                        className={`border-t border-border transition-colors ${
                          t.IsActive === false ? "opacity-50" : ""
                        } ${draft.Id === t.Id ? "bg-primary/5" : "hover:bg-muted/20"}`}
                      >
                        <td className="px-3 py-2 font-mono text-xs font-semibold">{t.Code}</td>
                        <td className="px-3 py-2">
                          {t.Name}
                          {t.IsActive === false && (
                            <span className="ml-2 text-[0.6875rem] text-muted-foreground">Removed</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{t.HasFloorPlan ? <span className="text-primary font-medium">Floor plan · {t.PlanRoomCount} rooms · {t.PlanFloorCount} floor{t.PlanFloorCount === 1 ? "" : "s"}</span> : t.LayoutLabel || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{sqft(t.BaseLandAreaSqFt)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{sqft(t.BuiltUpAreaSqFt)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{sqft(t.SuperBuiltUpAreaSqFt)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{t.PlotCount ?? 0}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{t.VillaCount ?? 0}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            {t.IsActive === false ? (
                              <button
                                onClick={() => restore(t)}
                                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-border text-xs font-medium hover:bg-muted"
                                title="Restore this villa type"
                              >
                                <RotateCcw size={13} /> Restore
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => { setPlanFor(planFor?.Id === t.Id ? null : t); setDraft({}); }}
                                  className={`p-1.5 rounded transition-colors ${
                                    planFor?.Id === t.Id
                                      ? "bg-primary text-primary-foreground"
                                      : "hover:bg-muted"
                                  }`}
                                  title="Room plan (floors &amp; rooms)"
                                >
                                  <LayoutGrid size={14} />
                                </button>
                                <button
                                  onClick={() => startEditing(t)}
                                  className={`p-1.5 rounded transition-colors ${
                                    draft.Id === t.Id
                                      ? "text-primary"
                                      : "hover:bg-muted"
                                  }`}
                                  title="Edit villa type"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  onClick={() => remove(t)}
                                  title="Remove (blocked while unconverted plots plan it)"
                                  className="p-1.5 rounded text-destructive hover:bg-destructive/10 transition-colors"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {shownTypes.length === 0 && (
                      <tr>
                        <td colSpan={9} className="p-6 text-center text-muted-foreground">
                          {removedCount > 0
                            ? `No active villa types — ${removedCount} removed (tick "Show removed types" to restore them).`
                            : "No villa types for this project yet."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* ── Room plan editor (inline, below table) ──────── */}
              {planFor && (
                <VillaRoomPlanEditor
                  type={planFor}
                  siblings={types.filter((x) => x.Id !== planFor.Id && x.IsActive !== false)}
                  canEdit
                  onSaved={() => { refresh(); onPlotsChanged(); }}
                  onClose={() => setPlanFor(null)}
                />
              )}

              {/* ── Add / Edit form ──────────────────────────────── */}
              <div
                ref={formRef}
                className={`rounded-lg border p-4 space-y-4 transition-colors ${
                  draft.Id != null
                    ? "border-amber-400/60 bg-amber-500/[0.04]"
                    : "border-border"
                }`}
              >
                {/* Edit mode banner */}
                {draft.Id != null ? (
                  <div className="flex items-center justify-between gap-3 rounded-md bg-amber-500/10 border border-amber-400/40 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Pencil size={13} className="text-amber-600 shrink-0" />
                      <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                        Editing: {draft.Code} — {draft.Name}
                      </span>
                    </div>
                    <button
                      onClick={() => setDraft({})}
                      className="text-xs border border-border rounded px-2.5 py-1 hover:bg-muted transition-colors"
                    >
                      Cancel / Add new instead
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                      <Plus size={14} />
                    </span>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Add a villa type
                    </p>
                  </div>
                )}

                {/* Row 1: Code · Name · Sort order */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className={labelCls}>Code *</label>
                    <input
                      value={draft.Code || ""}
                      maxLength={20}
                      onChange={setField("Code")}
                      placeholder="e.g. T4"
                      className={`${inputCls} font-mono`}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Name *</label>
                    <input
                      value={draft.Name || ""}
                      maxLength={100}
                      onChange={setField("Name")}
                      placeholder="e.g. Villa Type 4"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Sort order</label>
                    <input
                      type="number"
                      min="0"
                      value={draft.SortOrder ?? ""}
                      onChange={setField("SortOrder")}
                      placeholder="100"
                      className={inputCls}
                    />
                  </div>
                </div>

                {/* Row 2: rooms — from the floor plan when the type has one */}
                {draft.Id != null && draft.HasFloorPlan ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
                    <p className="text-sm">
                      <span className="font-medium">Rooms: from the floor plan</span>
                      <span className="text-muted-foreground"> — {draft.PlanRoomCount} rooms on {draft.PlanFloorCount} floor{draft.PlanFloorCount === 1 ? "" : "s"}</span>
                    </p>
                    <button type="button" onClick={() => { const t0 = types.find((x) => x.Id === draft.Id); if (t0) { setPlanFor(t0); setDraft({}); } }}
                      className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold border border-border rounded-lg bg-background hover:bg-muted">
                      <LayoutGrid size={13} /> Edit rooms by floor
                    </button>
                  </div>
                ) : (
                <div>
                  <label className={labelCls}>Room layout <span className="normal-case font-normal text-muted-foreground">— or plan rooms floor by floor with the <LayoutGrid size={11} className="inline -mt-0.5" /> Rooms button once the type is added</span></label>
                  <Select
                    value={draft.LayoutTypeId != null ? String(draft.LayoutTypeId) : "__none__"}
                    onValueChange={(value) => {
                      const id = value === "__none__" ? null : Number(value);
                      const label = id != null
                        ? layoutTypes.find((l) => l.id === id)?.label ?? null
                        : null;
                      setDraft((d) => ({ ...d, LayoutTypeId: id, LayoutLabel: label }));
                    }}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Not set</SelectItem>
                      {layoutTypes
                        .filter((l) => l.roomCount > 0 || l.id === Number(draft.LayoutTypeId))
                        .map((l) => (
                          <SelectItem key={l.id} value={String(l.id)}>{l.label}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                )}
                {/* Row 3: Area fields */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className={labelCls}>Base land area (sq ft)</label>
                    <input
                      type="number" min="0" step="0.01"
                      value={draft.BaseLandAreaSqFt ?? ""}
                      onChange={setField("BaseLandAreaSqFt")}
                      className={`${inputCls} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Built-up area (sq ft) *</label>
                    <input
                      type="number" min="0" step="0.01"
                      value={draft.BuiltUpAreaSqFt ?? ""}
                      onChange={setField("BuiltUpAreaSqFt")}
                      className={`${inputCls} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Super built-up (sq ft)</label>
                    <input
                      type="number" min="0" step="0.01"
                      value={draft.SuperBuiltUpAreaSqFt ?? ""}
                      onChange={setField("SuperBuiltUpAreaSqFt")}
                      placeholder="Optional"
                      className={`${inputCls} tabular-nums`}
                    />
                  </div>
                </div>

                {draft.Id != null && (
                  <p className="text-xs text-muted-foreground">
                    Changes apply to future conversions only. Villas already built keep their current areas.
                  </p>
                )}

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 pt-1 border-t border-border">
                  {draft.Id != null && (
                    <button
                      onClick={() => setDraft({})}
                      className="h-10 px-4 text-sm border border-border rounded-lg hover:bg-muted"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={save}
                    disabled={saving}
                    className="h-10 px-5 text-sm font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-2"
                  >
                    <CheckCircle2 size={15} />
                    {saving ? "Saving…" : draft.Id != null ? "Update villa type" : "Add villa type"}
                  </button>
                </div>
              </div>

              {/* ── Assign to ticked plots ───────────────────────── */}
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Plan a villa type on selected plots
                </p>
                {canAssign ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex-1 min-w-[220px]">
                      <label className={labelCls}>
                        Type to plan on the {selectedPlotIds.length} ticked plot{selectedPlotIds.length === 1 ? "" : "s"}
                      </label>
                      <Select
                        value={assignTo || "__clear__"}
                        onValueChange={(v) => setAssignTo(v === "__clear__" ? "" : v)}
                      >
                        <SelectTrigger className="h-10">
                          <SelectValue placeholder="No villa type (clear)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__clear__">No villa type (clear)</SelectItem>
                          {activeTypes.map((t) => (
                            <SelectItem key={t.Id} value={String(t.Id)}>
                              {t.Code} — {t.Name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <button
                      onClick={assign}
                      className="h-10 px-4 text-sm font-semibold border border-primary text-primary rounded-lg hover:bg-primary hover:text-primary-foreground transition-colors inline-flex items-center gap-1.5"
                    >
                      <CheckCircle2 size={15} /> Apply to plots
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Tick plots of this project in Plot Master to plan a villa type on them.
                    {selectedPlotIds.length > 0 &&
                      selectedProjectId != null &&
                      String(selectedProjectId) !== projectId && (
                        <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">
                          (The ticked plots belong to a different project than the one selected above.)
                        </span>
                      )}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
