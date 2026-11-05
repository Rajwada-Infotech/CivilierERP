// Plot facings, managed in place: a facing has no meaning outside plots, and a separate master page would be one more
// thing to find and permission for a list of eight rows.
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SheetMark } from "@/components/sheet/Sheet";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DIALOG, DIALOG_STYLE, DialogHead, FACING_API, INP, KEY_INK, KEY_LINE, LBL, NUM, RULE, RULE_SOFT, fetchFacings, type PlotFacing } from "./config";

export const FacingsDialog: React.FC<{
  open: boolean; onOpenChange: (open: boolean) => void;
  canCreate: boolean; canEdit: boolean; canDelete: boolean;
}> = ({ open, onOpenChange, canCreate, canEdit, canDelete }) => {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Partial<PlotFacing>>({});
  const [saving, setSaving] = useState(false);
  // All facings, so a deactivated one is still visible to re-enable.
  const { data: facings = [], isError, error } = useQuery({ queryKey: ["plot-facings", "all"], queryFn: () => fetchFacings(true), enabled: open });
  const editing = draft.Id != null;
  // Adding needs create, changing needs edit — the server's own rule.
  const mayWrite = editing ? canEdit : canCreate;

  const save = async () => {
    const code = String(draft.Code || "").trim().toUpperCase();
    const name = String(draft.Name || "").trim();
    if (!code || !name) { toast.error("Code and name are both required"); return; }
    setSaving(true);
    try {
      const response = await fetchWithAuth(editing ? `${FACING_API}/${draft.Id}` : FACING_API, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, Code: code, Name: name }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not save the facing");
      toast.success(editing ? "Facing updated" : "Facing added");
      setDraft({});
      queryClient.invalidateQueries({ queryKey: ["plot-facings"] });
      queryClient.invalidateQueries({ queryKey: ["plot-master"] });
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };
  const remove = async (facing: PlotFacing) => {
    try {
      const response = await fetchWithAuth(`${FACING_API}/${facing.Id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not remove the facing");
      toast.success("Facing removed");
      queryClient.invalidateQueries({ queryKey: ["plot-facings"] });
    } catch (e: any) { toast.error(e.message); }
  };

  const th = `!px-3 !py-2 text-left ${LBL}`;
  const codeLocked = editing && (draft.PlotCount ?? 0) > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setDraft({}); }}>
      <DialogContent className={`max-w-2xl ${DIALOG}`} style={DIALOG_STYLE}>
        <DialogHead Title={DialogTitle} eyebrow="Plot Master" title="Plot facings"
          note="The premium is added to a plot's rate, so what a direction is worth lives here rather than in pricing code." />
        <div className="bg-card overflow-x-auto thin-scroll" style={{ border: RULE }}>
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr style={{ borderBottom: RULE }}>
                <th className={th}>Code</th><th className={th}>Name</th><th className={`${th} !text-right`}>Premium</th><th className={`${th} !text-right`}>Plots</th><th className={th}>State</th><th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {isError ? (
                <tr><td colSpan={6} className="!px-3 !py-4 text-center text-xs text-destructive">{(error as Error)?.message}</td></tr>
              ) : facings.length === 0 ? (
                <tr><td colSpan={6} className="!px-3 !py-4 text-center text-xs text-muted-foreground">No facings defined yet.</td></tr>
              ) : facings.map((facing) => (
                <tr key={facing.Id} style={{ borderBottom: RULE_SOFT, boxShadow: draft.Id === facing.Id ? "inset 3px 0 0 hsl(var(--foreground))" : undefined }}
                  className={draft.Id === facing.Id ? "bg-primary/5" : ""}>
                  <td className={`!px-3 !py-2 text-xs font-semibold ${NUM}`}>{facing.Code}</td>
                  <td className="!px-3 !py-2">{facing.Name}</td>
                  <td className={`!px-3 !py-2 text-right ${NUM}`}>{Number(facing.PremiumPercent) || 0}%</td>
                  <td className={`!px-3 !py-2 text-right ${NUM} text-muted-foreground`}>{facing.PlotCount ?? 0}</td>
                  <td className="!px-3 !py-2"><SheetMark text={facing.IsActive === false ? "Inactive" : "Active"} tone={facing.IsActive === false ? "draft" : "done"} /></td>
                  <td className="!px-3 !py-2">
                    <div className="flex justify-end gap-1">
                      {canEdit && <button onClick={() => setDraft(facing)} className="w-7 h-7 inline-flex items-center justify-center border border-transparent hover:border-foreground" title="Edit"><Pencil size={13} /></button>}
                      {/* Disabled with a reason rather than hidden, so it's clear the facing is in use. */}
                      {canDelete && (
                        <button onClick={() => remove(facing)} disabled={(facing.PlotCount ?? 0) > 0 || facing.IsActive === false}
                          title={(facing.PlotCount ?? 0) > 0 ? `In use by ${facing.PlotCount} plot(s)` : facing.IsActive === false ? "Already inactive" : "Remove"}
                          className="w-7 h-7 inline-flex items-center justify-center border border-transparent text-destructive hover:border-destructive disabled:opacity-35"><Trash2 size={13} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(canCreate || (editing && canEdit)) && (
          <div className="space-y-3">
            <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">{editing ? `Edit ${draft.Name || "facing"}` : "New facing"}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block space-y-1">
                <span className={`block ${LBL}`}>Code</span>
                <input value={draft.Code || ""} maxLength={20} disabled={codeLocked}
                  title={codeLocked ? "The code is locked while plots use it; the name and premium can still change" : undefined}
                  onChange={(e) => setDraft((d) => ({ ...d, Code: e.target.value.toUpperCase() }))} placeholder="NE" className={`${INP} ${NUM} disabled:opacity-60`} />
              </label>
              <label className="block space-y-1">
                <span className={`block ${LBL}`}>Name</span>
                <input value={draft.Name || ""} maxLength={50} onChange={(e) => setDraft((d) => ({ ...d, Name: e.target.value }))} placeholder="North-East" className={INP} />
              </label>
              <label className="block space-y-1">
                <span className={`block ${LBL}`}>Premium %</span>
                <input type="number" step="0.001" value={draft.PremiumPercent ?? ""} onChange={(e) => setDraft((d) => ({ ...d, PremiumPercent: e.target.value as any }))} className={`${INP} ${NUM} text-right`} />
              </label>
            </div>
            {editing && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-3.5 w-3.5 accent-foreground" checked={draft.IsActive !== false} onChange={(e) => setDraft((d) => ({ ...d, IsActive: e.target.checked }))} /> Active
                <span className="text-xs text-muted-foreground">(untick to hide it from the plot dropdown; blocked while plots use it)</span>
              </label>
            )}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
          {editing && canCreate && <button onClick={() => setDraft({})} className={`${KEY_LINE} h-9 px-4`}>New instead</button>}
          <button onClick={() => onOpenChange(false)} className={`${KEY_LINE} h-9 px-4`}>Close</button>
          {mayWrite && (
            <button onClick={save} disabled={saving} className={`${KEY_INK} h-9 px-4`}>{saving ? "Saving…" : editing ? "Update facing" : "Add facing"}</button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
