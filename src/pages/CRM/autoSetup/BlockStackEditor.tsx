import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Pencil, Plus, X } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SheetMark } from "@/components/sheet/Sheet";
import { unitTypeOptions, type LayoutType } from "@/api/unitBhkConfigApi";
import { INP, KEY_INK, KEY_LINE, LBL, NUM, RULE, RULE_SOFT, TEXT_LINK } from "./config";

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

const total = (rows: MixRow[] | null | undefined) => (rows || []).reduce((s, r) => s + (parseInt(String(r.Count), 10) || 0), 0);
const describe = (rows: MixRow[] | null | undefined) =>
  (rows || []).filter((r) => (parseInt(String(r.Count), 10) || 0) > 0).map((r) => `${r.Count} × ${r.UnitType}`).join(" + ") || "—";

interface Props {
  /** Generated floors: load + render their real units (edit / delete in place). */
  onOpenGeneratedFloor?: (floor: { Id: number }) => void;
  renderGeneratedFloor?: (floorId: number) => React.ReactNode;
  paymentPlans?: { Id: number; PlanName: string; IsActive: boolean }[];
  blockId: number;
  blockName: string;
  kinds: KindRow[];
  layoutTypes: LayoutType[];
  canEdit: boolean;
  onChanged: () => void;
}

// One editable mix (typical or a floor's own) — a compact table with every
// field visible: type, units, areas and rate. Nothing folded away.
// [field, header, unit shown inside the box]
const AREA_COLS = [
  ["CarpetAreaSqFt", "Carpet", "sq ft"],
  ["BuiltUpAreaSqFt", "Built-up", "sq ft"],
  ["SuperBuiltUpAreaSqFt", "Super built-up", "sq ft"],
  ["RatePerSqFt", "Rate", "₹/sq ft"],
] as const;

const FIELD_LABEL = LBL;

// Number box with its unit inside, on the right — wide enough for real
// figures (1,800 / 12,500) and no spinner arrows eating the space.
function NumBox({ value, onChange, disabled, unit, label, min = 0, max }: {
  value: string | number | null | undefined; onChange: (v: string) => void; disabled: boolean;
  unit?: string; label: string; min?: number; max?: number;
}) {
  return (
    <div className="relative">
      <input type="number" inputMode="decimal" min={min} max={max} value={value ?? ""} disabled={disabled}
        placeholder="—" aria-label={label} onChange={(e) => onChange(e.target.value)}
        className={`${INP} ${NUM} text-right disabled:opacity-60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
          ${unit ? "!pr-12" : ""}`} />
      {unit && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[0.6875rem] text-muted-foreground">{unit}</span>}
    </div>
  );
}

function MixEditor({ rows, onChange, kinds, layoutTypes, canEdit }: {
  rows: MixRow[]; onChange: (r: MixRow[]) => void; kinds: KindRow[]; layoutTypes: LayoutType[]; canEdit: boolean;
}) {
  const commercial = kinds.filter((k) => k.IsCommercial);
  const set = (i: number, patch: Partial<MixRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const firstType = unitTypeOptions(layoutTypes)[0]?.value ?? "";
  return (
    <div>
      {/* One line per type: labelled fields that wrap onto a second line when
          the panel is narrow — never squeezed, never a sideways scrollbar. */}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-x-2.5 gap-y-2 bg-card p-2.5" style={{ border: RULE_SOFT }}>
            <label className="flex min-w-[10rem] flex-[1.6_1_10rem] flex-col gap-1">
              <span className={FIELD_LABEL}>Type</span>
              <select value={r.UnitKind ? `kind:${r.UnitKind}` : r.UnitType} disabled={!canEdit}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith("kind:")) { const k = commercial.find((x) => x.Code === v.slice(5)); set(i, { UnitKind: v.slice(5), UnitType: k?.Name || v.slice(5) }); }
                  else set(i, { UnitKind: null, UnitType: v });
                }} className={`${INP} disabled:opacity-60`}>
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
            </label>
            <label className="flex w-[5.5rem] flex-none flex-col gap-1">
              <span className={FIELD_LABEL}>Units</span>
              <NumBox value={r.Count} min={1} max={100} disabled={!canEdit} label="Units" onChange={(v) => set(i, { Count: v })} />
            </label>
            {AREA_COLS.map(([key, label, unit]) => (
              <label key={key} className="flex min-w-[8rem] flex-[1_1_8rem] flex-col gap-1">
                <span className={FIELD_LABEL}>{label}</span>
                <NumBox value={r[key]} unit={unit} disabled={!canEdit} label={label} onChange={(v) => set(i, { [key]: v })} />
              </label>
            ))}
            {canEdit && rows.length > 1 && (
              <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove this type" title="Remove this type"
                className="inline-flex h-9 w-9 flex-none items-center justify-center text-muted-foreground hover:text-destructive"><X size={15} /></button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <button type="button" onClick={() => onChange([...rows, { UnitType: firstType, Count: 1 }])} className={`mt-2 inline-flex items-center gap-1 ${TEXT_LINK}`}>
          <Plus size={12} /> Add a type
        </button>
      )}
    </div>
  );
}

export function BlockStackEditor({ blockId, blockName, kinds, layoutTypes, canEdit, onChanged, paymentPlans = [], onOpenGeneratedFloor, renderGeneratedFloor }: Props) {
  const qc = useQueryClient();
  const key = ["auto-setup-stack", blockId];
  const { data, isError, error } = useQuery<{ mixReady: boolean; paymentPlanIds: number[]; typical: MixRow[]; floors: FloorRow[] }>({
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

  const saveTypical = () => call(`${API}/blocks/${blockId}/unit-template`, "PUT", { Items: typical, PaymentPlanIds: data?.paymentPlanIds ?? [] }, "Typical floor saved — floors updated");
  // Payment plans every unit generated in this block gets (saved with the typical floor).
  const togglePlan = (id: number) => {
    if (!data) return;
    if (!data.typical.length) { toast.error("Save the typical floor first, then pick payment plans."); return; }
    const cur = data.paymentPlanIds ?? [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    call(`${API}/blocks/${blockId}/unit-template`, "PUT", { Items: data.typical, PaymentPlanIds: next }, "Payment plans updated");
  };
  const saveFloorMix = async (f: FloorRow) => { if (await call(`${API}/floors/${f.Id}/mix`, "PUT", { Items: floorDraft }, `Floor ${f.FloorLabel} saved`)) setEditingFloor(null); };
  const useTypical = (f: FloorRow) => call(`${API}/floors/${f.Id}/mix`, "PUT", { Items: null }, `Floor ${f.FloorLabel} follows the typical floor`);
  const toggleUnits = (f: FloorRow, on: boolean) => call(`${API}/floors/${f.Id}`, "PUT", { HasUnits: on }, on ? `Floor ${f.FloorLabel} has units` : `Floor ${f.FloorLabel}: no units`);

  if (isError) return <p className="text-xs text-destructive">{(error as Error)?.message}</p>;
  if (!data) return <p className="text-xs text-muted-foreground">Loading floors…</p>;
  // Locked once saved; open the first time (nothing saved yet) or after Edit.
  const typicalEditing = typicalOpen ?? data.typical.length === 0;
  // Shown live from what's being typed, saved or not.
  const typTotal = total(typical);
  const pending = data.floors.filter((f) => !f.IsGenerated && f.HasUnits).reduce((s, f) => s + (f.ownMix ? total(f.ownMix) : typTotal), 0);

  return (
    <div className="space-y-3">
      {/* Typical floor — defined once, used by every floor that isn't "own mix". */}
      <div className="bg-card p-3 space-y-2.5" style={{ border: RULE }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">Typical floor</span>
          <span className="text-xs text-muted-foreground">applies to every floor unless a floor has its own mix</span>
          <span className="ml-auto text-xs text-muted-foreground"><span className={`${NUM} text-foreground`}>{total(typical)}</span> per floor</span>
          {canEdit && !typicalEditing && (
            <button type="button" onClick={() => setTypicalOpen(true)} className={`${KEY_LINE} h-7 px-2.5`}>
              <Pencil size={11} /> Edit
            </button>
          )}
        </div>
        <MixEditor rows={typical} onChange={setTypical} kinds={kinds} layoutTypes={layoutTypes} canEdit={canEdit && typicalEditing} />
        {canEdit && typicalEditing && (
          <div className="flex justify-end gap-2">
            {data.typical.length > 0 && (
              <button type="button" onClick={() => { setTypical(data.typical.map((r) => ({ ...r }))); setTypicalOpen(false); }} className={`${KEY_LINE} h-8 px-3`}>Cancel</button>
            )}
            <button type="button" onClick={async () => { if (await saveTypical()) setTypicalOpen(false); }} disabled={busy || !typicalDirty}
              className={`${KEY_INK} h-8 px-3`}>Save typical floor</button>
          </div>
        )}
      </div>

      {/* Payment plans for units generated in this block. */}
      {paymentPlans.filter((p) => p.IsActive).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`${LBL} mr-1`}>Payment plans</span>
          {paymentPlans.filter((p) => p.IsActive).map((p) => {
            const on = (data.paymentPlanIds ?? []).includes(p.Id);
            return (
              <button key={p.Id} type="button" disabled={!canEdit || busy} onClick={() => togglePlan(p.Id)} aria-pressed={on}
                className={`h-7 px-2.5 text-xs border transition-colors disabled:opacity-60 ${on ? "bg-foreground text-card border-foreground" : "border-foreground/30 hover:border-foreground"}`}>
                {p.PlanName}
              </button>
            );
          })}
        </div>
      )}

      {/* The building, top floor first. */}
      <div className="bg-card overflow-x-auto thin-scroll" style={{ border: RULE }}>
        <table className="w-full text-xs min-w-[360px]">
          <thead>
            <tr style={{ borderBottom: RULE }}>
              <th className={`!px-3 !py-2 text-left w-16 ${LBL}`}>Floor</th><th className={`!px-3 !py-2 text-left ${LBL}`}>Units on this floor</th><th className={`!px-3 !py-2 text-right w-16 ${LBL}`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {data.floors.map((f) => {
              const isOpen = openFloor === f.Id;
              const isEditing = editingFloor === f.Id;
              const rows = f.ownMix || typical;
              const label = f.FloorNo === 0 ? "G" : f.FloorLabel;
              return (
                <React.Fragment key={f.Id}>
                  {/* Summary row — click to see this floor's configuration (read-only until Edit). */}
                  <tr onClick={() => {
                      if (isEditing) return;
                      if (!isOpen && f.IsGenerated) onOpenGeneratedFloor?.(f);
                      setOpenFloor(isOpen ? null : f.Id);
                    }}
                    className={`cursor-pointer transition-colors ${isOpen ? "bg-primary/5" : "hover:bg-primary/5"}`} style={{ borderBottom: RULE_SOFT }}>
                    <td className={`!px-3 !py-2 font-medium ${NUM}`}>
                      <span className="inline-flex items-center gap-1.5">
                        {isOpen ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
                        {label}
                      </span>
                    </td>
                    <td className="!px-3 !py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {f.FloorNo === 0 && !f.IsGenerated && (
                          <span className="inline-flex items-center gap-2 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                            <button type="button" role="switch" aria-checked={!!f.HasUnits} aria-label="Sellable units on the ground floor"
                              disabled={!canEdit || busy} onClick={() => toggleUnits(f, !f.HasUnits)}
                              className={`relative h-4 w-7 border border-foreground transition-colors disabled:opacity-50 ${f.HasUnits ? "bg-foreground" : "bg-card"}`}>
                              <span className={`absolute top-[2px] h-2.5 w-2.5 transition-all ${f.HasUnits ? "left-[14px] bg-card" : "left-[2px] bg-foreground"}`} />
                            </button>
                            {!f.HasUnits && "No sellable units"}
                          </span>
                        )}
                        {f.IsGenerated ? (
                          <SheetMark text={`${f.GeneratedUnitCount} unit(s) created`} tone="done" />
                        ) : f.HasUnits && (f.ownMix ? (
                          <>
                            <SheetMark text="Own mix" tone="moving" />
                            <span>{describe(f.ownMix)}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">Same as typical · {describe(typical)}</span>
                        ))}
                      </div>
                    </td>
                    <td className={`!px-3 !py-2 text-right ${NUM}`}>
                      {f.IsGenerated ? f.GeneratedUnitCount : f.HasUnits ? total(rows) : "—"}
                    </td>
                  </tr>

                  {/* Detail — locked view first, Edit to change. */}
                  {isOpen && (
                    <tr className="bg-primary/[0.03]" style={{ borderBottom: RULE_SOFT }}>
                      <td />
                      <td colSpan={2} className="!px-3 !pb-3 !pt-1">
                        {f.IsGenerated ? (
                          renderGeneratedFloor ? renderGeneratedFloor(f.Id)
                            : <p className="text-xs text-muted-foreground">Units on this floor are created — change them in Unit Master.</p>
                        ) : !f.HasUnits ? (
                          <p className="text-xs text-muted-foreground">No sellable units on this floor. Turn the switch on to add some.</p>
                        ) : isEditing ? (
                          <div className="space-y-2">
                            <MixEditor rows={floorDraft} onChange={setFloorDraft} kinds={kinds} layoutTypes={layoutTypes} canEdit={canEdit} />
                            <div className="flex flex-wrap items-center gap-2">
                              <button type="button" onClick={() => saveFloorMix(f)} disabled={busy} className={`${KEY_INK} h-8 px-3`}>Save floor {label}</button>
                              <button type="button" onClick={() => setEditingFloor(null)} className={`${KEY_LINE} h-8 px-3`}>Cancel</button>
                              <span className="text-xs text-muted-foreground">Saving gives this floor its own mix; other floors keep the typical floor.</span>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <MixEditor rows={rows} onChange={() => {}} kinds={kinds} layoutTypes={layoutTypes} canEdit={false} />
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs text-muted-foreground">{f.ownMix ? "This floor's own mix" : "Follows the typical floor"}</span>
                              {canEdit && (
                                <span className="ml-auto flex gap-2">
                                  {f.ownMix && (
                                    <button type="button" onClick={() => useTypical(f)} disabled={busy} className={`${KEY_LINE} h-8 px-3`}>Use typical floor</button>
                                  )}
                                  <button type="button"
                                    onClick={() => {
                                      if (!data.mixReady) { toast.error("Editing one floor needs database migration 530 — run the migrations and reload."); return; }
                                      setFloorDraft(rows.map((r) => ({ ...r }))); setEditingFloor(f.Id);
                                    }}
                                    className={`${KEY_LINE} h-8 px-3`}>
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
        {pending > 0 ? <span><b className={`${NUM} text-foreground`}>{pending}</b> unit(s) in {blockName} ready to generate.</span>
          : <SheetMark text={`Nothing pending in ${blockName}`} tone="done" />}
      </div>
    </div>
  );
}
