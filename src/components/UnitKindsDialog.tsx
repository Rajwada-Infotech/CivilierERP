import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Unit kinds — Flat, Villa, Shop, Office… — managed from Unit Master. Each kind
// is land (outside GST), commercial (commercial GST rule) or neither
// (residential); never both. Kinds are data: nothing here lists them.

const API = "/api/unit-master/kinds";
type Kind = { Id: number; Code: string; Name: string; SortOrder?: number; IsActive?: boolean; IsLand?: boolean; IsCommercial?: boolean };
const empty = { Id: 0, Code: "", Name: "", SortOrder: "100", IsActive: true, IsLand: false, IsCommercial: false };
const fieldCls = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm";

export function UnitKindsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(empty);
  const [saving, setSaving] = useState(false);
  const { data: kinds = [] } = useQuery<Kind[]>({
    queryKey: ["unit-kinds", "manage"],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/manage`);
      if (!r.ok) throw new Error("Failed to load unit kinds");
      return r.json();
    },
    enabled: open,
  });

  const edit = (k?: Kind) => setDraft(k
    ? { Id: k.Id, Code: k.Code, Name: k.Name, SortOrder: String(k.SortOrder ?? 100), IsActive: k.IsActive !== false, IsLand: !!k.IsLand, IsCommercial: !!k.IsCommercial }
    : empty);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetchWithAuth(draft.Id ? `${API}/${draft.Id}` : API, {
        method: draft.Id ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, SortOrder: Number(draft.SortOrder) }),
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

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) edit(); }}>
      <DialogContent accent="crm" className="max-w-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings2 size={17} className="text-primary" /> Unit kinds</DialogTitle></DialogHeader>
        <p className="-mt-2 text-xs text-muted-foreground">What a unit is — flat, villa, shop, office… Commercial kinds use the commercial GST rule; land kinds are outside GST.</p>
        <div className="grid gap-4 md:grid-cols-[1fr_280px]">
          <div className="max-h-80 overflow-y-auto divide-y divide-border rounded-lg border border-border">
            {kinds.map((k) => (
              <button key={k.Id} onClick={() => edit(k)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40">
                <span className="font-medium">{k.Name}</span><span className="text-xs text-muted-foreground">{k.Code}</span>
                {k.IsLand && <span className="rounded bg-emerald-500/10 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-300">Land</span>}
                {k.IsCommercial && <span className="rounded bg-sky-500/10 px-1.5 text-[10px] text-sky-700 dark:text-sky-300">Commercial</span>}
                <span className="ml-auto text-xs text-muted-foreground">{k.IsActive === false ? "Inactive" : "Active"}</span>
              </button>
            ))}
          </div>
          <div className="space-y-3">
            <div><label className="mb-1 block text-xs text-muted-foreground">Name</label><input value={draft.Name} onChange={(e) => setDraft((d) => ({ ...d, Name: e.target.value }))} className={fieldCls} /></div>
            <div><label className="mb-1 block text-xs text-muted-foreground">Code</label><input value={draft.Code} onChange={(e) => setDraft((d) => ({ ...d, Code: e.target.value.toUpperCase() }))} className={fieldCls} /></div>
            <div><label className="mb-1 block text-xs text-muted-foreground">Sort order</label><input type="number" min="0" max="9999" value={draft.SortOrder} onChange={(e) => setDraft((d) => ({ ...d, SortOrder: e.target.value }))} className={fieldCls} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.IsCommercial} onChange={(e) => setDraft((d) => ({ ...d, IsCommercial: e.target.checked, IsLand: e.target.checked ? false : d.IsLand }))} /> Commercial (shop / office)</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.IsLand} onChange={(e) => setDraft((d) => ({ ...d, IsLand: e.target.checked, IsCommercial: e.target.checked ? false : d.IsCommercial }))} /> Land (outside GST)</label>
            {draft.Id > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.IsActive} onChange={(e) => setDraft((d) => ({ ...d, IsActive: e.target.checked }))} /> Active</label>}
            <div className="flex justify-end gap-2">
              <button onClick={() => edit()} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted">New</button>
              <button onClick={save} disabled={saving || !draft.Name.trim() || !draft.Code.trim()} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">{saving ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
