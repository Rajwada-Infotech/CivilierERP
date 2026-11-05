import { useEffect, useMemo, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { RULE, RULE_SOFT, LBL, KEY_INK, KEY_LINE, INP } from "./customers/config";
import { useSheetAsk } from "@/components/sheet/SheetAsk";
import { VILLA_TYPE_API, type VillaType } from "./VillaTypesDialog";
import { storeyDisplay, storeyRank } from "@/lib/floorLabel";

// A villa type's rooms, floor by floor (migration 539). A villa contains its
// floors — the reverse of a tower — so the plan is edited per floor: G, 1, 2 …
// Saving rebuilds the type's own room layout and brings villas already built
// to this type in line (missing rooms added with their DPR steps; every room
// placed on its floor). Rooms are never removed by a save.
type Category = { id: number; alias: string };
type Line = { key: string; storey: string; categoryId: string; quantity: string };



// Floor names and order are shared with every other screen (src/lib/floorLabel.ts).
const storeyName = storeyDisplay;
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";

let seq = 0;
const newLine = (storey: string, categoryId = "", quantity = "1"): Line => ({
  key: `l${++seq}`,
  storey,
  categoryId,
  quantity,
});

async function loadPlan(id: number): Promise<Line[]> {
  const r = await fetchWithAuth(`${VILLA_TYPE_API}/${id}/plan`);
  if (!r.ok) throw new Error("Could not load the room plan");
  const body = await r.json();
  return (body.rooms || []).map((x: any) =>
    newLine(String(x.storey), String(x.categoryId), String(x.quantity))
  );
}

/** Build a sorted floor list from "G + N" shorthand (e.g. upperCount=2 → G,1,2). */
function buildFloorList(upperCount: number, hasBasement: boolean, hasRoof: boolean): string[] {
  const list: string[] = [];
  if (hasBasement) list.push("B");
  list.push("G");
  for (let i = 1; i <= upperCount; i++) list.push(String(i));
  if (hasRoof) list.push("Roof");
  return list;
}

export function VillaRoomPlanEditor({
  type,
  siblings,
  canEdit,
  onSaved,
  onClose,
}: {
  type: VillaType;
  siblings: VillaType[];
  canEdit: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [floors, setFloors] = useState<string[]>(["G", "1", "2"]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // After a save: built villas of this type that lack rooms of the new plan.
  const [behind, setBehind] = useState<{ villas: number; rooms: number } | null>(null);
  const [updatingVillas, setUpdatingVillas] = useState(false);
  const villasUrl = `/api/crm/project-auto-setup/projects/${type.ProjectId}/villas/add-missing-rooms?villaTypeId=${type.Id}`;
  // Asked on the sheet (components/sheet/SheetAsk), in place of window.confirm.
  const ask = useSheetAsk();
  const requestConfirm = (msg: string, onOk: () => void) => { void ask.confirm(msg, { title: "Confirm Action", okLabel: "Confirm" }).then((yes) => { if (yes) onOk(); }); };
  const checkBuiltVillas = async () => {
    if (!type.VillaCount) { setBehind(null); return; }
    const r = await fetchWithAuth(`${villasUrl}&dryRun=1`, { method: "POST" });
    const b = await r.json().catch(() => ({}));
    setBehind(r.ok && b.roomsAdded ? { villas: (b.changed || []).length, rooms: b.roomsAdded } : null);
  };
  const updateBuiltVillas = async () => {
    if (!behind) return;
    // Asked on the sheet (useSheetAsk).
    requestConfirm(
      `Add ${behind.rooms} room(s) to ${behind.villas} built ${type.Code} villa(s)? Only missing rooms are added — existing rooms, their names and their DPR work stay exactly as they are.`,
      async () => {
        setUpdatingVillas(true);
        try {
          const r = await fetchWithAuth(villasUrl, { method: "POST" });
          const b = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(b.error || "Could not update the villas");
          toast.success(`${b.roomsAdded} room(s) added to ${(b.changed || []).length} villa(s)` + (b.failed?.length ? ` — ${b.failed.length} left unchanged: ${b.failed[0]}` : ""));
          setBehind(null);
          onSaved();
        } catch (e: any) { toast.error(e.message); } finally { setUpdatingVillas(false); }
      }
    );
  };

  // Floor-builder state
  const [upperCount, setUpperCount] = useState(2); // G + N upper floors
  const [hasBasement, setHasBasement] = useState(false);
  const [hasRoof, setHasRoof] = useState(false);
  const [customFloor, setCustomFloor] = useState("");

  const customRef = useRef<HTMLInputElement>(null);

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["room-category-options"],
    queryFn: async () => {
      const r = await fetchWithAuth("/api/room-category-master/options");
      if (!r.ok) throw new Error("Could not load room types");
      return r.json();
    },
    staleTime: 60_000,
  });

  // Room types that already have a DPR step list (null until loaded).
  const { data: dprRows } = useQuery<{ categoryId: number }[]>({
    queryKey: ["villa-dpr-ready-categories", type.ProjectId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${VILLA_TYPE_API}/dpr-ready-categories?projectId=${type.ProjectId}`);
      if (!r.ok) throw new Error("Could not load DPR readiness");
      return r.json();
    },
    staleTime: 60_000,
  });
  const dprReady = useMemo(() => (dprRows ? new Set(dprRows.map((r) => r.categoryId)) : null), [dprRows]);

  const applyLoaded = (loaded: Line[]) => {
    setLines(loaded);
    const fl = [...new Set(loaded.map((l) => l.storey))];
    const sorted = fl.length
      ? fl.sort((a, b) => storeyRank(a) - storeyRank(b))
      : ["G", "1", "2"];
    setFloors(sorted);
    // Sync floor builder controls from loaded plan
    setHasBasement(sorted.some((f) => f.toUpperCase() === "B"));
    setHasRoof(sorted.some((f) => f.toLowerCase() === "roof"));
    const numbered = sorted.filter((f) => /^\d+$/.test(f));
    if (numbered.length > 0) setUpperCount(Math.max(...numbered.map(Number)));
  };

  useEffect(() => {
    let live = true;
    setLoading(true);
    loadPlan(type.Id)
      .then((l) => { if (live) applyLoaded(l); })
      .catch((e) => toast.error(e.message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [type.Id]);

  const total = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0),
    [lines]
  );

  /** True when the floor builder's intended list differs from the current floor list. */
  const builderFloors = useMemo(
    () => buildFloorList(upperCount, hasBasement, hasRoof),
    [upperCount, hasBasement, hasRoof]
  );
  const isFloorDirty = useMemo(
    () =>
      builderFloors.length !== floors.length ||
      builderFloors.some((f, i) => f !== floors[i]),
    [builderFloors, floors]
  );

  const set = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const copyFrom = async (id: number) => {
    try {
      const l = await loadPlan(id);
      applyLoaded(l.map((x) => newLine(x.storey, x.categoryId, x.quantity)));
      toast.success("Rooms copied — review and save");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // Apply the G + N builder to create/update floors (keeps existing room lines)
  const applyFloorBuilder = () => {
    const next = buildFloorList(upperCount, hasBasement, hasRoof);
    // Keep room lines that still belong to a retained floor; orphaned lines are dropped
    setLines((ls) => ls.filter((l) => next.includes(l.storey)));
    setFloors(next);
  };

  // Add a single custom floor (Roof, Terrace, Mezzanine, etc.)
  const addCustomFloor = () => {
    const raw = customFloor.trim();
    if (!raw) return;
    const v = raw.toUpperCase() === "G" ? "G" : raw.toUpperCase() === "B" ? "B" : raw;
    if (floors.includes(v)) {
      toast.error(`${storeyName(v)} is already in the list`);
      return;
    }
    setFloors((fs) => [...fs, v].sort((a, b) => storeyRank(a) - storeyRank(b)));
    setCustomFloor("");
    customRef.current?.focus();
  };

  // Remove a floor (and its room lines)
  const removeFloor = (f: string) => {
    setFloors((fs) => fs.filter((x) => x !== f));
    setLines((ls) => ls.filter((l) => l.storey !== f));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { checkBuiltVillas().catch(() => {}); }, [type.Id]);

  const save = async () => {
    const blank = lines.filter((l) => !l.categoryId);
    if (blank.length) {
      toast.error(`Choose a room type for every row, or remove the empty one${blank.length > 1 ? "s" : ""} (${[...new Set(blank.map((l) => storeyName(l.storey)))].join(", ")})`);
      return;
    }
    const rooms = lines
      .filter((l) => l.categoryId)
      .map((l) => ({
        storey: l.storey,
        categoryId: Number(l.categoryId),
        quantity: Number(l.quantity),
      }));
    if (!rooms.length) { toast.error("Add at least one room"); return; }
    if (rooms.some((r) => !(r.quantity >= 1 && r.quantity <= 20))) {
      toast.error("Quantity must be 1–20");
      return;
    }
    setSaving(true);
    try {
      const r = await fetchWithAuth(`${VILLA_TYPE_API}/${type.Id}/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rooms }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "Could not save the rooms");
      toast.success(
        `${type.Name}: ${body.roomCount} rooms saved` +
          (body.villasUpdated
            ? ` — ${body.villasUpdated} villa(s) updated, ${body.roomsAdded} room(s) added`
            : " — villas converted from now on get this plan; villas already built keep their rooms")
      );
      onSaved();
      await checkBuiltVillas();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <div className="bg-card p-4 space-y-4" style={{ border: RULE, boxShadow: "inset 3px 0 0 hsl(var(--foreground))" }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={HEAD}>Rooms by floor — {type.Code} · {type.Name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Each plot converted to this type gets these rooms on these floors, with their DPR steps. Villas already built keep theirs — after saving you can add the new rooms to them.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {siblings.length > 0 && canEdit && (
            <select value="" onChange={(e) => e.target.value && copyFrom(Number(e.target.value))} className={`${INP} !w-52 !text-xs`} aria-label="Copy rooms from another type">
              <option value="">Copy from another type…</option>
              {siblings.map((s) => <option key={s.Id} value={String(s.Id)}>{s.Code} — {s.Name}</option>)}
            </select>
          )}
          <button
            onClick={onClose}
            className={`${KEY_LINE} h-9 px-3`}
          >
            Close
          </button>
        </div>
      </div>

      {/* ── Floor Structure Builder ─────────────────────────────── */}
      {canEdit && (
        <div className="p-3 space-y-3" style={{ border: RULE_SOFT }}>
          <p className={LBL}>Floor structure</p>

          {/* Quick G + N builder */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">G +</span>
              <input
                type="number"
                min={0}
                max={30}
                value={upperCount}
                onChange={(e) => setUpperCount(Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
                className={`${INP} !w-16 text-center font-heading tabular-nums`}
                title="Number of upper floors above ground"
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">upper floors</span>
            </div>

            <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hasBasement}
                onChange={(e) => setHasBasement(e.target.checked)}
                className="h-3.5 w-3.5 accent-foreground"
              />
              <span>+ Basement</span>
            </label>

            <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hasRoof}
                onChange={(e) => setHasRoof(e.target.checked)}
                className="h-3.5 w-3.5 accent-foreground"
              />
              <span>+ Roof terrace</span>
            </label>

            <button
              onClick={applyFloorBuilder}
              disabled={!isFloorDirty}
              title={isFloorDirty ? "Apply the new floor structure" : "Floor structure is already up to date"}
              className={`${isFloorDirty ? KEY_INK : KEY_LINE} h-9 px-4`}
            >
              {isFloorDirty ? "Apply" : "Applied"}
            </button>
          </div>

          {/* Current floors as chips + add custom */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={LBL}>Floors</span>
            {floors.map((f) => {
              const hasRooms = lines.some((l) => l.storey === f);
              return (
                <span
                  key={f}
                  className={`inline-flex items-center gap-1 h-7 px-2.5 text-xs font-medium border ${
                    hasRooms
                      ? "border-foreground bg-primary/10 text-foreground"
                      : "border-foreground/30 bg-card text-muted-foreground"
                  }`}
                >
                  {storeyName(f)}
                  <button
                    onClick={() => removeFloor(f)}
                    title={hasRooms ? "Remove floor and its rooms" : "Remove floor"}
                    className="ml-0.5 hover:text-destructive"
                  >
                    <X size={11} />
                  </button>
                </span>
              );
            })}
            {/* Add custom floor inline */}
            <div className="flex items-center gap-1">
              <input
                ref={customRef}
                value={customFloor}
                onChange={(e) => setCustomFloor(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustomFloor()}
                placeholder="e.g. Terrace"
                maxLength={20}
                className="h-7 w-28 border border-dashed border-foreground/40 bg-card px-2.5 text-xs outline-none focus:border-foreground"
              />
              <button
                onClick={addCustomFloor}
                className="inline-flex items-center gap-0.5 text-xs underline underline-offset-2"
              >
                <Plus size={11} /> Add
              </button>
            </div>
          </div>

          <p className="text-[0.6875rem] text-muted-foreground">
            <strong>G + {upperCount}</strong> = Ground floor
            {upperCount > 0 ? ` + Floor 1 through Floor ${upperCount}` : " only"}
            {hasBasement ? " + Basement" : ""}
            {hasRoof ? " + Roof terrace" : ""}
            . Floors with a washed tag already have rooms.
          </p>
        </div>
      )}

      {/* ── Floors, bottom to top, each full width ─────────────── */}
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading the room plan…</p>
      ) : floors.length === 0 ? (
        <div className="border border-dashed border-foreground/30 p-6 text-center text-sm text-muted-foreground">
          No floors defined yet. Use the floor structure above to add floors.
        </div>
      ) : (
        <div className="space-y-3">
          {floors.map((f) => {
            const mine = lines.filter((l) => l.storey === f);
            const floorRooms = mine.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
            const usedHere = new Set(mine.map((l) => l.categoryId).filter(Boolean));
            return (
              <div key={f} className="bg-card" style={{ border: RULE_SOFT }}>
                <div className="flex items-center justify-between gap-2 px-3 py-2" style={{ borderBottom: RULE_SOFT }}>
                  <p className={HEAD}>{storeyName(f)}</p>
                  <span className="text-xs text-muted-foreground font-heading tabular-nums">
                    {floorRooms} room{floorRooms !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="p-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {mine.map((l) => {
                    const noDpr = !!l.categoryId && dprReady != null && !dprReady.has(Number(l.categoryId));
                    return (
                      <div key={l.key} className={`flex items-center gap-2 border p-1.5 ${noDpr ? "border-foreground" : "border-foreground/20"}`}
                        style={{ boxShadow: noDpr ? "inset 3px 0 0 hsl(var(--foreground))" : undefined }}>
                        <div className="flex-1 min-w-0">
                          <select value={l.categoryId} onChange={(e) => set(l.key, { categoryId: e.target.value })} disabled={!canEdit} className={`${INP} disabled:opacity-60`}>
                            <option value="" disabled>Room type…</option>
                            {categories.map((c) => (
                              <option key={c.id} value={String(c.id)} disabled={usedHere.has(String(c.id)) && String(c.id) !== l.categoryId}>
                                {c.alias}{dprReady != null && !dprReady.has(c.id) ? "  · no DPR steps yet" : ""}
                              </option>
                            ))}
                          </select>
                          {noDpr && <p className="mt-1 px-1 text-[0.6875rem] text-foreground">No DPR step list for this room type yet — set one in Dependency Master.</p>}
                        </div>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          className={`${INP} !w-16 shrink-0 text-center font-heading tabular-nums self-start disabled:opacity-60`}
                          value={l.quantity}
                          disabled={!canEdit}
                          onChange={(e) => set(l.key, { quantity: e.target.value })}
                          aria-label={`How many on ${storeyName(f)}`}
                          title="How many"
                        />
                        {canEdit && (
                          <button
                            onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                            className="w-9 h-9 inline-flex items-center justify-center border border-transparent text-destructive hover:border-destructive shrink-0 self-start"
                            title="Remove room"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {canEdit && (
                    <button
                      onClick={() => setLines((ls) => [...ls, newLine(f)])}
                      className="h-[50px] inline-flex items-center justify-center gap-1.5 border border-dashed border-foreground/40 text-xs font-heading font-semibold uppercase tracking-[0.1em] hover:bg-primary/5"
                    >
                      <Plus size={14} /> Add room on {storeyName(f)}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {behind && canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-card" style={{ border: RULE, boxShadow: "inset 3px 0 0 hsl(var(--foreground))" }}>
          <span className="text-xs text-foreground">
            {behind.villas} built {type.Code} villa{behind.villas === 1 ? " is" : "s are"} missing {behind.rooms} room{behind.rooms === 1 ? "" : "s"} of this plan.
          </span>
          <button type="button" onClick={updateBuiltVillas} disabled={updatingVillas}
            className={`${KEY_INK} h-8 px-3`}>
            {updatingVillas ? "Adding…" : "Add the new rooms to them"}
          </button>
        </div>
      )}
      {/* ── Save footer ────────────────────────────────────────── */}
      {canEdit && (
        <div className="flex items-center justify-between gap-3 pt-3" style={{ borderTop: RULE_SOFT }}>
          <span className="text-xs text-muted-foreground tabular-nums">
            {total} room{total !== 1 ? "s" : ""} in total across {floors.length} floor{floors.length !== 1 ? "s" : ""}
          </span>
          <button
            onClick={save}
            disabled={saving}
            className={`${KEY_INK} h-9 px-5`}
          >
            {saving ? "Saving…" : "Save rooms"}
          </button>
        </div>
      )}
    </div>
    {ask.node}
    </>
  );
}
