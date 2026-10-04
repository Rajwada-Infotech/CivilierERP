import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, ChevronRight, Lock, Plus, X } from "lucide-react";
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

// One editable mix (typical or a floor's own).
function MixEditor({ rows, onChange, kinds, layoutTypes, canEdit, showDetails }: {
  rows: MixRow[]; onChange: (r: MixRow[]) => void; kinds: KindRow[]; layoutTypes: LayoutType[]; canEdit: boolean; showDetails?: boolean;
}) {
  const [openDetails, setOpenDetails] = useState<number | null>(null);
  const commercial = kinds.filter((k) => k.IsCommercial);
  const set = (i: number, patch: Partial<MixRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const firstType = unitTypeOptions(layoutTypes)[0]?.value ?? "";
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <input type="number" min={1} max={100} value={r.Count} disabled={!canEdit} aria-label="How many"
              onChange={(e) => set(i, { Count: e.target.value })} className={`${inputCls} w-14 text-right tabular-nums`} />
            <span className="text-xs text-muted-foreground">×</span>
            <select value={r.UnitKind ? `kind:${r.UnitKind}` : r.UnitType} disabled={!canEdit}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith("kind:")) { const k = commercial.find((x) => x.Code === v.slice(5)); set(i, { UnitKind: v.slice(5), UnitType: k?.Name || v.slice(5) }); }
                else set(i, { UnitKind: null, UnitType: v });
              }} className={`${inputCls} min-w-[9rem]`}>
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
            {showDetails && (
              <button type="button" onClick={() => setOpenDetails(openDetails === i ? null : i)} className="text-[0.6875rem] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5">
                {openDetails === i ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Area & rate
              </button>
            )}
            {canEdit && rows.length > 1 && (
              <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove" className="text-muted-foreground hover:text-red-600"><X size={13} /></button>
            )}
          </div>
          {showDetails && openDetails === i && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 pl-16">
              {([["CarpetAreaSqFt", "Carpet"], ["BuiltUpAreaSqFt", "Built-up"], ["SuperBuiltUpAreaSqFt", "Super built-up"], ["OpenTerraceAreaSqFt", "Open terrace"], ["RatePerSqFt", "Rate / sq ft"]] as const).map(([key, label]) => (
                <label key={key} className="text-[0.625rem] text-muted-foreground">{label}
                  <input type="number" min={0} value={r[key] ?? ""} disabled={!canEdit} onChange={(e) => set(i, { [key]: e.target.value })} className={`${inputCls} w-full`} />
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
      {canEdit && (
        <button type="button" onClick={() => onChange([...rows, { UnitType: firstType, Count: 1 }])} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
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
  const typTotal = total(data.typical);
  const pending = data.floors.filter((f) => !f.IsGenerated && f.HasUnits).reduce((s, f) => s + (f.ownMix ? total(f.ownMix) : typTotal), 0);

  return (
    <div className="space-y-3">
      {/* Typical floor — defined once, used by every floor that isn't "own mix". */}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold">Typical floor</span>
          <span className="text-[0.6875rem] text-muted-foreground">every floor below uses this unless set to its own mix</span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">{total(typical)} per floor</span>
        </div>
        <MixEditor rows={typical} onChange={setTypical} kinds={kinds} layoutTypes={layoutTypes} canEdit={canEdit} showDetails />
        {canEdit && typicalDirty && (
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setTypical(data.typical.length ? data.typical.map((r) => ({ ...r })) : [{ UnitType: firstType, Count: 1 }])} className="px-3 py-1.5 text-xs rounded-lg border border-border">Undo</button>
            <button type="button" onClick={saveTypical} disabled={busy} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">Save typical floor</button>
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
            {data.floors.map((f) => (
              <tr key={f.Id} className={f.IsGenerated ? "bg-emerald-500/5" : ""}>
                <td className="px-3 py-2 font-medium align-top">{f.FloorNo === 0 ? "G" : f.FloorLabel}</td>
                <td className="px-3 py-2">
                  {f.IsGenerated ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><Lock size={11} /> {f.GeneratedUnitCount} unit(s) created — edit them in Unit Master</span>
                  ) : editingFloor === f.Id ? (
                    <div className="space-y-2">
                      <MixEditor rows={floorDraft} onChange={setFloorDraft} kinds={kinds} layoutTypes={layoutTypes} canEdit={canEdit} showDetails />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => saveFloorMix(f)} disabled={busy} className="px-3 py-1 text-xs font-semibold text-white rounded-lg bg-primary disabled:opacity-40">Save floor</button>
                        <button type="button" onClick={() => setEditingFloor(null)} className="px-3 py-1 text-xs rounded-lg border border-border">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-1 text-muted-foreground">
                        <input type="checkbox" checked={!!f.HasUnits} disabled={!canEdit || busy} onChange={(e) => toggleUnits(f, e.target.checked)} /> has units
                      </label>
                      {f.HasUnits && (f.ownMix ? (
                        <>
                          <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-violet-700 dark:text-violet-300">Own mix</span>
                          <span>{describe(f.ownMix)}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Same as typical · {describe(data.typical)}</span>
                      ))}
                      {canEdit && f.HasUnits && data.mixReady && (
                        <span className="ml-auto flex gap-2">
                          <button type="button" onClick={() => { setFloorDraft((f.ownMix || data.typical).map((r) => ({ ...r }))); setEditingFloor(f.Id); }} className="text-primary hover:underline">
                            {f.ownMix ? "Edit own mix" : "Set own mix"}
                          </button>
                          {f.ownMix && <button type="button" onClick={() => useTypical(f)} className="text-muted-foreground hover:text-foreground">Use typical</button>}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums align-top">
                  {f.IsGenerated ? f.GeneratedUnitCount : f.HasUnits ? (f.ownMix ? total(f.ownMix) : typTotal) : "—"}
                </td>
              </tr>
            ))}
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
