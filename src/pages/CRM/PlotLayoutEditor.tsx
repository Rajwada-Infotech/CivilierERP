import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Minus, Move, Network, Plus, RotateCcw, Save, Sparkles, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const PLOT_API = "/api/plot-master";
const MAX_GRID = 60;
const DEFAULT_COLS = 8;

// "P-2" before "P-10". Used by the page and the editor so every list agrees on order.
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
export const naturalCompare = (a: unknown, b: unknown) => collator.compare(String(a ?? ""), String(b ?? ""));
export const plotOrder = (a: { PlotName: string; PlotNo: string }, b: { PlotName: string; PlotNo: string }) =>
  naturalCompare(a.PlotName, b.PlotName) || naturalCompare(a.PlotNo, b.PlotNo);

export type LayoutPlot = {
  Id: number; PlotNo: string; PlotName: string; AreaSqFt?: number | null; Facing?: string | null;
  GridRow?: number | null; GridCol?: number | null; ConvertedUnitId?: number | null;
  LockBookingNo?: string | null; LockApplicationNo?: string | null; LockHoldId?: number | null;
};
type Cell = { r: number; c: number };
type LayoutResponse = { GridRows: number | null; GridCols: number | null; Adjacency: { PlotId: number; AdjacentPlotId: number }[] };
type Mode = "arrange" | "neighbours";

const linkKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

function tone(plot: LayoutPlot) {
  if (plot.ConvertedUnitId) return "border-violet-500/50 bg-violet-500/10";
  if (plot.LockBookingNo) return "border-red-500/50 bg-red-500/10";
  if (plot.LockApplicationNo || plot.LockHoldId) return "border-amber-500/50 bg-amber-500/10";
  return "border-emerald-500/50 bg-emerald-500/10";
}

async function fetchLayout(blockId: number): Promise<LayoutResponse> {
  const response = await fetchWithAuth(`${PLOT_API}/layout/${blockId}`);
  if (!response.ok) throw new Error("Could not load the block layout");
  return response.json();
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockId: number | null;
  title: string;
  plots: LayoutPlot[];
  initialMode?: Mode;
  initialFocusId?: number | null;
  onSaved: () => void;
};

export function PlotLayoutEditor({ open, onOpenChange, blockId, title, plots, initialMode = "arrange", initialFocusId = null, onSaved }: Props) {
  const { data: layout, isLoading, isFetching, error } = useQuery({
    queryKey: ["plot-layout", blockId],
    queryFn: () => fetchLayout(blockId as number),
    enabled: open && blockId != null,
    staleTime: 0,
  });

  const [rows, setRows] = useState(1);
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [pos, setPos] = useState<Record<number, Cell>>({});
  const [pairs, setPairs] = useState<Set<string>>(new Set());
  const [linksTouched, setLinksTouched] = useState(false);
  const [mode, setMode] = useState<Mode>("arrange");
  const [focusId, setFocusId] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [diagonals, setDiagonals] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const initialised = useRef<number | null>(null);

  const byId = useMemo(() => new Map(plots.map((plot) => [plot.Id, plot])), [plots]);
  const sorted = useMemo(() => [...plots].sort(plotOrder), [plots]);

  // Load once per open. A refetch of the plot list while the dialog is open must not
  // throw away what the user has dragged but not saved yet.
  useEffect(() => {
    if (!open) { initialised.current = null; return; }
    // isFetching: after a save, the cached layout is stale until the refetch lands.
    if (!layout || isFetching || blockId == null || initialised.current === blockId) return;
    initialised.current = blockId;

    const placed = sorted.filter((plot) => plot.GridRow != null && plot.GridCol != null);
    const next: Record<number, Cell> = {};
    placed.forEach((plot) => { next[plot.Id] = { r: plot.GridRow as number, c: plot.GridCol as number }; });
    const usedCols = placed.reduce((m, plot) => Math.max(m, (plot.GridCol as number) + 1), 0);
    const usedRows = placed.reduce((m, plot) => Math.max(m, (plot.GridRow as number) + 1), 0);
    let nextRows = Math.min(MAX_GRID, Math.max(layout.GridRows ?? 0, usedRows, 1));
    let nextCols = Math.min(MAX_GRID, Math.max(layout.GridCols ?? 0, usedCols, 1));
    let startDirty = false;

    if (placed.length === 0 && sorted.length > 0) {
      // First time this block is opened: lay the plots out in natural order so the
      // user starts from something tidy and only drags the exceptions.
      nextCols = Math.min(DEFAULT_COLS, Math.max(1, sorted.length));
      nextRows = Math.max(1, Math.ceil(sorted.length / nextCols));
      sorted.forEach((plot, i) => { next[plot.Id] = { r: Math.floor(i / nextCols), c: i % nextCols }; });
      startDirty = true;
    }
    setPos(next); setRows(nextRows); setCols(nextCols);
    setPairs(new Set(layout.Adjacency.map((row) => linkKey(row.PlotId, row.AdjacentPlotId))));
    setLinksTouched(false); setDirty(startDirty); setPicked(null); setDragId(null);
    setMode(initialMode); setFocusId(initialFocusId);
  }, [open, layout, isFetching, blockId, sorted, initialMode, initialFocusId]);

  const cellMap = useMemo(() => {
    const map = new Map<string, number>();
    Object.entries(pos).forEach(([id, cell]) => map.set(`${cell.r}:${cell.c}`, Number(id)));
    return map;
  }, [pos]);
  const unplaced = useMemo(() => sorted.filter((plot) => !pos[plot.Id]), [sorted, pos]);
  const linkCount = useMemo(() => {
    const counts = new Map<number, number>();
    pairs.forEach((key) => key.split("-").map(Number).forEach((id) => counts.set(id, (counts.get(id) || 0) + 1)));
    return counts;
  }, [pairs]);
  const focusPlot = focusId != null ? byId.get(focusId) : undefined;
  const focusNeighbours = useMemo(() => {
    if (focusId == null) return [] as LayoutPlot[];
    return [...pairs].map((key) => key.split("-").map(Number)).filter(([a, b]) => a === focusId || b === focusId)
      .map(([a, b]) => byId.get(a === focusId ? b : a)).filter(Boolean).sort((a, b) => plotOrder(a as LayoutPlot, b as LayoutPlot)) as LayoutPlot[];
  }, [pairs, focusId, byId]);

  const touch = () => setDirty(true);

  const placeAt = (id: number, r: number, c: number) => {
    setPos((current) => {
      const next = { ...current };
      const occupant = Object.keys(next).map(Number).find((pid) => pid !== id && next[pid].r === r && next[pid].c === c);
      const from = next[id];
      // Dropping on an occupied cell swaps; if the dragged plot came from the tray the occupant goes there.
      if (occupant !== undefined) { if (from) next[occupant] = { ...from }; else delete next[occupant]; }
      next[id] = { r, c };
      return next;
    });
    setPicked(null); touch();
  };
  const toTray = (id: number) => { setPos((current) => { const next = { ...current }; delete next[id]; return next; }); setPicked(null); touch(); };

  const resize = (axis: "rows" | "cols", delta: number) => {
    const current = axis === "rows" ? rows : cols;
    const target = current + delta;
    if (target < 1 || target > MAX_GRID) return;
    if (delta < 0) {
      const blocked = Object.values(pos).some((cell) => (axis === "rows" ? cell.r : cell.c) >= target);
      if (blocked) { toast.error(`${axis === "rows" ? "Row" : "Column"} ${current} still holds plots - move them out first`); return; }
    }
    (axis === "rows" ? setRows : setCols)(target); touch();
  };

  const autoArrange = () => {
    const width = Math.max(1, cols);
    const needed = Math.ceil(sorted.length / width);
    if (needed > MAX_GRID) { toast.error("Too many plots for this many columns - add columns first"); return; }
    const next: Record<number, Cell> = {};
    sorted.forEach((plot, i) => { next[plot.Id] = { r: Math.floor(i / width), c: i % width }; });
    setPos(next); setRows(Math.max(1, needed)); setPicked(null); touch();
    toast.success(`Arranged ${sorted.length} plots in order, ${width} per row`);
  };
  const clearGrid = () => { setPos({}); setPicked(null); touch(); };

  const toggleLink = (a: number, b: number) => {
    setPairs((current) => { const next = new Set(current); const key = linkKey(a, b); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    setLinksTouched(true); touch();
  };
  const autoLink = () => {
    const next = new Set(pairs);
    const before = next.size;
    const steps: [number, number][] = diagonals ? [[0, 1], [1, 0], [1, 1], [1, -1]] : [[0, 1], [1, 0]];
    Object.entries(pos).forEach(([idText, cell]) => {
      const id = Number(idText);
      if (byId.get(id)?.ConvertedUnitId) return;
      steps.forEach(([dr, dc]) => {
        const other = cellMap.get(`${cell.r + dr}:${cell.c + dc}`);
        if (other != null && !byId.get(other)?.ConvertedUnitId) next.add(linkKey(id, other));
      });
    });
    setPairs(next); setLinksTouched(true); touch();
    toast.success(next.size === before ? "No new neighbours found - every touching pair is already linked" : `Linked ${next.size - before} new neighbour pair(s) from the grid`);
  };
  const clearLinks = () => { setPairs(new Set()); setLinksTouched(true); setFocusId(null); touch(); };

  const onChipClick = (plot: LayoutPlot) => {
    if (mode === "arrange") { setPicked((current) => (current === plot.Id ? null : plot.Id)); return; }
    if (plot.ConvertedUnitId) { toast.error("Converted plots cannot have neighbours"); return; }
    if (focusId == null) setFocusId(plot.Id);
    else if (focusId !== plot.Id) toggleLink(focusId, plot.Id);
  };

  const close = (next: boolean) => {
    if (!next && dirty && !window.confirm("Discard the unsaved layout changes?")) return;
    onOpenChange(next);
  };

  const save = async () => {
    if (blockId == null) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        GridRows: rows, GridCols: cols,
        Placements: Object.entries(pos).map(([id, cell]) => ({ Id: Number(id), Row: cell.r, Col: cell.c })),
      };
      if (linksTouched) body.Adjacency = [...pairs].map((key) => key.split("-").map(Number));
      const response = await fetchWithAuth(`${PLOT_API}/layout/${blockId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not save the layout");
      toast.success("Layout saved");
      setDirty(false);
      onSaved();
      onOpenChange(false);
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const renderChip = (plot: LayoutPlot) => {
    const isFocus = mode === "neighbours" && focusId === plot.Id;
    const isNeighbour = mode === "neighbours" && focusId != null && pairs.has(linkKey(focusId, plot.Id));
    const isPicked = mode === "arrange" && picked === plot.Id;
    const dimmed = mode === "neighbours" && focusId != null && !isFocus && !isNeighbour && Boolean(plot.ConvertedUnitId);
    const links = linkCount.get(plot.Id) || 0;
    return (
      <div
        draggable={mode === "arrange"}
        onDragStart={(event) => { setDragId(plot.Id); event.dataTransfer.setData("text/plain", String(plot.Id)); event.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => setDragId(null)}
        onClick={(event) => { event.stopPropagation(); onChipClick(plot); }}
        title={mode === "arrange" ? "Drag to a cell, or click then click a cell" : "Click to link / unlink as a neighbour"}
        className={`flex h-full w-full select-none flex-col justify-between rounded-md border px-1.5 py-1 text-left ${tone(plot)} ${mode === "arrange" ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}
          ${isFocus ? "ring-2 ring-primary" : ""} ${isNeighbour ? "ring-2 ring-sky-500 bg-sky-500/20" : ""} ${isPicked ? "ring-2 ring-primary" : ""} ${dimmed ? "opacity-40" : ""} ${dragId === plot.Id ? "opacity-40" : ""}`}
      >
        <span className="block truncate text-xs font-semibold">{plot.PlotName}</span>
        <span className="block truncate text-[10px] text-muted-foreground">{plot.AreaSqFt ? `${Number(plot.AreaSqFt).toLocaleString("en-IN")} sq ft` : "Area pending"}</span>
        <span className="block truncate text-[10px] text-muted-foreground">{links ? `${links} neighbour${links === 1 ? "" : "s"}` : "no neighbours"}</span>
      </div>
    );
  };

  const placedCount = Object.keys(pos).length;
  const dropProps = (r: number, c: number) => ({
    onDragOver: (event: React.DragEvent) => { if (mode === "arrange") event.preventDefault(); },
    onDrop: (event: React.DragEvent) => {
      if (mode !== "arrange") return;
      event.preventDefault();
      const id = dragId ?? Number(event.dataTransfer.getData("text/plain"));
      if (byId.has(id)) placeAt(id, r, c);
      setDragId(null);
    },
    onClick: () => { if (mode === "arrange" && picked != null) placeAt(picked, r, c); },
  });

  const btn = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-40";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent accent="crm" className="max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Network size={17} className="text-primary" /> Layout &amp; neighbours · {title}</DialogTitle>
        </DialogHeader>

        {error ? <p className="p-6 text-sm text-destructive">Could not load this block&apos;s layout. Close and try again.</p>
          : (isLoading || (isFetching && initialised.current === null)) ? <p className="p-6 text-sm text-muted-foreground">Loading layout...</p> : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-8 overflow-hidden rounded-lg border border-border" role="group" aria-label="Editor mode">
                <button onClick={() => { setMode("arrange"); setFocusId(null); }} className={`inline-flex items-center gap-1.5 px-3 text-xs font-medium ${mode === "arrange" ? "bg-muted text-foreground" : "text-muted-foreground"}`}><Move size={13} /> Arrange</button>
                <button onClick={() => { setMode("neighbours"); setPicked(null); }} className={`inline-flex items-center gap-1.5 border-l border-border px-3 text-xs font-medium ${mode === "neighbours" ? "bg-muted text-foreground" : "text-muted-foreground"}`}><Network size={13} /> Neighbours</button>
              </div>

              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                Rows
                <button className={btn + " !px-1.5"} onClick={() => resize("rows", -1)} aria-label="Remove a row"><Minus size={13} /></button>
                <span className="w-6 text-center tabular-nums text-foreground">{rows}</span>
                <button className={btn + " !px-1.5"} onClick={() => resize("rows", 1)} aria-label="Add a row"><Plus size={13} /></button>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                Columns
                <button className={btn + " !px-1.5"} onClick={() => resize("cols", -1)} aria-label="Remove a column"><Minus size={13} /></button>
                <span className="w-6 text-center tabular-nums text-foreground">{cols}</span>
                <button className={btn + " !px-1.5"} onClick={() => resize("cols", 1)} aria-label="Add a column"><Plus size={13} /></button>
              </div>

              {mode === "arrange" ? (
                <>
                  <button className={btn} onClick={autoArrange}><Sparkles size={13} /> Auto-arrange in order</button>
                  <button className={btn} onClick={clearGrid} disabled={!placedCount}><Trash2 size={13} /> Clear grid</button>
                </>
              ) : (
                <>
                  <button className={btn} onClick={autoLink}><Sparkles size={13} /> Auto-link from grid</button>
                  <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={diagonals} onChange={(event) => setDiagonals(event.target.checked)} /> include diagonals</label>
                  <button className={btn} onClick={clearLinks} disabled={!pairs.size}><RotateCcw size={13} /> Remove all links</button>
                </>
              )}
              <span className="ml-auto text-xs text-muted-foreground">{placedCount} of {plots.length} placed{unplaced.length ? ` · ${unplaced.length} in tray` : ""}</span>
            </div>

            {mode === "arrange" ? (
              <p className="text-xs text-muted-foreground">Drag a plot onto any cell. Dropping on an occupied cell swaps the two. On touch screens, tap a plot, then tap the cell. Empty cells stay empty (roads, parks, gaps).</p>
            ) : focusPlot ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                <span>Neighbours of <span className="font-semibold">{focusPlot.PlotName}</span>: {focusNeighbours.length ? focusNeighbours.map((plot) => plot.PlotName).join(", ") : "none yet"}.</span>
                <span className="text-muted-foreground">Click a plot to link it, click a blue one to unlink.</span>
                <button className="ml-auto text-primary hover:underline" onClick={() => setFocusId(null)}>Pick another plot</button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Click the plot whose neighbours you want to set. Only linked neighbours can be combined into one unit. &ldquo;Auto-link from grid&rdquo; links every plot that touches side by side.</p>
            )}

            <div className="max-h-[52vh] overflow-auto rounded-lg border border-border bg-muted/20 p-3">
              <div className="inline-grid gap-1.5" style={{ gridTemplateColumns: `28px repeat(${cols}, 104px)` }}>
                <div />
                {Array.from({ length: cols }, (_, c) => <div key={`h${c}`} className="text-center text-[10px] text-muted-foreground">{c + 1}</div>)}
                {Array.from({ length: rows }, (_, r) => (
                  <React.Fragment key={`r${r}`}>
                    <div className="flex items-center justify-center text-[10px] text-muted-foreground">{r + 1}</div>
                    {Array.from({ length: cols }, (_, c) => {
                      const id = cellMap.get(`${r}:${c}`);
                      const plot = id != null ? byId.get(id) : undefined;
                      return (
                        <div key={`c${r}:${c}`} {...dropProps(r, c)}
                          className={`h-[64px] rounded-md ${plot ? "" : `border border-dashed border-border/70 ${mode === "arrange" && (picked != null || dragId != null) ? "bg-primary/5" : ""}`}`}>
                          {plot && renderChip(plot)}
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>

            <div
              onDragOver={(event) => { if (mode === "arrange") event.preventDefault(); }}
              onDrop={(event) => { if (mode !== "arrange") return; event.preventDefault(); const id = dragId ?? Number(event.dataTransfer.getData("text/plain")); if (byId.has(id)) toTray(id); setDragId(null); }}
              onClick={() => { if (mode === "arrange" && picked != null && pos[picked]) toTray(picked); }}
              className="rounded-lg border border-dashed border-border p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Unplaced plots ({unplaced.length}){mode === "arrange" ? " - drop a plot here to take it off the grid" : ""}</p>
              {unplaced.length === 0 ? <p className="text-xs text-muted-foreground">Every plot has a cell.</p> : (
                <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))" }}>
                  {unplaced.map((plot) => <div key={plot.Id} className="h-[64px]">{renderChip(plot)}</div>)}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-500" /> Available</span>
                <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-500" /> Applied / held</span>
                <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-red-500" /> Booked</span>
                <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-violet-500" /> Converted</span>
                {mode === "neighbours" && <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-sky-500" /> Neighbour</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => close(false)} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted">Cancel</button>
                <button onClick={save} disabled={saving || !dirty} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40"><Save size={13} /> {saving ? "Saving..." : "Save layout"}</button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default PlotLayoutEditor;
