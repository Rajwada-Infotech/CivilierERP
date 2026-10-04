import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, GripVertical, Lock, Pencil, Tag, Undo2, Wand2 } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Unit naming for Auto Project Setup. Pick a ready-made style (the ones real
// projects actually use) or arrange the parts yourself. Under the hood it is
// saved as a naming pattern (migration 527) for the whole project or one
// block; nobody has to type a template.
//
// Styles covered, from how flats are numbered in practice:
//   floor + 2-digit flat no.  101, 1204   (most common in India)
//   wing / tower + flat no.   A-1204
//   floor + letter            1A, 12B     (Kolkata; Rajwada's projects)
//   tower / floor / unit      T1/FL2/A
// plus: 2-digit floors (0101), 3-digit units (001), ground as G / GF / 0,
// letters I and O skipped (they read as 1 and 0).

const API = "/api/crm/project-auto-setup";
const PATTERN_API = "/api/crm-naming-pattern";

type Part = "tower" | "floor" | "unit";
type Builder = {
  order: Part[];
  tower: "NAME" | "T1";
  floor: "1" | "01" | "FL1";
  unit: "A" | "1" | "01" | "001";
  ground: "G" | "GF" | "0";
  sep: "/" | "-";
  joinFloorUnit: boolean; // 101 / 1A instead of 1/01 / 1/A
  skipIO: boolean;
};
const DEFAULT: Builder = { order: ["tower", "floor", "unit"], tower: "NAME", floor: "1", unit: "01", ground: "G", sep: "/", joinFloorUnit: true, skipIO: false };

const TOWER_TOKEN = { NAME: "{B}", T1: "T{T}" } as const;
const FLOOR_TOKEN = { "1": "{F}", "01": "{F:2}", FL1: "FL{F}" } as const;
const UNIT_TOKEN = { A: "{L}", "1": "{N}", "01": "{N:2}", "001": "{N:3}" } as const;
const partToken = (b: Builder, p: Part) => (p === "tower" ? TOWER_TOKEN[b.tower] : p === "floor" ? FLOOR_TOKEN[b.floor] : UNIT_TOKEN[b.unit]);
const keyOf = <T extends Record<string, string>>(map: T, token: string) => (Object.keys(map) as (keyof T)[]).find((k) => map[k] === token);

function toTemplate(b: Builder): string {
  const segs: string[] = ["{P}"];
  for (let i = 0; i < b.order.length; i++) {
    const p = b.order[i];
    if (b.joinFloorUnit && p === "floor" && b.order[i + 1] === "unit") { segs.push(partToken(b, "floor") + partToken(b, "unit")); i++; continue; }
    segs.push(partToken(b, p));
  }
  return segs.join(b.sep);
}

// Read a saved pattern back into the builder (null = not one made here).
function fromTemplate(tpl: string, skip: string | null, ground: string | null): Builder | null {
  for (const sep of ["/", "-"] as const) {
    const segs = tpl.split(sep);
    if (segs[0] !== "{P}") continue;
    const b: Builder = { ...DEFAULT, order: [], sep, joinFloorUnit: false, skipIO: (skip || "").includes("I"), ground: (["G", "GF", "0"].includes(ground || "") ? ground : "G") as Builder["ground"] };
    let ok = true;
    for (const s of segs.slice(1)) {
      const joined = s.match(/^(FL\{F\}|\{F(?::2)?\})(\{L\}|\{N(?::\d)?\})$/);
      const f = joined ? keyOf(FLOOR_TOKEN, joined[1]) : keyOf(FLOOR_TOKEN, s);
      const u = joined ? keyOf(UNIT_TOKEN, joined[2]) : keyOf(UNIT_TOKEN, s);
      const t = keyOf(TOWER_TOKEN, s);
      if (joined && f && u) { b.floor = f; b.unit = u; b.order.push("floor", "unit"); b.joinFloorUnit = true; }
      else if (t) { b.tower = t; b.order.push("tower"); }
      else if (!joined && f) { b.floor = f; b.order.push("floor"); }
      else if (!joined && u) { b.unit = u; b.order.push("unit"); }
      else { ok = false; break; }
    }
    if (ok && b.order.length === 3) return b;
  }
  return null;
}

// Three sample names: floor 1 unit 1, floor 1 unit 2, floor 12 unit 1.
function example(b: Builder, short: string, blockName: string) {
  const letters = b.skipIO ? "ABCDEFGHJKLMNPQRSTUVWXYZ" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const one = (floor: number, seq: number) => toTemplate(b)
    .replace("{P}", short).replace("T{T}", "T1").replace("{B}", blockName)
    .replace("{F:2}", String(floor).padStart(2, "0")).replace("{F}", String(floor))
    .replace("{L}", letters[seq - 1]).replace("{N:3}", String(seq).padStart(3, "0")).replace("{N:2}", String(seq).padStart(2, "0")).replace("{N}", String(seq));
  return [one(1, 1), one(1, 2), one(12, 1)].join(",  ");
}

const LABEL: Record<Part, string> = { tower: "Tower / Block", floor: "Floor", unit: "Unit" };

// Ready-made styles, most common first.
const PRESETS: { title: string; hint: string; b: Builder }[] = [
  { title: "Floor + flat number", hint: "Most common", b: { ...DEFAULT } },
  { title: "Floor + letter", hint: "1A, 1B…", b: { ...DEFAULT, unit: "A" } },
  { title: "Wing + flat number", hint: "With a dash", b: { ...DEFAULT, sep: "-" } },
  { title: "Floor / Unit", hint: "Separate parts", b: { ...DEFAULT, unit: "1", joinFloorUnit: false } },
  { title: "Tower / Floor / Unit", hint: "T1, FL1…", b: { ...DEFAULT, tower: "T1", floor: "FL1", unit: "A", joinFloorUnit: false } },
];
const sameAs = (x: Builder, y: Builder) => toTemplate(x) === toTemplate(y) && x.skipIO === y.skipIO && x.ground === y.ground;

const STYLE_OPTIONS: Record<Part, { value: string; label: (block: string) => string }[]> = {
  tower: [{ value: "NAME", label: (blk) => `${blk} (block name)` }, { value: "T1", label: () => "T1, T2…" }],
  floor: [{ value: "1", label: () => "1, 2 … 12" }, { value: "01", label: () => "01, 02 … 12" }, { value: "FL1", label: () => "FL1, FL2…" }],
  unit: [{ value: "01", label: () => "01, 02…" }, { value: "1", label: () => "1, 2…" }, { value: "001", label: () => "001, 002…" }, { value: "A", label: () => "A, B…" }],
};

interface Props {
  projectId: number;
  shortName?: string;
  blocks: { Id: number; BlockName: string }[];
  floorsByBlock: Map<number, any[]>;
  canEdit: boolean;
}

export function NamingPanel({ projectId, shortName, blocks, floorsByBlock, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<string>("project"); // "project" or a block id
  const [b, setB] = useState<Builder>(DEFAULT);
  const [customOpen, setCustomOpen] = useState(false);
  // Open while setting up for the first time; locked (one line + Edit) once
  // a naming is saved or units already exist.
  const [open, setOpen] = useState<boolean | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: naming } = useQuery<any>({
    queryKey: ["auto-setup-naming", projectId],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/naming?ProjectId=${projectId}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load naming");
      return res.json();
    },
    enabled: !!projectId,
  });

  // What is saved for the chosen target (a block falls back to the project).
  const current = useMemo(() => {
    if (!naming) return null;
    const pid = target === "project"
      ? naming.project?.UnitNamingPatternId
      : naming.blocks?.find((x: any) => String(x.Id) === target)?.UnitNamingPatternId ?? naming.project?.UnitNamingPatternId;
    return naming.patterns?.find((p: any) => p.Id === pid) ?? null;
  }, [naming, target]);
  const saved = useMemo(() => (current && fromTemplate(current.Template, current.SkipLetters, current.GroundLabel)) || DEFAULT, [current]);
  useEffect(() => { setB(saved); }, [saved]);
  const anyGenerated = useMemo(() => [...floorsByBlock.values()].flat().some((f: any) => f.IsGenerated), [floorsByBlock]);
  const firstTime = !!naming && !naming.project?.UnitNamingPatternId && !(naming.blocks || []).some((x: any) => x.UnitNamingPatternId) && !anyGenerated;
  const isOpen = open ?? firstTime;

  const short = shortName || "PRJ";
  const blockName = target === "project" ? blocks[0]?.BlockName ?? "A" : blocks.find((x) => String(x.Id) === target)?.BlockName ?? "A";
  const canJoin = b.order.indexOf("floor") + 1 === b.order.indexOf("unit");
  const effective: Builder = { ...b, joinFloorUnit: b.joinFloorUnit && canJoin };
  const dirty = !sameAs(effective, saved);
  const names = example(effective, short, blockName);

  const drop = (to: number) => {
    if (dragIdx === null || dragIdx === to) return setDragIdx(null);
    setB((s) => { const order = [...s.order]; const [m] = order.splice(dragIdx, 1); order.splice(to, 0, m); return { ...s, order }; });
    setDragIdx(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      const template = toTemplate(effective);
      const skip = effective.skipIO ? "IO" : "";
      // Reuse an identical pattern rather than piling up duplicates.
      let pattern = naming?.patterns?.find((p: any) => p.Scope === "UNIT" && p.Template === template && (p.SkipLetters || "") === skip && p.GroundLabel === effective.ground);
      if (!pattern) {
        const res = await fetchWithAuth(PATTERN_API, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ Name: template.replace("{P}", "Project"), Scope: "UNIT", Template: template, GroundLabel: effective.ground, SkipLetters: skip, NumberStart: 1 }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Couldn't save naming");
        pattern = { Id: body.id };
      }
      const res = await fetchWithAuth(`${API}/naming`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Level: target === "project" ? "project" : "block", Id: target === "project" ? projectId : Number(target), Scope: "UNIT", PatternId: pattern.Id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't save naming");
      toast.success("Naming saved — new units will use it");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["auto-setup-naming", projectId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-background/50 p-3 sm:p-4 space-y-3">
      {/* Folded: one line saying what new units are called. */}
      <div className="flex flex-wrap items-center gap-2">
        {isOpen ? <Tag size={13} className="text-sky-600" /> : <Lock size={12} className="text-muted-foreground" />}
        <span className="text-sm font-semibold">{isOpen ? "How should units be named?" : "Unit names"}</span>
        {!isOpen && (
          <>
            <span className="font-mono text-xs text-muted-foreground">{example(saved, short, blockName)} …</span>
            <span className="text-xs text-muted-foreground">· {PRESETS.find((p) => sameAs({ ...p.b, skipIO: saved.skipIO, ground: saved.ground }, saved))?.title ?? "Your own"}</span>
          </>
        )}
        {canEdit && !isOpen && (
          <button type="button" onClick={() => setOpen(true)}
            className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-border text-primary hover:bg-primary/5">
            <Pencil size={11} /> Edit
          </button>
        )}
        {isOpen && !firstTime && (
          <button type="button" onClick={() => { setOpen(false); setB(saved); setCustomOpen(false); }}
            className="ml-auto px-2.5 py-1 text-xs rounded-lg border border-border text-muted-foreground hover:bg-muted/50">
            Cancel
          </button>
        )}
      </div>

      {isOpen && (<>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Pick the style that looks right.</span>
        {blocks.length > 1 && (
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            Apply to
            <select value={target} onChange={(e) => setTarget(e.target.value)}
              className="px-2 py-1 rounded-lg border border-border bg-background text-foreground">
              <option value="project">All blocks</option>
              {blocks.map((x) => <option key={x.Id} value={String(x.Id)}>Block {x.BlockName} only</option>)}
            </select>
          </label>
        )}
      </div>

      {/* Pick by example — real names for this project. */}
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {PRESETS.map((p) => {
          const pb = { ...p.b, skipIO: b.skipIO, ground: b.ground };
          const active = !customOpen && sameAs(pb, effective);
          const [first, ...rest] = example(pb, short, blockName).split(",  ");
          return (
            <button key={p.title} type="button" disabled={!canEdit} onClick={() => { setB(pb); setCustomOpen(false); }} aria-pressed={active}
              className={`relative h-full rounded-xl border p-3 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${active ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/40"}`}>
              {active && <CheckCircle2 size={14} className="absolute top-2.5 right-2.5 text-primary" />}
              <div className="text-[11px] text-muted-foreground pr-5">{p.title} <span className="opacity-60">· {p.hint}</span></div>
              <div className="mt-1 font-mono text-sm font-semibold">{first}</div>
              <div className="font-mono text-[11px] text-muted-foreground">{rest.join(", ")}</div>
            </button>
          );
        })}
        {(() => {
          const isCustom = customOpen || !PRESETS.some((p) => sameAs({ ...p.b, skipIO: b.skipIO, ground: b.ground }, effective));
          return (
            <button type="button" disabled={!canEdit} onClick={() => setCustomOpen(true)} aria-pressed={isCustom}
              className={`relative h-full rounded-xl border border-dashed p-3 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${isCustom ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/40"}`}>
              {isCustom && <CheckCircle2 size={14} className="absolute top-2.5 right-2.5 text-primary" />}
              <div className="text-[11px] text-muted-foreground flex items-center gap-1"><Wand2 size={11} /> Your own</div>
              <div className="mt-1 text-sm font-semibold">{isCustom ? <span className="font-mono">{names.split(",  ")[0]}</span> : "Make your own"}</div>
              <div className="text-[11px] text-muted-foreground">Arrange the parts yourself</div>
            </button>
          );
        })()}
      </div>

      {/* Make your own: drag the boxes into order, pick a style in each. */}
      {customOpen && (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
          <p className="text-[11px] text-muted-foreground">Drag the boxes to change the order, and pick how each part looks in its menu.</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 py-2 text-xs rounded-lg bg-muted text-muted-foreground">Project <b>{short}</b></span>
            {b.order.map((p, i) => (
              <React.Fragment key={p}>
                <span className="text-muted-foreground font-mono">{effective.joinFloorUnit && p === "unit" && b.order[i - 1] === "floor" ? "+" : b.sep}</span>
                <div draggable={canEdit} onDragStart={() => setDragIdx(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(i)} onDragEnd={() => setDragIdx(null)}
                  className={`flex items-center gap-2 rounded-lg border border-primary/40 bg-background px-2 py-1.5 cursor-grab active:cursor-grabbing select-none ${dragIdx === i ? "opacity-40" : ""}`}>
                  <GripVertical size={12} className="text-muted-foreground" />
                  <span className="text-xs font-medium">{LABEL[p]}</span>
                  <select disabled={!canEdit} value={b[p]} onChange={(e) => setB({ ...b, [p]: e.target.value } as Builder)}
                    className="px-1.5 py-0.5 text-xs rounded border border-border bg-background">
                    {STYLE_OPTIONS[p].map((o) => <option key={o.value} value={o.value}>{o.label(blockName)}</option>)}
                  </select>
                </div>
              </React.Fragment>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-1.5">Separator
              <select disabled={!canEdit} value={b.sep} onChange={(e) => setB({ ...b, sep: e.target.value as "/" | "-" })} className="px-1.5 py-0.5 rounded border border-border bg-background">
                <option value="/">/</option><option value="-">-</option>
              </select>
            </label>
            {canJoin && (
              <label className="flex items-center gap-1.5"><input type="checkbox" disabled={!canEdit} checked={b.joinFloorUnit} onChange={(e) => setB({ ...b, joinFloorUnit: e.target.checked })} /> Floor and unit together (101 / 1A)</label>
            )}
          </div>
        </div>
      )}

      {/* Result bar — calm when saved, clearly asks to save when changed. */}
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 transition-colors ${dirty ? "bg-amber-500/5 border-amber-500/30" : "bg-emerald-500/5 border-emerald-500/20"}`}>
        <span className="text-xs text-muted-foreground">{dirty ? "New units would be named" : "New units will be named"}</span>
        <span className={`font-mono text-sm ${dirty ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>{names} …</span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Ground floor as
          <select disabled={!canEdit} value={b.ground} onChange={(e) => setB({ ...b, ground: e.target.value as Builder["ground"] })}
            className="px-1.5 py-0.5 rounded border border-border bg-background text-foreground">
            <option value="G">G (G01)</option><option value="GF">GF (GF01)</option><option value="0">0 (001)</option>
          </select>
        </label>
        {b.unit === "A" && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" disabled={!canEdit} checked={b.skipIO} onChange={(e) => setB({ ...b, skipIO: e.target.checked })} /> Skip I and O
          </label>
        )}
        <div className="ml-auto flex items-center gap-2">
          {dirty ? (
            canEdit && (
              <>
                <button type="button" onClick={() => { setB(saved); setCustomOpen(false); }} disabled={saving}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-border hover:bg-muted/50">
                  <Undo2 size={11} /> Undo
                </button>
                <button type="button" onClick={save} disabled={saving}
                  className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">
                  {saving ? "Saving…" : "Save naming"}
                </button>
              </>
            )
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 size={12} /> Saved</span>
          )}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">Only units generated from now on use this. Units already created keep their names.</p>
      </>)}
    </div>
  );
}

// ── Parking slot naming — same card, same lock/Edit behaviour ───────────────
const PARKING_PRESETS: { title: string; hint: string; template: string }[] = [
  { title: "P + number", hint: "Most common", template: "{P}/{B}/P{N:2}" },
  { title: "P + plain number", hint: "P1, P2…", template: "{P}/{B}/P{N}" },
  { title: "Tower-wise", hint: "T1, T2…", template: "{P}/T{T}/P{N:2}" },
  { title: "With dashes", hint: "Dash separated", template: "{P}-{B}-P{N:2}" },
  { title: "3-digit number", hint: "Large lots", template: "{P}/{B}/P{N:3}" },
];
const LEGACY_PARKING = PARKING_PRESETS[0].template; // what's generated when nothing is chosen

function parkingExample(template: string, short: string, blockName: string) {
  const one = (n: number) => template.replace("{P}", short).replace("T{T}", "T1").replace("{B}", blockName)
    .replace("{N:3}", String(n).padStart(3, "0")).replace("{N:2}", String(n).padStart(2, "0")).replace("{N}", String(n));
  return [one(1), one(2), one(3)].join(",  ");
}

export function ParkingNamingPanel({ projectId, shortName, blocks, canEdit }: {
  projectId: number; shortName?: string; blocks: { Id: number; BlockName: string; ParkingSlotCount?: number }[]; canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<boolean | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { data: naming } = useQuery<any>({
    queryKey: ["auto-setup-naming", projectId],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/naming?ProjectId=${projectId}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load naming");
      return res.json();
    },
    enabled: !!projectId,
  });
  const short = shortName || "PRJ";
  const blockName = blocks[0]?.BlockName ?? "A";
  const savedTemplate: string = naming?.patterns?.find((p: any) => p.Id === naming?.project?.ParkingNamingPatternId)?.Template ?? LEGACY_PARKING;
  const chosen = pick ?? savedTemplate;
  const dirty = chosen !== savedTemplate;
  const anyGenerated = blocks.some((b) => (b.ParkingSlotCount || 0) > 0);
  const firstTime = !!naming && !naming.project?.ParkingNamingPatternId && !anyGenerated;
  const isOpen = open ?? firstTime;
  const titleOf = (tpl: string) => PARKING_PRESETS.find((p) => p.template === tpl)?.title ?? "Custom";

  const save = async () => {
    setSaving(true);
    try {
      let pattern = naming?.patterns?.find((p: any) => p.Scope === "PARKING" && p.Template === chosen);
      if (!pattern) {
        const res = await fetchWithAuth(PATTERN_API, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ Name: chosen.replace("{P}", "Project"), Scope: "PARKING", Template: chosen, GroundLabel: "G", NumberStart: 1 }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Couldn't save naming");
        pattern = { Id: body.id };
      }
      const res = await fetchWithAuth(`${API}/naming`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Level: "project", Id: projectId, Scope: "PARKING", PatternId: pattern.Id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't save naming");
      toast.success("Parking naming saved — new slots will use it");
      await queryClient.invalidateQueries({ queryKey: ["auto-setup-naming", projectId] });
      setPick(null);
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-background/50 p-3 sm:p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {isOpen ? <Tag size={13} className="text-sky-600" /> : <Lock size={12} className="text-muted-foreground" />}
        <span className="text-sm font-semibold">{isOpen ? "How should parking slots be named?" : "Slot names"}</span>
        {!isOpen && (
          <>
            <span className="font-mono text-xs text-muted-foreground">{parkingExample(savedTemplate, short, blockName)} …</span>
            <span className="text-xs text-muted-foreground">· {titleOf(savedTemplate)}</span>
          </>
        )}
        {canEdit && !isOpen && (
          <button type="button" onClick={() => setOpen(true)}
            className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-border text-primary hover:bg-primary/5">
            <Pencil size={11} /> Edit
          </button>
        )}
        {isOpen && !firstTime && (
          <button type="button" onClick={() => { setOpen(false); setPick(null); }}
            className="ml-auto px-2.5 py-1 text-xs rounded-lg border border-border text-muted-foreground hover:bg-muted/50">Cancel</button>
        )}
      </div>
      {isOpen && (
        <>
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
            {PARKING_PRESETS.map((p) => {
              const active = p.template === chosen;
              const [first, ...rest] = parkingExample(p.template, short, blockName).split(",  ");
              return (
                <button key={p.title} type="button" disabled={!canEdit} onClick={() => setPick(p.template)} aria-pressed={active}
                  className={`relative h-full rounded-xl border p-3 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${active ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/40"}`}>
                  {active && <CheckCircle2 size={14} className="absolute top-2.5 right-2.5 text-primary" />}
                  <div className="text-[11px] text-muted-foreground pr-5">{p.title} <span className="opacity-60">· {p.hint}</span></div>
                  <div className="mt-1 font-mono text-sm font-semibold">{first}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{rest.join(", ")}</div>
                </button>
              );
            })}
          </div>
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 ${dirty ? "bg-amber-500/5 border-amber-500/30" : "bg-emerald-500/5 border-emerald-500/20"}`}>
            <span className="text-xs text-muted-foreground">{dirty ? "New slots would be named" : "New slots will be named"}</span>
            <span className={`font-mono text-sm ${dirty ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>{parkingExample(chosen, short, blockName)} …</span>
            <div className="ml-auto flex items-center gap-2">
              {dirty || firstTime ? (canEdit && (
                <>
                  {dirty && (
                    <button type="button" onClick={() => setPick(null)} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-border hover:bg-muted/50">
                      <Undo2 size={11} /> Undo
                    </button>
                  )}
                  <button type="button" onClick={save} disabled={saving} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">
                    {saving ? "Saving…" : "Save naming"}
                  </button>
                </>
              )) : (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 size={12} /> Saved</span>
              )}
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">Only slots generated from now on use this. Slots already created keep their names.</p>
        </>
      )}
    </div>
  );
}
