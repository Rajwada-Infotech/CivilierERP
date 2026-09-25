import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Minus, Plus, RotateCcw, Save, X, AlertTriangle } from "lucide-react";
import type { RoomCategory } from "@/api/roomCategoryMasterApi";
import {
  previewOverride, saveOverride, resetOverride,
  type OverrideScope, type OverridePreview,
} from "@/api/unitLayoutOverrideApi";
import {
  ownOverride, inheritedLayout, scopeLabel, compositionText, roomTotal,
  type Level, type Position, type LayoutOverrideRow, type CompositionRow,
} from "@/lib/layoutResolve";

// Same per-category cap the Unit Composition screen and the API enforce.
const MAX_ROOM_QTY = 10;

export interface NodeType { layoutTypeId: number; label: string; units: number; global: CompositionRow[] }

// Inline "Edit layout" strip shown directly under a Flat Master tree row.
// Edits ONE layout type's room list for this level (Project / Block / Floor
// range / Unit). The impact line updates live as counts change; Save
// applies exactly the numbers whose impact is on screen.
export function InlineLayoutEditor({
  level, position, types, overrides, categories, canEdit, onClose, onDirtyChange,
}: {
  level: Level;
  position: Position & { projectId: number };
  types: NodeType[];
  overrides: LayoutOverrideRow[];
  categories: RoomCategory[];
  canEdit: boolean;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const qc = useQueryClient();
  const [typeId, setTypeId] = React.useState<number>(types[0]?.layoutTypeId);
  const type = types.find((t) => t.layoutTypeId === typeId) ?? types[0];
  const own = type ? ownOverride(overrides, type.layoutTypeId, level, position) : null;
  const inherited = type ? inheritedLayout(overrides, type.global, type.layoutTypeId, level, position) : null;
  const current: CompositionRow[] = own?.composition ?? inherited?.composition ?? [];

  // Floor rows: a new override starts as this one floor, optionally extended
  // "up to floor N"; an existing range is edited as that whole range.
  const [upTo, setUpTo] = React.useState<string>("");
  const scope: OverrideScope | null = React.useMemo(() => {
    if (!type) return null;
    const base = { ProjectId: position.projectId };
    if (level === "PROJECT") return { ...base, ScopeLevel: "PROJECT" };
    if (level === "BLOCK") return { ...base, ScopeLevel: "BLOCK", BlockId: position.blockId! };
    if (level === "UNIT") return { ...base, ScopeLevel: "UNIT", BlockId: position.blockId!, UnitId: position.unitId! };
    if (own) return { ...base, ScopeLevel: "FLOOR", BlockId: position.blockId!, FloorFrom: own.FloorFrom!, FloorTo: own.FloorTo! };
    const to = parseInt(upTo, 10);
    return {
      ...base, ScopeLevel: "FLOOR", BlockId: position.blockId!,
      FloorFrom: position.floorNo!, FloorTo: Number.isInteger(to) && to >= position.floorNo! ? to : position.floorNo!,
    };
  }, [type, level, position, own, upTo]);

  const [qty, setQty] = React.useState<Record<number, number>>({});
  React.useEffect(() => {
    const q: Record<number, number> = {};
    current.forEach((c) => { q[c.categoryId] = c.quantity; });
    setQty(q);
    setUpTo("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeId, own?.Id]);

  const items = categories.map((c) => ({ roomCategoryId: c.id, quantity: qty[c.id] ?? 0 }));
  const total = items.reduce((s, i) => s + i.quantity, 0);
  const currentMap = new Map(current.map((c) => [c.categoryId, c.quantity]));
  const countsChanged = categories.some((c) => (qty[c.id] ?? 0) !== (currentMap.get(c.id) ?? 0));
  // A new floor range with unchanged counts is still a change (it pins them).
  const dirty = countsChanged || (level === "FLOOR" && !own && upTo !== "" && scope?.FloorTo !== position.floorNo);
  React.useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  // Live impact — debounced; a response for anything but the latest request is dropped.
  const [preview, setPreview] = React.useState<{ key: string; data: OverridePreview } | null>(null);
  const [previewError, setPreviewError] = React.useState<string>("");
  const [loadingPreview, setLoadingPreview] = React.useState(false);
  const seq = React.useRef(0);
  const key = JSON.stringify({ scope, typeId, items });
  React.useEffect(() => {
    setPreviewError("");
    if (!scope || !type || !dirty || total === 0) { setPreview(null); setLoadingPreview(false); return; }
    const my = ++seq.current;
    setLoadingPreview(true);
    const t = setTimeout(async () => {
      try {
        const data = await previewOverride(scope, type.layoutTypeId, items);
        if (my === seq.current) setPreview({ key, data });
      } catch (e: any) {
        if (my === seq.current) { setPreview(null); setPreviewError(e.message); }
      } finally {
        if (my === seq.current) setLoadingPreview(false);
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dirty, total]);
  const previewReady = preview?.key === key && !loadingPreview;

  const [busy, setBusy] = React.useState<"" | "save" | "reset" | "reset-preview">("");
  const [resetImpact, setResetImpact] = React.useState<OverridePreview | null>(null);

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["layout-overrides-project"] }),
    qc.invalidateQueries({ queryKey: ["room-master"] }),
    qc.invalidateQueries({ queryKey: ["room-master-unit-rooms"] }),
  ]);

  const save = async () => {
    if (!scope || !type || !previewReady || preview?.data.overlap) return;
    setBusy("save");
    try {
      const r = await saveOverride(scope, type.layoutTypeId, items);
      toast.success(`${type.label} layout saved for ${r.units} unit(s): +${r.roomsAdded} / −${r.roomsRemoved} room(s)`);
      if (r.failed) toast.error(`${r.failed} unit(s) couldn't be updated — check the server log.`);
      await refresh();
      onDirtyChange(false);
      onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(""); }
  };

  const askReset = async () => {
    if (!scope || !type) return;
    setBusy("reset-preview");
    try { setResetImpact(await previewOverride(scope, type.layoutTypeId, null)); } catch (e: any) { toast.error(e.message); } finally { setBusy(""); }
  };
  const confirmReset = async () => {
    if (!scope || !type) return;
    setBusy("reset");
    try {
      const r = await resetOverride(scope, type.layoutTypeId);
      toast.success(`${type.label} back to the inherited layout for ${r.units} unit(s): +${r.roomsAdded} / −${r.roomsRemoved} room(s)`);
      await refresh();
      onDirtyChange(false);
      onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(""); }
  };

  // Cancel / Esc never silently drop unsaved counts.
  const requestClose = React.useCallback(() => {
    if (busy !== "") return;
    if (dirty && !window.confirm("Discard the unsaved layout changes?")) return;
    onClose();
  }, [busy, dirty, onClose]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") requestClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  if (!type) {
    return <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/20 border-y border-border">No units with a Unit Type here.</div>;
  }

  const btn = "inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors disabled:opacity-40";
  const impact = (p: OverridePreview, verb: string) => (
    <span>
      <span className="font-semibold">{p.unitsChanged}</span> of {p.unitsInScope} unit(s) {verb} ·{" "}
      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">+{p.roomsToAdd}</span> /{" "}
      <span className="text-amber-600 dark:text-amber-400 font-semibold">−{p.roomsToRemove}</span> room(s)
      {p.unitsShadowed > 0 && <span className="text-muted-foreground"> · {p.unitsShadowed} keep their own layout</span>}
      {p.roomsKeptWithWork.length > 0 && (
        <span className="text-amber-600 dark:text-amber-400"> · keeps {p.roomsKeptWithWork.length} room(s) with DPR work
          <span className="text-muted-foreground"> ({p.roomsKeptWithWork.slice(0, 3).join(", ")}{p.roomsKeptWithWork.length > 3 ? "…" : ""})</span></span>
      )}
    </span>
  );

  return (
    <div className="border-y border-cyan-500/30 bg-cyan-500/[0.04] px-4 py-2.5 space-y-2 text-xs" style={{ paddingLeft: 16 + (RANK_DEPTH[level] + 1) * 20 }}>
      <div className="flex flex-wrap items-center gap-2">
        {types.length > 1 ? (
          <select value={type.layoutTypeId} onChange={(e) => setTypeId(Number(e.target.value))} disabled={busy !== ""}
            className="h-7 rounded-md border border-border bg-background px-1.5 text-[11px]">
            {types.map((t) => <option key={t.layoutTypeId} value={t.layoutTypeId}>{t.label} ({t.units})</option>)}
          </select>
        ) : (
          <span className="font-semibold">{type.label} <span className="font-normal text-muted-foreground">({type.units} unit{type.units === 1 ? "" : "s"})</span></span>
        )}
        {categories.map((c) => {
          const n = qty[c.id] ?? 0;
          return (
            <span key={c.id} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${n !== (currentMap.get(c.id) ?? 0) ? "border-cyan-500/60" : "border-border"} ${n === 0 ? "opacity-60" : ""}`}>
              <span>{c.alias}</span>
              <button type="button" aria-label={`Fewer ${c.alias}`} disabled={!canEdit || busy !== "" || n <= 0}
                onClick={() => setQty((q) => ({ ...q, [c.id]: Math.max(0, n - 1) }))}
                className="w-5 h-5 rounded border border-border flex items-center justify-center disabled:opacity-30"><Minus size={10} /></button>
              <span className="w-4 text-center font-semibold tabular-nums">{n}</span>
              <button type="button" aria-label={`More ${c.alias}`} disabled={!canEdit || busy !== "" || n >= MAX_ROOM_QTY}
                onClick={() => setQty((q) => ({ ...q, [c.id]: Math.min(MAX_ROOM_QTY, n + 1) }))}
                className="w-5 h-5 rounded border border-border flex items-center justify-center disabled:opacity-30"><Plus size={10} /></button>
            </span>
          );
        })}
        {level === "FLOOR" && !own && (
          <label className="inline-flex items-center gap-1 text-muted-foreground">
            up to floor
            <input value={upTo} onChange={(e) => setUpTo(e.target.value)} type="number" min={position.floorNo ?? 0} placeholder={String(position.floorNo)}
              disabled={!canEdit || busy !== ""} className="h-6 w-14 rounded border border-border bg-background px-1 text-[11px]" />
          </label>
        )}
      </div>

      <div className="text-muted-foreground">
        {own
          ? <>Custom layout for <span className="font-medium text-foreground">{scopeLabel(own)}</span>{own.ScopeLevel === "FLOOR" && own.FloorFrom !== own.FloorTo ? " (shared range)" : ""}. </>
          : <>Currently inherited. </>}
        Inherited from <span className="font-medium text-foreground">{inherited?.override ? `${scopeLabel(inherited.override)} override` : "Unit Composition"}</span>: {compositionText(inherited?.composition ?? []) || "no rooms"} ({roomTotal(inherited?.composition ?? [])} rooms)
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[16rem]">
          {resetImpact ? (
            <span className="text-foreground">Reset: {impact(resetImpact, "change")}</span>
          ) : !dirty ? (
            <span className="text-muted-foreground">No changes — adjust the counts above.</span>
          ) : total === 0 ? (
            <span className="text-destructive">A layout needs at least one room.</span>
          ) : previewError ? (
            <span className="text-destructive">{previewError}</span>
          ) : loadingPreview || !previewReady ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 size={11} className="animate-spin" /> Checking impact…</span>
          ) : preview!.data.overlap ? (
            <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle size={11} /> Overlaps the existing {preview!.data.overlap.label} override — pick a different range.</span>
          ) : (
            <span className="text-foreground">{impact(preview!.data, "change")}</span>
          )}
        </div>
        {canEdit && (resetImpact ? (
          <>
            <button type="button" onClick={confirmReset} disabled={busy !== ""} className={`${btn} bg-amber-500 text-white hover:bg-amber-600`}>
              {busy === "reset" ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />} Confirm reset
            </button>
            <button type="button" onClick={() => setResetImpact(null)} disabled={busy !== ""} className={`${btn} border border-border hover:bg-muted`}>Back</button>
          </>
        ) : (
          <>
            {own && (
              <button type="button" onClick={askReset} disabled={busy !== ""} className={`${btn} border border-border hover:bg-muted`}>
                {busy === "reset-preview" ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />} Reset to inherited
              </button>
            )}
            <button type="button" onClick={save} disabled={busy !== "" || !dirty || total === 0 || !previewReady || !!preview?.data.overlap}
              className={`${btn} bg-gradient-to-r from-cyan-500 to-teal-400 text-white hover:opacity-90`}>
              {busy === "save" ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
            </button>
          </>
        ))}
        <button type="button" onClick={requestClose} disabled={busy !== ""} className={`${btn} border border-border hover:bg-muted`}>
          <X size={11} /> {canEdit ? "Cancel" : "Close"}
        </button>
      </div>
    </div>
  );
}

const RANK_DEPTH: Record<Level, number> = { PROJECT: 0, BLOCK: 1, FLOOR: 2, UNIT: 3 };
