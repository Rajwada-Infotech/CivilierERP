// Types, number / date helpers, line and form conversions, the field and detail-row wrappers shared by the BOQ page and its parts.
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import React from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BoqItem {
  Id?: number;
  _key: string;
  /** The BOQ Activity (Activity Master id) this item is required for; "" = none. */
  activityId: string;
  activityName: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  description: string;
  quantity: string;
  uomName: string;
  rate: string;
  tax: string;
  amount: number;
}

export interface BoqActivity {
  Id?: number;
  _key: string;
  /** Total area of the activity (optional) — with Qty it is the basis for per-unit figures. */
  area: string;
  /** Activity Group picked first; the activity can only come from this group. */
  groupId: string;
  groupName: string;
  activityId: string;
  activityName: string;
  activityCode: string;
  description: string;
  quantity: string;
  uomName: string;
  rate: string;
  tax: string;
  amount: number;
}

export interface BoqRecord {
  BoqID: number;
  BoqNo: string;
  BoqDate: string;
  CompanyId: number | null;
  CompanyName?: string;
  ProjectId: number | null;
  ProjectName?: string;
  Description: string;
  TotalAmount: number;
  Status: "Draft" | "Pending" | "Approved" | "Rejected";
  Remarks: string;
  DocTypeId: number | null;
  DocNo: string;
  DocTypePrefix?: string;
  DocTypeDescription?: string;
  CreatedBy?: string;
  CreatedAt?: string;
  UpdatedBy?: string;
  UpdatedAt?: string;
  ApprovedBy?: string;
  RejectedBy?: string;
  RejectionNote?: string;
  BoqItems: BoqItem[];
  BoqActivities: BoqActivity[];
}

export interface Company {
  id: number;
  label?: string;
  name?: string;
}
export interface Project {
  id: number;
  label?: string;
  name?: string;
  companyId?: number | null;
  companyIds?: string[];
}
export interface DocType {
  id: number;
  code: string;
  name: string;
  description: string;
}
export interface UomOption {
  Id: number;
  UOMName: string;
  UOMCode: string;
}
export interface ItemOption {
  id: string;
  name: string;
  code: string;
  uomCode: string;
}
export interface ActivityOption {
  id: string;
  name: string;
  code: string;
  /** Activity Group (Activity Master, type 0) this activity belongs to. */
  groupId: string;
}
export interface ActivityGroupOption {
  id: string;
  name: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

export let _uidSeed = 1;
export const uid = () => `k${_uidSeed++}`;

export const apiFetch = async (path: string, opts?: RequestInit) => {
  const url = `/api${path}`;
  const headers = new Headers(opts?.headers || {});
  if (!headers.has("Content-Type") && !(opts?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetchWithAuth(url, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json().catch(() => ({}));
};

export const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n ?? 0);

export const fmtDate = (d?: string) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

export const calcAmount = (qty: string, rate: string) =>
  (parseFloat(qty) || 0) * (parseFloat(rate) || 0);

/**
 * What an activity's per-unit figures are divided by: its Total Area when one is
 * entered, otherwise its Total Quantity.
 */
export const activityBasis = (a?: Pick<BoqActivity, "area" | "quantity">) => {
  return { value: parseFloat(a?.area ?? "") || 0, kind: "area" as const };
};

export const fmtQty = (n: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 4 });

export const blankItem = (): BoqItem => ({
  _key: uid(),
  activityId: "",
  activityName: "",
  itemId: "",
  itemName: "",
  itemCode: "",
  description: "",
  quantity: "",
  uomName: "",
  rate: "",
  tax: "18",
  amount: 0,
});

export const blankActivity = (): BoqActivity => ({
  _key: uid(),
  area: "",
  groupId: "",
  groupName: "",
  activityId: "",
  activityName: "",
  activityCode: "",
  description: "",
  quantity: "1",
  uomName: "",
  rate: "",
  tax: "18",
  amount: 0,
});

export const rowToItem = (r: any): BoqItem => ({
  Id: r.Id,
  _key: uid(),
  activityId: r.ActivityId ?? "",
  activityName: r.ActivityName ?? "",
  itemId: r.ItemId ?? "",
  itemName: r.ItemName ?? "",
  itemCode: r.ItemCode ?? "",
  description: r.Description ?? "",
  quantity: String(r.Quantity ?? ""),
  uomName: r.UomName ?? "",
  rate: String(r.Rate ?? ""),
  tax: String(r.TaxPct ?? "18"),
  amount: parseFloat(r.LineAmount) || 0,
});

export const rowToActivity = (r: any): BoqActivity => ({
  Id: r.Id,
  _key: uid(),
  // Total Qty is gone from activities — the area is the quantity. Older rows that
  // only had a Qty keep their amount by showing that Qty as the area.
  area: r.Area != null ? String(r.Area) : r.Quantity ? String(r.Quantity) : "",
  groupId: r.GroupId ?? "",
  groupName: r.GroupName ?? "",
  activityId: r.ActivityId ?? "",
  activityName: r.ActivityName ?? "",
  activityCode: r.ActivityCode ?? "",
  description: r.Description ?? "",
  quantity: "1",
  uomName: r.UomName ?? "",
  // Total Rate is the whole activity's price (not per unit). Rows saved as
  // area x unit-rate keep their amount by showing that amount as the Total Rate.
  rate: String(r.Quantity && Number(r.Quantity) !== 1 ? (r.LineAmount ?? r.Rate ?? "") : (r.Rate ?? "")),
  tax: String(r.TaxPct ?? "18"),
  amount: parseFloat(r.LineAmount) || 0,
});

export const buildPayload = (
  form: FormState,
  items: BoqItem[],
  activities: BoqActivity[],
  activityOptions: ActivityOption[] = [],
  activityGroups: ActivityGroupOption[] = [],
) => ({
  BoqNo: form.BoqNo || undefined,
  BoqDate: form.BoqDate,
  CompanyId: form.CompanyId ? Number(form.CompanyId) : null,
  ProjectId: form.ProjectId ? Number(form.ProjectId) : null,
  Description: form.Description,
  Remarks: form.Remarks,
  DocTypeId: form.DocTypeId ? Number(form.DocTypeId) : null,
  finYear: form.FinYear || undefined,
  Status: form.Status,
  BoqItems: items.map((it) => {
    const act = it.activityId
      ? activities.find((a) => a.activityId === it.activityId)
      : undefined;
    return {
    activityId: act ? act.activityId : null,
    activityName: act ? act.activityName : null,
    itemId: it.itemId,
    itemName: it.itemName,
    itemCode: it.itemCode,
    description: it.description,
    quantity: it.quantity,
    uomName: it.uomName,
    unit: it.uomName,
    rate: it.rate,
    tax: it.tax,
    amount: it.amount,
    };
  }),
  BoqActivities: activities.map((ac) => ({
    groupId: ac.groupId || activityOptions.find((o) => o.id === ac.activityId)?.groupId || null,
    groupName:
      ac.groupName ||
      activityGroups.find(
        (g) => g.id === (ac.groupId || activityOptions.find((o) => o.id === ac.activityId)?.groupId),
      )?.name ||
      null,
    area: ac.area,
    activityId: ac.activityId,
    activityName: ac.activityName,
    activityCode: ac.activityCode,
    description: ac.description,
    quantity: "1",
    uomName: ac.uomName,
    unit: ac.uomName,
    rate: ac.rate,
    tax: ac.tax,
    amount: ac.amount,
  })),
});

// ─────────────────────────────────────────────────────────────────────────────
// Field wrapper
// ─────────────────────────────────────────────────────────────────────────────

export const Field = ({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <label className="block text-[0.625rem] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
      {label} {required && <span className="text-destructive">*</span>}
    </label>
    {children}
    {error && <p className="text-[0.6875rem] text-destructive">{error}</p>}
  </div>
);

export const DetailRow = ({
  label,
  value,
}: {
  label: string;
  value?: React.ReactNode;
}) => (
  <div>
    <p className="text-[0.625rem] uppercase tracking-[0.12em] text-muted-foreground mb-1">
      {label}
    </p>
    <p className="font-medium text-foreground">{value || "—"}</p>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Line Items Editor — redesigned
// ─────────────────────────────────────────────────────────────────────────────



// ─────────────────────────────────────────────────────────────────────────────
// Form state
// ─────────────────────────────────────────────────────────────────────────────

export interface FormState {
  BoqNo: string;
  BoqDate: string;
  CompanyId: string;
  ProjectId: string;
  FinYear: string;
  Description: string;
  Remarks: string;
  DocTypeId: string;
  Status: "Draft" | "Pending" | "Approved" | "Rejected";
}

export const canEditBoq = (status?: string | null) =>
  !status || status === "Draft" || status === "Rejected";

export const defaultForm = (finYear?: string): FormState => ({
  BoqNo: "",
  BoqDate: new Date().toISOString().slice(0, 10),
  CompanyId: "",
  ProjectId: "",
  FinYear: finYear ?? "",
  Description: "",
  Remarks: "",
  DocTypeId: "",
  Status: "Draft",
});

export const recordToForm = (r: BoqRecord): FormState => ({
  BoqNo: r.BoqNo ?? "",
  BoqDate: r.BoqDate?.slice(0, 10) ?? "",
  CompanyId: String(r.CompanyId ?? ""),
  ProjectId: String(r.ProjectId ?? ""),
  FinYear: (r as any).FinYear ?? "",
  Description: r.Description ?? "",
  Remarks: r.Remarks ?? "",
  DocTypeId: String(r.DocTypeId ?? ""),
  Status: r.Status ?? "Draft",
});

// ─────────────────────────────────────────────────────────────────────────────
