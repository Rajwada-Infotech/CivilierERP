import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Pencil, Plus, Tag, AlertTriangle } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Naming panel for Auto Project Setup (migration 527). Patterns are created
// and chosen right here — project default, block override, floor override —
// and the exact names the next generate will create are previewed before
// anything is written. "Default naming" = the legacy fixed names.

const API = "/api/crm/project-auto-setup";
const PATTERN_API = "/api/crm-naming-pattern";

type Pattern = { Id: number; Name: string; Scope: "UNIT" | "PARKING"; Template: string; GroundLabel: string; SkipLetters: string | null; NumberStart: number; Example?: string };
type NamingState = {
  patterns: Pattern[];
  project: { UnitNamingPatternId?: number | null; ParkingNamingPatternId?: number | null };
  blocks: { Id: number; UnitNamingPatternId: number | null; ParkingNamingPatternId: number | null }[];
  floors: { Id: number; UnitNamingPatternId: number | null }[];
};
type Preview = { floors: { FloorId: number; BlockId: number; FloorLabel: string; Pattern: string | null; Names: string[]; Clashes: string[] }[]; clashCount: number };

const selectCls = "px-2 py-1 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30";
const inputCls = "w-full px-2 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30";
const emptyDraft = { Id: 0, Name: "", Scope: "UNIT" as "UNIT" | "PARKING", Template: "{P}/{B}/{F}{L}", GroundLabel: "G", SkipLetters: "", NumberStart: "1" };

interface Props {
  projectId: number;
  blocks: { Id: number; BlockName: string }[];
  floorsByBlock: Map<number, any[]>;
  canEdit: boolean;
}

export function NamingPanel({ projectId, blocks, floorsByBlock, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [draftExample, setDraftExample] = useState<{ example?: string; error?: string }>({});
  const [openBlock, setOpenBlock] = useState<number | null>(null);

  const { data: naming } = useQuery<NamingState>({
    queryKey: ["auto-setup-naming", projectId],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/naming?ProjectId=${projectId}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load naming");
      return res.json();
    },
    enabled: !!projectId,
  });
  const floorKey = useMemo(() => [...floorsByBlock.values()].flat().map((f: any) => `${f.Id}:${f.UnitCount}:${f.IsGenerated}`).join(","), [floorsByBlock]);
  const { data: preview } = useQuery<Preview>({
    queryKey: ["auto-setup-naming-preview", projectId, floorKey, naming],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/naming-preview`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ProjectId: projectId }),
      });
      if (!res.ok) throw new Error("Failed to preview names");
      return res.json();
    },
    enabled: !!projectId && !!naming,
  });

  // Live example for the pattern being edited.
  useEffect(() => {
    if (!manageOpen) return;
    const t = setTimeout(async () => {
      const res = await fetchWithAuth(`${PATTERN_API}/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
      });
      setDraftExample(await res.json().catch(() => ({})));
    }, 300);
    return () => clearTimeout(t);
  }, [draft, manageOpen]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["auto-setup-naming", projectId] });
    queryClient.invalidateQueries({ queryKey: ["auto-setup-naming-preview", projectId] });
  };

  const assign = async (Level: "project" | "block" | "floor", Id: number, Scope: "UNIT" | "PARKING", value: string) => {
    const res = await fetchWithAuth(`${API}/naming`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Level, Id, Scope, PatternId: value === "" ? null : Number(value) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(body.error || "Failed to set naming");
    refresh();
  };

  const savePattern = async () => {
    const res = await fetchWithAuth(draft.Id ? `${PATTERN_API}/${draft.Id}` : PATTERN_API, {
      method: draft.Id ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, NumberStart: Number(draft.NumberStart) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(body.error || "Failed to save pattern");
    toast.success(draft.Id ? "Pattern updated" : "Pattern created");
    setDraft(emptyDraft);
    refresh();
  };

  const patterns = naming?.patterns ?? [];
  const unitPatterns = patterns.filter((p) => p.Scope === "UNIT");
  const parkingPatterns = patterns.filter((p) => p.Scope === "PARKING");
  const nameOf = (id?: number | null) => patterns.find((p) => p.Id === id)?.Name;
  const projectUnit = naming?.project.UnitNamingPatternId ?? null;
  const projectParking = naming?.project.ParkingNamingPatternId ?? null;
  const blockRow = (id: number) => naming?.blocks.find((b) => b.Id === id);
  const floorRow = (id: number) => naming?.floors.find((f) => f.Id === id);
  const previewFor = (floorId: number) => preview?.floors.find((f) => f.FloorId === floorId);

  const options = (list: Pattern[], inheritLabel: string) => (
    <>
      <option value="">{inheritLabel}</option>
      {list.map((p) => <option key={p.Id} value={p.Id}>{p.Name} — {p.Template}</option>)}
    </>
  );

  const projectSummary = nameOf(projectUnit) || "Default naming";
  const firstNames = preview?.floors.slice(0, 2).map((f) => f.Names[0]).filter(Boolean).join(", ");

  return (
    <div className="rounded-xl border border-border/60 bg-background/50 p-3 sm:p-4 space-y-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex flex-wrap items-center gap-2 text-left">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Tag size={13} className="text-sky-600" />
        <span className="text-sm font-semibold">Unit naming</span>
        <span className="text-xs text-muted-foreground">{projectSummary}{firstNames ? ` · next: ${firstNames}…` : ""}</span>
        {!!preview?.clashCount && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-red-600"><AlertTriangle size={11} /> {preview.clashCount} name clash(es)</span>
        )}
      </button>

      {open && (
        <div className="space-y-3">
          {/* Project default */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="w-28 text-muted-foreground">Project default</span>
            <select disabled={!canEdit} value={projectUnit ?? ""} onChange={(e) => assign("project", projectId, "UNIT", e.target.value)} className={selectCls}>
              {options(unitPatterns, "Default naming (short/block/floor01)")}
            </select>
            <span className="text-muted-foreground">Parking</span>
            <select disabled={!canEdit} value={projectParking ?? ""} onChange={(e) => assign("project", projectId, "PARKING", e.target.value)} className={selectCls}>
              {options(parkingPatterns, "Default (short/block/P01)")}
            </select>
          </div>

          {/* Block overrides + floor overrides + preview */}
          {blocks.map((b) => {
            const row = blockRow(b.Id);
            const pending = (floorsByBlock.get(b.Id) || []).filter((f: any) => !f.IsGenerated && f.HasUnits && f.UnitCount > 0);
            const isOpen = openBlock === b.Id;
            return (
              <div key={b.Id} className="rounded-lg border border-border/50 p-2 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button type="button" onClick={() => setOpenBlock(isOpen ? null : b.Id)} className="w-28 flex items-center gap-1 font-medium">
                    {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Block {b.BlockName}
                  </button>
                  <select disabled={!canEdit} value={row?.UnitNamingPatternId ?? ""} onChange={(e) => assign("block", b.Id, "UNIT", e.target.value)} className={selectCls}>
                    {options(unitPatterns, `Same as project (${projectSummary})`)}
                  </select>
                  <span className="text-muted-foreground">Parking</span>
                  <select disabled={!canEdit} value={row?.ParkingNamingPatternId ?? ""} onChange={(e) => assign("block", b.Id, "PARKING", e.target.value)} className={selectCls}>
                    {options(parkingPatterns, `Same as project (${nameOf(projectParking) || "Default"})`)}
                  </select>
                  <span className="text-muted-foreground">{pending.length ? `${pending.length} floor(s) to generate` : "nothing pending"}</span>
                </div>
                {isOpen && pending.map((f: any) => {
                  const pv = previewFor(f.Id);
                  return (
                    <div key={f.Id} className="flex flex-wrap items-center gap-2 pl-6 text-xs">
                      <span className="w-20 text-muted-foreground">Floor {f.FloorLabel}</span>
                      <select disabled={!canEdit} value={floorRow(f.Id)?.UnitNamingPatternId ?? ""} onChange={(e) => assign("floor", f.Id, "UNIT", e.target.value)} className={selectCls}>
                        {options(unitPatterns, "Same as block")}
                      </select>
                      {pv && (
                        <span className={pv.Clashes.length ? "text-red-600" : "text-muted-foreground"}>
                          {pv.Names[0]}{pv.Names.length > 1 ? ` … ${pv.Names[pv.Names.length - 1]}` : ""} ({pv.Names.length})
                          {pv.Clashes.length ? ` — already exists: ${pv.Clashes.slice(0, 3).join(", ")}` : ""}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Manage patterns inline */}
          <div className="pt-2 border-t border-border/60 space-y-2">
            <button type="button" onClick={() => setManageOpen((o) => !o)} className="flex items-center gap-1 text-xs text-primary">
              {manageOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Manage naming patterns ({patterns.length})
            </button>
            {manageOpen && (
              <div className="grid gap-3 md:grid-cols-[1fr_320px]">
                <div className="divide-y divide-border rounded-lg border border-border max-h-64 overflow-y-auto">
                  {patterns.length === 0 && <div className="p-3 text-xs text-muted-foreground">No patterns yet — create one on the right.</div>}
                  {patterns.map((p) => (
                    <button key={p.Id} type="button" disabled={!canEdit}
                      onClick={() => setDraft({ Id: p.Id, Name: p.Name, Scope: p.Scope, Template: p.Template, GroundLabel: p.GroundLabel, SkipLetters: p.SkipLetters || "", NumberStart: String(p.NumberStart) })}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/40">
                      <span className="font-medium">{p.Name}</span>
                      <span className="rounded bg-muted px-1.5 text-[10px]">{p.Scope === "PARKING" ? "Parking" : "Unit"}</span>
                      <span className="font-mono text-muted-foreground">{p.Template}</span>
                      <Pencil size={10} className="ml-auto opacity-50" />
                    </button>
                  ))}
                </div>
                {canEdit && (
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <div className="text-xs font-semibold">{draft.Id ? "Edit pattern" : "New pattern"}</div>
                    <input placeholder="Name, e.g. Tower / Floor / Unit" value={draft.Name} onChange={(e) => setDraft({ ...draft, Name: e.target.value })} className={inputCls} />
                    <select value={draft.Scope} onChange={(e) => setDraft({ ...draft, Scope: e.target.value as "UNIT" | "PARKING" })} className={inputCls}>
                      <option value="UNIT">Units</option>
                      <option value="PARKING">Parking</option>
                    </select>
                    <input placeholder="{P}/T{T}/FL{F}/{L}" value={draft.Template} onChange={(e) => setDraft({ ...draft, Template: e.target.value })} className={`${inputCls} font-mono`} />
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      {"{P}"} project short name · {"{T}"} tower no. · {"{B}"} block name · {"{F}"} floor · {"{L}"} letter · {"{N}"} number ({"{N:2}"} = 01)
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="text-[10px] text-muted-foreground">Ground as<input value={draft.GroundLabel} onChange={(e) => setDraft({ ...draft, GroundLabel: e.target.value })} className={inputCls} /></label>
                      <label className="text-[10px] text-muted-foreground">Skip letters<input placeholder="I,O" value={draft.SkipLetters} onChange={(e) => setDraft({ ...draft, SkipLetters: e.target.value.toUpperCase() })} className={inputCls} /></label>
                      <label className="text-[10px] text-muted-foreground">Number from<input type="number" min={0} value={draft.NumberStart} onChange={(e) => setDraft({ ...draft, NumberStart: e.target.value })} className={inputCls} /></label>
                    </div>
                    <div className={`text-[11px] ${draftExample.error ? "text-red-600" : "text-emerald-700 dark:text-emerald-400"}`}>
                      {draftExample.error || (draftExample.example ? `e.g. ${draftExample.example}` : "")}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={savePattern} disabled={!draft.Name.trim() || !!draftExample.error}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">
                        <Plus size={11} /> {draft.Id ? "Save" : "Create"}
                      </button>
                      {draft.Id > 0 && <button type="button" onClick={() => setDraft(emptyDraft)} className="px-3 py-1.5 text-xs rounded-lg border border-border">New</button>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
