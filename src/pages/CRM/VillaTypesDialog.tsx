import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, LayoutGrid, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useSheetAsk } from "@/components/sheet/SheetAsk";
import { SheetMark } from "@/components/sheet/Sheet";
import { RULE, RULE_SOFT, LBL, KEY_INK, KEY_LINE, INP } from "./customers/config";
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

const inputCls = INP;
const NUMC = "font-heading tabular-nums";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";

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
  /** Plot Master's rights: adding a type needs create, changing one edit, removing one delete. */
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

// Villa types are managed in place from Plot Master, as facings are: they have
// no meaning outside a plotted layout.
export function VillaTypesDialog({
  open, onOpenChange, projects, initialProjectId, layoutTypes,
  selectedPlotIds, selectedProjectId, onPlotsChanged, canCreate, canEdit, canDelete,
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
  // Asked on the sheet (components/sheet/SheetAsk), in place of window.confirm.
  const ask = useSheetAsk();
  const requestConfirm = (msg: string, onOk: () => void) => { void ask.confirm(msg, { title: "Confirm Remove", okLabel: "Remove", danger: true }).then((yes) => { if (yes) onOk(); }); };

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

  // A failed load says so; it used to read "No villa types for this project yet".
  const { data: types = [], isError: typesFailed, error: typesError } = useQuery({
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
    requestConfirm(`Remove villa type ${type.Code}?`, async () => {
      try {
        const response = await fetchWithAuth(`${VILLA_TYPE_API}/${type.Id}`, { method: "DELETE" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Could not remove the villa type");
        toast.success("Villa type removed"); refresh();
      } catch (e: any) { toast.error(e.message); }
    });
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

  const th = `!px-3 !py-2 text-left ${LBL}`;
  const td = "!px-3 !py-2.5";
  const formOpen = draft.Id != null ? canEdit : canCreate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] rounded-none p-5 gap-4 max-h-[92vh] overflow-y-auto thin-scroll" style={{ border: RULE }}>
        <div className="pb-3" style={{ borderBottom: RULE }}>
          <p className={LBL}>Plot Master</p>
          <DialogTitle className="mt-1 font-heading text-lg font-bold tracking-tight">Villa types</DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            The villa designs this layout offers. Converting plots to a villa takes its areas from the type planned on them.
          </p>
        </div>

        <label className="block space-y-1 w-full sm:max-w-sm">
          <span className={`block ${LBL}`}>Project</span>
          <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setDraft({}); setPlanFor(null); setAssignTo(""); }} className={inputCls}>
            <option value="" disabled>Choose a project</option>
            {projects.map((p) => <option key={p.ProjectId} value={String(p.ProjectId)}>{p.ProjectName}</option>)}
          </select>
        </label>

        {/* Fixed body height so choosing / clearing a project doesn't resize the card. */}
        <div className="min-h-[30rem] grid content-start gap-4">
          {!projectId && (
            <div className="min-h-[30rem] grid place-items-center border border-dashed border-foreground/30 text-sm text-muted-foreground">
              Choose a project to see and edit its villa types.
            </div>
          )}

          {projectId && (
            <>
              {removedCount > 0 && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-foreground" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />
                  Show removed types (<span className="tabular-nums">{removedCount}</span>)
                </label>
              )}

              <div className="bg-card overflow-x-auto thin-scroll" style={{ border: RULE }}>
                <table className="w-full text-sm min-w-[760px]">
                  <thead>
                    <tr style={{ borderBottom: RULE }}>
                      <th className={th}>Code</th><th className={th}>Name</th><th className={th}>Layout</th>
                      <th className={`${th} !text-right`}>Base land</th><th className={`${th} !text-right`}>Built-up</th><th className={`${th} !text-right`}>Super built-up</th>
                      <th className={`${th} !text-right`}>Plots</th><th className={`${th} !text-right`}>Villas</th><th className={`${th} !text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typesFailed ? (
                      <tr><td colSpan={9} className={`${td} text-center text-xs text-destructive`}>{(typesError as Error)?.message}</td></tr>
                    ) : shownTypes.map((t) => {
                      const on = draft.Id === t.Id || planFor?.Id === t.Id;
                      return (
                        <tr key={t.Id} className={`${t.IsActive === false ? "opacity-50" : ""} ${on ? "bg-primary/5" : "hover:bg-primary/5"}`}
                          style={{ borderBottom: RULE_SOFT, boxShadow: on ? "inset 3px 0 0 hsl(var(--foreground))" : undefined }}>
                          <td className={`${td} font-heading text-xs font-semibold tabular-nums`}>{t.Code}</td>
                          <td className={td}>
                            {t.Name}
                            {t.IsActive === false && <span className="ml-2"><SheetMark text="Removed" tone="draft" /></span>}
                          </td>
                          <td className={`${td} text-xs text-muted-foreground`}>
                            {t.HasFloorPlan
                              ? <span className="text-foreground">Floor plan · <span className="tabular-nums">{t.PlanRoomCount}</span> rooms · <span className="tabular-nums">{t.PlanFloorCount}</span> floor{t.PlanFloorCount === 1 ? "" : "s"}</span>
                              : t.LayoutLabel || "—"}
                          </td>
                          <td className={`${td} text-right ${NUMC}`}>{sqft(t.BaseLandAreaSqFt)}</td>
                          <td className={`${td} text-right ${NUMC} font-semibold`}>{sqft(t.BuiltUpAreaSqFt)}</td>
                          <td className={`${td} text-right ${NUMC}`}>{sqft(t.SuperBuiltUpAreaSqFt)}</td>
                          <td className={`${td} text-right ${NUMC} text-muted-foreground`}>{t.PlotCount ?? 0}</td>
                          <td className={`${td} text-right ${NUMC} text-muted-foreground`}>{t.VillaCount ?? 0}</td>
                          <td className={td}>
                            <div className="flex justify-end gap-1">
                              {t.IsActive === false ? (
                                canEdit && (
                                  <button onClick={() => restore(t)} className={`${KEY_LINE} h-7 px-2.5`} title="Restore this villa type"><RotateCcw size={12} /> Restore</button>
                                )
                              ) : (
                                <>
                                  <button onClick={() => { setPlanFor(planFor?.Id === t.Id ? null : t); setDraft({}); }} title="Room plan (floors & rooms)"
                                    className={`w-7 h-7 inline-flex items-center justify-center border transition-colors ${planFor?.Id === t.Id ? "bg-foreground text-card border-foreground" : "border-transparent hover:border-foreground"}`}>
                                    <LayoutGrid size={13} />
                                  </button>
                                  {canEdit && (
                                    <button onClick={() => startEditing(t)} title="Edit villa type"
                                      className={`w-7 h-7 inline-flex items-center justify-center border transition-colors ${draft.Id === t.Id ? "border-foreground" : "border-transparent hover:border-foreground"}`}>
                                      <Pencil size={13} />
                                    </button>
                                  )}
                                  {canDelete && (
                                    <button onClick={() => remove(t)} title="Remove (blocked while unconverted plots plan it)"
                                      className="w-7 h-7 inline-flex items-center justify-center border border-transparent text-destructive hover:border-destructive">
                                      <Trash2 size={13} />
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!typesFailed && shownTypes.length === 0 && (
                      <tr>
                        <td colSpan={9} className={`${td} text-center text-muted-foreground`}>
                          {removedCount > 0
                            ? `No active villa types — ${removedCount} removed (tick "Show removed types" to restore them).`
                            : "No villa types for this project yet."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Room plan editor, below the table. */}
              {planFor && (
                <VillaRoomPlanEditor
                  type={planFor}
                  siblings={types.filter((x) => x.Id !== planFor.Id && x.IsActive !== false)}
                  canEdit={canEdit}
                  onSaved={() => { refresh(); onPlotsChanged(); }}
                  onClose={() => setPlanFor(null)}
                />
              )}

              {/* Add / edit */}
              {formOpen && (
                <section ref={formRef} className="bg-card" style={{ border: RULE, boxShadow: draft.Id != null ? "inset 3px 0 0 hsl(var(--foreground))" : undefined }}>
                  <header className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2" style={{ borderBottom: RULE_SOFT }}>
                    <span className={HEAD}>{draft.Id != null ? `Editing ${draft.Code} — ${draft.Name}` : "Add a villa type"}</span>
                    {draft.Id != null && canCreate && <button onClick={() => setDraft({})} className={`${KEY_LINE} h-7 px-2.5`}>Add new instead</button>}
                  </header>
                  <div className="p-4 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="block space-y-1"><span className={`block ${LBL}`}>Code <span className="text-destructive">*</span></span>
                        <input value={draft.Code || ""} maxLength={20} onChange={setField("Code")} placeholder="e.g. T4" className={`${inputCls} font-heading`} /></label>
                      <label className="block space-y-1"><span className={`block ${LBL}`}>Name <span className="text-destructive">*</span></span>
                        <input value={draft.Name || ""} maxLength={100} onChange={setField("Name")} placeholder="e.g. Villa Type 4" className={inputCls} /></label>
                      <label className="block space-y-1"><span className={`block ${LBL}`}>Sort order</span>
                        <input type="number" min="0" value={draft.SortOrder ?? ""} onChange={setField("SortOrder")} placeholder="100" className={`${inputCls} tabular-nums`} /></label>
                    </div>

                    {/* Rooms — from the floor plan when the type has one. */}
                    {draft.Id != null && draft.HasFloorPlan ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 bg-primary/5" style={{ border: RULE_SOFT }}>
                        <p className="text-sm">
                          <span className="font-medium">Rooms: from the floor plan</span>
                          <span className="text-muted-foreground"> — <span className="tabular-nums">{draft.PlanRoomCount}</span> rooms on <span className="tabular-nums">{draft.PlanFloorCount}</span> floor{draft.PlanFloorCount === 1 ? "" : "s"}</span>
                        </p>
                        <button type="button" onClick={() => { const t0 = types.find((x) => x.Id === draft.Id); if (t0) { setPlanFor(t0); setDraft({}); } }} className={`${KEY_LINE} h-8 px-3`}>
                          <LayoutGrid size={12} /> Edit rooms by floor
                        </button>
                      </div>
                    ) : (
                      <label className="block space-y-1">
                        <span className={`block ${LBL}`}>Room layout <span className="normal-case tracking-normal font-normal">— or plan rooms floor by floor with the room-plan key once the type is added</span></span>
                        <select value={draft.LayoutTypeId != null ? String(draft.LayoutTypeId) : ""} className={inputCls}
                          onChange={(e) => {
                            const id = e.target.value ? Number(e.target.value) : null;
                            const label = id != null ? layoutTypes.find((l) => l.id === id)?.label ?? null : null;
                            setDraft((d) => ({ ...d, LayoutTypeId: id, LayoutLabel: label }));
                          }}>
                          <option value="">Not set</option>
                          {layoutTypes.filter((l) => l.roomCount > 0 || l.id === Number(draft.LayoutTypeId)).map((l) => <option key={l.id} value={String(l.id)}>{l.label}</option>)}
                        </select>
                      </label>
                    )}
                    <div className="grid gap-3 sm:grid-cols-3">
                      {([["BaseLandAreaSqFt", "Base land area (sq ft)", ""], ["BuiltUpAreaSqFt", "Built-up area (sq ft)", "*"], ["SuperBuiltUpAreaSqFt", "Super built-up (sq ft)", ""]] as const).map(([key, label, req]) => (
                        <label key={key} className="block space-y-1"><span className={`block ${LBL}`}>{label}{req && <span className="text-destructive"> *</span>}</span>
                          <input type="number" min="0" step="0.01" value={draft[key] ?? ""} onChange={setField(key)} placeholder={req ? "" : "Optional"} className={`${inputCls} ${NUMC} text-right`} /></label>
                      ))}
                    </div>
                    {draft.Id != null && <p className="text-xs text-muted-foreground">Changes apply to future conversions only. Villas already built keep their current areas.</p>}
                    <div className="flex items-center justify-end gap-2 pt-3" style={{ borderTop: RULE_SOFT }}>
                      {draft.Id != null && <button onClick={() => setDraft({})} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>}
                      <button onClick={save} disabled={saving} className={`${KEY_INK} h-9 px-4`}>
                        {saving ? "Saving…" : draft.Id != null ? "Update villa type" : "Add villa type"}
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {/* Plan a type on the ticked plots. */}
              {canEdit && (
                <section className="bg-card" style={{ border: RULE }}>
                  <header className="px-4 py-2.5" style={{ borderBottom: RULE_SOFT }}><span className={HEAD}>Plan a villa type on selected plots</span></header>
                  <div className="p-4">
                    {canAssign ? (
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="block space-y-1 flex-1 min-w-[220px]">
                          <span className={`block ${LBL}`}>Type to plan on the <span className="tabular-nums">{selectedPlotIds.length}</span> ticked plot{selectedPlotIds.length === 1 ? "" : "s"}</span>
                          <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className={inputCls}>
                            <option value="">No villa type (clear)</option>
                            {activeTypes.map((t) => <option key={t.Id} value={String(t.Id)}>{t.Code} — {t.Name}</option>)}
                          </select>
                        </label>
                        <button onClick={assign} className={`${KEY_INK} h-9 px-4`}>Apply to plots</button>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Tick plots of this project in Plot Master to plan a villa type on them.
                        {selectedPlotIds.length > 0 && selectedProjectId != null && String(selectedProjectId) !== projectId && (
                          <span className="ml-1 font-medium text-foreground">(The ticked plots belong to a different project than the one selected above.)</span>
                        )}
                      </p>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </DialogContent>
      {ask.node}
    </Dialog>
  );
}
