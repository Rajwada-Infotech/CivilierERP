import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { VILLA_TYPE_API, type VillaType } from "./VillaTypesDialog";

// A villa type's rooms, floor by floor (migration 539). A villa contains its
// floors — the reverse of a tower — so the plan is edited per floor: G, 1, 2 …
// Saving rebuilds the type's own room layout and brings villas already built
// to this type in line (missing rooms added with their DPR steps; every room
// placed on its floor). Rooms are never removed by a save.
type Category = { id: number; alias: string };
type Line = { key: string; storey: string; categoryId: string; quantity: string };

const fieldCls = "h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm";
const storeyRank = (s: string) => (s.toUpperCase() === "G" ? 0 : /^\d+$/.test(s) ? Number(s) : 1000);
const storeyName = (s: string) => (s.toUpperCase() === "G" ? "Ground floor" : /^\d+$/.test(s) ? `Floor ${s}` : s);
let seq = 0;
const newLine = (storey: string, categoryId = "", quantity = "1"): Line => ({ key: `l${++seq}`, storey, categoryId, quantity });

async function loadPlan(id: number): Promise<Line[]> {
  const r = await fetchWithAuth(`${VILLA_TYPE_API}/${id}/plan`);
  if (!r.ok) throw new Error("Could not load the room plan");
  const body = await r.json();
  return (body.rooms || []).map((x: any) => newLine(String(x.storey), String(x.categoryId), String(x.quantity)));
}

export function VillaRoomPlanEditor({ type, siblings, canEdit, onSaved, onClose }: {
  type: VillaType; siblings: VillaType[]; canEdit: boolean; onSaved: () => void; onClose: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [floors, setFloors] = useState<string[]>(["G", "1", "2"]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newFloor, setNewFloor] = useState("");

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["room-category-options"],
    queryFn: async () => {
      const r = await fetchWithAuth("/api/room-category-master/options");
      if (!r.ok) throw new Error("Could not load room types");
      return r.json();
    },
    staleTime: 60_000,
  });

  const applyLoaded = (loaded: Line[]) => {
    setLines(loaded);
    const fl = [...new Set(loaded.map((l) => l.storey))];
    setFloors(fl.length ? fl.sort((a, b) => storeyRank(a) - storeyRank(b)) : ["G", "1", "2"]);
  };

  useEffect(() => {
    let live = true;
    setLoading(true);
    loadPlan(type.Id).then((l) => { if (live) applyLoaded(l); }).catch((e) => toast.error(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [type.Id]);

  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0), [lines]);
  const set = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const copyFrom = async (id: number) => {
    try { const l = await loadPlan(id); applyLoaded(l.map((x) => newLine(x.storey, x.categoryId, x.quantity))); toast.success("Rooms copied — review and save"); }
    catch (e: any) { toast.error(e.message); }
  };

  const addFloor = () => {
    const f = newFloor.trim();
    if (!f) return;
    const v = f.toUpperCase() === "G" ? "G" : f;
    if (floors.includes(v)) { toast.error(`${storeyName(v)} is already listed`); return; }
    setFloors((fs) => [...fs, v].sort((a, b) => storeyRank(a) - storeyRank(b)));
    setNewFloor("");
  };

  const save = async () => {
    const rooms = lines.filter((l) => l.categoryId).map((l) => ({ storey: l.storey, categoryId: Number(l.categoryId), quantity: Number(l.quantity) }));
    if (!rooms.length) { toast.error("Add at least one room"); return; }
    if (rooms.some((r) => !(r.quantity >= 1 && r.quantity <= 20))) { toast.error("Quantity must be 1–20"); return; }
    setSaving(true);
    try {
      const r = await fetchWithAuth(`${VILLA_TYPE_API}/${type.Id}/plan`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rooms }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "Could not save the rooms");
      toast.success(`${type.Name}: ${body.roomCount} rooms saved` + (body.villasUpdated ? ` — ${body.villasUpdated} villa(s) updated, ${body.roomsAdded} room(s) added` : ""));
      onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Rooms by floor — {type.Code} · {type.Name}</p>
          <p className="text-xs text-muted-foreground">Each villa built to this type gets these rooms on these floors, with their DPR steps.</p>
        </div>
        <div className="flex items-center gap-2">
          {siblings.length > 0 && canEdit && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Copy size={13} />
              <select className="h-8 rounded-md border border-border bg-background px-2 text-xs" value=""
                onChange={(e) => e.target.value && copyFrom(Number(e.target.value))} aria-label="Copy rooms from another villa type">
                <option value="">Copy from…</option>
                {siblings.map((s) => <option key={s.Id} value={s.Id}>{s.Code} — {s.Name}</option>)}
              </select>
            </label>
          )}
          <button onClick={onClose} className="h-8 px-3 text-xs border border-border rounded-lg hover:bg-muted">Close</button>
        </div>
      </div>

      {loading ? <div className="h-24 rounded-lg bg-muted/40 animate-pulse" /> : (
        <div className="grid gap-3 md:grid-cols-3">
          {floors.map((f) => {
            const mine = lines.filter((l) => l.storey === f);
            return (
              <div key={f} className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-2 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">{storeyName(f)}</p>
                  <span className="text-[0.6875rem] text-muted-foreground tabular-nums">{mine.reduce((s, l) => s + (Number(l.quantity) || 0), 0)} rooms</span>
                </div>
                {mine.map((l) => (
                  <div key={l.key} className="flex items-center gap-1.5">
                    <select className={fieldCls} value={l.categoryId} disabled={!canEdit} onChange={(e) => set(l.key, { categoryId: e.target.value })} aria-label="Room type">
                      <option value="">Room type…</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.alias}</option>)}
                    </select>
                    <input type="number" min={1} max={20} className={`${fieldCls} w-16 tabular-nums`} value={l.quantity} disabled={!canEdit}
                      onChange={(e) => set(l.key, { quantity: e.target.value })} aria-label="Quantity" />
                    {canEdit && (
                      <button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="p-1.5 rounded text-destructive hover:bg-destructive/10" title="Remove"><Trash2 size={14} /></button>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <button onClick={() => setLines((ls) => [...ls, newLine(f)])} className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><Plus size={12} /> Add room</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex items-center gap-1.5">
            <input value={newFloor} onChange={(e) => setNewFloor(e.target.value)} placeholder="3, Roof…" maxLength={10}
              className="h-8 w-24 rounded-md border border-border bg-background px-2 text-xs" aria-label="New floor" />
            <button onClick={addFloor} className="h-8 px-2.5 text-xs border border-border rounded-md hover:bg-muted">Add floor</button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground tabular-nums">{total} rooms in total</span>
            <button onClick={save} disabled={saving} className="h-9 px-4 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Saving…" : "Save rooms"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
