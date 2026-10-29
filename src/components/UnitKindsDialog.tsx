import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SheetMark } from "@/components/sheet/Sheet";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Unit kinds — Flat, Villa, Shop, Office… — managed from Unit Master. Each kind
// is land (outside GST), commercial (commercial GST rule) or neither
// (residential); never both. Kinds are data: nothing here lists them.

const API = "/api/unit-master/kinds";
type Kind = { Id: number; Code: string; Name: string; SortOrder?: number; IsActive?: boolean; IsLand?: boolean; IsCommercial?: boolean; BuiltOn?: string | null };
const empty = { Id: 0, Code: "", Name: "", SortOrder: "100", IsActive: true, IsLand: false, IsCommercial: false, BuiltOn: "" };
const BUILT_ON: Record<string, string> = { FLOORS: "Floors", PLOTS: "Plots" };

const RULE = "1px solid hsl(var(--foreground))";
const RULE_SOFT = "1px solid hsl(var(--foreground) / 0.15)";
const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed h-8 px-3";
const fieldCls = "h-9 w-full border border-foreground/40 focus:border-foreground bg-card px-2.5 text-sm text-foreground outline-none disabled:opacity-50";
const TAG = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] border border-foreground/30 px-1.5 py-0.5";

export function UnitKindsDialog({ open, onOpenChange, canCreate, canEdit }: {
  open: boolean; onOpenChange: (v: boolean) => void; canCreate: boolean; canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(empty);
  const [saving, setSaving] = useState(false);
  const { data: kinds = [], isError, error } = useQuery<Kind[]>({
    queryKey: ["unit-kinds", "manage"],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/manage`);
      if (!r.ok) throw new Error("Failed to load unit kinds");
      return r.json();
    },
    enabled: open,
  });

  const edit = (k?: Kind) => setDraft(k
    ? { Id: k.Id, Code: k.Code, Name: k.Name, SortOrder: String(k.SortOrder ?? 100), IsActive: k.IsActive !== false, IsLand: !!k.IsLand, IsCommercial: !!k.IsCommercial, BuiltOn: k.BuiltOn || "" }
    : empty);
  // A new kind needs the create right, a change the edit right — the server's own rule.
  const mayWrite = draft.Id ? canEdit : canCreate;

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetchWithAuth(draft.Id ? `${API}/${draft.Id}` : API, {
        method: draft.Id ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, SortOrder: Number(draft.SortOrder), BuiltOn: draft.BuiltOn || null }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "Could not save the unit kind");
      toast.success("Unit kind saved");
      edit();
      // Every place that lists kinds picks the change up.
      queryClient.invalidateQueries({ queryKey: ["unit-kinds"] });
      queryClient.invalidateQueries({ queryKey: ["unit-master-kinds"] });
      queryClient.invalidateQueries({ queryKey: ["constructed-asset-kinds"] });
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const check = (checked: boolean, onChange: (v: boolean) => void, label: string, disabled = false) => (
    <label className={`flex items-center gap-2 text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-foreground" /> {label}
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) edit(); }}>
      <DialogContent className="max-w-2xl rounded-none p-5 gap-4" style={{ border: RULE }}>
        <DialogHeader className="pb-3" style={{ borderBottom: RULE }}>
          <p className={LBL}>Unit Master</p>
          <DialogTitle className="font-heading text-lg font-bold tracking-tight">Unit kinds</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            What a unit is — flat, villa, shop, office… Commercial kinds use the commercial GST rule; land kinds are outside GST.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_260px]">
          <div className="max-h-80 overflow-y-auto thin-scroll bg-card" style={{ border: RULE }}>
            {isError ? (
              <p className="px-3 py-3 text-xs text-destructive">{(error as Error)?.message}</p>
            ) : kinds.map((k) => (
              <button key={k.Id} onClick={() => edit(k)}
                className={`flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-primary/5 ${draft.Id === k.Id ? "bg-primary/5" : ""}`}
                style={{ borderBottom: RULE_SOFT, boxShadow: draft.Id === k.Id ? "inset 3px 0 0 hsl(var(--foreground))" : undefined }}>
                <span className="font-medium">{k.Name}</span>
                <span className="font-heading text-xs font-semibold text-muted-foreground">{k.Code}</span>
                {k.IsLand && <span className={TAG}>Land</span>}
                {k.IsCommercial && <span className={TAG}>Commercial</span>}
                {k.BuiltOn && <span className={TAG}>{BUILT_ON[k.BuiltOn] ?? k.BuiltOn}</span>}
                <span className="ml-auto"><SheetMark text={k.IsActive === false ? "Inactive" : "Active"} tone={k.IsActive === false ? "draft" : "done"} /></span>
              </button>
            ))}
          </div>
          <div className="space-y-3">
            <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">{draft.Id ? `Edit ${draft.Name || "kind"}` : "New kind"}</p>
            <label className="block space-y-1"><span className={`block ${LBL}`}>Name</span><input value={draft.Name} onChange={(e) => setDraft((d) => ({ ...d, Name: e.target.value }))} className={fieldCls} /></label>
            <label className="block space-y-1"><span className={`block ${LBL}`}>Code</span><input value={draft.Code} onChange={(e) => setDraft((d) => ({ ...d, Code: e.target.value.toUpperCase() }))} className={`${fieldCls} font-heading`} /></label>
            <label className="block space-y-1"><span className={`block ${LBL}`}>Sort order</span><input type="number" min="0" max="9999" value={draft.SortOrder} onChange={(e) => setDraft((d) => ({ ...d, SortOrder: e.target.value }))} className={`${fieldCls} tabular-nums`} /></label>
            {check(draft.IsCommercial, (v) => setDraft((d) => ({ ...d, IsCommercial: v, IsLand: v ? false : d.IsLand })), "Commercial (shop / office)")}
            <label className="block space-y-1"><span className={`block ${LBL}`}>Built on</span>
              <select value={draft.BuiltOn} disabled={draft.IsLand} onChange={(e) => setDraft((d) => ({ ...d, BuiltOn: e.target.value }))} className={fieldCls}>
                <option value="">Floors or plots</option>
                <option value="FLOORS">Floors (towers)</option>
                <option value="PLOTS">Plots (villas, bungalows)</option>
              </select>
            </label>
            {check(draft.IsLand, (v) => setDraft((d) => ({ ...d, IsLand: v, IsCommercial: v ? false : d.IsCommercial })), "Land (outside GST)")}
            {draft.Id > 0 && check(draft.IsActive, (v) => setDraft((d) => ({ ...d, IsActive: v })), "Active")}
            <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE_SOFT }}>
              {canCreate && <button onClick={() => edit()} className={`${KEY} border border-foreground text-foreground hover:bg-primary/10`}>New</button>}
              {mayWrite && (
                <button onClick={save} disabled={saving || !draft.Name.trim() || !draft.Code.trim()} className={`${KEY} bg-foreground text-card border border-foreground`}>
                  {saving ? "Saving…" : "Save"}
                </button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
