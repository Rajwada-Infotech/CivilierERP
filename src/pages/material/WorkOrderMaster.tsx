import React, { useState, useMemo, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Save,
  RotateCcw,
  Building2,
  FolderPlus,
  FilePlus,
  Calculator,
  IndianRupee,
  FileText,
  Calendar,
  Hash,
  User,
  Layers,
  X,
  Check,
  Package,
  Hammer,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { createWorkOrder, saveFullWorkOrder } from "@/api/workOrderApi";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MaterialItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  price: number;
}

interface Activity {
  id: string;
  name: string;
  unit: string;
  ratePerUnit: number;
  area: number;
  materials: MaterialItem[];
}

interface ActivityGroup {
  id: string;
  name: string;
  activities: Activity[];
  expanded: boolean;
}

interface WorkOrderForm {
  companyId: string;
  projectId: string;
  docNumber: string;
  docDate: string;
  contractorId: string;
  remarks: string;
  termsAndConditions: string;
}

// ─── Real API data loaded above ─

// ─── Helpers ──────────────────────────────────────────────────────────────────

const generateDocNumber = () => {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const seq = String(Math.floor(Math.random() * 900) + 100);
  return `WO-${yy}${mm}-${seq}`;
};

const uid = () => Math.random().toString(36).slice(2, 9);

const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);

const EMPTY_FORM = (): WorkOrderForm => ({
  companyId: "",
  projectId: "",
  docNumber: generateDocNumber(),
  docDate: new Date().toISOString().slice(0, 10),
  contractorId: "",
  remarks: "",
  termsAndConditions: "",
});

const EMPTY_MATERIAL = (): MaterialItem => ({
  id: uid(),
  name: "",
  quantity: 0,
  unit: "Nos",
  price: 0,
});

const EMPTY_ACTIVITY = (): Activity => ({
  id: uid(),
  name: "",
  unit: "Sq.Ft",
  ratePerUnit: 0,
  area: 0,
  materials: [],
});

const EMPTY_GROUP = (): ActivityGroup => ({
  id: uid(),
  name: "",
  activities: [EMPTY_ACTIVITY()],
  expanded: true,
});

const UNITS = ["Sq.Ft", "Sq.M", "RMT", "Nos", "Kg", "MT", "CUM", "CFT"];

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";

const selectCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none";

const cellInput =
  "w-full text-sm rounded-md border border-border px-2.5 py-1.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";

const FieldLabel: React.FC<{
  children: React.ReactNode;
  required?: boolean;
}> = ({ children, required }) => (
  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
    {children}
    {required && <span className="text-red-500 ml-0.5">*</span>}
  </label>
);

// ─── Material Breakdown Modal ─────────────────────────────────────────────────

const MaterialBreakdownModal: React.FC<{
  activity: Activity;
  onUpdateMaterials: (materials: MaterialItem[]) => void;
}> = ({ activity, onUpdateMaterials }) => {
  const [open, setOpen] = useState(false);

  const materialsTotal = activity.materials.reduce(
    (sum, m) => sum + m.quantity * m.price,
    0,
  );
  const labourTotal = activity.ratePerUnit * activity.area;

  const addMaterial = () =>
    onUpdateMaterials([...activity.materials, EMPTY_MATERIAL()]);

  const updateMaterial = (
    idx: number,
    field: keyof MaterialItem,
    value: string | number,
  ) => {
    onUpdateMaterials(
      activity.materials.map((m, i) =>
        i === idx ? { ...m, [field]: value } : m,
      ),
    );
  };

  const deleteMaterial = (idx: number) =>
    onUpdateMaterials(activity.materials.filter((_, i) => i !== idx));

  return (
    <>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors whitespace-nowrap
          ${
            activity.materials.length > 0
              ? "border-primary/30 bg-primary/8 text-primary"
              : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5"
          }`}
      >
        <Package size={12} />
        <span className="hidden md:inline">Materials</span>
        {activity.materials.length > 0 ? (
          <span className="bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold leading-none">
            {activity.materials.length}
          </span>
        ) : (
          <ChevronDown size={11} />
        )}
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 w-full sm:w-[600px] sm:max-w-[calc(100vw-2rem)] bg-card rounded-t-2xl sm:rounded-2xl border border-border shadow-2xl flex flex-col max-h-[88vh]">
            <div className="flex justify-center pt-2.5 pb-0 sm:hidden shrink-0">
              <div className="w-9 h-1 rounded-full bg-muted-foreground/20" />
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
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
                className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 ml-3"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex items-center gap-4 px-4 py-2 bg-muted/30 border-b border-border text-xs shrink-0 flex-wrap gap-y-1">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Layers size={11} className="shrink-0" />
                <span className="text-foreground font-medium">Area:</span>
                {activity.area > 0 ? (
                  <span className="font-semibold text-primary">
                    {activity.area} {activity.unit}
                  </span>
                ) : (
                  <span className="italic text-muted-foreground/50">
                    not set in activity row
                  </span>
                )}
              </span>
              {materialsTotal > 0 && (
                <span className="flex items-center gap-1.5 text-muted-foreground ml-auto">
                  <span className="text-foreground font-medium">
                    Materials Total:
                  </span>
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    {fmt(materialsTotal)}
                  </span>
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {activity.materials.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-3">
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
                    const lineTotal = mat.quantity * mat.price;
                    return (
                      <div
                        key={mat.id}
                        className="rounded-lg border border-border bg-muted/10 p-3 space-y-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            value={mat.name}
                            onChange={(e) =>
                              updateMaterial(idx, "name", e.target.value)
                            }
                            placeholder="Material name (e.g. Cement, Steel, Sand)"
                            className={`${cellInput} flex-1`}
                          />
                          <button
                            onClick={() => deleteMaterial(idx)}
                            className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                          >
                            <X size={13} />
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                              Qty
                            </p>
                            <input
                              type="number"
                              min={0}
                              value={mat.quantity || ""}
                              onChange={(e) =>
                                updateMaterial(
                                  idx,
                                  "quantity",
                                  parseFloat(e.target.value) || 0,
                                )
                              }
                              placeholder={
                                activity.area > 0 ? String(activity.area) : "0"
                              }
                              className={cellInput}
                            />
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                              Unit
                            </p>
                            <select
                              value={mat.unit}
                              onChange={(e) =>
                                updateMaterial(idx, "unit", e.target.value)
                              }
                              className="w-full text-sm rounded-md border border-border px-2 py-1.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none"
                            >
                              {UNITS.map((u) => (
                                <option key={u}>{u}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
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
                                  updateMaterial(
                                    idx,
                                    "price",
                                    parseFloat(e.target.value) || 0,
                                  )
                                }
                                placeholder="0"
                                className={`${cellInput} pl-6`}
                              />
                            </div>
                          </div>
                        </div>
                        {lineTotal > 0 && (
                          <div className="flex items-center justify-between pt-1 border-t border-border/50">
                            <span className="text-xs text-muted-foreground">
                              {mat.quantity} {mat.unit} × ₹{mat.price}
                            </span>
                            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                              {fmt(lineTotal)}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {activity.materials.length > 0 && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="bg-muted/40 px-3 py-2 border-b border-border flex items-center gap-1.5">
                    <Package size={11} className="text-muted-foreground" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Material Cost Breakdown
                    </span>
                  </div>
                  <div className="divide-y divide-border/50">
                    {activity.materials.map((mat) => {
                      const lt = mat.quantity * mat.price;
                      return (
                        <div
                          key={mat.id}
                          className="flex items-center gap-2 px-3 py-2 text-xs"
                        >
                          <span className="flex-1 font-medium text-foreground truncate">
                            {mat.name || (
                              <span className="italic text-muted-foreground/50">
                                Unnamed
                              </span>
                            )}
                          </span>
                          <span className="text-muted-foreground shrink-0">
                            {mat.quantity > 0
                              ? `${mat.quantity} ${mat.unit}`
                              : "—"}
                          </span>
                          <span className="text-muted-foreground shrink-0">
                            {mat.price > 0 ? `× ₹${mat.price}` : "—"}
                          </span>
                          <span
                            className={`font-semibold shrink-0 w-24 text-right ${lt > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
                          >
                            {lt > 0 ? fmt(lt) : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="border-t border-border bg-muted/20 divide-y divide-border/40">
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Package size={11} className="text-amber-500" />
                        Raw Materials
                      </span>
                      <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                        {fmt(materialsTotal)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Hammer size={11} className="text-blue-500" />
                        Labour (Rate × Area)
                      </span>
                      <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                        {labourTotal > 0 ? fmt(labourTotal) : "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5 bg-muted/30">
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
            <div className="px-4 py-3 border-t border-border flex items-center justify-between shrink-0 bg-card">
              <button
                onClick={addMaterial}
                className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium px-3 py-2 rounded-lg hover:bg-primary/5 transition-colors"
              >
                <Plus size={14} />
                Add Material
              </button>
              <button
                onClick={() => setOpen(false)}
                className="flex items-center gap-1.5 text-sm font-semibold px-5 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                <Check size={13} />
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ─── Activity Row ─────────────────────────────────────────────────────────────

const ActivityRow: React.FC<{
  activity: Activity;
  index: number;
  groupIndex: number;
  onUpdate: (
    field: keyof Activity,
    value: string | number | MaterialItem[],
  ) => void;
  onDelete: () => void;
  canDelete: boolean;
}> = ({ activity, index, groupIndex, onUpdate, onDelete, canDelete }) => {
  const labourTotal = activity.ratePerUnit * activity.area;
  const materialsTotal = activity.materials.reduce(
    (sum, m) => sum + m.quantity * m.price,
    0,
  );
  const activityTotal = labourTotal + materialsTotal;
  const label = `${groupIndex + 1}.${index + 1}`;

  return (
    <>
      {/* ── Mobile card ── */}
      <div className="sm:hidden rounded-lg border border-border/60 bg-muted/10 p-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-primary font-bold shrink-0 w-8">
            {label}
          </span>
          <input
            value={activity.name}
            onChange={(e) => onUpdate("name", e.target.value)}
            placeholder="Activity name…"
            className={`${cellInput} flex-1`}
          />
          <button
            onClick={onDelete}
            disabled={!canDelete}
            className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-20"
          >
            <X size={13} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Unit
            </p>
            <select
              value={activity.unit}
              onChange={(e) => onUpdate("unit", e.target.value)}
              className="w-full text-sm rounded-md border border-border px-2 py-1.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none"
            >
              {UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Area
            </p>
            <input
              type="number"
              min={0}
              value={activity.area || ""}
              onChange={(e) =>
                onUpdate("area", parseFloat(e.target.value) || 0)
              }
              placeholder="0"
              className={cellInput}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Rate / Unit (Labour)
            </p>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                ₹
              </span>
              <input
                type="number"
                min={0}
                value={activity.ratePerUnit || ""}
                onChange={(e) =>
                  onUpdate("ratePerUnit", parseFloat(e.target.value) || 0)
                }
                placeholder="0"
                className={`${cellInput} pl-6`}
              />
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Activity Total
            </p>
            <div className="flex items-center h-[34px]">
              <span
                className={`text-sm font-semibold ${activityTotal > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
              >
                {activityTotal > 0 ? fmt(activityTotal) : "—"}
              </span>
            </div>
          </div>
        </div>
        {(labourTotal > 0 || materialsTotal > 0) && (
          <div className="flex items-center gap-2 flex-wrap">
            {labourTotal > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                <Hammer size={9} />
                Labour: {fmt(labourTotal)}
              </span>
            )}
            {materialsTotal > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                <Package size={9} />
                Materials: {fmt(materialsTotal)}
              </span>
            )}
          </div>
        )}
        <MaterialBreakdownModal
          activity={activity}
          onUpdateMaterials={(mats) =>
            onUpdate("materials", mats as unknown as MaterialItem[])
          }
        />
      </div>

      {/* ── Desktop row ── */}
      <div className="hidden sm:block rounded-lg border border-border/50 overflow-hidden">
        <div className="grid grid-cols-[48px_1fr_96px_128px_112px_auto_120px_32px] gap-2 items-center px-3 py-2.5 bg-muted/20">
          <div className="text-xs font-mono text-primary font-semibold">
            {label}
          </div>
          <input
            value={activity.name}
            onChange={(e) => onUpdate("name", e.target.value)}
            placeholder="Activity name…"
            className={cellInput}
          />
          <select
            value={activity.unit}
            onChange={(e) => onUpdate("unit", e.target.value)}
            className="w-full text-sm rounded-md border border-border px-2 py-1.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none"
          >
            {UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              ₹
            </span>
            <input
              type="number"
              min={0}
              value={activity.ratePerUnit || ""}
              onChange={(e) =>
                onUpdate("ratePerUnit", parseFloat(e.target.value) || 0)
              }
              placeholder="Rate"
              className={`${cellInput} pl-6`}
            />
          </div>
          <input
            type="number"
            min={0}
            value={activity.area || ""}
            onChange={(e) => onUpdate("area", parseFloat(e.target.value) || 0)}
            placeholder="Area"
            className={cellInput}
          />
          <MaterialBreakdownModal
            activity={activity}
            onUpdateMaterials={(mats) =>
              onUpdate("materials", mats as unknown as MaterialItem[])
            }
          />
          <div className="text-right">
            <span
              className={`text-sm font-semibold ${activityTotal > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
            >
              {activityTotal > 0 ? fmt(activityTotal) : "—"}
            </span>
          </div>
          <button
            onClick={onDelete}
            disabled={!canDelete}
            className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
          >
            <X size={13} />
          </button>
        </div>
        {(labourTotal > 0 || materialsTotal > 0) && (
          <div className="flex items-center gap-3 px-3 py-1.5 bg-muted/10 border-t border-border/40 flex-wrap">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mr-1">
              Breakdown:
            </span>
            {labourTotal > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                <Hammer size={9} />
                Labour: {fmt(labourTotal)}
              </span>
            )}
            {materialsTotal > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                <Package size={9} />
                Raw Materials: {fmt(materialsTotal)}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
};

// ─── Activity Group ───────────────────────────────────────────────────────────

const ActivityGroupCard: React.FC<{
  group: ActivityGroup;
  index: number;
  onUpdate: (updated: ActivityGroup) => void;
  onDelete: () => void;
  canDelete: boolean;
}> = ({ group, index, onUpdate, onDelete, canDelete }) => {
  const groupLabourTotal = group.activities.reduce(
    (sum, a) => sum + a.ratePerUnit * a.area,
    0,
  );
  const groupMaterialsTotal = group.activities.reduce(
    (sum, a) =>
      sum + a.materials.reduce((ms, m) => ms + m.quantity * m.price, 0),
    0,
  );
  const groupTotal = groupLabourTotal + groupMaterialsTotal;

  const updateActivity = (
    actIdx: number,
    field: keyof Activity,
    value: string | number | MaterialItem[],
  ) => {
    onUpdate({
      ...group,
      activities: group.activities.map((a, i) =>
        i === actIdx ? { ...a, [field]: value } : a,
      ),
    });
  };

  const addActivity = () =>
    onUpdate({ ...group, activities: [...group.activities, EMPTY_ACTIVITY()] });

  const deleteActivity = (actIdx: number) =>
    onUpdate({
      ...group,
      activities: group.activities.filter((_, i) => i !== actIdx),
    });

  const toggleExpand = () => onUpdate({ ...group, expanded: !group.expanded });

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 sm:px-4 py-3 bg-muted/30 border-b border-border">
        <button
          onClick={toggleExpand}
          className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          {group.expanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
        </button>
        <span className="text-xs font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-md shrink-0">
          {index + 1}
        </span>
        <input
          value={group.name}
          onChange={(e) => onUpdate({ ...group, name: e.target.value })}
          placeholder={`Group ${index + 1} (e.g. Structure, Finishing…)`}
          className="flex-1 min-w-0 text-sm font-semibold bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/40 focus:ring-0"
        />
        <span
          className={`text-sm font-bold shrink-0 ${groupTotal > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
        >
          {groupTotal > 0 ? fmt(groupTotal) : "₹0"}
        </span>
        <button
          onClick={onDelete}
          disabled={!canDelete}
          className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-20 disabled:cursor-not-allowed shrink-0"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {group.expanded && (
        <div className="p-3 space-y-2">
          {group.activities.length > 0 && (
            <div className="hidden sm:grid grid-cols-[48px_1fr_96px_128px_112px_auto_120px_32px] gap-2 px-3 pb-1">
              {[
                "#",
                "Activity",
                "Unit",
                "Rate / Unit (Labour)",
                "Area",
                "Materials",
                "Activity Total",
                "",
              ].map((h) => (
                <div
                  key={h}
                  className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {h}
                </div>
              ))}
            </div>
          )}
          {group.activities.map((activity, actIdx) => (
            <ActivityRow
              key={activity.id}
              activity={activity}
              index={actIdx}
              groupIndex={index}
              onUpdate={(field, value) => updateActivity(actIdx, field, value)}
              onDelete={() => deleteActivity(actIdx)}
              canDelete={group.activities.length > 1}
            />
          ))}
          <button
            onClick={addActivity}
            className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 px-3 py-2 rounded-lg hover:bg-primary/5 transition-colors font-medium"
          >
            <FilePlus size={13} />
            Add Activity {index + 1}.{group.activities.length + 1}
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const WorkOrderMaster: React.FC = () => {
  const { currentUser } = useAuth();

  const [form, setForm] = useState<WorkOrderForm>(EMPTY_FORM());
  const [groups, setGroups] = useState<ActivityGroup[]>([EMPTY_GROUP()]);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // ── Real API data ─────────
  const [companies, setCompanies] = useState([]);
  const [projects, setProjects] = useState([]);
  const [contractors, setContractors] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [entRes, contrRes] = await Promise.all([
          fetchWithAuth("/api/enterprises"),
          fetchWithAuth("/api/account-head/options"),
        ]);
        if (entRes.ok) {
          const enterprises = await entRes.json();
          setCompanies(
            enterprises.map((e: any) => ({
              id: e.Id,
              name: e.Name || e.CompanyName,
            })),
          );
          setProjects(
            enterprises.map((e: any) => ({
              id: e.Id,
              name: e.ProjectName || e.Name,
            })),
          );
        }
        if (contrRes.ok) {
          const contractorsData = await contrRes.json();
          setContractors(
            contractorsData.map((c: any) => ({ id: c.id, name: c.label })),
          );
        }
      } catch (err) {
        console.error("Failed to fetch dropdown data:", err);
        toast.error("Failed to load dropdown data");
      }
    };
    fetchData();
  }, []);

  // ── Totals ──────────────────────────────────────────────────────────────────
  const { grandLabourTotal, grandMaterialsTotal, grandTotal } = useMemo(() => {
    let labour = 0;
    let materials = 0;
    for (const g of groups) {
      for (const a of g.activities) {
        labour += a.ratePerUnit * a.area;
        materials += a.materials.reduce((s, m) => s + m.quantity * m.price, 0);
      }
    }
    return {
      grandLabourTotal: labour,
      grandMaterialsTotal: materials,
      grandTotal: labour + materials,
    };
  }, [groups]);

  const setField = (key: keyof WorkOrderForm, value: string) => {
    setForm((p) => ({ ...p, [key]: value }));
    setErrors((p) => ({ ...p, [key]: false }));
  };

  const addGroup = () => setGroups((prev) => [...prev, EMPTY_GROUP()]);
  const updateGroup = (idx: number, updated: ActivityGroup) =>
    setGroups((prev) => prev.map((g, i) => (i === idx ? updated : g)));
  const deleteGroup = (idx: number) =>
    setGroups((prev) => prev.filter((_, i) => i !== idx));

  const resetAll = () => {
    setForm(EMPTY_FORM());
    setGroups([EMPTY_GROUP()]);
    setErrors({});
    setSaved(false);
  };

  const validate = () => {
    const e: Record<string, boolean> = {};
    if (!form.companyId) e.companyId = true;
    if (!form.projectId) e.projectId = true;
    if (!form.docDate) e.docDate = true;
    if (!form.contractorId) e.contractorId = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── SAVE — the real implementation ─────────────────────────────────────────
  const handleSave = async () => {
    if (!validate()) {
      toast.error("Please fill in all required fields.");
      return;
    }
    setSaving(true);
    try {
      const userId = parseInt(currentUser?.id ?? "1");

      // Step 1: Create the header row → get new Id back
      const created = await createWorkOrder({
        CompanyId: parseInt(form.companyId),
        ProjectId: parseInt(form.projectId),
        DocumentNumber: form.docNumber,
        DocumentDate: form.docDate,
        ContractorId: parseInt(form.contractorId),
        TotalAmount: grandTotal,
        Remarks: form.remarks || null,
        TermsAndConditions: form.termsAndConditions || null,
        CreatedBy: userId,
      });

      const newHeaderId: number = created.Id;

      // Step 2: Bulk-save activities + materials under that header
      const activities = groups.flatMap((g) =>
        g.activities.map((a) => {
          const labourAmt = a.ratePerUnit * a.area;
          const materialAmt = a.materials.reduce(
            (s, m) => s + m.quantity * m.price,
            0,
          );
          return {
            // No Id → backend will INSERT
            ActivityGroupId: null, // wire up if you add group master later
            ActivityId: null, // wire up if you add activity master later
            UOMId: null, // wire up UOM master later
            Rate: a.ratePerUnit || null,
            Area: a.area || null,
            LabourAmount: labourAmt || null,
            MaterialAmount: materialAmt || null,
            GrandTotal: labourAmt + materialAmt || null,
            Remarks: a.name || null, // store activity name in Remarks until ActivityId FK is wired
            materials: a.materials.map((m) => ({
              // ItemId left null until Item_Master_Group FK is wired
              UOMId: null,
              Quantity: m.quantity || null,
              Rate: m.price || null,
              Remarks: m.name || null,
              CreatedBy: userId,
            })),
          };
        }),
      );

      await saveFullWorkOrder(newHeaderId, {
        header: {
          TotalAmount: grandTotal,
          UpdatedBy: userId,
        },
        activities,
      });

      toast.success("Work order saved successfully!");
      setSaved(true);
      setForm((p) => ({ ...p, docNumber: generateDocNumber() }));
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      const msg: string = err.message || "";
      let friendly = "Something went wrong. Please try again.";

      if (msg.includes("UNIQUE KEY") || msg.includes("duplicate key"))
        friendly =
          "A work order with this document number already exists. Please reset and try again.";
      else if (msg.includes("FK_WorkOrder_Com") || msg.includes("enterprise"))
        friendly =
          "The selected company doesn't exist. Please select a valid company.";
      else if (msg.includes("FK_WorkOrder_Project"))
        friendly =
          "The selected project doesn't exist. Please select a valid project.";
      else if (
        msg.includes("FK_WorkOrder_Contr") ||
        msg.includes("AccountHeadMaster")
      )
        friendly =
          "The selected contractor doesn't exist. Please select a valid contractor.";
      else if (msg.includes("FK_WOA") || msg.includes("WorkOrderActivities"))
        friendly =
          "One or more activities could not be saved. Please check the activity details.";
      else if (
        msg.includes("FK_WOAM") ||
        msg.includes("WorkOrderActivityMaterials")
      )
        friendly =
          "One or more materials could not be saved. Please check the material details.";
      else if (msg.includes("NOT NULL") || msg.includes("cannot be null"))
        friendly =
          "Some required fields are missing. Please fill in all required fields.";
      else if (msg.includes("FOREIGN KEY"))
        friendly =
          "A selected value references data that doesn't exist in the system.";
      else if (msg.includes("Cannot insert") || msg.includes("INSERT"))
        friendly =
          "Could not save the work order. Please check all fields and try again.";

      toast.error(friendly);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Breadcrumbs items={["Material", "Work Order"]} />

      {/* Page header */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground">
            Work Order
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
            Create and manage work orders with activity-based cost breakdown
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={resetAll}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            <RotateCcw size={13} />
            <span className="hidden sm:inline">Reset</span>
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity"
          >
            {saving ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Saving…</span>
              </>
            ) : saved ? (
              <>
                <Check size={14} />
                <span>Saved!</span>
              </>
            ) : (
              <>
                <Save size={14} />
                <span className="hidden sm:inline">Save Work Order</span>
                <span className="sm:hidden">Save</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Header card */}
      <div className="rounded-xl border border-border bg-card mb-5">
        <div className="px-4 sm:px-5 py-3.5 border-b border-border flex items-center gap-2">
          <FileText size={15} className="text-primary shrink-0" />
          <h2 className="text-sm font-semibold text-foreground">
            Work Order Details
          </h2>
          <span className="ml-auto font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded shrink-0">
            {form.docNumber}
          </span>
        </div>

        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-4">
            {/* Company — real data from DB */}
            <div>
              <FieldLabel required>
                <span className="flex items-center gap-1.5">
                  <Building2 size={11} />
                  Company Name
                </span>
              </FieldLabel>
              <select
                value={form.companyId}
                onChange={(e) => setField("companyId", e.target.value)}
                className={`${selectCls} ${errors.companyId ? "border-red-400" : ""}`}
                style={{ colorScheme: "light dark" }}
              >
                <option value="">Select company…</option>
                {companies.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {errors.companyId && (
                <p className="text-xs text-red-500 mt-1">Required</p>
              )}
            </div>

            {/* Project — real data from DB */}
            <div>
              <FieldLabel required>
                <span className="flex items-center gap-1.5">
                  <Layers size={11} />
                  Project Name
                </span>
              </FieldLabel>
              <select
                value={form.projectId}
                onChange={(e) => setField("projectId", e.target.value)}
                className={`${selectCls} ${errors.projectId ? "border-red-400" : ""}`}
                style={{ colorScheme: "light dark" }}
              >
                <option value="">Select project…</option>
                {projects.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {errors.projectId && (
                <p className="text-xs text-red-500 mt-1">Required</p>
              )}
            </div>

            {/* Document Number — auto-generated, read-only */}
            <div>
              <FieldLabel>
                <span className="flex items-center gap-1.5">
                  <Hash size={11} />
                  Document Number
                </span>
              </FieldLabel>
              <input
                value={form.docNumber}
                readOnly
                className={`${inputCls} bg-muted/50 text-muted-foreground font-mono cursor-not-allowed`}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Auto-generated
              </p>
            </div>

            {/* Document Date */}
            <div>
              <FieldLabel required>
                <span className="flex items-center gap-1.5">
                  <Calendar size={11} />
                  Document Date
                </span>
              </FieldLabel>
              <input
                type="date"
                value={form.docDate}
                onChange={(e) => setField("docDate", e.target.value)}
                className={`${inputCls} ${errors.docDate ? "border-red-400" : ""}`}
              />
            </div>

            {/* Contractor — real data from DB (AccountHeadMaster) */}
            <div>
              <FieldLabel required>
                <span className="flex items-center gap-1.5">
                  <User size={11} />
                  Contractor
                </span>
              </FieldLabel>
              <select
                value={form.contractorId}
                onChange={(e) => setField("contractorId", e.target.value)}
                className={`${selectCls} ${errors.contractorId ? "border-red-400" : ""}`}
                style={{ colorScheme: "light dark" }}
              >
                <option value="">Select contractor…</option>
                {contractors.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {errors.contractorId && (
                <p className="text-xs text-red-500 mt-1">Required</p>
              )}
            </div>

            {/* Total Amount — computed from activities, read-only */}
            <div>
              <FieldLabel>
                <span className="flex items-center gap-1.5">
                  <IndianRupee size={11} />
                  Total Amount
                </span>
              </FieldLabel>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  ₹
                </span>
                <input
                  readOnly
                  value={grandTotal > 0 ? grandTotal.toFixed(2) : ""}
                  placeholder="Calculated from activities"
                  className={`${inputCls} pl-7 bg-muted/50 text-muted-foreground cursor-not-allowed`}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Auto-calculated from activities
              </p>
            </div>

            {/* Remarks */}
            <div className="col-span-1 sm:col-span-2 lg:col-span-3">
              <FieldLabel>Remarks</FieldLabel>
              <input
                value={form.remarks}
                onChange={(e) => setField("remarks", e.target.value)}
                placeholder="Any additional remarks…"
                className={inputCls}
              />
            </div>

            {/* Terms & Conditions */}
            <div className="col-span-1 sm:col-span-2 lg:col-span-3">
              <FieldLabel>Terms &amp; Conditions</FieldLabel>
              <textarea
                value={form.termsAndConditions}
                onChange={(e) => setField("termsAndConditions", e.target.value)}
                placeholder="Enter contractor terms and conditions…"
                rows={4}
                className={`${inputCls} resize-none`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Activity Details */}
      <div className="rounded-xl border border-border bg-card mb-5">
        <div className="px-4 sm:px-5 py-3.5 border-b border-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Calculator size={15} className="text-primary shrink-0" />
            <h2 className="text-sm font-semibold text-foreground">
              Activity Details
            </h2>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full hidden sm:block">
              {groups.length}g ·{" "}
              {groups.reduce((s, g) => s + g.activities.length, 0)}a
            </span>
          </div>
          <button
            onClick={addGroup}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors shrink-0"
          >
            <FolderPlus size={13} />
            <span className="hidden sm:inline">Add Group</span>
            <span className="sm:hidden">Group</span>
          </button>
        </div>

        <div className="p-3 space-y-3">
          {groups.map((group, idx) => (
            <ActivityGroupCard
              key={group.id}
              group={group}
              index={idx}
              onUpdate={(updated) => updateGroup(idx, updated)}
              onDelete={() => deleteGroup(idx)}
              canDelete={groups.length > 1}
            />
          ))}
        </div>

        {/* Grand total footer */}
        <div className="border-t border-border bg-muted/10">
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border/50">
            <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Package size={11} className="text-amber-500" />
                Raw Materials
              </span>
              <span className="text-base font-bold text-amber-600 dark:text-amber-400">
                {fmt(grandMaterialsTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Hammer size={11} className="text-blue-500" />
                Labour
              </span>
              <span className="text-base font-bold text-blue-600 dark:text-blue-400">
                {fmt(grandLabourTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3 bg-muted/20">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Receipt size={11} className="text-primary" />
                Grand Total
              </span>
              <span className="text-xl font-bold text-foreground">
                {fmt(grandTotal)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-end gap-3 pb-8">
        <button
          onClick={resetAll}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
        >
          <RotateCcw size={13} />
          Reset
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity"
        >
          {saving ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving…
            </>
          ) : saved ? (
            <>
              <Check size={14} />
              Saved!
            </>
          ) : (
            <>
              <Save size={14} />
              Save Work Order
            </>
          )}
        </button>
      </div>
    </>
  );
};

export default WorkOrderMaster;
