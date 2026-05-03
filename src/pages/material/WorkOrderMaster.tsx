import React, { useState, useMemo, useEffect, useCallback } from "react";
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
  AlertCircle,
  Eye,
  PenSquare,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronUp,
  List,
  ClipboardList,
  ArrowLeft,
  Filter,
  SortAsc,
  TrendingUp,
  Boxes,
  BadgeCheck,
  Clock,
  XCircle,
  MoreVertical,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useFinYear } from "@/contexts/FinYearContext";
import {
  createWorkOrder,
  saveFullWorkOrder,
  fetchCompanies,
  fetchProjects,
  fetchContractors,
  fetchActivityGroups,
  fetchActivities,
  fetchItems,
  getWorkOrders,
  getWorkOrder,
  deleteWorkOrder,
} from "@/api/workOrderApi";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useQuery } from "@tanstack/react-query";
import { getHsn } from "@/api/hsnApi";
import {
  DocNumberPreview,
  fetchNextDocNumber,
} from "@/pages/material/ExpenseBooking/DocNumberPreview";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MaterialItem {
  id: string;
  itemId: string;
  itemName: string;
  quantity: number;
  uomId: number | null;
  unit: string;
  price: number;
}
interface Activity {
  id: string;
  activityId: number | null;
  name: string;
  uomId: number | null;
  unit: string;
  ratePerUnit: number;
  area: number;
  materials: MaterialItem[];
}
interface ActivityGroup {
  id: string;
  groupId: number | null;
  name: string;
  activities: Activity[];
  expanded: boolean;
}
type WOGSTType = "none" | "cgst_sgst" | "igst";
interface WorkOrderForm {
  companyId: string;
  projectId: string;
  docNumber: string;
  docDate: string;
  contractorId: string;
  remarks: string;
  termsAndConditions: string;
  hsnCode: string;
  gstType: WOGSTType;
  gstRate: number;
}
interface DropdownOption {
  id: number;
  name: string;
}
interface ItemOption {
  id: string;
  name: string;
}
interface ActivityOption {
  id: number;
  name: string;
  groupId?: number;
}
interface WorkOrderListItem {
  Id: number;
  DocumentNumber: string;
  DocumentDate: string;
  TotalAmount: number;
  Status: string;
  CreatedAt: string;
  CompanyName: string;
  ProjectName: string;
  ContractorName: string;
  ActivityCount: number;
  Remarks?: string;
}
interface WorkOrderDetail {
  Id: number;
  DocumentNumber: string;
  DocumentDate: string;
  TotalAmount: number;
  Status: string;
  CreatedAt: string;
  UpdatedAt?: string;
  CompanyName: string;
  ProjectName: string;
  ContractorName: string;
  Remarks?: string;
  TermsAndConditions?: string;
  CreatedBy?: string;
  UpdatedBy?: string;
  activities: WorkOrderActivityDetail[];
}
interface WorkOrderMaterialDetail {
  Id: number;
  WorkOrderActivityId: number;
  ItemName: string;
  ItemIdStr: string;
  ItemId?: string;
  UOMId?: number;
  UOMName: string;
  Quantity: number;
  Rate: number;
  Remarks?: string;
}
interface WorkOrderActivityDetail {
  Id: number;
  ActivityGroupId?: number;
  ActivityId?: number;
  UOMId?: number;
  ActivityGroupName: string;
  ActivityName: string;
  UOMName: string;
  Rate: number;
  Area: number;
  LabourAmount: number;
  MaterialAmount: number;
  GrandTotal: number;
  Remarks?: string;
  materials: WorkOrderMaterialDetail[];
}
interface HsnRecord {
  code: string;
  shortDesc: string;
  description: string;
  igstRate: number;
  cgstRate: number;
  sgstRate: number;
  status: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const generateDocNumber = () => "";
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);

function ensureArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.recordset)) return obj.recordset as T[];
  }
  return [];
}

const mapHsnRecords = (hsnData: unknown): HsnRecord[] =>
  Array.isArray(hsnData)
    ? hsnData.map((h: any) => ({
        code: h.HCode,
        shortDesc: h.HShortDescription || h.HCode,
        description: h.HDescription || "",
        igstRate: h.HIGST ?? 0,
        cgstRate: h.HCGST ?? 0,
        sgstRate: h.HSGST ?? 0,
        status: !!h.HStatus,
      }))
    : [];

const normalizeActivities = (rawActs: ActivityOption[]) =>
  rawActs.map((a) => ({
    ...a,
    groupId:
      a.groupId !== undefined && a.groupId !== null
        ? Number(a.groupId)
        : undefined,
  }));

const EMPTY_FORM = (): WorkOrderForm => ({
  companyId: "",
  projectId: "",
  docNumber: generateDocNumber(),
  docDate: new Date().toISOString().slice(0, 10),
  contractorId: "",
  remarks: "",
  termsAndConditions: "",
  hsnCode: "",
  gstType: "cgst_sgst",
  gstRate: 0,
});
const EMPTY_MATERIAL = (): MaterialItem => ({
  id: uid(),
  itemId: "",
  itemName: "",
  quantity: 0,
  uomId: null,
  unit: "",
  price: 0,
});
const EMPTY_ACTIVITY = (): Activity => ({
  id: uid(),
  activityId: null,
  name: "",
  uomId: null,
  unit: "",
  ratePerUnit: 0,
  area: 0,
  materials: [],
});
const EMPTY_GROUP = (): ActivityGroup => ({
  id: uid(),
  groupId: null,
  name: "",
  activities: [EMPTY_ACTIVITY()],
  expanded: true,
});

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";
const selectCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none";
const cellInput =
  "w-full text-sm rounded-md border border-border px-2.5 py-1.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";
const cellSelect =
  "w-full text-sm rounded-md border border-border px-2.5 py-1.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none";

const FieldLabel: React.FC<{
  children: React.ReactNode;
  required?: boolean;
}> = ({ children, required }) => (
  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
    {children}
    {required && <span className="text-red-500 ml-0.5">*</span>}
  </label>
);

const CellLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
    {children}
  </p>
);

const SelectSkeleton: React.FC = () => (
  <div className="w-full h-10 rounded-lg border border-border bg-muted/30 animate-pulse" />
);

const ErrorBox: React.FC<{ msg: string }> = ({ msg }) => (
  <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 px-4 py-3">
    <AlertCircle size={14} className="text-red-500 shrink-0" />
    <p className="text-sm text-red-600 dark:text-red-400">{msg}</p>
  </div>
);

const LoadingSkeleton: React.FC = () => (
  <div className="space-y-4">
    {[1, 2, 3].map((i) => (
      <div
        key={i}
        className="rounded-xl border border-border bg-card p-5 animate-pulse"
      >
        <div className="h-4 bg-muted rounded w-1/3 mb-3" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((j) => (
            <div key={j} className="h-10 bg-muted rounded" />
          ))}
        </div>
      </div>
    ))}
  </div>
);

// ─── Shared: SaveButton ───────────────────────────────────────────────────────

const SaveButton: React.FC<{
  saving: boolean;
  saved: boolean;
  disabled?: boolean;
  label: string;
  size?: "sm" | "md";
  onClick?: () => void;
}> = ({ saving, saved, disabled, label, size = "md", onClick }) => {
  const px = size === "sm" ? "px-4 py-2" : "px-5 py-2.5";
  return (
    <button
      onClick={onClick}
      disabled={disabled || saving}
      className={`flex items-center gap-2 ${px} rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity`}
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
          <span>{label}</span>
        </>
      )}
    </button>
  );
};

// ─── Shared: TotalFooter ─────────────────────────────────────────────────────

const TotalFooter: React.FC<{
  materials: number;
  labour: number;
  grandTotal: number;
}> = ({ materials, labour, grandTotal }) => (
  <div className="border-t border-border bg-muted/10">
    <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border/50">
      <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Package size={11} className="text-amber-500" />
          Raw Materials
        </span>
        <span className="text-base font-bold text-amber-600 dark:text-amber-400">
          {fmt(materials)}
        </span>
      </div>
      <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Hammer size={11} className="text-blue-500" />
          Labour
        </span>
        <span className="text-base font-bold text-blue-600 dark:text-blue-400">
          {fmt(labour)}
        </span>
      </div>
      <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3 bg-muted/20">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Receipt size={11} className="text-primary" />
          Grand Total (incl. GST)
        </span>
        <span className="text-xl font-bold text-foreground">
          {fmt(grandTotal)}
        </span>
      </div>
    </div>
  </div>
);

// ─── Shared: GstBreakdownBar ─────────────────────────────────────────────────

const GstBreakdownBar: React.FC<{
  gstRate: number;
  gstType: WOGSTType;
  gstAmount: number;
  subtotal: number;
}> = ({ gstRate, gstType, gstAmount, subtotal }) => {
  if (gstRate <= 0 || gstAmount <= 0) return null;
  return (
    <div className="border-t border-border/50 px-4 sm:px-6 py-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
      <span>
        Subtotal: <strong className="text-foreground">{fmt(subtotal)}</strong>
      </span>
      {gstType === "cgst_sgst" ? (
        <>
          <span>
            CGST ({(gstRate / 2).toFixed(2)}%):{" "}
            <strong className="text-foreground">{fmt(gstAmount / 2)}</strong>
          </span>
          <span>
            SGST ({(gstRate / 2).toFixed(2)}%):{" "}
            <strong className="text-foreground">{fmt(gstAmount / 2)}</strong>
          </span>
        </>
      ) : (
        <span>
          IGST ({gstRate}%):{" "}
          <strong className="text-foreground">{fmt(gstAmount)}</strong>
        </span>
      )}
    </div>
  );
};

// ─── Shared: GstSection ──────────────────────────────────────────────────────

const GstSection: React.FC<{
  hsnCode: string;
  gstType: WOGSTType;
  gstRate: number;
  hsnRecords: HsnRecord[];
  onHsnChange: (code: string, rate: number) => void;
  onGstTypeChange: (t: WOGSTType) => void;
  onGstRateChange: (r: number) => void;
}> = ({
  hsnCode,
  gstType,
  gstRate,
  hsnRecords,
  onHsnChange,
  onGstTypeChange,
  onGstRateChange,
}) => (
  <div className="col-span-1 sm:col-span-2 lg:col-span-3">
    <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-4">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
        <Receipt size={11} className="text-primary" />
        GST Details
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <FieldLabel>HSN Code</FieldLabel>
          <select
            value={hsnCode}
            onChange={(e) => {
              const h = hsnRecords.find((r) => r.code === e.target.value);
              onHsnChange(
                e.target.value,
                h ? h.igstRate || h.cgstRate + h.sgstRate : 0,
              );
            }}
            className={inputCls}
          >
            <option value="">— Select HSN Code —</option>
            {hsnRecords
              .filter((h) => h.status)
              .map((h) => (
                <option key={h.code} value={h.code}>
                  {h.code} — {h.shortDesc}
                </option>
              ))}
          </select>
          {hsnCode && hsnRecords.find((h) => h.code === hsnCode) && (
            <p className="text-[11px] text-muted-foreground mt-1 truncate">
              {hsnRecords.find((h) => h.code === hsnCode)!.description}
            </p>
          )}
        </div>
        <div>
          <FieldLabel>GST Type</FieldLabel>
          <select
            value={gstType}
            onChange={(e) => onGstTypeChange(e.target.value as WOGSTType)}
            className={inputCls}
          >
            <option value="cgst_sgst">CGST + SGST</option>
            <option value="igst">IGST</option>
          </select>
        </div>
        <div>
          <FieldLabel>GST Rate (%)</FieldLabel>
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={gstRate}
            readOnly={!!hsnCode}
            onChange={(e) =>
              !hsnCode && onGstRateChange(parseFloat(e.target.value) || 0)
            }
            className={`${inputCls} ${hsnCode ? "bg-muted/50 text-muted-foreground cursor-not-allowed" : ""}`}
          />
          {gstRate > 0 && gstType === "cgst_sgst" && (
            <p className="text-[11px] text-muted-foreground mt-1">
              CGST {(gstRate / 2).toFixed(2)}% + SGST {(gstRate / 2).toFixed(2)}
              %
            </p>
          )}
        </div>
      </div>
    </div>
  </div>
);

// ─── Shared: renderSelect helper ─────────────────────────────────────────────

const makeRenderSelect =
  (loadingDropdowns: boolean) =>
  (
    value: string,
    onChange: (v: string) => void,
    options: DropdownOption[],
    placeholder: string,
    hasError: boolean,
  ) => {
    if (loadingDropdowns) return <SelectSkeleton />;
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${selectCls} ${hasError ? "border-red-400" : ""}`}
      >
        <option value="">
          {options.length === 0
            ? `No ${placeholder.toLowerCase()} found`
            : `${placeholder}…`}
        </option>
        {options.map((o) => (
          <option key={o.id} value={String(o.id)}>
            {o.name}
          </option>
        ))}
      </select>
    );
  };

// ─── Status helpers ───────────────────────────────────────────────────────────

const getStatusConfig = (status: string) => {
  const s = (status || "Draft").toLowerCase();
  if (s === "approved")
    return {
      icon: <BadgeCheck size={12} />,
      cls: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    };
  if (s === "pending")
    return {
      icon: <Clock size={12} />,
      cls: "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    };
  if (s === "rejected")
    return {
      icon: <XCircle size={12} />,
      cls: "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800",
    };
  return {
    icon: <FileText size={12} />,
    cls: "bg-muted text-muted-foreground border-border",
  };
};

// ─── Material Breakdown Modal ─────────────────────────────────────────────────

const MaterialBreakdownModal: React.FC<{
  activity: Activity;
  uomOptions: DropdownOption[];
  itemOptions: ItemOption[];
  loadingItems: boolean;
  onUpdateMaterials: (materials: MaterialItem[]) => void;
}> = ({
  activity,
  uomOptions,
  itemOptions,
  loadingItems,
  onUpdateMaterials,
}) => {
  const [open, setOpen] = useState(false);
  const materialsTotal = activity.materials.reduce(
    (sum, m) => sum + m.quantity * m.price,
    0,
  );
  const labourTotal = activity.ratePerUnit * activity.area;

  const addMaterial = () =>
    onUpdateMaterials([...activity.materials, EMPTY_MATERIAL()]);
  const updateMaterial = (idx: number, patch: Partial<MaterialItem>) =>
    onUpdateMaterials(
      activity.materials.map((m, i) => (i === idx ? { ...m, ...patch } : m)),
    );
  const deleteMaterial = (idx: number) =>
    onUpdateMaterials(activity.materials.filter((_, i) => i !== idx));
  const handleItemChange = (idx: number, selectedId: string) => {
    const found = itemOptions.find((it) => it.id === selectedId);
    updateMaterial(idx, {
      itemId: found ? found.id : "",
      itemName: found ? found.name : "",
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
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors whitespace-nowrap ${activity.materials.length > 0 ? "border-primary/30 bg-primary/8 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5"}`}
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

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 w-full sm:max-w-xl max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-card border border-border shadow-2xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border shrink-0">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Package size={15} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  Material Breakdown
                </p>
                {activity.name && (
                  <p className="text-xs text-muted-foreground truncate">
                    {activity.name}
                  </p>
                )}
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
                    {activity.area} {activity.unit || "—"}
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
                          {loadingItems ? (
                            <div className="flex-1 h-[34px] rounded-md border border-border bg-muted/30 animate-pulse" />
                          ) : (
                            <select
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
                            </select>
                          )}
                          <button
                            onClick={() => deleteMaterial(idx)}
                            className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                          >
                            <X size={13} />
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <CellLabel>Qty</CellLabel>
                            <input
                              type="number"
                              min={0}
                              value={mat.quantity || ""}
                              onChange={(e) =>
                                updateMaterial(idx, {
                                  quantity: parseFloat(e.target.value) || 0,
                                })
                              }
                              placeholder={
                                activity.area > 0 ? String(activity.area) : "0"
                              }
                              className={cellInput}
                            />
                          </div>
                          <div>
                            <CellLabel>Unit</CellLabel>
                            {uomOptions.length > 0 ? (
                              <select
                                value={
                                  mat.uomId !== null ? String(mat.uomId) : ""
                                }
                                onChange={(e) =>
                                  handleMatUomChange(idx, e.target.value)
                                }
                                className="w-full text-sm rounded-md border border-border px-2 py-1.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none"
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
                            <CellLabel>Price / Unit</CellLabel>
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
                            {mat.itemName || (
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
  onUpdate: (patch: Partial<Activity>) => void;
  onDelete: () => void;
  canDelete: boolean;
  activityOptions: ActivityOption[];
  uomOptions: DropdownOption[];
  itemOptions: ItemOption[];
  loadingActivities: boolean;
  loadingItems: boolean;
}> = ({
  activity,
  index,
  groupIndex,
  onUpdate,
  onDelete,
  canDelete,
  activityOptions,
  uomOptions,
  itemOptions,
  loadingActivities,
  loadingItems,
}) => {
  const safeOptions = ensureArray<ActivityOption>(activityOptions);
  const safeUomOptions = ensureArray<DropdownOption>(uomOptions);
  const labourTotal = activity.ratePerUnit * activity.area;
  const materialsTotal = activity.materials.reduce(
    (sum, m) => sum + m.quantity * m.price,
    0,
  );
  const activityTotal = labourTotal + materialsTotal;
  const label = `${groupIndex + 1}.${index + 1}`;

  const handleActivityChange = (selectedId: string) => {
    const found = safeOptions.find((a) => String(a.id) === selectedId);
    onUpdate({
      activityId: found ? found.id : null,
      name: found ? found.name : "",
    });
  };
  const handleUomChange = (selectedId: string) => {
    const found = safeUomOptions.find((u) => String(u.id) === selectedId);
    onUpdate({ uomId: found ? found.id : null, unit: found ? found.name : "" });
  };

  const activitySelectJSX = loadingActivities ? (
    <div className={`${cellSelect} bg-muted/30 animate-pulse h-[34px]`} />
  ) : (
    <select
      value={activity.activityId !== null ? String(activity.activityId) : ""}
      onChange={(e) => handleActivityChange(e.target.value)}
      className={cellSelect}
    >
      <option value="">
        {safeOptions.length === 0
          ? "No activities available"
          : "Select activity…"}
      </option>
      {safeOptions.map((a) => (
        <option key={a.id} value={String(a.id)}>
          {a.name}
        </option>
      ))}
    </select>
  );

  const uomSelectJSX = loadingActivities ? (
    <div className={`${cellSelect} bg-muted/30 animate-pulse h-[34px]`} />
  ) : (
    <select
      value={activity.uomId !== null ? String(activity.uomId) : ""}
      onChange={(e) => handleUomChange(e.target.value)}
      className="w-full text-sm rounded-md border border-border px-2 py-1.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none"
    >
      <option value="">
        {safeUomOptions.length === 0 ? "No UOMs" : "Select unit…"}
      </option>
      {safeUomOptions.map((u) => (
        <option key={u.id} value={String(u.id)}>
          {u.name}
        </option>
      ))}
    </select>
  );

  return (
    <>
      {/* Mobile */}
      <div className="sm:hidden rounded-lg border border-border/60 bg-muted/10 p-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-primary font-bold shrink-0 w-8">
            {label}
          </span>
          <div className="flex-1">{activitySelectJSX}</div>
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
            <CellLabel>Unit</CellLabel>
            {uomSelectJSX}
          </div>
          <div>
            <CellLabel>Area</CellLabel>
            <input
              type="number"
              min={0}
              value={activity.area || ""}
              onChange={(e) =>
                onUpdate({ area: parseFloat(e.target.value) || 0 })
              }
              placeholder="0"
              className={cellInput}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <CellLabel>Rate / Unit (Labour)</CellLabel>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                ₹
              </span>
              <input
                type="number"
                min={0}
                value={activity.ratePerUnit || ""}
                onChange={(e) =>
                  onUpdate({ ratePerUnit: parseFloat(e.target.value) || 0 })
                }
                placeholder="0"
                className={`${cellInput} pl-6`}
              />
            </div>
          </div>
          <div>
            <CellLabel>Activity Total</CellLabel>
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
          uomOptions={uomOptions}
          itemOptions={itemOptions}
          loadingItems={loadingItems}
          onUpdateMaterials={(mats) => onUpdate({ materials: mats })}
        />
      </div>

      {/* Desktop */}
      <div className="hidden sm:block rounded-lg border border-border/50 overflow-hidden">
        <div className="grid grid-cols-[48px_1fr_120px_128px_112px_auto_120px_32px] gap-2 items-center px-3 py-2.5 bg-muted/20">
          <div className="text-xs font-mono text-primary font-semibold">
            {label}
          </div>
          {activitySelectJSX}
          {uomSelectJSX}
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              ₹
            </span>
            <input
              type="number"
              min={0}
              value={activity.ratePerUnit || ""}
              onChange={(e) =>
                onUpdate({ ratePerUnit: parseFloat(e.target.value) || 0 })
              }
              placeholder="Rate"
              className={`${cellInput} pl-6`}
            />
          </div>
          <input
            type="number"
            min={0}
            value={activity.area || ""}
            onChange={(e) =>
              onUpdate({ area: parseFloat(e.target.value) || 0 })
            }
            placeholder="Area"
            className={cellInput}
          />
          <MaterialBreakdownModal
            activity={activity}
            uomOptions={uomOptions}
            itemOptions={itemOptions}
            loadingItems={loadingItems}
            onUpdateMaterials={(mats) => onUpdate({ materials: mats })}
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

// ─── Activity Group Card ──────────────────────────────────────────────────────

const ActivityGroupCard: React.FC<{
  group: ActivityGroup;
  index: number;
  onUpdate: (updated: ActivityGroup) => void;
  onDelete: () => void;
  canDelete: boolean;
  activityGroupOptions: DropdownOption[];
  activityOptions: ActivityOption[];
  uomOptions: DropdownOption[];
  itemOptions: ItemOption[];
  loadingDropdowns: boolean;
  loadingItems: boolean;
}> = ({
  group,
  index,
  onUpdate,
  onDelete,
  canDelete,
  activityGroupOptions,
  activityOptions,
  uomOptions,
  itemOptions,
  loadingDropdowns,
  loadingItems,
}) => {
  const safeGroupOptions = ensureArray<DropdownOption>(activityGroupOptions);
  const safeActivityOptions = ensureArray<ActivityOption>(activityOptions);
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
  const filteredActivities =
    group.groupId !== null
      ? safeActivityOptions.filter(
          (a) => Number(a.groupId) === Number(group.groupId),
        )
      : safeActivityOptions;

  const updateActivity = (actIdx: number, patch: Partial<Activity>) =>
    onUpdate({
      ...group,
      activities: group.activities.map((a, i) =>
        i === actIdx ? { ...a, ...patch } : a,
      ),
    });
  const addActivity = () =>
    onUpdate({ ...group, activities: [...group.activities, EMPTY_ACTIVITY()] });
  const deleteActivity = (actIdx: number) =>
    onUpdate({
      ...group,
      activities: group.activities.filter((_, i) => i !== actIdx),
    });
  const toggleExpand = () => onUpdate({ ...group, expanded: !group.expanded });
  const handleGroupChange = (selectedId: string) => {
    const found = safeGroupOptions.find((g) => String(g.id) === selectedId);
    onUpdate({
      ...group,
      groupId: found ? found.id : null,
      name: found ? found.name : "",
      activities: [EMPTY_ACTIVITY()],
    });
  };

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
        {loadingDropdowns ? (
          <div className="flex-1 h-8 rounded-md bg-muted/50 animate-pulse" />
        ) : (
          <select
            value={group.groupId !== null ? String(group.groupId) : ""}
            onChange={(e) => handleGroupChange(e.target.value)}
            className="flex-1 min-w-0 text-sm font-semibold bg-background border border-border rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none cursor-pointer"
          >
            <option value="">
              {safeGroupOptions.length === 0
                ? "No groups available"
                : "Select group…"}
            </option>
            {safeGroupOptions.map((g) => (
              <option key={g.id} value={String(g.id)}>
                {g.name}
              </option>
            ))}
          </select>
        )}
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
            <div className="hidden sm:grid grid-cols-[48px_1fr_120px_128px_112px_auto_120px_32px] gap-2 px-3 pb-1">
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
              onUpdate={(patch) => updateActivity(actIdx, patch)}
              onDelete={() => deleteActivity(actIdx)}
              canDelete={group.activities.length > 1}
              activityOptions={filteredActivities}
              uomOptions={uomOptions}
              itemOptions={itemOptions}
              loadingActivities={loadingDropdowns}
              loadingItems={loadingItems}
            />
          ))}
          {group.groupId !== null &&
            filteredActivities.length === 0 &&
            !loadingDropdowns && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                <AlertCircle size={13} className="text-amber-500 shrink-0" />
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  No activities found for this group.
                </span>
              </div>
            )}
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

// ─── Shared: Activity form section (groups + footer) ─────────────────────────

const ActivitySection: React.FC<{
  groups: ActivityGroup[];
  activityGroupOptions: DropdownOption[];
  activityOptions: ActivityOption[];
  uomOptions: DropdownOption[];
  itemOptions: ItemOption[];
  loadingDropdowns: boolean;
  loadingItems: boolean;
  onAddGroup: () => void;
  onUpdateGroup: (idx: number, g: ActivityGroup) => void;
  onDeleteGroup: (idx: number) => void;
  grandLabourTotal: number;
  grandMaterialsTotal: number;
  grandTotal: number;
  gstRate: number;
  gstType: WOGSTType;
  gstAmount: number;
  grandSubtotal: number;
}> = ({
  groups,
  activityGroupOptions,
  activityOptions,
  uomOptions,
  itemOptions,
  loadingDropdowns,
  loadingItems,
  onAddGroup,
  onUpdateGroup,
  onDeleteGroup,
  grandLabourTotal,
  grandMaterialsTotal,
  grandTotal,
  gstRate,
  gstType,
  gstAmount,
  grandSubtotal,
}) => (
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
        onClick={onAddGroup}
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
          onUpdate={(updated) => onUpdateGroup(idx, updated)}
          onDelete={() => onDeleteGroup(idx)}
          canDelete={groups.length > 1}
          activityGroupOptions={activityGroupOptions}
          activityOptions={activityOptions}
          uomOptions={uomOptions}
          itemOptions={itemOptions}
          loadingDropdowns={loadingDropdowns}
          loadingItems={loadingItems}
        />
      ))}
    </div>
    <TotalFooter
      materials={grandMaterialsTotal}
      labour={grandLabourTotal}
      grandTotal={grandTotal}
    />
    <GstBreakdownBar
      gstRate={gstRate}
      gstType={gstType}
      gstAmount={gstAmount}
      subtotal={grandSubtotal}
    />
  </div>
);

// ─── VIEW: Work Order Detail Panel ────────────────────────────────────────────

const WorkOrderDetailPanel: React.FC<{
  workOrderId: number;
  onBack: () => void;
  onDelete: (id: number) => void;
  onEdit: (id: number) => void;
}> = ({ workOrderId, onBack, onDelete, onEdit }) => {
  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );
  const [expandedMaterials, setExpandedMaterials] = useState<
    Record<number, boolean>
  >({});
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getWorkOrder(workOrderId);
        setDetail(data);
        const exp: Record<string, boolean> = {};
        (data.activities || []).forEach(
          (_: WorkOrderActivityDetail, i: number) => {
            exp[i] = true;
          },
        );
        setExpandedGroups(exp);
      } catch {
        setError("Failed to load work order details.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [workOrderId]);

  const toggleGroup = (idx: number) =>
    setExpandedGroups((p) => ({ ...p, [idx]: !p[idx] }));
  const toggleMaterials = (actId: number) =>
    setExpandedMaterials((p) => ({ ...p, [actId]: !p[actId] }));

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteWorkOrder(workOrderId);
      toast.success("Work order deleted successfully");
      onDelete(workOrderId);
    } catch {
      toast.error("Failed to delete work order");
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (error || !detail)
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-6 text-center">
        <AlertCircle size={24} className="text-red-500 mx-auto mb-2" />
        <p className="text-sm text-red-600 dark:text-red-400">
          {error || "Work order not found"}
        </p>
        <button
          onClick={onBack}
          className="mt-3 text-xs text-primary underline"
        >
          Go back
        </button>
      </div>
    );

  const statusCfg = getStatusConfig(detail.Status);
  const grouped: Record<string, WorkOrderActivityDetail[]> = {};
  (detail.activities || []).forEach((act) => {
    const key = act.ActivityGroupName || "Ungrouped";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(act);
  });
  const grandLabour = (detail.activities || []).reduce(
    (s, a) => s + (a.LabourAmount || 0),
    0,
  );
  const grandMaterials = (detail.activities || []).reduce(
    (s, a) => s + (a.MaterialAmount || 0),
    0,
  );

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={15} />
          <span>Back to List</span>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(detail.Id)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            <PenSquare size={13} />
            <span className="hidden sm:inline">Edit</span>
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
            >
              <Trash2 size={13} />
              <span className="hidden sm:inline">Delete</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/20">
              <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                Confirm?
              </span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs font-semibold text-red-600 dark:text-red-400 hover:text-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Header info card */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <FileText size={15} className="text-primary shrink-0" />
            <h2 className="text-sm font-semibold text-foreground">
              {detail.DocumentNumber}
            </h2>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${statusCfg.cls}`}
            >
              {statusCfg.icon}
              {detail.Status || "Draft"}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {detail.DocumentDate
              ? new Date(detail.DocumentDate).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })
              : "—"}
          </span>
        </div>
        <div className="p-4 sm:p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            {
              label: "Company",
              value: detail.CompanyName,
              icon: <Building2 size={11} />,
            },
            {
              label: "Project",
              value: detail.ProjectName,
              icon: <Layers size={11} />,
            },
            {
              label: "Contractor",
              value: detail.ContractorName,
              icon: <User size={11} />,
            },
            {
              label: "Created By",
              value: detail.CreatedBy,
              icon: <User size={11} />,
            },
            {
              label: "Created At",
              value: detail.CreatedAt
                ? new Date(detail.CreatedAt).toLocaleDateString("en-IN")
                : "—",
              icon: <Calendar size={11} />,
            },
            {
              label: "Total Amount",
              value: fmt(detail.TotalAmount || 0),
              icon: <IndianRupee size={11} />,
            },
          ].map(({ label, value, icon }) => (
            <div key={label}>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                {icon}
                {label}
              </p>
              <p className="text-sm font-medium text-foreground">
                {value || "—"}
              </p>
            </div>
          ))}
        </div>
        {detail.Remarks && (
          <div className="px-4 sm:px-5 py-3 border-t border-border bg-muted/10">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Remarks
            </p>
            <p className="text-sm text-foreground">{detail.Remarks}</p>
          </div>
        )}
      </div>

      {/* Activities */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-border flex items-center gap-2">
          <Calculator size={15} className="text-primary shrink-0" />
          <h2 className="text-sm font-semibold text-foreground">
            Activity Breakdown
          </h2>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full ml-auto">
            {detail.activities?.length || 0} activities
          </span>
        </div>
        <div className="divide-y divide-border">
          {Object.entries(grouped).map(([groupName, acts], groupIdx) => (
            <div key={groupName}>
              {/* Group header */}
              <button
                onClick={() => toggleGroup(groupIdx)}
                className="w-full flex items-center gap-2 px-4 py-3 bg-muted/20 hover:bg-muted/30 transition-colors text-left"
              >
                {expandedGroups[groupIdx] ? (
                  <ChevronDown
                    size={13}
                    className="text-muted-foreground shrink-0"
                  />
                ) : (
                  <ChevronRight
                    size={13}
                    className="text-muted-foreground shrink-0"
                  />
                )}
                <span className="text-xs font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-md">
                  {groupIdx + 1}
                </span>
                <span className="text-sm font-semibold text-foreground flex-1">
                  {groupName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {acts.length} activities
                </span>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {fmt(acts.reduce((s, a) => s + (a.GrandTotal || 0), 0))}
                </span>
              </button>

              {expandedGroups[groupIdx] && (
                <div className="divide-y divide-border/50">
                  {/* Desktop activity header */}
                  <div className="hidden sm:grid grid-cols-[32px_1fr_80px_110px_80px_110px_110px_110px] gap-2 px-4 py-2 bg-muted/5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {[
                      "#",
                      "Activity",
                      "Unit",
                      "Rate",
                      "Area",
                      "Labour",
                      "Materials",
                      "Total",
                    ].map((h) => (
                      <div key={h}>{h}</div>
                    ))}
                  </div>
                  {acts.map((act, actIdx) => {
                    const hasMaterials =
                      act.materials && act.materials.length > 0;
                    const matExpanded = expandedMaterials[act.Id];
                    return (
                      <div
                        key={act.Id}
                        className="border-b border-border/30 last:border-0"
                      >
                        {/* Mobile activity */}
                        <div className="sm:hidden p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-primary font-bold shrink-0">
                              {groupIdx + 1}.{actIdx + 1}
                            </span>
                            <span className="text-sm font-medium text-foreground flex-1">
                              {act.ActivityName || "—"}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">
                                Unit:
                              </span>{" "}
                              <span className="font-medium">
                                {act.UOMName || "—"}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">
                                Area:
                              </span>{" "}
                              <span className="font-medium">
                                {act.Area || "—"}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">
                                Rate:
                              </span>{" "}
                              <span className="font-medium">
                                {act.Rate ? fmt(act.Rate) : "—"}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">
                                Labour:
                              </span>{" "}
                              <span className="font-medium text-blue-600 dark:text-blue-400">
                                {act.LabourAmount ? fmt(act.LabourAmount) : "—"}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between pt-1 border-t border-border/50">
                            <span className="text-xs text-muted-foreground">
                              Activity Total
                            </span>
                            <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                              {fmt(act.GrandTotal || 0)}
                            </span>
                          </div>
                        </div>
                        {/* Desktop activity row */}
                        <div className="hidden sm:grid grid-cols-[32px_1fr_80px_110px_80px_110px_110px_110px] gap-2 items-center px-3 py-2.5 bg-muted/10">
                          <span className="text-xs font-mono text-primary font-semibold">
                            {groupIdx + 1}.{actIdx + 1}
                          </span>
                          <span
                            className="text-sm font-medium text-foreground truncate"
                            title={act.ActivityName}
                          >
                            {act.ActivityName || "—"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {act.UOMName || "—"}
                          </span>
                          <span className="text-xs font-medium">
                            {act.Rate ? fmt(act.Rate) : "—"}
                          </span>
                          <span className="text-xs font-medium">
                            {act.Area ?? "—"}
                          </span>
                          <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                            {act.LabourAmount ? fmt(act.LabourAmount) : "—"}
                          </span>
                          <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                            {act.MaterialAmount ? fmt(act.MaterialAmount) : "—"}
                          </span>
                          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                            {fmt(act.GrandTotal || 0)}
                          </span>
                        </div>
                        {/* Materials toggle */}
                        {hasMaterials && (
                          <>
                            <button
                              onClick={() => toggleMaterials(act.Id)}
                              className="w-full flex items-center gap-2 px-4 py-2 bg-muted/5 border-t border-border/40 text-xs text-muted-foreground hover:bg-muted/20 transition-colors"
                            >
                              <Package
                                size={11}
                                className="text-amber-500 shrink-0"
                              />
                              <span className="font-medium">
                                {act.materials.length} Material
                                {act.materials.length !== 1 ? "s" : ""}
                              </span>
                              <span className="ml-auto font-semibold text-amber-600 dark:text-amber-400">
                                {fmt(act.MaterialAmount || 0)}
                              </span>
                              {matExpanded ? (
                                <ChevronUp size={11} />
                              ) : (
                                <ChevronDown size={11} />
                              )}
                            </button>
                            {matExpanded && (
                              <div className="border-t border-border/40 bg-amber-50/30 dark:bg-amber-950/10">
                                <div className="hidden sm:grid grid-cols-[1fr_80px_80px_80px_120px] gap-2 px-6 py-1.5 border-b border-border/30">
                                  {[
                                    "Item Name",
                                    "Qty",
                                    "Unit",
                                    "Rate",
                                    "Amount",
                                  ].map((h) => (
                                    <div
                                      key={h}
                                      className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70"
                                    >
                                      {h}
                                    </div>
                                  ))}
                                </div>
                                {act.materials.map((mat, matIdx) => {
                                  const lineTotal =
                                    (mat.Quantity || 0) * (mat.Rate || 0);
                                  return (
                                    <div key={mat.Id}>
                                      <div className="sm:hidden flex items-center justify-between px-4 py-2 border-b border-border/20 last:border-0">
                                        <div>
                                          <p className="text-xs font-medium text-foreground">
                                            {mat.ItemName || "—"}
                                          </p>
                                          <p className="text-[10px] text-muted-foreground">
                                            {mat.Quantity} {mat.UOMName} × ₹
                                            {mat.Rate}
                                          </p>
                                        </div>
                                        <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                                          {lineTotal > 0 ? fmt(lineTotal) : "—"}
                                        </span>
                                      </div>
                                      <div className="hidden sm:grid grid-cols-[1fr_80px_80px_80px_120px] gap-2 items-center px-6 py-2 border-b border-border/20 last:border-0">
                                        <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                                          <span className="w-4 h-4 rounded flex items-center justify-center bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-[10px] font-bold shrink-0">
                                            {matIdx + 1}
                                          </span>
                                          {mat.ItemName || "—"}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                          {mat.Quantity ?? "—"}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                          {mat.UOMName || "—"}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                          {mat.Rate ? `₹${mat.Rate}` : "—"}
                                        </span>
                                        <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                                          {lineTotal > 0 ? fmt(lineTotal) : "—"}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                                <div className="flex items-center justify-between px-6 py-2 bg-amber-50/50 dark:bg-amber-950/20 border-t border-amber-200/50 dark:border-amber-800/30">
                                  <span className="text-xs font-semibold text-muted-foreground">
                                    Materials Subtotal
                                  </span>
                                  <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                                    {fmt(act.MaterialAmount || 0)}
                                  </span>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                        {act.Remarks && (
                          <div className="px-4 py-2 border-t border-border/30 bg-muted/5">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
                              Remarks:{" "}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {act.Remarks}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="border-t border-border bg-muted/10">
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border/50">
            <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Package size={11} className="text-amber-500" />
                Raw Materials
              </span>
              <span className="text-base font-bold text-amber-600 dark:text-amber-400">
                {fmt(grandMaterials)}
              </span>
            </div>
            <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Hammer size={11} className="text-blue-500" />
                Labour
              </span>
              <span className="text-base font-bold text-blue-600 dark:text-blue-400">
                {fmt(grandLabour)}
              </span>
            </div>
            <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3 bg-muted/20">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Receipt size={11} className="text-primary" />
                Grand Total
              </span>
              <span className="text-xl font-bold text-foreground">
                {fmt(detail.TotalAmount || 0)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── VIEW: Work Orders List ───────────────────────────────────────────────────

const WorkOrdersList: React.FC<{ onViewDetail: (id: number) => void }> = ({
  onViewDetail,
}) => {
  const [workOrders, setWorkOrders] = useState<WorkOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 10;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getWorkOrders();
      const arr = ensureArray<WorkOrderListItem>(data);
      setWorkOrders(arr);
      setTotal(arr.length);
      setTotalPages(Math.ceil(arr.length / LIMIT));
    } catch {
      setError("Failed to load work orders.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let list = workOrders;
    if (statusFilter !== "all")
      list = list.filter(
        (w) =>
          (w.Status || "Draft").toLowerCase() === statusFilter.toLowerCase(),
      );
    if (search.trim())
      list = list.filter(
        (w) =>
          w.DocumentNumber?.toLowerCase().includes(search.toLowerCase()) ||
          w.CompanyName?.toLowerCase().includes(search.toLowerCase()) ||
          w.ProjectName?.toLowerCase().includes(search.toLowerCase()) ||
          w.ContractorName?.toLowerCase().includes(search.toLowerCase()),
      );
    return list;
  }, [workOrders, statusFilter, search]);

  const paginated = filtered.slice((page - 1) * LIMIT, page * LIMIT);
  const filteredPages = Math.ceil(filtered.length / LIMIT);

  const stats = useMemo(
    () => ({
      total: workOrders.reduce((s, w) => s + (w.TotalAmount || 0), 0),
      approved: workOrders.filter(
        (w) => (w.Status || "").toLowerCase() === "approved",
      ).length,
      pending: workOrders.filter(
        (w) => (w.Status || "").toLowerCase() === "pending",
      ).length,
      count: workOrders.length,
    }),
    [workOrders],
  );

  return (
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Total Orders",
            value: String(stats.count),
            icon: <ClipboardList size={14} />,
            color: "text-primary",
          },
          {
            label: "Total Value",
            value: fmt(stats.total),
            icon: <TrendingUp size={14} />,
            color: "text-emerald-600 dark:text-emerald-400",
          },
          {
            label: "Approved",
            value: String(stats.approved),
            icon: <BadgeCheck size={14} />,
            color: "text-emerald-600 dark:text-emerald-400",
          },
          {
            label: "Pending",
            value: String(stats.pending),
            icon: <Clock size={14} />,
            color: "text-amber-600 dark:text-amber-400",
          },
        ].map(({ label, value, icon, color }) => (
          <div
            key={label}
            className="rounded-xl border border-border bg-card px-4 py-3"
          >
            <div
              className={`flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-1 ${color}`}
            >
              {icon}
              {label}
            </div>
            <p className={`text-lg font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px]">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search orders…"
            className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="text-sm rounded-lg border border-border px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none"
        >
          <option value="all">All Status</option>
          <option value="draft">Draft</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {error && <ErrorBox msg={error} />}

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_100px_90px_100px_80px] gap-3 px-4 py-3 bg-muted/30 border-b border-border">
          {[
            "Document No.",
            "Company",
            "Project / Contractor",
            "Date",
            "Activities",
            "Amount",
            "Status",
          ].map((h) => (
            <div
              key={h}
              className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {h}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="px-4 py-4 animate-pulse">
                <div className="grid grid-cols-[1fr_1fr_1fr_100px_90px_100px_80px] gap-3">
                  {[1, 2, 3, 4, 5, 6, 7].map((j) => (
                    <div key={j} className="h-4 bg-muted rounded" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <ClipboardList size={24} className="text-muted-foreground/40" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              {search || statusFilter !== "all"
                ? "No work orders match your filters"
                : "No work orders yet"}
            </p>
            {(search || statusFilter !== "all") && (
              <button
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                }}
                className="mt-2 text-xs text-primary underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {paginated.map((wo) => {
              const statusCfg = getStatusConfig(wo.Status);
              const dateStr = wo.DocumentDate
                ? new Date(wo.DocumentDate).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })
                : "—";
              return (
                <button
                  key={wo.Id}
                  onClick={() => onViewDetail(wo.Id)}
                  className="w-full text-left hover:bg-muted/20 transition-colors"
                >
                  {/* Mobile */}
                  <div className="sm:hidden p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground font-mono">
                          {wo.DocumentNumber}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {wo.CompanyName}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${statusCfg.cls}`}
                      >
                        {statusCfg.icon}
                        {wo.Status || "Draft"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{wo.ContractorName}</span>
                      <span className="font-semibold text-foreground">
                        {fmt(wo.TotalAmount || 0)}
                      </span>
                    </div>
                  </div>
                  {/* Desktop */}
                  <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_100px_90px_100px_80px] gap-3 items-center px-4 py-3.5">
                    <span className="text-sm font-semibold text-foreground font-mono">
                      {wo.DocumentNumber}
                    </span>
                    <span className="text-sm text-foreground truncate">
                      {wo.CompanyName}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">
                        {wo.ProjectName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {wo.ContractorName}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {dateStr}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {wo.ActivityCount ?? "—"}
                    </span>
                    <span className="text-sm font-semibold text-foreground">
                      {fmt(wo.TotalAmount || 0)}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${statusCfg.cls}`}
                    >
                      {statusCfg.icon}
                      {wo.Status || "Draft"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {filteredPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {filtered.length} results
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-muted-foreground px-2">
              {page} / {filteredPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(filteredPages, p + 1))}
              disabled={page === filteredPages}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── VIEW: Work Order Edit Panel ──────────────────────────────────────────────

const WorkOrderEditPanel: React.FC<{
  workOrderId: number;
  onBack: () => void;
  onSaved: (id: number) => void;
}> = ({ workOrderId, onBack, onSaved }) => {
  const { currentUser } = useAuth();
  const { data: hsnData } = useQuery({
    queryKey: ["hsn"],
    queryFn: getHsn,
    staleTime: 5 * 60 * 1000,
  });
  const hsnRecords = mapHsnRecords(hsnData);
  const userId = (currentUser as { id?: number } | null)?.id ?? 1;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setFormState] = useState<WorkOrderForm>(EMPTY_FORM());
  const [groups, setGroups] = useState<ActivityGroup[]>([EMPTY_GROUP()]);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [companies, setCompanies] = useState<DropdownOption[]>([]);
  const [projects, setProjects] = useState<DropdownOption[]>([]);
  const [contractors, setContractors] = useState<DropdownOption[]>([]);
  const [activityGroupOptions, setActivityGroupOptions] = useState<
    DropdownOption[]
  >([]);
  const [activityOptions, setActivityOptions] = useState<ActivityOption[]>([]);
  const [uomOptions, setUomOptions] = useState<DropdownOption[]>([]);
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [loadingDropdowns, setLoadingDropdowns] = useState(true);
  const [dropdownError, setDropdownError] = useState<string | null>(null);
  const [loadingItems, setLoadingItems] = useState(true);

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      setLoadingDropdowns(true);
      setDropdownError(null);
      try {
        const [comp, proj, cont, grps, acts, uomsRaw, detail, items] =
          await Promise.all([
            fetchCompanies(),
            fetchProjects(),
            fetchContractors(),
            fetchActivityGroups(),
            fetchActivities(),
            fetchWithAuth("/api/work-orders/meta/uoms").then((r) =>
              r.ok ? r.json() : [],
            ),
            getWorkOrder(workOrderId),
            fetchItems(),
          ]);
        const compList = ensureArray<DropdownOption>(comp);
        const projList = ensureArray<DropdownOption>(proj);
        const contList = ensureArray<DropdownOption>(cont);
        setCompanies(compList);
        setProjects(projList);
        setContractors(contList);
        setActivityGroupOptions(ensureArray<DropdownOption>(grps));
        setActivityOptions(
          normalizeActivities(ensureArray<ActivityOption>(acts)),
        );
        setUomOptions(ensureArray<DropdownOption>(uomsRaw));
        setItemOptions(ensureArray<ItemOption>(items));

        const compId =
          compList.find((c) => c.name === detail.CompanyName)?.id ?? "";
        const projId =
          projList.find((p) => p.name === detail.ProjectName)?.id ?? "";
        const contId =
          contList.find((c) => c.name === detail.ContractorName)?.id ?? "";
        const gstData = detail.GST as {
          applicable?: boolean;
          hsnCode?: string;
          type?: string;
          rate?: number;
        } | null;
        setFormState({
          companyId: compId ? String(compId) : "",
          projectId: projId ? String(projId) : "",
          docNumber: detail.DocumentNumber || "",
          docDate: detail.DocumentDate
            ? detail.DocumentDate.slice(0, 10)
            : new Date().toISOString().slice(0, 10),
          contractorId: contId ? String(contId) : "",
          remarks: detail.Remarks || "",
          termsAndConditions: detail.TermsAndConditions || "",
          hsnCode: gstData?.hsnCode || "",
          gstType: (gstData?.type as WOGSTType) || "cgst_sgst",
          gstRate: gstData?.rate ?? 0,
        });

        const uomArr = ensureArray<DropdownOption>(uomsRaw);
        const serverActs = ensureArray<WorkOrderActivityDetail>(
          detail.activities,
        );
        const groupMap: Record<string, WorkOrderActivityDetail[]> = {};
        serverActs.forEach((a) => {
          const key = a.ActivityGroupName || "Ungrouped";
          if (!groupMap[key]) groupMap[key] = [];
          groupMap[key].push(a);
        });
        const reconstructed: ActivityGroup[] = Object.entries(groupMap).map(
          ([groupName, acts]) => ({
            id: uid(),
            groupId: acts[0]?.ActivityGroupId
              ? Number(acts[0].ActivityGroupId)
              : null,
            name: groupName,
            expanded: true,
            activities: acts.map((a) => ({
              id: uid(),
              activityId: a.ActivityId ? Number(a.ActivityId) : null,
              dbId: a.Id,
              name: a.ActivityName || "",
              uomId: a.UOMId ? Number(a.UOMId) : null,
              unit: a.UOMName || "",
              ratePerUnit: a.Rate || 0,
              area: a.Area || 0,
              materials: ensureArray<WorkOrderMaterialDetail>(a.materials).map(
                (m) => ({
                  id: uid(),
                  dbId: m.Id,
                  itemId: m.ItemIdStr || (m.ItemId ? String(m.ItemId) : ""),
                  itemName: m.ItemName || "",
                  quantity: m.Quantity || 0,
                  uomId: m.UOMId ? Number(m.UOMId) : null,
                  unit: m.UOMName || "",
                  price: m.Rate || 0,
                }),
              ),
            })),
          }),
        );
        setGroups(reconstructed.length > 0 ? reconstructed : [EMPTY_GROUP()]);
      } catch (err) {
        console.error("Failed to load edit data:", err);
        setError("Failed to load work order for editing.");
      } finally {
        setLoading(false);
        setLoadingDropdowns(false);
        setLoadingItems(false);
      }
    };
    loadAll();
  }, [workOrderId]);

  const {
    grandLabourTotal,
    grandMaterialsTotal,
    grandSubtotal,
    gstAmount,
    grandTotal,
  } = useMemo(() => {
    let labour = 0,
      materials = 0;
    for (const g of groups)
      for (const a of g.activities) {
        labour += a.ratePerUnit * a.area;
        materials += a.materials.reduce((s, m) => s + m.quantity * m.price, 0);
      }
    const subtotal = labour + materials;
    const gst = form.gstRate > 0 ? (subtotal * form.gstRate) / 100 : 0;
    return {
      grandLabourTotal: labour,
      grandMaterialsTotal: materials,
      grandSubtotal: subtotal,
      gstAmount: gst,
      grandTotal: subtotal + gst,
    };
  }, [groups, form.gstRate]);

  const setField = (key: keyof WorkOrderForm, value: string) => {
    setFormState((p) => ({ ...p, [key]: value }));
    setErrors((p) => ({ ...p, [key]: false }));
  };
  const addGroup = () => setGroups((prev) => [...prev, EMPTY_GROUP()]);
  const updateGroup = (idx: number, updated: ActivityGroup) =>
    setGroups((prev) => prev.map((g, i) => (i === idx ? updated : g)));
  const deleteGroup = (idx: number) =>
    setGroups((prev) => prev.filter((_, i) => i !== idx));
  const validate = () => {
    const e: Record<string, boolean> = {};
    if (!form.companyId) e.companyId = true;
    if (!form.projectId) e.projectId = true;
    if (!form.docDate) e.docDate = true;
    if (!form.contractorId) e.contractorId = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const renderSelect = makeRenderSelect(loadingDropdowns);

  const handleSave = async () => {
    if (!validate()) {
      toast.error("Please fill in all required fields.");
      return;
    }
    setSaving(true);
    try {
      const activities = groups.flatMap((g) =>
        g.activities.map((a) => ({
          Id: (a as Activity & { dbId?: number }).dbId ?? undefined,
          ActivityGroupId: g.groupId ?? null,
          ActivityId: a.activityId ?? null,
          UOMId: a.uomId ?? null,
          Rate: a.ratePerUnit || null,
          Area: a.area || null,
          LabourAmount: a.ratePerUnit * a.area || null,
          MaterialAmount:
            a.materials.reduce((s, m) => s + m.quantity * m.price, 0) || null,
          GrandTotal:
            a.ratePerUnit * a.area +
              a.materials.reduce((s, m) => s + m.quantity * m.price, 0) || null,
          Remarks: null,
          UpdatedBy: userId,
          materials: a.materials
            .filter((m) => m.itemId && m.itemId.trim() !== "")
            .map((m) => ({
              Id: (m as MaterialItem & { dbId?: number }).dbId ?? undefined,
              ItemId: m.itemId,
              UOMId: m.uomId ?? null,
              Quantity: m.quantity || null,
              Rate: m.price || null,
              Remarks: null,
              UpdatedBy: userId,
            })),
        })),
      );
      await saveFullWorkOrder(workOrderId, {
        header: {
          CompanyId: parseInt(form.companyId),
          ProjectId: parseInt(form.projectId),
          DocumentNumber: form.docNumber,
          DocumentDate: form.docDate,
          ContractorId: parseInt(form.contractorId),
          TotalAmount: grandTotal,
          Remarks: form.remarks || null,
          TermsAndConditions: form.termsAndConditions || null,
          UpdatedBy: userId,
          GST: {
            applicable: form.gstRate > 0,
            hsnCode: form.hsnCode || null,
            type: form.gstType,
            rate: form.gstRate,
          },
        },
        activities,
      });
      toast.success("Work order updated successfully!");
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onSaved(workOrderId);
      }, 1500);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : String(err) || "Failed to update work order.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (error)
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-6 text-center">
        <AlertCircle size={24} className="text-red-500 mx-auto mb-2" />
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <button
          onClick={onBack}
          className="mt-3 text-xs text-primary underline"
        >
          Go back
        </button>
      </div>
    );

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={15} />
          <span>Back to Detail</span>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            <X size={13} />
            Cancel
          </button>
          <SaveButton
            saving={saving}
            saved={saved}
            disabled={loadingDropdowns}
            label="Update Work Order"
            size="sm"
            onClick={handleSave}
          />
        </div>
      </div>

      {dropdownError && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-4 py-3">
          <AlertCircle size={15} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {dropdownError}
          </p>
        </div>
      )}

      {/* Header card */}
      <div className="rounded-xl border border-border bg-card mb-5">
        <div className="px-4 sm:px-5 py-3.5 border-b border-border flex items-center gap-2">
          <PenSquare size={15} className="text-primary shrink-0" />
          <h2 className="text-sm font-semibold text-foreground">
            Edit Work Order
          </h2>
          <span className="ml-auto font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded shrink-0">
            {form.docNumber}
          </span>
        </div>
        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-4">
            <div>
              <FieldLabel required>
                <span className="flex items-center gap-1.5">
                  <Building2 size={11} />
                  Company Name
                </span>
              </FieldLabel>
              {renderSelect(
                form.companyId,
                (v) => setField("companyId", v),
                companies,
                "Select company",
                errors.companyId ?? false,
              )}
              {errors.companyId && (
                <p className="text-xs text-red-500 mt-1">Required</p>
              )}
            </div>
            <div>
              <FieldLabel required>
                <span className="flex items-center gap-1.5">
                  <Layers size={11} />
                  Project Name
                </span>
              </FieldLabel>
              {renderSelect(
                form.projectId,
                (v) => setField("projectId", v),
                projects,
                "Select project",
                errors.projectId ?? false,
              )}
              {errors.projectId && (
                <p className="text-xs text-red-500 mt-1">Required</p>
              )}
            </div>
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
            <div>
              <FieldLabel required>
                <span className="flex items-center gap-1.5">
                  <User size={11} />
                  Contractor
                </span>
              </FieldLabel>
              {renderSelect(
                form.contractorId,
                (v) => setField("contractorId", v),
                contractors,
                "Select contractor",
                errors.contractorId ?? false,
              )}
              {errors.contractorId && (
                <p className="text-xs text-red-500 mt-1">Required</p>
              )}
            </div>
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
            <GstSection
              hsnCode={form.hsnCode}
              gstType={form.gstType}
              gstRate={form.gstRate}
              hsnRecords={hsnRecords}
              onHsnChange={(code, rate) =>
                setFormState((p) => ({ ...p, hsnCode: code, gstRate: rate }))
              }
              onGstTypeChange={(t) =>
                setFormState((p) => ({ ...p, gstType: t }))
              }
              onGstRateChange={(r) =>
                setFormState((p) => ({ ...p, gstRate: r }))
              }
            />
            <div className="col-span-1 sm:col-span-2 lg:col-span-3">
              <FieldLabel>Remarks</FieldLabel>
              <input
                value={form.remarks}
                onChange={(e) => setField("remarks", e.target.value)}
                placeholder="Any additional remarks…"
                className={inputCls}
              />
            </div>
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

      <ActivitySection
        groups={groups}
        activityGroupOptions={activityGroupOptions}
        activityOptions={activityOptions}
        uomOptions={uomOptions}
        itemOptions={itemOptions}
        loadingDropdowns={loadingDropdowns}
        loadingItems={loadingItems}
        onAddGroup={addGroup}
        onUpdateGroup={updateGroup}
        onDeleteGroup={deleteGroup}
        grandLabourTotal={grandLabourTotal}
        grandMaterialsTotal={grandMaterialsTotal}
        grandTotal={grandTotal}
        gstRate={form.gstRate}
        gstType={form.gstType}
        gstAmount={gstAmount}
        grandSubtotal={grandSubtotal}
      />

      <div className="flex items-center justify-end gap-3 pb-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
        >
          <X size={13} />
          Cancel
        </button>
        <SaveButton
          saving={saving}
          saved={saved}
          disabled={loadingDropdowns}
          label="Update Work Order"
          onClick={handleSave}
        />
      </div>
    </>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

type ViewMode = "create" | "list" | "detail" | "edit";

const WorkOrderMaster: React.FC = () => {
  const { currentUser } = useAuth();
  const { finYears } = useFinYear();
  const { data: hsnData } = useQuery({
    queryKey: ["hsn"],
    queryFn: getHsn,
    staleTime: 5 * 60 * 1000,
  });
  const hsnRecords = mapHsnRecords(hsnData);
  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year || undefined;
  const finYearOptions = finYears.filter((fy) => fy.status === "Active");
  const [selectedFinYear, setSelectedFinYear] = useState("");

  useEffect(() => {
    if (!selectedFinYear && activeFinYear) setSelectedFinYear(activeFinYear);
  }, [activeFinYear, selectedFinYear]);

  const [viewMode, setViewMode] = useState<ViewMode>("create");
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [form, setForm] = useState<WorkOrderForm>(EMPTY_FORM());
  const [groups, setGroups] = useState<ActivityGroup[]>([EMPTY_GROUP()]);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [savedStatus, setSavedStatus] = useState<string>("Draft");
  const [woDocTypeId, setWoDocTypeId] = useState<number | null>(null);
  const [woDocNo, setWoDocNo] = useState("");
  const [docRefreshTrigger, setDocRefreshTrigger] = useState(0);

  const applyWoDocNumber = (docTypeId: number | null, docNo: string) => {
    setWoDocTypeId(docTypeId);
    setWoDocNo(docNo);
    setForm((prev) => ({ ...prev, docNumber: docNo }));
  };
  const refreshWoDocNumber = async (
    docTypeId: number | null = woDocTypeId,
    finYearOverride = selectedFinYear,
  ) => {
    if (!docTypeId) {
      applyWoDocNumber(null, "");
      return "";
    }
    const nextDocNo = await fetchNextDocNumber(
      docTypeId,
      finYearOverride || undefined,
    );
    applyWoDocNumber(docTypeId, nextDocNo);
    setDocRefreshTrigger((current) => current + 1);
    return nextDocNo;
  };

  const [companies, setCompanies] = useState<DropdownOption[]>([]);
  const [projects, setProjects] = useState<DropdownOption[]>([]);
  const [contractors, setContractors] = useState<DropdownOption[]>([]);
  const [activityGroupOptions, setActivityGroupOptions] = useState<
    DropdownOption[]
  >([]);
  const [activityOptions, setActivityOptions] = useState<ActivityOption[]>([]);
  const [uomOptions, setUomOptions] = useState<DropdownOption[]>([]);
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [loadingDropdowns, setLoadingDropdowns] = useState(true);
  const [loadingItems, setLoadingItems] = useState(true);
  const [dropdownError, setDropdownError] = useState<string | null>(null);

  useEffect(() => {
    const loadDropdowns = async () => {
      setLoadingDropdowns(true);
      setDropdownError(null);
      try {
        const [comp, proj, cont, grps, acts, uomsRaw] = await Promise.all([
          fetchCompanies(),
          fetchProjects(),
          fetchContractors(),
          fetchActivityGroups(),
          fetchActivities(),
          fetchWithAuth("/api/work-orders/meta/uoms").then((r) =>
            r.ok ? r.json() : [],
          ),
        ]);
        setCompanies(ensureArray<DropdownOption>(comp));
        setProjects(ensureArray<DropdownOption>(proj));
        setContractors(ensureArray<DropdownOption>(cont));
        setActivityGroupOptions(ensureArray<DropdownOption>(grps));
        setUomOptions(ensureArray<DropdownOption>(uomsRaw));
        setActivityOptions(
          normalizeActivities(ensureArray<ActivityOption>(acts)),
        );
      } catch (err) {
        console.error("Failed to fetch dropdown data:", err);
        setDropdownError(
          "Some dropdown data could not be loaded. You can still fill in the form.",
        );
        toast.error("Failed to load some dropdown data");
        setCompanies([]);
        setProjects([]);
        setContractors([]);
        setActivityGroupOptions([]);
        setActivityOptions([]);
        setUomOptions([]);
      } finally {
        setLoadingDropdowns(false);
      }
    };
    const loadItems = async () => {
      setLoadingItems(true);
      try {
        setItemOptions(ensureArray<ItemOption>(await fetchItems()));
      } catch {
        setItemOptions([]);
      } finally {
        setLoadingItems(false);
      }
    };
    loadDropdowns();
    loadItems();
  }, []);

  const {
    grandLabourTotal,
    grandMaterialsTotal,
    grandSubtotal,
    gstAmount,
    grandTotal,
  } = useMemo(() => {
    let labour = 0,
      materials = 0;
    for (const g of groups)
      for (const a of g.activities) {
        labour += a.ratePerUnit * a.area;
        materials += a.materials.reduce((s, m) => s + m.quantity * m.price, 0);
      }
    const subtotal = labour + materials;
    const gst = form.gstRate > 0 ? (subtotal * form.gstRate) / 100 : 0;
    return {
      grandLabourTotal: labour,
      grandMaterialsTotal: materials,
      grandSubtotal: subtotal,
      gstAmount: gst,
      grandTotal: subtotal + gst,
    };
  }, [groups, form.gstRate]);

  const setField = (key: keyof WorkOrderForm, value: string) => {
    setForm((p) => ({ ...p, [key]: value }));
    setErrors((p) => ({ ...p, [key]: false }));
  };
  const addGroup = () => setGroups((prev) => [...prev, EMPTY_GROUP()]);
  const updateGroup = (idx: number, updated: ActivityGroup) =>
    setGroups((prev) => prev.map((g, i) => (i === idx ? updated : g)));
  const deleteGroup = (idx: number) =>
    setGroups((prev) => prev.filter((_, i) => i !== idx));

  const resetAll = async (keepDocType = false) => {
    const nextDocTypeId = keepDocType ? woDocTypeId : null;
    const nextDocNo = nextDocTypeId
      ? await fetchNextDocNumber(nextDocTypeId, selectedFinYear || undefined)
      : "";
    setForm({ ...EMPTY_FORM(), docNumber: nextDocNo });
    setGroups([EMPTY_GROUP()]);
    setErrors({});
    setSaved(false);
    setSavedId(null);
    setSavedStatus("Draft");
    setWoDocTypeId(nextDocTypeId);
    setWoDocNo(nextDocNo);
    if (nextDocTypeId) setDocRefreshTrigger((current) => current + 1);
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
  const renderSelect = makeRenderSelect(loadingDropdowns);

  const handleSave = async () => {
    if (!validate()) {
      toast.error("Please fill in all required fields.");
      return;
    }
    setSaving(true);
    try {
      const userId = parseInt(currentUser?.id ?? "1");
      const created = await createWorkOrder({
        CompanyId: parseInt(form.companyId),
        ProjectId: parseInt(form.projectId),
        DocumentNumber: form.docNumber,
        DocumentDate: form.docDate,
        ContractorId: parseInt(form.contractorId),
        TotalAmount: grandTotal,
        Remarks: form.remarks || null,
        TermsAndConditions: form.termsAndConditions || null,
        DocTypeId: woDocTypeId,
        DocNo: form.docNumber || woDocNo || null,
        finYear: selectedFinYear || null,
        CreatedBy: userId,
        GST: {
          applicable: form.gstRate > 0,
          type: form.gstType,
          rate: form.gstRate,
        },
      });
      const newHeaderId: number = created.Id;
      const confirmedDocNumber =
        created.DocumentNumber || created.DocNo || form.docNumber;
      const activities = groups.flatMap((g) =>
        g.activities.map((a) => {
          const labourAmt = a.ratePerUnit * a.area;
          const materialAmt = a.materials.reduce(
            (s, m) => s + m.quantity * m.price,
            0,
          );
          return {
            ActivityGroupId: g.groupId ?? null,
            ActivityId: a.activityId ?? null,
            UOMId: a.uomId ?? null,
            Rate: a.ratePerUnit || null,
            Area: a.area || null,
            LabourAmount: labourAmt || null,
            MaterialAmount: materialAmt || null,
            GrandTotal: labourAmt + materialAmt || null,
            Remarks: null,
            materials: a.materials
              .filter((m) => m.itemId && m.itemId.trim() !== "")
              .map((m) => ({
                ItemId: m.itemId,
                UOMId: m.uomId ?? null,
                Quantity: m.quantity || null,
                Rate: m.price || null,
                Remarks: null,
                CreatedBy: userId,
              })),
          };
        }),
      );
      await saveFullWorkOrder(newHeaderId, {
        header: {
          CompanyId: parseInt(form.companyId),
          ProjectId: parseInt(form.projectId),
          DocumentNumber: confirmedDocNumber,
          DocumentDate: form.docDate,
          ContractorId: parseInt(form.contractorId),
          TotalAmount: grandTotal,
          Remarks: form.remarks || null,
          TermsAndConditions: form.termsAndConditions || null,
          DocTypeId: woDocTypeId,
          DocNo: confirmedDocNumber || null,
          UpdatedBy: userId,
          GST: {
            applicable: form.gstRate > 0,
            hsnCode: form.hsnCode || null,
            type: form.gstType,
            rate: form.gstRate,
          },
        },
        activities,
      });
      toast.success("Work order saved successfully!");
      setSaved(true);
      setSavedId(newHeaderId);
      setSavedStatus("Draft");
      await resetAll(!!woDocTypeId);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      let friendly = "Something went wrong. Please try again.";
      if (msg.includes("UNIQUE KEY") || msg.includes("duplicate key"))
        friendly = "A work order with this document number already exists.";
      else if (msg.includes("FK_WorkOrder_Com") || msg.includes("enterprise"))
        friendly = "The selected company doesn't exist.";
      else if (msg.includes("FK_WorkOrder_Project"))
        friendly = "The selected project doesn't exist.";
      else if (
        msg.includes("FK_WorkOrder_Contr") ||
        msg.includes("AccountHeadMaster")
      )
        friendly = "The selected contractor doesn't exist.";
      else if (msg.includes("FK_WOA") || msg.includes("WorkOrderActivities"))
        friendly = "One or more activities could not be saved.";
      else if (
        msg.includes("FK_WOAM") ||
        msg.includes("WorkOrderActivityMaterials")
      )
        friendly = "One or more materials could not be saved.";
      else if (
        msg.includes("FK_WOAM_Item") ||
        msg.includes("Item_Master_Group")
      )
        friendly = "One or more selected items don't exist in the item master.";
      else if (msg.includes("UQ_WOAM_Activity_Item"))
        friendly = "The same item cannot be added twice to the same activity.";
      else if (msg.includes("NOT NULL") || msg.includes("cannot be null"))
        friendly = "Some required fields are missing.";
      else if (msg.includes("FOREIGN KEY"))
        friendly = "A selected value references data that doesn't exist.";
      else if (msg.includes("Cannot insert") || msg.includes("INSERT"))
        friendly = "Could not save the work order. Please check all fields.";
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
          <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5">
            <button
              onClick={() => setViewMode("create")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === "create" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <PenSquare size={13} />
              <span className="hidden sm:inline">Create</span>
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === "list" || viewMode === "detail" || viewMode === "edit" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <List size={13} />
              <span className="hidden sm:inline">View All</span>
            </button>
          </div>
          {viewMode === "create" && (
            <>
              <button
                onClick={() => void resetAll()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                <RotateCcw size={13} />
                <span className="hidden sm:inline">Reset</span>
              </button>
              <SaveButton
                saving={saving}
                saved={saved}
                disabled={saving || loadingDropdowns}
                label="Save Work Order"
                size="sm"
                onClick={handleSave}
              />
            </>
          )}
        </div>
      </div>

      {viewMode === "list" && (
        <WorkOrdersList
          onViewDetail={(id) => {
            setSelectedOrderId(id);
            setViewMode("detail");
          }}
        />
      )}
      {viewMode === "detail" && selectedOrderId !== null && (
        <WorkOrderDetailPanel
          workOrderId={selectedOrderId}
          onBack={() => setViewMode("list")}
          onDelete={() => setViewMode("list")}
          onEdit={(id) => {
            setSelectedOrderId(id);
            setViewMode("edit");
          }}
        />
      )}
      {viewMode === "edit" && selectedOrderId !== null && (
        <WorkOrderEditPanel
          workOrderId={selectedOrderId}
          onBack={() => setViewMode("detail")}
          onSaved={(id) => {
            setSelectedOrderId(id);
            setViewMode("detail");
          }}
        />
      )}

      {viewMode === "create" && (
        <>
          {dropdownError && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-4 py-3">
              <AlertCircle
                size={15}
                className="text-amber-500 shrink-0 mt-0.5"
              />
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {dropdownError}
              </p>
            </div>
          )}

          {savedId && (
            <div className="mb-5 rounded-xl border border-border bg-card px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-muted-foreground">
                  Approval Status:
                </span>
                <StatusBadge status={savedStatus} />
              </div>
              <ApprovalActions
                status={savedStatus}
                recordId={savedId}
                endpoint="/api/work-orders"
                onSuccess={async () => {
                  try {
                    const res = await fetchWithAuth(
                      `/api/work-orders/${savedId}`,
                    );
                    if (res.ok) {
                      const data = await res.json();
                      setSavedStatus(data.Status || data.status || savedStatus);
                    }
                  } catch {
                    /* ignore */
                  }
                }}
              />
            </div>
          )}

          {/* Document Type & Number */}
          <div className="rounded-xl border border-border bg-card mb-5 p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <Hash size={15} className="text-primary shrink-0" />
              <h2 className="text-sm font-semibold text-foreground">
                Document Type &amp; Number
              </h2>
            </div>
            <div className="mb-3">
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                Fin Year
              </label>
              <select
                value={selectedFinYear}
                onChange={(e) => {
                  const nextFinYear = e.target.value;
                  setSelectedFinYear(nextFinYear);
                  if (woDocTypeId)
                    void refreshWoDocNumber(woDocTypeId, nextFinYear);
                }}
                className={selectCls}
              >
                <option value="">Select fin year...</option>
                {finYearOptions.map((fy) => (
                  <option key={fy.id} value={fy.year}>
                    {fy.year}
                  </option>
                ))}
              </select>
            </div>
            <DocNumberPreview
              module="WO"
              finYear={selectedFinYear || undefined}
              selectedDocTypeId={woDocTypeId}
              preview={woDocNo}
              refreshTrigger={docRefreshTrigger}
              onSelect={applyWoDocNumber}
            />
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
                <div>
                  <FieldLabel required>
                    <span className="flex items-center gap-1.5">
                      <Building2 size={11} />
                      Company Name
                    </span>
                  </FieldLabel>
                  {renderSelect(
                    form.companyId,
                    (v) => setField("companyId", v),
                    companies,
                    "Select company",
                    errors.companyId ?? false,
                  )}
                  {errors.companyId && (
                    <p className="text-xs text-red-500 mt-1">Required</p>
                  )}
                </div>
                <div>
                  <FieldLabel required>
                    <span className="flex items-center gap-1.5">
                      <Layers size={11} />
                      Project Name
                    </span>
                  </FieldLabel>
                  {renderSelect(
                    form.projectId,
                    (v) => setField("projectId", v),
                    projects,
                    "Select project",
                    errors.projectId ?? false,
                  )}
                  {errors.projectId && (
                    <p className="text-xs text-red-500 mt-1">Required</p>
                  )}
                </div>
                <div>
                  <FieldLabel>
                    <span className="flex items-center gap-1.5">
                      <Hash size={11} />
                      Document Number
                    </span>
                  </FieldLabel>
                  <input
                    value={form.docNumber}
                    onChange={(e) => {
                      const nextValue = e.target.value.toUpperCase();
                      setForm((prev) => ({ ...prev, docNumber: nextValue }));
                      setWoDocNo(nextValue);
                    }}
                    className={`${inputCls} font-mono`}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Auto-filled from document type, but still editable.
                  </p>
                </div>
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
                <div>
                  <FieldLabel required>
                    <span className="flex items-center gap-1.5">
                      <User size={11} />
                      Contractor
                    </span>
                  </FieldLabel>
                  {renderSelect(
                    form.contractorId,
                    (v) => setField("contractorId", v),
                    contractors,
                    "Select contractor",
                    errors.contractorId ?? false,
                  )}
                  {errors.contractorId && (
                    <p className="text-xs text-red-500 mt-1">Required</p>
                  )}
                </div>
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
                <GstSection
                  hsnCode={form.hsnCode}
                  gstType={form.gstType}
                  gstRate={form.gstRate}
                  hsnRecords={hsnRecords}
                  onHsnChange={(code, rate) =>
                    setForm((p) => ({ ...p, hsnCode: code, gstRate: rate }))
                  }
                  onGstTypeChange={(t) =>
                    setForm((p) => ({ ...p, gstType: t }))
                  }
                  onGstRateChange={(r) =>
                    setForm((p) => ({ ...p, gstRate: r }))
                  }
                />
                <div className="col-span-1 sm:col-span-2 lg:col-span-3">
                  <FieldLabel>Remarks</FieldLabel>
                  <input
                    value={form.remarks}
                    onChange={(e) => setField("remarks", e.target.value)}
                    placeholder="Any additional remarks…"
                    className={inputCls}
                  />
                </div>
                <div className="col-span-1 sm:col-span-2 lg:col-span-3">
                  <FieldLabel>Terms &amp; Conditions</FieldLabel>
                  <textarea
                    value={form.termsAndConditions}
                    onChange={(e) =>
                      setField("termsAndConditions", e.target.value)
                    }
                    placeholder="Enter contractor terms and conditions…"
                    rows={4}
                    className={`${inputCls} resize-none`}
                  />
                </div>
              </div>
            </div>
          </div>

          <ActivitySection
            groups={groups}
            activityGroupOptions={activityGroupOptions}
            activityOptions={activityOptions}
            uomOptions={uomOptions}
            itemOptions={itemOptions}
            loadingDropdowns={loadingDropdowns}
            loadingItems={loadingItems}
            onAddGroup={addGroup}
            onUpdateGroup={updateGroup}
            onDeleteGroup={deleteGroup}
            grandLabourTotal={grandLabourTotal}
            grandMaterialsTotal={grandMaterialsTotal}
            grandTotal={grandTotal}
            gstRate={form.gstRate}
            gstType={form.gstType}
            gstAmount={gstAmount}
            grandSubtotal={grandSubtotal}
          />

          <div className="flex items-center justify-end gap-3 pb-8">
            <button
              onClick={() => void resetAll()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              <RotateCcw size={13} />
              Reset
            </button>
            <SaveButton
              saving={saving}
              saved={saved}
              disabled={saving || loadingDropdowns}
              label="Save Work Order"
              onClick={handleSave}
            />
          </div>
        </>
      )}
    </>
  );
};

export default WorkOrderMaster;
