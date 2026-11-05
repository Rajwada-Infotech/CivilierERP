// Add a plot, or edit an available one: its number and name, survey number, facing, planned villa type and sizes.
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fetchVillaTypes, villaTypesKey, type VillaType } from "../VillaTypesDialog";
import { DIALOG, DIALOG_STYLE, DialogHead, INP, KEY_INK, KEY_LINE, LBL, NUM, RULE, TEXT_LINK, type PlotBlock, type PlotFacing } from "./config";

const SIZES: [string, string][] = [
  ["AreaSqFt", "Area (sq ft)"], ["RatePerSqFt", "Rate ₹ / sq ft"], ["PlotWidthFt", "Width (ft)"],
  ["PlotDepthFt", "Depth (ft)"], ["RoadWidthFt", "Road width (ft)"], ["GuidelineRatePerSqFt", "Guideline rate ₹ / sq ft"],
];

export const PlotEditDialog: React.FC<{
  open: boolean; onOpenChange: (open: boolean) => void; creating: boolean;
  draft: Record<string, any>; setDraft: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  projects: [number, string][]; blockCatalog: PlotBlock[];
  facings: PlotFacing[]; facingsFailed: boolean; canManageFacings: boolean; onManageFacings: () => void;
  saving: boolean; onSave: () => void;
}> = ({ open, onOpenChange, creating, draft, setDraft, projects, blockCatalog, facings, facingsFailed, canManageFacings, onManageFacings, saving, onSave }) => {
  const { data: villaTypes = [] } = useQuery<VillaType[]>({ queryKey: villaTypesKey(draft.ProjectId), queryFn: () => fetchVillaTypes(draft.ProjectId), enabled: open && !!draft.ProjectId });
  const blocks = blockCatalog.filter((b) => String(b.ProjectId) === String(draft.ProjectId));
  const set = (patch: Record<string, any>) => setDraft((d) => ({ ...d, ...patch }));
  const field = (label: string, children: React.ReactNode, right?: React.ReactNode) => (
    <div className="space-y-1 min-w-0">
      <div className="flex items-end justify-between gap-2"><span className={LBL}>{label}</span>{right}</div>
      {children}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-w-2xl ${DIALOG}`} style={DIALOG_STYLE}>
        <DialogHead Title={DialogTitle} eyebrow="Plot Master" title={creating ? "Add plot" : `Edit ${draft.PlotName || "plot"}`}
          note={creating ? "Place it on the block's layout afterwards." : undefined} />
        <div className="grid gap-3 sm:grid-cols-2 max-h-[62vh] overflow-y-auto thin-scroll -mr-2 pr-2">
          {creating && (
            <>
              {field("Project", (
                <select value={draft.ProjectId || ""} className={INP}
                  onChange={(e) => { const next = blockCatalog.find((b) => String(b.ProjectId) === e.target.value); set({ ProjectId: e.target.value, BlockId: next ? String(next.BlockId) : "" }); }}>
                  <option value="" disabled>Select a project</option>
                  {projects.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
                </select>
              ))}
              {field("Block", (
                <select value={draft.BlockId || ""} onChange={(e) => set({ BlockId: e.target.value })} className={INP}>
                  <option value="" disabled>Select a block</option>
                  {blocks.map((b) => <option key={b.BlockId} value={String(b.BlockId)}>{b.BlockName}</option>)}
                </select>
              ))}
            </>
          )}
          {field("Plot number", <input value={draft.PlotNo || ""} onChange={(e) => set({ PlotNo: e.target.value })} className={`${INP} ${NUM}`} />)}
          {field("Plot name", <input value={draft.PlotName || ""} onChange={(e) => set({ PlotName: e.target.value })} className={`${INP} ${NUM}`} />)}
          {field("Survey number", <input value={draft.SurveyNo || ""} onChange={(e) => set({ SurveyNo: e.target.value })} className={INP} />)}
          {field("Facing", (
            <>
              <select value={draft.Facing || ""} onChange={(e) => set({ Facing: e.target.value })} className={INP}>
                <option value="">Not set</option>
                {facings.map((f) => <option key={f.Id} value={f.Code}>{f.Name}{Number(f.PremiumPercent) ? ` (+${f.PremiumPercent}%)` : ""}</option>)}
                {/* A plot saved before facings became a master may hold a code no longer listed; it stays visible. */}
                {draft.Facing && !facings.some((f) => f.Code === draft.Facing) && <option value={draft.Facing}>{draft.Facing} (not in master)</option>}
              </select>
              {facingsFailed && <p className="text-xs text-destructive">Could not load the facing list — the options may be incomplete.</p>}
            </>
          ), canManageFacings ? <button type="button" onClick={onManageFacings} className={TEXT_LINK}>Manage</button> : undefined)}
          {field("Planned villa type", (
            <select value={draft.PlannedVillaTypeId ?? ""} onChange={(e) => set({ PlannedVillaTypeId: e.target.value || null })} className={INP}>
              <option value="">Not planned</option>
              {villaTypes.map((t) => <option key={t.Id} value={t.Id}>{t.Code} — {t.Name}</option>)}
              {draft.PlannedVillaTypeId && !villaTypes.some((t) => String(t.Id) === String(draft.PlannedVillaTypeId)) && <option value={draft.PlannedVillaTypeId}>{draft.PlannedVillaTypeName || "Current type"} (inactive)</option>}
            </select>
          ))}
          {SIZES.map(([key, label]) => (
            <React.Fragment key={key}>
              {field(label, <input type="number" min="0" step="0.01" value={draft[key] ?? ""} onChange={(e) => set({ [key]: e.target.value })} className={`${INP} ${NUM} text-right`} />)}
            </React.Fragment>
          ))}
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className="h-3.5 w-3.5 accent-foreground" checked={draft.IsCornerPlot === true} onChange={(e) => set({ IsCornerPlot: e.target.checked })} /> Corner plot
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
          <button onClick={() => onOpenChange(false)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          <button onClick={onSave} disabled={saving || !draft.PlotNo?.trim() || !draft.PlotName?.trim()} className={`${KEY_INK} h-9 px-4`}>
            {saving ? "Saving…" : creating ? "Create plot" : "Save changes"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
