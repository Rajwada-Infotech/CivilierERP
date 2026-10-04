import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, ChevronRight, Lock, Pencil, Plus, X } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { unitTypeOptions, type LayoutType } from "@/api/unitBhkConfigApi";

// A tower block shown as the building it is: top floor first, each floor
// saying what it holds. Define the TYPICAL floor once — every floor follows it
// (counts update by themselves, no "apply" step). Any floor can switch to its
// OWN mix (a shops-only ground floor, a penthouse floor). Rows are a BHK
// layout or, where the block's type sells commercial, a commercial unit kind.

const API = "/api/crm/project-auto-setup";
type KindRow = { Code: string; Name: string; IsCommercial: boolean };
type MixRow = {
  UnitType: string; UnitKind?: string | null; Count: number | string;
  CarpetAreaSqFt?: any; BuiltUpAreaSqFt?: any; SuperBuiltUpAreaSqFt?: any; OpenTerraceAreaSqFt?: any; RatePerSqFt?: any;
};
type FloorRow = { Id: number; FloorNo: number; FloorLabel: string; HasUnits: boolean; IsGenerated: boolean; UnitCount: number; GeneratedUnitCount: number; ownMix: MixRow[] | null };

const inputCls = "h-8 rounded-lg border border-border bg-background px-2 text-xs";
const total = (rows: MixRow[] | null | undefined) => (rows || []).reduce((s, r) => s + (parseInt(String(r.Count), 10) || 0), 0);
const describe = (rows: MixRow[] | null | undefined) =>
  (rows || []).filter((r) => (parseInt(String(r.Count), 10) || 0) > 0).map((r) => `${r.Count} × ${r.UnitType}`).join(" + ") || "—";

interface Props {
  blockId: number;
  blockName: string;
  kinds: KindRow[];
  layoutTypes: LayoutType[];
  canEdit: boolean;
  onChanged: () => void;
}

// One editable mix (typical or a floor's own) — a compact table with every
// field visible: type, units, areas and rate. Nothing folded away.
const AREA_COLS = [
  ["CarpetAreaSqFt", "Carpet"],
  ["BuiltUpAreaSqFt", "Built-up"],
  ["SuperBuiltUpAreaSqFt", "Super built-up"],
  ["RatePerSqFt", "Rate / sq ft"],
] as const;

function MixEditor({ rows, onChange, kinds, layoutTypes, canEdit }: {
  rows: MixRow[]; onChange: (r: MixRow[]) => void; kinds: KindRow[]; layoutTypes: LayoutType[]; canEdit: boolean;
}) {
  const commercial = kinds.filter((k) => k.IsCommercial);
  const set = (i: number, patch: Partial<MixRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const firstType = unitTypeOptions(layoutTypes)[0]?.value ?? "";
  const cell = "h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-right tabular-nums disabled:opacity-60";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">
            <th className="text-left font-medium pb-1.5 pr-2">Type</th>
            <th className="text-right font-medium pb-1.5 px-1 w-16">Units</th>
            {AREA_COLS.map(([, label]) => <th key={label} className="text-right font-medium pb-1.5 px-1 w-24">{label}</th>)}
            <th className="w-6" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-1 pr-2">
                <select value={r.UnitKind ? `kind:${r.UnitKind}` : r.UnitType} disabled={!canEdit}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v.startsWith("kind:")) { const k = commercial.find((x) => x.Code === v.slice(5)); set(i, { UnitKind: v.slice(5), UnitType: k?.Name || v.slice(5) }); }
                    else set(i, { UnitKind: null, UnitType: v });
                  }} className="h-8 w-full min-w-[8rem] rounded-md border border-border bg-background px-2 text-xs">
                  {commercial.length ? (
                    <>
                      <optgroup label="Residential">
                        {unitTypeOptions(layoutTypes, r.UnitKind ? "" : r.UnitType).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </optgroup>
                      <optgroup label="Commercial">
                        {commercial.map((k) => <option key={k.Code} value={`kind:${k.Code}`}>{k.Name}</option>)}
                      </optgroup>
                    </>
                  ) : unitTypeOptions(layoutTypes, r.UnitType).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </td>
              <td className="py-1 px-1">
                <input type="number" min={1} max={100} value={r.Count} disabled={!canEdit} aria-label="Units"
                  onChange={(e) => set(i, { Count: e.target.value })} className={cell} />
              </td>
              {AREA_COLS.map(([key, label]) => (
                <td key={key} className="py-1 px-1">
                  <input type="number" min={0} value={r[key] ?? ""} disabled={!canEdit} placeholder="—" aria-label={label}
                    onChange={(e) => set(i, { [key]: e.target.value })}
                    className={cell} />
                </td>
              ))}
              <td className="py-1 pl-1 text-center">
                {canEdit && rows.length > 1 && (
                  <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove" className="text-muted-foreground hover:text-red-600"><X size={13} /></button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && (
        <button type="button" onClick={() => onChange([...rows, { UnitType: firstType, Count: 1 }])} className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
          <Plus size={11} /> Add a type
        </button>
      )}
    </div>
  );
}

export function BlockStackEditor({ blockId, blockName, kinds, layoutTypes, canEdit, onChanged }: Props) {
  const qc = useQueryClient();
  const key = ["auto-setup-stack", blockId];
  const { data } = useQuery<{ mixReady: boolean; typical: MixRow[]; floors: FloorRow[] }>({
    queryKey: key,
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/blocks/${blockId}/stack`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to load floors");
      return r.json();
    },
  });
  const [typical, setTypical] = useState<MixRow[]>([]);
  const [editingFloor, setEditingFloor] = useState<number | null>(null);
  const [openFloor, setOpenFloor] = useState<number | null>(null); // expanded (read-only) floor
  const [typicalOpen, setTypicalOpen] = useState<boolean | null>(null); // null = auto: open until first saved
  const [floorDraft, setFloorDraft] = useState<MixRow[]>([]);
  const [busy, setBusy] = useState(false);
  const firstType = unitTypeOptions(layoutTypes)[0]?.value ?? "";

  useEffect(() => {
    if (data) setTypical(data.typical.length ? data.typical.map((r) => ({ ...r })) : [{ UnitType: firstType, Count: 1 }]);
  }, [data, firstType]);
  const savedTypical = useMemo(() => JSON.stringify(data?.typical ?? []), [data]);
  // Unsaved: edited, or the block has no typical floor saved yet.
  const typicalDirty = !!data && (data.typical.length === 0 || JSON.stringify(typical) !== savedTypical);

  const refresh = () => { qc.invalidateQueries({ queryKey: key }); onChanged(); };
  const call = async (url: string, method: string, body: object, ok: string) => {
    setBusy(true);
    try {
      const r = await fetchWithAuth(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || "Couldn't save");
      toast.success(ok);
      refresh();
      return true;
    } catch (e: any) { toast.error(e.message); return false; } finally { setBusy(false); }
  };

  const saveTypical = () => call(`${API}/blocks/${blockId}/unit-template`, "PUT", { Items: typical }, "Typical floor saved — floors updated");
  const saveFloorMix = async (f: FloorRow) => { if (await call(`${API}/floors/${f.Id}/mix`, "PUT", { Items: floorDraft }, `Floor ${f.FloorLabel} saved`)) setEditingFloor(null); };
  const useTypical = (f: FloorRow) => call(`${API}/floors/${f.Id}/mix`, "PUT", { Items: null }, `Floor ${f.FloorLabel} follows the typical floor`);
  const toggleUnits = (f: FloorRow, on: boolean) => call(`${API}/floors/${f.Id}`, "PUT", { HasUnits: on }, on ? `Floor ${f.FloorLabel} has units` : `Floor ${f.FloorLabel}: no units`);

  if (!data) return <div className="text-xs text-muted-foreground p-2">Loading floors…</div>;
  // Locked once saved; open the first time (nothing saved yet) or after Edit.
  const typicalEditing = typicalOpen ?? data.typical.length === 0;
  // Shown live from what's being typed, saved or not.
  const typTotal = total(typical);
  const pending = data.floors.filter((f) => !f.IsGenerated && f.HasUnits).reduce((s, f) => s + (f.ownMix ? total(f.ownMix) : typTotal), 0);

  return (
    <div className="space-y-3">
      {/* Typical floor — defined once, used by every floor that isn't "own mix". */}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {!typicalEditing && <Lock size={11} className="text-muted-foreground" />}
          <span className="text-xs font-semibold">Typical floor</span>
          <span className="text-[0.6875rem] text-muted-foreground">applies to every floor unless a floor has its own mix</span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">{total(typical)} per floor</span>
          {canEdit && !typicalEditing && (
            <button type="button" onClick={() => setTypicalOpen(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-border text-primary hover:bg-primary/5">
              <Pencil size={11} /> Edit
            </button>
          )}
        </div>
        <MixEditor rows={typical} onChange={setTypical} kinds={kinds} layoutTypes={layoutTypes} canEdit={canEdit && typicalEditing} />
        {canEdit && typicalEditing && (
          <div className="flex justify-end gap-2">
            {data.typical.length > 0 && (
              <button type="button" onClick={() => { setTypical(data.typical.map((r) => ({ ...r }))); setTypicalOpen(false); }} className="px-3 py-1.5 text-xs rounded-lg border border-border">Cancel</button>
            )}
            <button type="button" onClick={async () => { if (await saveTypical()) setTypicalOpen(false); }} disabled={busy || !typicalDirty}
              className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">Save typical floor</button>
          </div>
        )}
      </div>

      {/* The building, top floor first. */}
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-[0.625rem] uppercase tracking-wide text-muted-foreground">
            <tr><th className="text-left px-3 py-2 w-16">Floor</th><th className="text-left px-3 py-2">Units on this floor</th><th className="text-right px-3 py-2 w-16">Total</th></tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {data.floors.map((f) => {
              const isOpen = openFloor === f.Id;
              const isEditing = editingFloor === f.Id;
              const rows = f.ownMix || typical;
              const label = f.FloorNo === 0 ? "G" : f.FloorLabel;
              return (
                <React.Fragment key={f.Id}>
                  {/* Summary row — click to see this floor's configuration (read-only until Edit). */}
                  <tr onClick={() => { if (!isEditing) setOpenFloor(isOpen ? null : f.Id); }}
                    className={`cursor-pointer transition-colors ${f.IsGenerated ? "bg-emerald-500/5" : isOpen ? "bg-primary/5" : "hover:bg-muted/40"}`}>
                    <td className="px-3 py-2 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {isOpen ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
                        {label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {f.FloorNo === 0 && !f.IsGenerated && (
                          <span className="inline-flex items-center gap-2 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                            <button type="button" role="switch" aria-checked={!!f.HasUnits} aria-label="Sellable units on the ground floor"
                              disabled={!canEdit || busy} onClick={() => toggleUnits(f, !f.HasUnits)}
                              className={`relative h-4 w-7 rounded-full transition-colors ${f.HasUnits ? "bg-primary" : "bg-muted-foreground/30"}`}>
                              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${f.HasUnits ? "left-3.5" : "left-0.5"}`} />
                            </button>
                            {!f.HasUnits && "No sellable units"}
                          </span>
                        )}
                        {f.IsGenerated ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><Lock size={11} /> {f.GeneratedUnitCount} unit(s) created</span>
                        ) : f.HasUnits && (f.ownMix ? (
                          <>
                            <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-violet-700 dark:text-violet-300">Own mix</span>
                            <span>{describe(f.ownMix)}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">Same as typical · {describe(typical)}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {f.IsGenerated ? f.GeneratedUnitCount : f.HasUnits ? total(rows) : "—"}
                    </td>
                  </tr>

                  {/* Detail — locked view first, Edit to change. */}
                  {isOpen && (
                    <tr className="bg-muted/10">
                      <td />
                      <td colSpan={2} className="px-3 pb-3 pt-1">
                        {f.IsGenerated ? (
                          <p className="text-xs text-muted-foreground">Units on this floor are created — change them in Unit Master.</p>
                        ) : !f.HasUnits ? (
                          <p className="text-xs text-muted-foreground">No sellable units on this floor. Turn the switch on to add some.</p>
                        ) : isEditing ? (
                          <div className="space-y-2">
                            <MixEditor rows={floorDraft} onChange={setFloorDraft} kinds={kinds} layoutTypes={layoutTypes} canEdit={canEdit} />
                            <div className="flex flex-wrap items-center gap-2">
                              <button type="button" onClick={() => saveFloorMix(f)} disabled={busy} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary disabled:opacity-40">Save floor {label}</button>
                              <button type="button" onClick={() => setEditingFloor(null)} className="px-3 py-1.5 text-xs rounded-lg border border-border">Cancel</button>
                              <span className="text-[0.6875rem] text-muted-foreground">Saving gives this floor its own mix; other floors keep the typical floor.</span>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <MixEditor rows={rows} onChange={() => {}} kinds={kinds} layoutTypes={layoutTypes} canEdit={false} />
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
                                <Lock size={11} /> {f.ownMix ? "This floor's own mix" : "Follows the typical floor"}
                              </span>
                              {canEdit && (
                                <span className="ml-auto flex gap-2">
                                  {f.ownMix && (
                                    <button type="button" onClick={() => useTypical(f)} disabled={busy} className="px-3 py-1.5 text-xs rounded-lg border border-border">Use typical floor</button>
                                  )}
                                  <button type="button"
                                    onClick={() => {
                                      if (!data.mixReady) { toast.error("Editing one floor needs database migration 530 — run the migrations and reload."); return; }
                                      setFloorDraft(rows.map((r) => ({ ...r }))); setEditingFloor(f.Id);
                                    }}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-border text-primary hover:bg-primary/5">
                                    <Pencil size={11} /> Edit floor {label}
                                  </button>
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {pending > 0 ? <span><b className="text-foreground">{pending}</b> unit(s) in {blockName} ready to generate.</span>
          : <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} className="text-emerald-600" /> Nothing pending in {blockName}.</span>}
      </div>
    </div>
  );
}
