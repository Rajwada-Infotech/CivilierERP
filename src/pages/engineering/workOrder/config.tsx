// Types, the chain-status hook, number helpers, BOQ-style quantity logic, shared styles and status helpers for the Work Order page and its parts.
import React from "react";
import { FileText, BadgeCheck, Clock, XCircle } from "lucide-react";
import { type WOItemOption } from "@/api/workOrderApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ─── WO Chain Status Hook ─────────────────────────────────────────────────────
export interface WOChainStatus {
  expenseCount: number;
  latestExpenseDocNo: string | null;
  latestExpenseStatus: string | null;
  latestExpenseAmount: number | null;
  paymentCount: number;
  latestPaymentAmount: number | null;
  isPaid: boolean;
  // Ledger fields from work-order-summary
  totalCertified: number;
  totalBooked: number;
  totalPaid: number;
  balance: number;
}

export function useWOChainStatus(woId: number | null) {
  const [status, setStatus] = React.useState<WOChainStatus | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!woId) {
      setStatus(null);
      return;
    }
    setLoading(true);
    Promise.all([
      fetchWithAuth(
        `/api/expense-booking/chain-status?sourceType=WO&sourceId=${woId}`,
      ).then((r) => r.json().catch(() => ({}))),
      fetchWithAuth(`/api/engineering/work-order-summary/${woId}`).then((r) =>
        r.json().catch(() => ({})),
      ),
    ])
      .then(([chain, summary]) => {
        setStatus({
          ...chain,
          totalCertified: summary.totalCertified ?? 0,
          totalBooked: summary.totalBooked ?? 0,
          totalPaid: summary.totalPaid ?? 0,
          balance: summary.balance ?? 0,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [woId]);

  return { status, loading };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MaterialItem {
  id: string;
  itemId: string;
  itemName: string;
  /** Per-unit-of-area quantity (e.g. 60 per m³) — derived: totalQty ÷ activity area */
  consumptionRatio: number;
  /** Total quantity of this item for the whole activity (what the user enters) */
  totalQty?: number;
  uomId: number | null;
  unit: string;
  price: number;
  /** GST rate % auto-filled from HSN when item is selected */
  gstRate: number;
  /** Supplier FK (AccountHeadMaster.LHeadId) for this material line */
  supplierId: number | null;
  supplierName: string;
}

// GST type for per-activity HSN selection
export type WOGSTType = "cgst_sgst" | "igst";

export interface Activity {
  id: string;
  activityId: number | null;
  name: string;
  uomId: number | null;
  unit: string;
  /** Rate per unit of area — derived: totalRate ÷ area (this is the "Per Activity Price") */
  ratePerUnit: number;
  /** Total labour rate for the whole activity (what the user enters) */
  totalRate?: number;
  area: number;
  materials: MaterialItem[];
  /** HSN code selected for this activity */
  hsnCode: string;
  /** GST rate derived from selected HSN */
  hsnGstRate: number;
  /** GST type derived from selected HSN */
  hsnGstType: WOGSTType;
}

export interface ActivityGroup {
  id: string;
  groupId: number | null;
  name: string;
  activities: Activity[];
  expanded: boolean;
}

export interface WorkOrderForm {
  boqId: string;
  companyId: string;
  projectId: string;
  docNumber: string;
  docDate: string;
  contractorId: string;
  supplierId: string;
  remarks: string;
  termsAndConditions: string;
}

export interface DropdownOption {
  id: number;
  name: string;
}

export interface TCRecord {
  id: number;
  name: string;
  terms: string;
}

// ItemOption now includes gstRate from HSN Master
export type ItemOption = WOItemOption;

export interface ActivityOption {
  id: number;
  name: string;
  groupId?: number;
  hsnCode?: string | null; // linked HSN from ActivityMaster
}

// ─── View types ───────────────────────────────────────────────────────────────

export interface WorkOrderListItem {
  Id: number;
  DocumentNumber: string;
  DocumentDate: string;
  TotalAmount: number;
  Status: string;
  CreatedAt: string;
  CompanyName: string;
  ProjectName: string;
  ContractorName: string;
  SupplierName: string;
  ActivityCount: number;
  Remarks?: string;
  BoqID?: number | null;
  BoqDocNo?: string | null;
}

export interface WorkOrderDetail {
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
  SupplierName: string;
  SupplierId?: number;
  Remarks?: string;
  TermsAndConditions?: string;
  CreatedBy?: string;
  UpdatedBy?: string;
  activities: WorkOrderActivityDetail[];
}

export interface WorkOrderMaterialDetail {
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
  GSTRate?: number | null;
  SupplierIdPerLine?: number | null;
  SupplierNamePerLine?: string | null;
}

export interface WorkOrderActivityDetail {
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
  HsnCode?: string | null;
  HsnGstRate?: number | null;
  HsnGstType?: string | null;
  BoqID?: number | null;
  materials: WorkOrderMaterialDetail[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const generateDocNumber = () => {
  return "";
};

export const uid = () => Math.random().toString(36).slice(2, 9);

export const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);

export function ensureArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.recordset)) return obj.recordset as T[];
  }
  return [];
}

export const EMPTY_FORM = (): WorkOrderForm => ({
  boqId: "",
  companyId: "",
  projectId: "",
  docNumber: generateDocNumber(),
  docDate: new Date().toISOString().slice(0, 10),
  contractorId: "",
  supplierId: "",
  remarks: "",
  termsAndConditions: "",
});

export const EMPTY_MATERIAL = (): MaterialItem => ({
  id: uid(),
  itemId: "",
  itemName: "",
  consumptionRatio: 0,
  uomId: null,
  unit: "",
  price: 0,
  gstRate: 0,
  supplierId: null,
  supplierName: "",
});

export const EMPTY_ACTIVITY = (): Activity => ({
  id: uid(),
  activityId: null,
  name: "",
  uomId: null,
  unit: "",
  ratePerUnit: 0,
  area: 0,
  materials: [],
  hsnCode: "",
  hsnGstRate: 0,
  hsnGstType: "cgst_sgst",
});

export const EMPTY_GROUP = (): ActivityGroup => ({
  id: uid(),
  groupId: null,
  name: "",
  activities: [EMPTY_ACTIVITY()],
  expanded: true,
});

// ─── BOQ-style quantity logic ─────────────────────────────────────────────────
// The user enters the activity's Total Rate and each item's total Qty; the
// per-area figures (Per Activity Price, per-unit item qty) are derived from the
// activity Area. ratePerUnit / consumptionRatio stay the stored per-unit values.

/** Whole-activity labour amount. */
export const actLabour = (a: Activity): number => a.totalRate ?? a.ratePerUnit * a.area;
/** Whole-activity quantity of one material. */
export const matQty = (m: MaterialItem, a: Activity): number =>
  m.totalQty ?? m.consumptionRatio * a.area;
export const matCost = (m: MaterialItem, a: Activity): number => matQty(m, a) * m.price;
export const fmtQ = (n: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 4 });

/** Patch for a new Total Rate: the rate per area follows. */
export const withTotalRate = (a: Activity, totalRate: number): Partial<Activity> => ({
  totalRate,
  ratePerUnit: a.area > 0 ? totalRate / a.area : 0,
});
/** Patch for a new Area: totals are kept, every per-area figure is recomputed. */
export const withArea = (a: Activity, area: number): Partial<Activity> => {
  const totalRate = actLabour(a);
  return {
    area,
    totalRate,
    ratePerUnit: area > 0 ? totalRate / area : 0,
    materials: a.materials.map((m) => {
      const totalQty = matQty(m, a);
      return { ...m, totalQty, consumptionRatio: area > 0 ? totalQty / area : 0 };
    }),
  };
};


/**
 * Turns a BOQ's activities (+ the BOQ items tied to them) into Work Order
 * activity groups. BOQ Total Rate / Total Area carry across as-is; each BOQ item
 * becomes a material of its activity with the BOQ's total qty as the Item Qty.
 */
export const boqToGroups = (acts: any[], items: any[]): ActivityGroup[] => {
  const groups = new Map<string, ActivityGroup>();
  for (const a of acts) {
    // Rows saved before Total Area existed were qty x unit-rate.
    const legacy = a.Area == null && Number(a.Quantity) !== 1;
    const area = parseFloat(a.Area ?? (legacy ? a.Quantity : 0)) || 0;
    const totalRate = legacy
      ? parseFloat(a.LineAmount) || 0
      : parseFloat(a.Rate) || 0;
    const actKey = a.ActivityId != null ? String(a.ActivityId) : "";
    const materials: MaterialItem[] = items
      .filter((it) => actKey && String(it.ActivityId ?? "") === actKey)
      .map((it) => {
        const totalQty = parseFloat(it.Quantity) || 0;
        return {
          id: uid(),
          itemId: it.ItemId ?? "",
          itemName: it.ItemName ?? "",
          totalQty,
          consumptionRatio: area > 0 ? totalQty / area : 0,
          uomId: it.UomId ?? null,
          unit: it.UomName ?? "",
          price: parseFloat(it.Rate) || 0,
          gstRate: parseFloat(it.TaxPct) || 0,
          supplierId: null,
          supplierName: "",
        };
      });
    const activity: Activity = {
      id: uid(),
      activityId: a.ActivityId ? parseInt(a.ActivityId) : null,
      name: a.ActivityName || "",
      uomId: a.UomId ?? null,
      unit: a.UomName || "",
      totalRate,
      ratePerUnit: area > 0 ? totalRate / area : 0,
      area,
      materials,
      hsnCode: "",
      hsnGstRate: parseFloat(a.TaxPct || 0),
      hsnGstType: "cgst_sgst",
    };
    const key = a.GroupId ? `g${a.GroupId}` : `a${uid()}`;
    const existing = groups.get(key);
    if (existing) existing.activities.push(activity);
    else
      groups.set(key, {
        id: uid(),
        groupId: a.GroupId ? parseInt(a.GroupId) : null,
        name: a.GroupName || a.ActivityName || "",
        expanded: true,
        activities: [activity],
      });
  }
  return [...groups.values()];
};

/** Fetch a BOQ's activities and items and map them to Work Order groups. */
export const fetchBoqGroups = async (boqId: string): Promise<ActivityGroup[]> => {
  const [acts, items] = await Promise.all([
    fetchWithAuth(`/api/engineering/boq-activities/${boqId}`).then((r) => r.json()),
    fetchWithAuth(`/api/engineering/boq-items/${boqId}`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
  ]);
  return Array.isArray(acts) && acts.length > 0
    ? boqToGroups(acts, Array.isArray(items) ? items : [])
    : [];
};

// ─── Shared styles ────────────────────────────────────────────────────────────

export const inputCls =
  "w-full h-10 text-sm rounded-lg border border-border px-3 py-0 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";

export const selectCls =
  "w-full h-10 text-sm rounded-lg border border-border pl-3 pr-8 py-0 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition wo-select-arrow";

export const cellInput =
  "w-full text-sm rounded-md border border-border px-2.5 py-1.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";

export const cellSelect =
  "w-full text-sm rounded-md border border-border pl-2.5 pr-7 py-1.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition wo-select-arrow";

export const FieldLabel: React.FC<{
  children: React.ReactNode;
  required?: boolean;
}> = ({ children, required }) => (
  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-0.5 mb-1.5">
    {children}
    {required && <span className="text-red-500 leading-none">*</span>}
  </label>
);

export const SelectSkeleton: React.FC = () => (
  <div className="w-full h-10 rounded-lg border border-border bg-muted/30 animate-pulse" />
);

// ─── Status helpers ───────────────────────────────────────────────────────────

export const getStatusConfig = (status: string) => {
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
