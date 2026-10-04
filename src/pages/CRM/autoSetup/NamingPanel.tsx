import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GripVertical, Tag } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Unit naming for Auto Project Setup — a plain "order" builder. Pick the
// parts in the order they should appear, a style for each, see the result,
// save. Under the hood it becomes a naming pattern (migration 527) assigned
// to the whole project or one block; nobody has to type a template.

const API = "/api/crm/project-auto-setup";
const PATTERN_API = "/api/crm-naming-pattern";

type Part = "tower" | "floor" | "unit";
type Builder = {
  order: Part[];
  tower: "T1" | "NAME";
  floor: "FL1" | "1";
  unit: "A" | "01" | "1";
  sep: "/" | "-";
  joinFloorUnit: boolean; // 1A instead of 1/A
  skipIO: boolean;
};
const DEFAULT: Builder = { order: ["tower", "floor", "unit"], tower: "NAME", floor: "1", unit: "A", sep: "/", joinFloorUnit: true, skipIO: false };

const TOKEN: Record<string, string> = { T1: "T{T}", NAME: "{B}", FL1: "FL{F}", "1f": "{F}", A: "{L}", "01": "{N:2}", "1u": "{N}" };
const partToken = (b: Builder, p: Part) =>
  p === "tower" ? TOKEN[b.tower] : p === "floor" ? (b.floor === "FL1" ? TOKEN.FL1 : TOKEN["1f"]) : b.unit === "A" ? TOKEN.A : b.unit === "01" ? TOKEN["01"] : TOKEN["1u"];

function toTemplate(b: Builder): string {
  const segs: string[] = ["{P}"];
  for (let i = 0; i < b.order.length; i++) {
    const p = b.order[i];
    const next = b.order[i + 1];
    if (b.joinFloorUnit && p === "floor" && next === "unit") { segs.push(partToken(b, "floor") + partToken(b, "unit")); i++; continue; }
    segs.push(partToken(b, p));
  }
  return segs.join(b.sep);
}

// Read a saved template back into the builder (null = not built here).
function fromTemplate(tpl: string, skip: string | null): Builder | null {
  for (const sep of ["/", "-"] as const) {
    const segs = tpl.split(sep);
    if (segs[0] !== "{P}") continue;
    const b: Builder = { ...DEFAULT, order: [], sep, joinFloorUnit: false, skipIO: (skip || "").includes("I") };
    let ok = true;
    for (const s of segs.slice(1)) {
      const joined = s.match(/^(FL\{F\}|\{F\})(\{L\}|\{N:2\}|\{N\})$/);
      if (joined) {
        b.floor = joined[1] === "FL{F}" ? "FL1" : "1";
        b.unit = joined[2] === "{L}" ? "A" : joined[2] === "{N:2}" ? "01" : "1";
        b.order.push("floor", "unit"); b.joinFloorUnit = true; continue;
      }
      if (s === "T{T}" || s === "{B}") { b.tower = s === "T{T}" ? "T1" : "NAME"; b.order.push("tower"); }
      else if (s === "FL{F}" || s === "{F}") { b.floor = s === "FL{F}" ? "FL1" : "1"; b.order.push("floor"); }
      else if (s === "{L}" || s === "{N:2}" || s === "{N}") { b.unit = s === "{L}" ? "A" : s === "{N:2}" ? "01" : "1"; b.order.push("unit"); }
      else { ok = false; break; }
    }
    if (ok && b.order.length === 3) return b;
  }
  return null;
}

function example(b: Builder, short: string, blockName: string) {
  const letter = (n: number) => (b.skipIO ? "ABCDEFGHJKLMNPQRSTUVWXYZ" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ")[n - 1];
  const one = (floor: number, seq: number) => toTemplate(b)
    .replace("{P}", short).replace("T{T}", "T1").replace("{B}", blockName)
    .replace("{F}", String(floor)).replace("{L}", letter(seq)).replace("{N:2}", String(seq).padStart(2, "0")).replace("{N}", String(seq));
  return [one(1, 1), one(1, 2), one(2, 1)].join(",  ");
}

const LABEL: Record<Part, string> = { tower: "Tower / Block", floor: "Floor", unit: "Unit" };

// Ready-made choices shown as example cards — most people just click one.
const PRESETS: { title: string; b: Builder }[] = [
  { title: "Block + flat", b: { ...DEFAULT } },
  { title: "Tower / Floor / Unit", b: { ...DEFAULT, tower: "T1", floor: "FL1", unit: "A", joinFloorUnit: false } },
  { title: "Block + flat number", b: { ...DEFAULT, unit: "01" } },
  { title: "Block / Floor / Unit no.", b: { ...DEFAULT, unit: "1", joinFloorUnit: false } },
  { title: "With dashes", b: { ...DEFAULT, sep: "-" } },
];
const sameAs = (x: Builder, y: Builder) => toTemplate(x) === toTemplate(y) && x.skipIO === y.skipIO;

const STYLE_OPTIONS: Record<Part, { value: string; label: (block: string) => string }[]> = {
  tower: [{ value: "NAME", label: (blk) => `${blk} (block name)` }, { value: "T1", label: () => "T1, T2…" }],
  floor: [{ value: "1", label: () => "1, 2…" }, { value: "FL1", label: () => "FL1, FL2…" }],
  unit: [{ value: "A", label: () => "A, B…" }, { value: "01", label: () => "01, 02…" }, { value: "1", label: () => "1, 2…" }],
};

interface Props {
  projectId: number;
  shortName?: string;
  blocks: { Id: number; BlockName: string }[];
  floorsByBlock: Map<number, any[]>;
  canEdit: boolean;
}

export function NamingPanel({ projectId, shortName, blocks, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<string>("project"); // "project" or a block id
  const [b, setB] = useState<Builder>(DEFAULT);
  const [customOpen, setCustomOpen] = useState(false);
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
  const saved = useMemo(() => (current && fromTemplate(current.Template, current.SkipLetters)) || DEFAULT, [current]);
  useEffect(() => { setB(saved); }, [saved]);

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
      let pattern = naming?.patterns?.find((p: any) => p.Scope === "UNIT" && p.Template === template && (p.SkipLetters || "") === skip && p.GroundLabel === "G");
      if (!pattern) {
        const res = await fetchWithAuth(PATTERN_API, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ Name: template.replace("{P}", "Project"), Scope: "UNIT", Template: template, GroundLabel: "G", SkipLetters: skip, NumberStart: 1 }),
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
      queryClient.invalidateQueries({ queryKey: ["auto-setup-naming", projectId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-background/50 p-3 sm:p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tag size={13} className="text-sky-600" />
        <span className="text-sm font-semibold">How should units be named?</span>
        <span className="text-xs text-muted-foreground">Click the one that looks right.</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)}
          className="ml-auto px-2 py-1 text-xs rounded-lg border border-border bg-background">
          <option value="project">For the whole project</option>
          {blocks.map((x) => <option key={x.Id} value={String(x.Id)}>Only for Block {x.BlockName}</option>)}
        </select>
      </div>

      {/* Pick by example — real names for this project. */}
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
        {PRESETS.map((p) => {
          const pb = { ...p.b, skipIO: b.skipIO };
          const active = sameAs(pb, effective);
          const [first, ...rest] = example(pb, short, blockName).split(",  ");
          return (
            <button key={p.title} type="button" disabled={!canEdit} onClick={() => setB(pb)}
              className={`rounded-xl border p-3 text-left transition-all ${active ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/40"}`}>
              <div className="text-[11px] text-muted-foreground">{p.title}</div>
              <div className="mt-1 font-mono text-sm font-semibold">{first}</div>
              <div className="font-mono text-[11px] text-muted-foreground">{rest.join(", ")}</div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs">
        <button type="button" onClick={() => setCustomOpen((o) => !o)} className="text-primary hover:underline">
          {customOpen ? "Hide custom order" : "None of these? Make your own"}
        </button>
        {b.unit === "A" && (
          <label className="flex items-center gap-1.5"><input type="checkbox" disabled={!canEdit} checked={b.skipIO} onChange={(e) => setB({ ...b, skipIO: e.target.checked })} /> Skip letters I and O</label>
        )}
      </div>

      {/* Make your own: drag the boxes into order, pick a style in each. */}
      {customOpen && (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
          <p className="text-[11px] text-muted-foreground">Drag the boxes to change the order, and pick how each part looks.</p>
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
              <label className="flex items-center gap-1.5"><input type="checkbox" disabled={!canEdit} checked={b.joinFloorUnit} onChange={(e) => setB({ ...b, joinFloorUnit: e.target.checked })} /> Floor and unit together (1A)</label>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2">
        <span className="text-xs text-muted-foreground">New units will be named</span>
        <span className="font-mono text-sm text-emerald-700 dark:text-emerald-400">{names} …</span>
        {canEdit && (
          <button type="button" onClick={save} disabled={saving || !dirty}
            className="ml-auto px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">
            {saving ? "Saving…" : dirty ? "Save naming" : "Saved ✓"}
          </button>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">Only units generated from now on use this. Units already created keep their names.</p>
    </div>
  );
}
