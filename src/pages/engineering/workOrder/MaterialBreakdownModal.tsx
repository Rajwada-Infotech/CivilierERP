// The materials an activity needs: quantities and cost per unit of work.
import React, { useState } from "react";
import { Plus, ChevronDown, Calculator, Layers, X, Check, Package, Hammer, Receipt, AlertCircle } from "lucide-react";
import { BodyPortal } from "@/components/ui/body-portal";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { MaterialItem, Activity, DropdownOption, ItemOption, fmt, EMPTY_MATERIAL, actLabour, matQty, matCost, fmtQ, cellInput, cellSelect } from "./config";

// ─── Material Breakdown Modal ─────────────────────────────────────────────────

export const MaterialBreakdownModal: React.FC<{
  activity: Activity;
  uomOptions: DropdownOption[];
  itemOptions: ItemOption[];
  loadingItems: boolean;
  suppliers: DropdownOption[];
  onUpdateMaterials: (materials: MaterialItem[]) => void;
}> = ({
  activity,
  uomOptions,
  itemOptions,
  loadingItems,
  suppliers,
  onUpdateMaterials,
}) => {
  const [open, setOpen] = useState(false);

  const materialsTotal = activity.materials.reduce(
    (sum, m) => sum + matCost(m, activity),
    0,
  );
  const labourTotal = actLabour(activity);

  const addMaterial = () =>
    onUpdateMaterials([...activity.materials, EMPTY_MATERIAL()]);

  const updateMaterial = (idx: number, patch: Partial<MaterialItem>) => {
    onUpdateMaterials(
      activity.materials.map((m, i) => (i === idx ? { ...m, ...patch } : m)),
    );
  };

  const deleteMaterial = (idx: number) =>
    onUpdateMaterials(activity.materials.filter((_, i) => i !== idx));

  const handleItemChange = (idx: number, selectedId: string) => {
    const found = itemOptions.find((it) => it.id === selectedId);
    // Resolve M_UOM code (stored as UOMCode) to actual UOMMaster id+name
    const resolvedUom = found?.uomName
      ? uomOptions.find((u) => (u as any).uomCode === found.uomName)
      : null;
    updateMaterial(idx, {
      itemId: found ? found.id : "",
      itemName: found ? found.name : "",
      consumptionRatio: 0,
      totalQty: 0,
      gstRate: found ? (found.gstRate ?? 0) : 0,
      ...(resolvedUom != null
        ? { uomId: resolvedUom.id, unit: resolvedUom.name }
        : found?.uomName
          ? { uomId: null, unit: found.uomName }
          : {}),
    });
  };

  const handleMatUomChange = (idx: number, selectedId: string) => {
    const found = uomOptions.find((u) => String(u.id) === selectedId);
    updateMaterial(idx, {
      uomId: found ? found.id : null,
      unit: found ? found.name : "",
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 border text-xs font-medium transition-colors whitespace-nowrap ${
            activity.materials.length > 0
              ? "border-primary/30 bg-primary/8 text-primary"
              : "border-foreground/30 bg-card text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5"
          }`}
      >
        <Package size={12} />
        <span className="hidden md:inline">Materials</span>
        {activity.materials.length > 0 ? (
          <span className="bg-primary text-primary-foreground w-4 h-4 flex items-center justify-center text-[0.625rem] font-bold leading-none">
            {activity.materials.length}
          </span>
        ) : (
          <ChevronDown size={11} />
        )}
      </button>

      {open && (
        <BodyPortal><div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 w-full sm:w-[640px] sm:max-w-[calc(100vw-2rem)] bg-card border border-foreground/30 flex flex-col max-h-[88vh]">
            <div className="flex justify-center pt-2.5 pb-0 sm:hidden shrink-0">
              <div className="w-9 h-1 bg-muted-foreground/20" />
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/30 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Package size={14} className="text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    Material Breakdown
                  </p>
                  {activity.name && (
                    <p className="text-xs text-muted-foreground truncate">
                      {activity.name}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/5 transition-colors shrink-0 ml-3"
              >
                <X size={14} />
              </button>
            </div>
            {/* Activity area multiplier info bar */}
            <div className="px-4 py-2.5 bg-card border-b border-foreground/40 shrink-0">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1 border text-xs font-semibold ${
                      activity.area > 0
                        ? "bg-card border-foreground/40 text-foreground"
                        : "bg-card border-foreground/30 text-muted-foreground"
                    }`}
                  >
                    <Layers size={11} className="shrink-0" />
                    <span>Activity Area:</span>
                    {activity.area > 0 ? (
                      <span className="font-bold">
                        {activity.area} {activity.unit || ""}
                      </span>
                    ) : (
                      <span className="italic font-normal opacity-60">
                        not set
                      </span>
                    )}
                  </div>
                  <span className="text-[0.625rem] text-foreground font-medium hidden sm:block">
                    Per-unit qty = Item Qty ÷ Area
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[0.625rem] text-foreground font-medium bg-card px-2 py-1">
                  <Calculator size={10} />
                  Item Qty × Price
                </div>
              </div>
              {activity.area === 0 && (
                <p className="text-[0.625rem] text-foreground mt-1.5 flex items-center gap-1">
                  <AlertCircle size={10} className="shrink-0" />
                  Set the Activity Area in the activity row first — the per-unit
                  quantities need it.
                </p>
              )}
            </div>
            <div className="flex items-center gap-4 px-4 py-2 bg-card border-b border-foreground/30 text-xs shrink-0 flex-wrap gap-y-1">
              {materialsTotal > 0 && (
                <span className="flex items-center gap-1.5 text-muted-foreground ml-auto">
                  <span className="text-foreground font-medium">
                    Materials Total:
                  </span>
                  <span className="font-semibold text-foreground">
                    {fmt(materialsTotal)}
                  </span>
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {activity.materials.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="w-12 h-12 bg-card flex items-center justify-center mb-3">
                    <Package size={22} className="text-muted-foreground/40" />
                  </div>
                  <p className="text-sm text-muted-foreground font-medium">
                    No materials yet
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    Tap "Add Material" to start
                  </p>
                </div>
              )}
              {activity.materials.length > 0 && (
                <div className="space-y-2">
                  {activity.materials.map((mat, idx) => {
                    const lineTotal =
                      matCost(mat, activity);
                    return (
                      <div
                        key={mat.id}
                        className="border border-foreground/30 bg-card p-3 space-y-2.5"
                      >
                        <div className="flex items-center gap-2">
                          {loadingItems ? (
                            <div className="flex-1 h-[34px] border border-foreground/30 bg-card animate-pulse" />
                          ) : (
                            <SearchableNativeSelect
                              value={mat.itemId}
                              onChange={(e) =>
                                handleItemChange(idx, e.target.value)
                              }
                              className={`${cellSelect} flex-1`}
                            >
                              <option value="">
                                {itemOptions.length === 0
                                  ? "No items available"
                                  : "Select material item…"}
                              </option>
                              {itemOptions.map((it) => (
                                <option key={it.id} value={it.id}>
                                  {it.name}
                                </option>
                              ))}
                            </SearchableNativeSelect>
                          )}
                          <button
                            onClick={() => deleteMaterial(idx)}
                            className="w-7 h-7 shrink-0 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/10 transition-colors"
                          >
                            <X size={13} />
                          </button>
                        </div>
                        {suppliers.length > 0 && (
                          <div>
                            <p className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                              Supplier
                            </p>
                            <select
                              value={
                                mat.supplierId !== null
                                  ? String(mat.supplierId)
                                  : ""
                              }
                              onChange={(e) => {
                                const v = e.target.value;
                                const found = suppliers.find(
                                  (s) => String(s.id) === v,
                                );
                                updateMaterial(idx, {
                                  supplierId: v ? parseInt(v, 10) : null,
                                  supplierName: found ? found.name : "",
                                });
                              }}
                              className={`${cellSelect} w-full`}
                            >
                              <option value="">No supplier</option>
                              {suppliers.map((s) => (
                                <option key={s.id} value={String(s.id)}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <p className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                              Item Qty (total)
                            </p>
                            <input
                              type="number"
                              min={0}
                              value={matQty(mat, activity) || ""}
                              onChange={(e) => {
                                const q = parseFloat(e.target.value) || 0;
                                updateMaterial(idx, {
                                  totalQty: q,
                                  consumptionRatio:
                                    activity.area > 0 ? q / activity.area : 0,
                                });
                              }}
                              placeholder="e.g. 60000"
                              className={cellInput}
                            />
                            <p className="text-[0.625rem] text-muted-foreground mt-1">
                              {activity.area > 0 && matQty(mat, activity) > 0
                                ? `Per unit: ${fmtQ(matQty(mat, activity) / activity.area)}${mat.unit ? ` ${mat.unit}` : ""} / area`
                                : "Per unit: —"}
                            </p>
                          </div>
                          <div>
                            <p className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                              Unit
                            </p>
                            {uomOptions.length > 0 ? (
                              <select
                                value={
                                  mat.uomId !== null ? String(mat.uomId) : ""
                                }
                                onChange={(e) =>
                                  handleMatUomChange(idx, e.target.value)
                                }
                                className="w-full text-sm border border-foreground/30 pl-2 pr-7 py-1.5 bg-card text-foreground focus:outline-none transition wo-select-arrow"
                              >
                                <option value="">Select unit…</option>
                                {uomOptions.map((u) => (
                                  <option key={u.id} value={String(u.id)}>
                                    {u.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                value={mat.unit}
                                onChange={(e) =>
                                  updateMaterial(idx, { unit: e.target.value })
                                }
                                placeholder="Unit"
                                className={cellInput}
                              />
                            )}
                          </div>
                          <div>
                            <p className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                              Price / Unit
                            </p>
                            <div className="relative">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                ₹
                              </span>
                              <input
                                type="number"
                                min={0}
                                value={mat.price || ""}
                                onChange={(e) =>
                                  updateMaterial(idx, {
                                    price: parseFloat(e.target.value) || 0,
                                  })
                                }
                                placeholder="0"
                                className={`${cellInput} pl-6`}
                              />
                            </div>
                          </div>
                        </div>
                        {mat.gstRate > 0 && (
                          <div className="mt-1 text-[0.6875rem] text-foreground font-medium">
                            GST {mat.gstRate}% (from SAC) ={" "}
                            {fmt((lineTotal * mat.gstRate) / 100)}
                          </div>
                        )}
                        {lineTotal > 0 && (
                          <div className="flex items-center justify-between pt-1 border-t border-foreground/30">
                            <span className="text-xs text-muted-foreground">
                              {fmtQ(matQty(mat, activity))} × ₹{mat.price}
                            </span>
                            <span className="text-xs font-semibold text-foreground">
                              {fmt(
                                lineTotal +
                                  (lineTotal * (mat.gstRate || 0)) / 100,
                              )}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {activity.materials.length > 0 && (
                <div className="border border-foreground/30 overflow-hidden">
                  <div className="bg-card px-3 py-2 border-b border-foreground/30 flex items-center gap-1.5">
                    <Package size={11} className="text-muted-foreground" />
                    <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      Material Cost Breakdown
                    </span>
                  </div>
                  <div className="divide-y divide-foreground/10">
                    {activity.materials.map((mat) => {
                      const lt =
                        matCost(mat, activity);
                      return (
                        <div
                          key={mat.id}
                          className="flex items-center gap-2 px-3 py-2 text-xs"
                        >
                          <span className="flex-1 font-medium text-foreground truncate">
                            {mat.itemName || (
                              <span className="italic text-muted-foreground/50">
                                Unnamed
                              </span>
                            )}
                          </span>
                          <span className="text-muted-foreground shrink-0">
                            {matQty(mat, activity) > 0
                              ? `${fmtQ(matQty(mat, activity))} qty`
                              : "—"}
                          </span>
                          <span className="text-muted-foreground shrink-0">
                            {mat.price > 0 ? `× ₹${mat.price}` : "—"}
                          </span>
                          <span
                            className={`font-semibold shrink-0 w-24 text-right ${lt > 0 ? "text-foreground" : "text-muted-foreground"}`}
                          >
                            {lt > 0 ? fmt(lt) : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="border-t border-foreground/30 bg-card divide-y divide-foreground/10">
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Package size={11} className="text-foreground" />
                        Materials (Item Qty × Price)
                      </span>
                      <span className="text-xs font-semibold text-foreground">
                        {fmt(materialsTotal)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Hammer size={11} className="text-foreground" />
                        Labour (Total Rate)
                      </span>
                      <span className="text-xs font-semibold text-foreground">
                        {labourTotal > 0 ? fmt(labourTotal) : "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5 bg-card">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <Receipt size={11} className="text-primary" />
                        Activity Total
                      </span>
                      <span className="text-sm font-bold text-primary">
                        {fmt(materialsTotal + labourTotal)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-foreground/30 flex items-center justify-between shrink-0 bg-card">
              <button
                onClick={addMaterial}
                className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium px-3 py-2 hover:bg-primary/5 transition-colors"
              >
                <Plus size={14} />
                Add Material
              </button>
              <button
                onClick={() => setOpen(false)}
                className="flex items-center gap-1.5 text-sm font-semibold px-5 py-2 bg-foreground text-card border border-foreground hover:opacity-90 transition-opacity"
              >
                <Check size={13} />
                Done
              </button>
            </div>
          </div>
        </div></BodyPortal>
      )}
    </>
  );
};
