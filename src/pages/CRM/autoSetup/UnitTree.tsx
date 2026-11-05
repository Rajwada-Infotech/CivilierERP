// A block's floors and their real units — the drill-down Auto Project Setup shows in the overview, the Blocks step,
// the Floor Plan step and Unit Generation — plus the overview itself. Units are edited and deleted through Unit
// Master's own endpoints (they enforce the booking / hold / application lock).
import React, { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SheetMark } from "@/components/sheet/Sheet";
import { unitTypeOptions, type LayoutType } from "@/api/unitBhkConfigApi";
import { API, INP, KEY_INK, KEY_LINE, LBL, NUM, RULE, RULE_SOFT, TEXT_LINK, firstPickableType, lockOf, plural, type KindRow, type UnitEdit } from "./config";

export interface UnitCtx {
  floorUnits: Record<number, any[]>;
  loadingFloorId: number | null;
  editingUnitId: number | null;
  editingUnit: UnitEdit | null;
  savingUnitId: number | null;
  unitTypesMaster: LayoutType[];
  commercialKinds: KindRow[];
  canEdit: boolean;
  canDelete: boolean;
  startEdit: (unit: any) => void;
  change: (patch: Partial<UnitEdit>) => void;
  cancel: () => void;
  save: (floorId: number, unit: any) => void;
  remove: (floorId: number, unit: any) => void;
}

/** The units loaded per floor and the one unit being edited — shared by every place a floor can be opened. */
export function useUnitEditing({ unitTypesMaster, commercialKinds, defaultKind, canEdit, canDelete, confirm, onChanged }: {
  unitTypesMaster: LayoutType[]; commercialKinds: KindRow[]; defaultKind?: string | null; canEdit: boolean; canDelete: boolean;
  confirm: (message: string, opts?: { okLabel?: string; danger?: boolean }) => Promise<boolean>; onChanged: () => void;
}) {
  const [floorUnits, setFloorUnits] = useState<Record<number, any[]>>({});
  const [loadingFloorId, setLoadingFloorId] = useState<number | null>(null);
  const [editingUnitId, setEditingUnitId] = useState<number | null>(null);
  const [editingUnit, setEditingUnit] = useState<UnitEdit | null>(null);
  const [savingUnitId, setSavingUnitId] = useState<number | null>(null);

  // A floor's units, fetched the first time it's opened. A failed load says so (it used to read "No units left").
  const loadFloor = async (f: { Id: number }) => {
    if (floorUnits[f.Id]) return;
    setLoadingFloorId(f.Id);
    try {
      const res = await fetchWithAuth(`${API}/floors/${f.Id}/units`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load this floor's units");
      setFloorUnits((m) => ({ ...m, [f.Id]: data.units || [] }));
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setLoadingFloorId(null);
    }
  };
  // Each place keeps its own "which floor is open", so opening a floor in one doesn't open it in the others.
  const toggle = (f: { Id: number }, current: number | null, setCurrent: (v: number | null) => void) => {
    if (current === f.Id) { setCurrent(null); return; }
    setCurrent(f.Id);
    loadFloor(f);
  };

  const isCommercial = (code?: string | null) => commercialKinds.some((k) => k.Code === code);
  const cancel = () => { setEditingUnitId(null); setEditingUnit(null); };
  const startEdit = (unit: any) => {
    setEditingUnitId(unit.Id);
    const str = (v: any) => (v != null ? String(v) : "");
    setEditingUnit({
      UnitName: unit.UnitName || "",
      FloorNo: str(unit.FloorNo),
      UnitKind: isCommercial(unit.UnitKind) ? unit.UnitKind : "",
      UnitType: isCommercial(unit.UnitKind) ? "" : (unit.UnitType || firstPickableType(unitTypesMaster)),
      AreaSqFt: str(unit.AreaSqFt),
      CarpetAreaSqFt: str(unit.CarpetAreaSqFt),
      BuiltUpAreaSqFt: str(unit.BuiltUpAreaSqFt),
      SuperBuiltUpAreaSqFt: unit.SuperBuiltUpAreaSqFt != null ? String(unit.SuperBuiltUpAreaSqFt) : str(unit.AreaSqFt),
      OpenTerraceAreaSqFt: str(unit.OpenTerraceAreaSqFt),
      RatePerSqFt: str(unit.RatePerSqFt),
    });
  };

  const save = async (floorId: number, unit: any) => {
    const e = editingUnit;
    if (!e) return;
    const unitName = e.UnitName.trim();
    if (!unitName) { toast.error("Unit name is required"); return; }
    const floorNo = e.FloorNo !== "" ? parseInt(e.FloorNo, 10) : null;
    setSavingUnitId(unit.Id);
    try {
      const res = await fetchWithAuth(`/api/unit-master/${unit.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ProjectId: unit.ProjectId,
          BlockId: unit.BlockId,
          UnitName: unitName,
          FloorNo: floorNo,
          UnitType: e.UnitKind ? null : (e.UnitType || null),
          UnitKind: e.UnitKind || defaultKind || undefined,
          AreaSqFt: e.AreaSqFt || null,
          CarpetAreaSqFt: e.CarpetAreaSqFt || null,
          BuiltUpAreaSqFt: e.BuiltUpAreaSqFt || null,
          SuperBuiltUpAreaSqFt: e.SuperBuiltUpAreaSqFt || null,
          OpenTerraceAreaSqFt: e.OpenTerraceAreaSqFt || null,
          RatePerSqFt: e.RatePerSqFt || null,
          IsActive: unit.IsActive !== false,
          PaymentPlanIds: unit.PaymentPlanIds ? String(unit.PaymentPlanIds).split(",").map((x) => parseInt(x, 10)).filter(Number.isFinite) : [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update unit");
      // A Unit Type change rebuilds the unit's rooms from the new layout.
      const rs = data.roomSync;
      toast.success(
        (data.message || "Unit updated")
        + (rs?.added ? ` — ${rs.added} room(s) added from the ${rs.layout} layout` : "")
        + (rs?.deactivated ? `, ${rs.deactivated} old room(s) deactivated` : ""),
      );
      if (rs?.keptWithWork?.length) {
        toast.warning(`Kept ${rs.keptWithWork.join(", ")} — not in the new layout but has DPR work recorded against it.`);
      }
      setFloorUnits((m) => ({
        ...m,
        [floorId]: (m[floorId] || []).map((u) => u.Id === unit.Id
          ? { ...u, UnitName: unitName, UnitType: e.UnitKind ? null : e.UnitType,
              UnitKind: e.UnitKind || defaultKind || u.UnitKind,
              KindName: e.UnitKind ? commercialKinds.find((k) => k.Code === e.UnitKind)?.Name : null,
              CarpetAreaSqFt: e.CarpetAreaSqFt || null,
              BuiltUpAreaSqFt: e.BuiltUpAreaSqFt || null,
              SuperBuiltUpAreaSqFt: e.SuperBuiltUpAreaSqFt || null,
              OpenTerraceAreaSqFt: e.OpenTerraceAreaSqFt || null,
              RatePerSqFt: e.RatePerSqFt || null,
              AreaSqFt: e.AreaSqFt || null }
          : u),
      }));
      cancel();
      onChanged();
    } catch (err: any) {
      toast.error(translateError(err.message));
    } finally {
      setSavingUnitId(null);
    }
  };

  const remove = async (floorId: number, unit: any) => {
    if (!(await confirm(`Delete unit "${unit.UnitName}"?`, { okLabel: "Delete", danger: true }))) return;
    try {
      const res = await fetchWithAuth(`/api/unit-master/${unit.Id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete unit");
      toast.success(data.message || "Unit deleted");
      setFloorUnits((m) => ({ ...m, [floorId]: (m[floorId] || []).filter((u) => u.Id !== unit.Id) }));
      onChanged();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const ctx: UnitCtx = {
    floorUnits, loadingFloorId, editingUnitId, editingUnit, savingUnitId, unitTypesMaster, commercialKinds, canEdit, canDelete,
    startEdit, change: (patch) => setEditingUnit((u) => (u ? { ...u, ...patch } : u)), cancel, save, remove,
  };
  return { ctx, toggle, loadFloor };
}

const AREA_FIELDS: [keyof UnitEdit, string][] = [
  ["AreaSqFt", "Saleable sq ft"], ["CarpetAreaSqFt", "Carpet sq ft"], ["BuiltUpAreaSqFt", "Built-up sq ft"],
  ["SuperBuiltUpAreaSqFt", "Super built-up sq ft"], ["OpenTerraceAreaSqFt", "Open terrace sq ft"], ["RatePerSqFt", "Rate ₹ / sq ft"],
];
const SMALL_INP = `${INP} !h-8 !text-xs`;

/** One floor's units as a grid of tags; a tag opens to its state, Edit and Delete. */
export const FloorUnitList: React.FC<{ floorId: number; ctx: UnitCtx }> = ({ floorId, ctx }) => {
  const [openUnitId, setOpenUnitId] = useState<number | null>(null);
  const units = ctx.floorUnits[floorId];
  const { editingUnit: e } = ctx;

  return (
    <div className="mt-2 space-y-2">
      {ctx.loadingFloorId === floorId ? (
        <p className="text-xs text-muted-foreground">Loading units…</p>
      ) : !units ? (
        <p className="text-xs text-destructive">The units didn&apos;t load. Close the floor and open it again.</p>
      ) : units.length === 0 ? (
        <p className="text-xs text-muted-foreground">No units left on this floor.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
          {units.map((u) => {
            const lock = lockOf(u);
            const isOpen = openUnitId === u.Id;
            if (ctx.editingUnitId === u.Id && e) {
              return (
                <div key={u.Id} className="col-span-2 sm:col-span-3 lg:col-span-4 bg-card p-3 space-y-3" style={{ border: RULE }}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className={`block ${LBL}`}>Unit name</span>
                      <input autoFocus value={e.UnitName} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                        name={`unit-name-${u.Id}`} onChange={(ev) => ctx.change({ UnitName: ev.target.value })} className={`${SMALL_INP} ${NUM}`} />
                    </label>
                    <label className="space-y-1">
                      <span className={`block ${LBL}`}>Unit type</span>
                      <select value={e.UnitKind ? `kind:${e.UnitKind}` : e.UnitType}
                        onChange={(ev) => {
                          const v = ev.target.value;
                          ctx.change(v.startsWith("kind:") ? { UnitKind: v.slice(5), UnitType: "" } : { UnitKind: "", UnitType: v });
                        }}
                        title={ctx.unitTypesMaster.find((t) => t.label === e.UnitType)?.summary || undefined} className={SMALL_INP}>
                        {!e.UnitType && !e.UnitKind && <option value="" disabled>Select a unit type</option>}
                        {ctx.commercialKinds.length ? (
                          <>
                            <optgroup label="Residential">
                              {unitTypeOptions(ctx.unitTypesMaster, u.UnitType).map((o) => <option key={o.value} value={o.value} title={o.title}>{o.label}</option>)}
                            </optgroup>
                            <optgroup label="Commercial">
                              {ctx.commercialKinds.map((k) => <option key={k.Code} value={`kind:${k.Code}`}>{k.Name}</option>)}
                            </optgroup>
                          </>
                        ) : unitTypeOptions(ctx.unitTypesMaster, u.UnitType).map((o) => <option key={o.value} value={o.value} title={o.title}>{o.label}</option>)}
                      </select>
                    </label>
                  </div>
                  {/* Only a unit with no floor (the Unassigned row) gets a floor here; the others keep the one the setup gave them. */}
                  {u.FloorNo == null && (
                    <label className="block space-y-1 max-w-[10rem]">
                      <span className={`block ${LBL}`}>Floor no. <span className="text-destructive">*</span></span>
                      <input value={e.FloorNo} type="number" placeholder="e.g. 1" onChange={(ev) => ctx.change({ FloorNo: ev.target.value })} className={`${SMALL_INP} ${NUM}`} />
                    </label>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    {AREA_FIELDS.map(([key, label]) => (
                      <label key={key} className="space-y-1 min-w-0">
                        <span className={`block ${LBL} truncate`}>{label}</span>
                        <input value={e[key] as string} type="number" min={0} placeholder="—"
                          onChange={(ev) => ctx.change({ [key]: ev.target.value })} className={`${SMALL_INP} ${NUM} text-right`} />
                      </label>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE_SOFT }}>
                    <button onClick={ctx.cancel} className={`${KEY_LINE} h-8 px-3`}>Cancel</button>
                    <button onClick={() => ctx.save(floorId, u)} disabled={ctx.savingUnitId === u.Id} className={`${KEY_INK} h-8 px-3`}>
                      {ctx.savingUnitId === u.Id ? "Saving…" : "Save unit"}
                    </button>
                  </div>
                </div>
              );
            }
            const kindName = ctx.commercialKinds.some((k) => k.Code === u.UnitKind) ? (u.KindName || u.UnitKind) : (u.UnitType || "No type set");
            return (
              <div key={u.Id} onClick={() => setOpenUnitId(isOpen ? null : u.Id)}
                className={`p-2.5 text-xs cursor-pointer transition-colors border ${isOpen ? "border-foreground bg-primary/5" : "border-foreground/25 bg-card hover:border-foreground"}`}>
                <div className={`${NUM} font-semibold text-foreground truncate`}>{u.UnitName}</div>
                <div className="mt-0.5 text-muted-foreground truncate">
                  {kindName}
                  {u.AreaSqFt ? <> · <span className={NUM}>{Number(u.AreaSqFt).toLocaleString("en-IN")}</span> sq ft</> : null}
                  {u.RatePerSqFt ? <> · <span className={NUM}>₹{Number(u.RatePerSqFt).toLocaleString("en-IN")}</span>/sq ft</> : null}
                </div>
                <div className="mt-1.5">{lock ? <SheetMark text={lock.text} tone={lock.tone} /> : <SheetMark text="Available" tone="done" />}</div>
                {isOpen && (ctx.canEdit || ctx.canDelete) && (
                  <div onClick={(ev) => ev.stopPropagation()} className="mt-2 pt-2 flex gap-3" style={{ borderTop: RULE_SOFT }}>
                    {ctx.canEdit && <button onClick={() => ctx.startEdit(u)} disabled={!!lock} className={TEXT_LINK}>Edit</button>}
                    {ctx.canDelete && <button onClick={() => ctx.remove(floorId, u)} disabled={!!lock} className={`${TEXT_LINK} text-destructive`}>Delete</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Link to="/crm/setup/unit-master" className={`${TEXT_LINK} inline-block text-muted-foreground`}>Edit details in Unit Master</Link>
    </div>
  );
};

/** A block's floors, top to bottom as stored; a generated floor opens to its units. */
export const BlockFloorTree: React.FC<{ blockFloors: any[]; expandedFloorId: number | null; onToggleFloor: (f: any) => void; ctx: UnitCtx }> =
  ({ blockFloors, expandedFloorId, onToggleFloor, ctx }) => {
    if (!blockFloors.length) return <p className="text-xs text-muted-foreground py-1">No floors yet.</p>;
    const Chevron = ({ open }: { open: boolean }) => (open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />);
    return (
      <div>
        {blockFloors.map((f) => {
          const open = expandedFloorId === f.Id;
          const n = f.GeneratedUnitCount ?? f.UnitCount ?? 0;
          return (
            <div key={f.Id} className="py-1.5" style={{ borderBottom: RULE_SOFT }}>
              {f.FloorNo === -1 ? (
                // Units with no floor at all: open them to give each one a floor.
                <button onClick={() => onToggleFloor(f)} className="w-full flex flex-wrap items-center gap-x-2.5 gap-y-1 text-left text-xs">
                  <Chevron open={open} />
                  <span className="font-medium text-foreground">Unassigned</span>
                  <SheetMark text={`${plural(n, "unit")} with no floor`} tone="stopped" />
                  <span className="text-muted-foreground">Edit each to give it a floor</span>
                </button>
              ) : f.IsGenerated ? (
                <button onClick={() => onToggleFloor(f)} className="w-full flex flex-wrap items-center gap-x-2.5 gap-y-1 text-left text-xs hover:text-primary">
                  <Chevron open={open} />
                  <span className="font-medium">Floor {f.FloorLabel}</span>
                  <span className="text-muted-foreground"><span className={NUM}>{f.GeneratedUnitCount}</span> unit{f.GeneratedUnitCount === 1 ? "" : "s"} generated</span>
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs pl-[20px]">
                  <span className="font-medium">Floor {f.FloorLabel}</span>
                  {f.HasUnits && f.UnitCount > 0
                    ? <SheetMark text={`${plural(f.UnitCount, "unit")} planned — not generated`} tone="waiting" />
                    : <span className="text-muted-foreground">No units planned</span>}
                </div>
              )}
              {open && <div className="pl-[20px]"><FloorUnitList floorId={f.Id} ctx={ctx} /></div>}
            </div>
          );
        })}
      </div>
    );
  };

/** Where a towered project stands: the counts, then each block with what's left to do, opening to its floors. */
export const TowerOverview: React.FC<{
  projectName?: string; blocks: any[]; floors: any[]; floorsByBlock: Map<number, any[]>; ctx: UnitCtx;
  toggle: (f: any, current: number | null, set: (v: number | null) => void) => void;
}> = ({ projectName, blocks, floors, floorsByBlock, ctx, toggle }) => {
  const [openBlocks, setOpenBlocks] = useState<Record<number, boolean>>({});
  const [openFloorId, setOpenFloorId] = useState<number | null>(null);
  const totalUnits = floors.reduce((s, f) => s + (f.GeneratedUnitCount || 0), 0);
  const pendingFloors = floors.filter((f) => !f.IsGenerated && f.HasUnits && f.UnitCount > 0).length;
  const figures = [
    { label: "Blocks", value: blocks.length },
    { label: "Floors", value: floors.length },
    { label: "Units generated", value: totalUnits },
    { label: "Floors pending", value: pendingFloors, red: pendingFloors > 0 },
  ];
  const th = `!px-4 !py-2.5 text-left ${LBL}`;
  return (
    <section className="bg-card" style={{ border: RULE }}>
      <header className="px-4 py-3" style={{ borderBottom: RULE }}>
        <h2 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">{projectName || "Project"} · overview</h2>
        <p className="mt-1 text-xs text-muted-foreground">Open a block to see its floors, and a floor to see its units.</p>
      </header>
      <div className="statrow four" style={{ padding: "16px 16px 18px", borderBottom: RULE }}>
        {figures.map((x) => (
          <div key={x.label}>
            <p className="label">{x.label}</p>
            <p className="figure" style={{ fontSize: "clamp(16px, 1.8vw, 24px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>{x.value.toLocaleString("en-IN")}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto thin-scroll">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr style={{ borderBottom: RULE }}>
              <th className={th}>Block</th><th className={`${th} !text-right`}>Floors</th><th className={`${th} !text-right`}>Units generated</th><th className={th}>State</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => {
              const bf = floorsByBlock.get(b.Id) || [];
              const units = bf.reduce((s, f) => s + (f.GeneratedUnitCount || 0), 0);
              const pending = bf.filter((f) => !f.IsGenerated && f.HasUnits && f.UnitCount > 0).length;
              const open = !!openBlocks[b.Id];
              return (
                <React.Fragment key={b.Id}>
                  <tr onClick={() => setOpenBlocks((m) => ({ ...m, [b.Id]: !open }))} className="cursor-pointer hover:bg-primary/5 transition-colors" style={{ borderBottom: RULE_SOFT }}>
                    <td className="!px-4 !py-3">
                      <span className="inline-flex items-center gap-2 font-medium">
                        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Block {b.BlockName}
                      </span>
                    </td>
                    <td className={`!px-4 !py-3 text-right ${NUM}`}>{bf.length}</td>
                    <td className={`!px-4 !py-3 text-right ${NUM}`}>{units}</td>
                    <td className="!px-4 !py-3">
                      {!bf.length ? <SheetMark text="Set up floors" tone="waiting" />
                        : pending ? <SheetMark text={`Generate units on ${plural(pending, "floor")}`} tone="waiting" />
                        : <SheetMark text="Done" tone="done" />}
                    </td>
                  </tr>
                  {open && (
                    <tr style={{ borderBottom: RULE_SOFT }}>
                      <td colSpan={4} className="!px-4 !pt-1 !pb-3 bg-primary/[0.03]">
                        <BlockFloorTree blockFloors={bf} expandedFloorId={openFloorId} onToggleFloor={(f) => toggle(f, openFloorId, setOpenFloorId)} ctx={ctx} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};
