import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { type DbItem } from "@/api/itemMasterApi";
import { type DbActivity } from "@/api/activityMasterApi";
import {
  FileText,
  Save,
  Search,
  Eye,
  Trash2,
  Plus,
  RefreshCw,
  X,
  Edit3,
  Building2,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  Clock,
  Package,
  Settings2,
  Send,
  XCircle,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { useFinYear } from "@/contexts/FinYearContext";
import { fetchNextDocNumber } from "@/pages/material/ExpenseBooking/DocNumberPreview";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BoqItem {
  Id?: number;
  _key: string; // local react key only
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

interface BoqActivity {
  Id?: number;
  _key: string;
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

interface BoqRecord {
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

interface Company {
  id: number;
  label?: string;
  name?: string;
}
interface Project {
  id: number;
  label?: string;
  name?: string;
}
interface DocType {
  id: number;
  code: string;
  name: string;
  description: string;
}
interface UomOption {
  Id: number;
  UOMName: string;
  UOMCode: string;
}

// Master lookup types fed into the line editor
interface ItemOption {
  id: string;
  name: string;
  code: string;
  uomCode: string;  // M_UOM = UOMCode from item master
}
interface ActivityOption {
  id: string;
  name: string;
  code: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

let _uidSeed = 1;
const uid = () => `k${_uidSeed++}`;

const getToken = () => localStorage.getItem("token") || "";

// Thin wrapper around fetchWithAuth that prepends /api, sets Content-Type,
// and throws on non-OK responses. No manual token injection needed —
// fetchWithAuth already handles the Authorization header.
const apiFetch = async (path: string, opts?: RequestInit) => {
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
  return res.json();
};

const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n ?? 0);

const fmtDate = (d?: string) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const calcAmount = (qty: string, rate: string) =>
  (parseFloat(qty) || 0) * (parseFloat(rate) || 0);

const blankItem = (): BoqItem => ({
  _key: uid(),
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

const blankActivity = (): BoqActivity => ({
  _key: uid(),
  activityId: "",
  activityName: "",
  activityCode: "",
  description: "",
  quantity: "",
  uomName: "",
  rate: "",
  tax: "18",
  amount: 0,
});

const rowToItem = (r: any): BoqItem => ({
  Id: r.Id,
  _key: uid(),
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

const rowToActivity = (r: any): BoqActivity => ({
  Id: r.Id,
  _key: uid(),
  activityId: r.ActivityId ?? "",
  activityName: r.ActivityName ?? "",
  activityCode: r.ActivityCode ?? "",
  description: r.Description ?? "",
  quantity: String(r.Quantity ?? ""),
  uomName: r.UomName ?? "",
  rate: String(r.Rate ?? ""),
  tax: String(r.TaxPct ?? "18"),
  amount: parseFloat(r.LineAmount) || 0,
});

const buildPayload = (
  form: FormState,
  items: BoqItem[],
  activities: BoqActivity[],
  finYear?: string,
) => ({
  BoqNo: form.BoqNo || undefined,
  BoqDate: form.BoqDate,
  CompanyId: form.CompanyId ? Number(form.CompanyId) : null,
  ProjectId: form.ProjectId ? Number(form.ProjectId) : null,
  Description: form.Description,
  Remarks: form.Remarks,
  DocTypeId: form.DocTypeId ? Number(form.DocTypeId) : null,
  finYear: finYear,
  Status: form.Status,
  BoqItems: items.map((it) => ({
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
  })),
  BoqActivities: activities.map((ac) => ({
    activityId: ac.activityId,
    activityName: ac.activityName,
    activityCode: ac.activityCode,
    description: ac.description,
    quantity: ac.quantity,
    uomName: ac.uomName,
    unit: ac.uomName,
    rate: ac.rate,
    tax: ac.tax,
    amount: ac.amount,
  })),
});

// ─────────────────────────────────────────────────────────────────────────────
// UI Wrappers
// ─────────────────────────────────────────────────────────────────────────────

const Field = ({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <label className="block text-xs uppercase tracking-widest font-heading font-semibold text-muted-foreground">
      {label} {required && <span className="text-destructive">*</span>}
    </label>
    {children}
  </div>
);

const DetailRow = ({
  label,
  value,
}: {
  label: string;
  value?: React.ReactNode;
}) => (
  <div>
    <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
      {label}
    </p>
    <p className="font-medium text-foreground">{value || "—"}</p>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Line Items Editor — used for both BoqItems and BoqActivities
// ─────────────────────────────────────────────────────────────────────────────

type LineMode = "item" | "activity";

interface LineEditorProps {
  mode: LineMode;
  rows: BoqItem[] | BoqActivity[];
  uoms: UomOption[];
  itemOptions?: ItemOption[];
  activityOptions?: ActivityOption[];
  onChange: (rows: any[]) => void;
  readOnly?: boolean;
}

const LineEditor: React.FC<LineEditorProps> = ({
  mode,
  rows,
  uoms,
  itemOptions = [],
  activityOptions = [],
  onChange,
  readOnly,
}) => {
  const isItem = mode === "item";
  const nameKey = isItem ? "itemName" : "activityName";
  const codeKey = isItem ? "itemCode" : "activityCode";
  const namePlh = isItem ? "Item description" : "Activity name";

  const upd = (idx: number, field: string, val: string) => {
    const next = (rows as any[]).map((r, i) => {
      if (i !== idx) return r;
      const updated = { ...r, [field]: val };
      if (field === "quantity" || field === "rate") {
        updated.amount = calcAmount(updated.quantity, updated.rate);
      }
      return updated;
    });
    onChange(next);
  };

  const remove = (idx: number) =>
    onChange((rows as any[]).filter((_, i) => i !== idx));

  const add = () =>
    onChange([...(rows as any[]), isItem ? blankItem() : blankActivity()]);

  const subtotal = (rows as any[]).reduce(
    (s: number, r: any) => s + (parseFloat(r.amount) || 0),
    0,
  );

  const cellInput = (
    idx: number,
    field: string,
    value: string,
    placeholder = "",
    type = "text",
  ) => (
    <td className="p-2">
      {readOnly ? (
        <span className="text-sm font-medium">{value || "—"}</span>
      ) : (
        <Input
          type={type}
          value={value}
          placeholder={placeholder}
          min={type === "number" ? 0 : undefined}
          onChange={(e) => upd(idx, field, e.target.value)}
          className="h-9 text-sm"
        />
      )}
    </td>
  );

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col style={{width:"40px"}} />
            <col style={{width:"22%"}} />
            <col style={{width:"90px"}} />
            <col style={{width:"13%"}} />
            <col style={{width:"72px"}} />
            <col />
            <col style={{width:"100px"}} />
            <col style={{width:"72px"}} />
            <col style={{width:"100px"}} />
            <col style={{width:"40px"}} />
          </colgroup>
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="px-3 py-3 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">
                #
              </th>
              <th className="px-3 py-3 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">
                {isItem ? "Item Name" : "Activity Name"}
              </th>
              <th className="px-3 py-3 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">
                Code
              </th>
              <th className="px-3 py-3 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">
                Spec/Notes
              </th>
              <th className="px-3 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground">
                Qty
              </th>
              <th className="px-3 py-3 text-left text-xs font-heading uppercase tracking-widest text-muted-foreground">
                UOM
              </th>
              <th className="px-3 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground">
                Rate (₹)
              </th>
              <th className="px-3 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground">
                Tax %
              </th>
              <th className="px-3 py-3 text-right text-xs font-heading uppercase tracking-widest text-muted-foreground">
                Amount (₹)
              </th>
              {!readOnly && <th className="px-3 py-3"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(rows as any[]).length === 0 && (
              <tr>
                <td
                  colSpan={readOnly ? 9 : 10}
                  className="text-center py-8 text-muted-foreground italic"
                >
                  No {isItem ? "items" : "activities"} added yet.
                  {!readOnly && " Click + Add below."}
                </td>
              </tr>
            )}
            {(rows as any[]).map((row, idx) => (
              <tr key={row._key ?? row.Id ?? idx}>
                <td className="px-2 py-3 text-muted-foreground font-bold text-xs text-center">
                  {idx + 1}
                </td>
                {/* ── Name cell: shadcn Select from master ── */}
                <td className="p-2">
                  {readOnly ? (
                    <span className="text-sm font-medium">{row[nameKey] || "—"}</span>
                  ) : isItem ? (
                    <Select
                      value={row.itemId ? String(row.itemId) : ""}
                      onValueChange={(val) => {
                        const selected = itemOptions.find((o) => o.id === val);
                        if (!selected) return;
                        // Resolve UOMCode -> UOMName for the dropdown value
                        const matchedUom = uoms.find((u) => u.UOMCode === selected.uomCode);
                        const resolvedUom = matchedUom?.UOMName ?? selected.uomCode;
                        const next = (rows as any[]).map((r, i) => {
                          if (i !== idx) return r;
                          return { ...r, itemId: selected.id, itemName: selected.name, itemCode: selected.code, uomName: resolvedUom };
                        });
                        onChange(next);
                      }}
                    >
                      <SelectTrigger className="h-9 text-sm w-full">
                        <SelectValue placeholder="— Select Item —" />
                      </SelectTrigger>
                      <SelectContent className="z-[300] max-h-60">
                        {itemOptions.map((o) => (
                          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select
                      value={row.activityId ? String(row.activityId) : ""}
                      onValueChange={(val) => {
                        const selected = activityOptions.find((o) => o.id === val);
                        if (!selected) return;
                        const next = (rows as any[]).map((r, i) => {
                          if (i !== idx) return r;
                          return { ...r, activityId: selected.id, activityName: selected.name, activityCode: selected.code };
                        });
                        onChange(next);
                      }}
                    >
                      <SelectTrigger className="h-9 text-sm w-full">
                        <SelectValue placeholder="— Select Activity —" />
                      </SelectTrigger>
                      <SelectContent className="z-[300] max-h-60">
                        {activityOptions.map((o) => (
                          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </td>
                {/* ── Code cell: read-only badge, auto-filled from master ── */}
                <td className="p-2">
                  {readOnly ? (
                    <span className="text-sm">{row[codeKey] || "—"}</span>
                  ) : (
                    <div className="h-9 flex items-center px-3 rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground text-sm font-body truncate">
                      {row[codeKey] || <span className="italic text-xs">Auto</span>}
                    </div>
                  )}
                </td>
                <td className="p-2">
                  {readOnly ? (
                    <span className="text-sm text-muted-foreground">{row.description || "—"}</span>
                  ) : (
                    <Input
                      value={row.description}
                      placeholder="Notes"
                      onChange={(e) => upd(idx, "description", e.target.value)}
                      className="h-9 text-sm w-full"
                    />
                  )}
                </td>
                {cellInput(idx, "quantity", row.quantity, "0", "number")}
                <td className="p-2">
                  {readOnly ? (
                    <span className="text-sm">{row.uomName || "—"}</span>
                  ) : (
                    <Select
                      value={row.uomName}
                      onValueChange={(val) => upd(idx, "uomName", val)}
                    >
                      <SelectTrigger className="h-9 text-sm w-full">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent className="z-[300]">
                        {uoms.map((u) => (
                          <SelectItem key={String(u.Id)} value={u.UOMName}>
                            {u.UOMName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </td>
                {cellInput(idx, "rate", row.rate, "0.00", "number")}
                {cellInput(idx, "tax", row.tax, "18", "number")}
                <td className="px-3 py-3 text-right">
                  <span className="font-semibold text-primary">
                    {fmt(parseFloat(row.amount) || 0)}
                  </span>
                </td>
                {!readOnly && (
                  <td className="px-2 py-3 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(idx)}
                      className="text-muted-foreground hover:text-destructive h-8 w-8 p-0"
                    >
                      <X size={15} />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {(rows as any[]).length > 0 && (
            <tfoot className="bg-muted/30 border-t-2 border-border">
              <tr className="text-right">
                <td
                  colSpan={readOnly ? 8 : 9}
                  className="px-3 py-3 text-xs font-heading uppercase tracking-widest text-muted-foreground"
                >
                  {isItem ? "Items" : "Activities"} Subtotal
                </td>
                <td className="px-3 py-3 font-bold text-primary">
                  {fmt(subtotal)}
                </td>
                {!readOnly && <td></td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {!readOnly && (
        <Button
          variant="outline"
          size="sm"
          onClick={add}
          className="mt-3 border-dashed"
        >
          + Add {isItem ? "Item" : "Activity"}
        </Button>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Form state
// ─────────────────────────────────────────────────────────────────────────────

interface FormState {
  BoqNo: string;
  BoqDate: string;
  CompanyId: string;
  ProjectId: string;
  Description: string;
  Remarks: string;
  DocTypeId: string;
  Status: "Draft" | "Pending" | "Approved" | "Rejected";
}

const defaultForm = (): FormState => ({
  BoqNo: "",
  BoqDate: new Date().toISOString().slice(0, 10),
  CompanyId: "",
  ProjectId: "",
  Description: "",
  Remarks: "",
  DocTypeId: "",
  Status: "Draft",
});

const recordToForm = (r: BoqRecord): FormState => ({
  BoqNo: r.BoqNo ?? "",
  BoqDate: r.BoqDate?.slice(0, 10) ?? "",
  CompanyId: String(r.CompanyId ?? ""),
  ProjectId: String(r.ProjectId ?? ""),
  Description: r.Description ?? "",
  Remarks: r.Remarks ?? "",
  DocTypeId: String(r.DocTypeId ?? ""),
  Status: r.Status ?? "Draft",
});

// ─────────────────────────────────────────────────────────────────────────────
// BOQ Form Modal (Create + Edit)
// ─────────────────────────────────────────────────────────────────────────────

interface FormModalProps {
  record: BoqRecord | null; // null = create
  companies: Company[];
  projects: Project[];
  docTypes: DocType[];
  uoms: UomOption[];
  itemOptions: ItemOption[];
  activityOptions: ActivityOption[];
  finYear?: string;
  onClose: () => void;
  onSaved: () => void;
}

const FormModal: React.FC<FormModalProps> = ({
  record,
  companies,
  projects,
  docTypes,
  uoms,
  itemOptions,
  activityOptions,
  finYear,
  onClose,
  onSaved,
}) => {
  const isEdit = record !== null;
  const [form, setForm] = useState<FormState>(
    isEdit ? recordToForm(record!) : defaultForm(),
  );
  const [items, setItems] = useState<BoqItem[]>(
    (record?.BoqItems ?? []).map(rowToItem),
  );
  const [activities, setActivities] = useState<BoqActivity[]>(
    (record?.BoqActivities ?? []).map(rowToActivity),
  );
  const [lineTab, setLineTab] = useState<"items" | "activities">("items");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (k: keyof FormState, v: string) => {
    setForm((p) => ({ ...p, [k]: v }));
    setErrors((p) => ({ ...p, [k]: "" }));
  };

  const handleDocTypeChange = async (val: string) => {
    set("DocTypeId", val);
    set("BoqNo", "");
    if (!val || isEdit) return;

    try {
      const nextDocNo = await fetchNextDocNumber(
        Number(val),
        finYear || undefined,
      );
      set("BoqNo", nextDocNo);
    } catch (err) {
      console.error("BOQ number preview failed:", err);
      toast.error("Failed to generate BOQ number preview");
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.BoqDate) e.BoqDate = "Date is required";
    if (!form.CompanyId) e.CompanyId = "Company is required";
    if (!form.ProjectId) e.ProjectId = "Project is required";
    if (!form.DocTypeId) e.DocTypeId = "Document Type is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = buildPayload(form, items, activities, finYear);
      if (isEdit) {
        await apiFetch(`/boq/${record!.BoqID}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast.success("BOQ updated successfully");
      } else {
        await apiFetch("/boq", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast.success("BOQ created successfully");
      }
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const itemsTotal = items.reduce(
    (s, r) => s + (parseFloat(String(r.amount)) || 0),
    0,
  );
  const activitiesTotal = activities.reduce(
    (s, r) => s + (parseFloat(String(r.amount)) || 0),
    0,
  );
  const grandTotal = itemsTotal + activitiesTotal;

  const hasErr = (k: string) => !!errors[k];

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-background overflow-hidden">
      <Card className="w-full h-full flex flex-col rounded-none border-0 shadow-none animate-in fade-in">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-4 bg-muted/30">
          <div className="space-y-1">
            <CardTitle className="text-xl flex items-center gap-2">
              {isEdit ? (
                <Edit3 size={20} className="text-primary" />
              ) : (
                <FileText size={20} className="text-primary" />
              )}
              {isEdit
                ? `Edit BOQ — ${record!.BoqNo}`
                : "New Bill of Quantities"}
            </CardTitle>
            <CardDescription>
              {isEdit
                ? "Modify header, items and activities. Status must be Draft to edit."
                : "Fill in the header then add items and/or activities."}
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X size={20} />
          </Button>
        </CardHeader>

        <CardContent className="p-6 overflow-y-auto flex-1 space-y-6">
          <div className="space-y-4">
            <h3 className="text-xs uppercase tracking-widest font-heading font-semibold text-muted-foreground flex items-center gap-1.5 border-b pb-2">
              <span className="w-5 h-5 rounded bg-primary/10 text-primary flex items-center justify-center">
                1
              </span>
              BOQ Header
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <Field label="Document Type" required>
                <Select
                  value={form.DocTypeId}
                  onValueChange={handleDocTypeChange}
                >
                  <SelectTrigger
                    className={`h-10 ${hasErr("DocTypeId") ? "border-destructive" : ""}`}
                  >
                    <SelectValue placeholder="— Select Document Type —" />
                  </SelectTrigger>
                  <SelectContent className="z-[300]">
                    {docTypes.map((dt) => (
                      <SelectItem key={String(dt.id)} value={String(dt.id)}>
                        {dt.code} - {dt.name || dt.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hasErr("DocTypeId") && (
                  <span className="text-xs text-destructive mt-1">
                    {errors.DocTypeId}
                  </span>
                )}
              </Field>

              <Field label="BOQ No">
                <Input
                  value={form.BoqNo || ""}
                  readOnly
                  placeholder="Auto generated"
                  className="h-10 bg-muted/50 text-muted-foreground focus-visible:ring-0 cursor-not-allowed"
                />
              </Field>

              <Field label="BOQ Date" required>
                <Input
                  type="date"
                  value={form.BoqDate}
                  onChange={(e) => set("BoqDate", e.target.value)}
                  className={`h-10 ${hasErr("BoqDate") ? "border-destructive" : ""}`}
                />
                {hasErr("BoqDate") && (
                  <span className="text-xs text-destructive mt-1">
                    {errors.BoqDate}
                  </span>
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Company" required>
                <Select
                  value={form.CompanyId}
                  onValueChange={(val) => set("CompanyId", val)}
                >
                  <SelectTrigger
                    className={`h-10 ${hasErr("CompanyId") ? "border-destructive" : ""}`}
                  >
                    <SelectValue placeholder="— Select Company —" />
                  </SelectTrigger>
                  <SelectContent className="z-[300]">
                    {companies.map((c) => (
                      <SelectItem key={String(c.id)} value={String(c.id)}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hasErr("CompanyId") && (
                  <span className="text-xs text-destructive mt-1">
                    {errors.CompanyId}
                  </span>
                )}
              </Field>

              <Field label="Project" required>
                <Select
                  value={form.ProjectId}
                  onValueChange={(val) => set("ProjectId", val)}
                >
                  <SelectTrigger
                    className={`h-10 ${hasErr("ProjectId") ? "border-destructive" : ""}`}
                  >
                    <SelectValue placeholder="— Select Project —" />
                  </SelectTrigger>
                  <SelectContent className="z-[300]">
                    {projects.map((p) => (
                      <SelectItem key={String(p.id)} value={String(p.id)}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hasErr("ProjectId") && (
                  <span className="text-xs text-destructive mt-1">
                    {errors.ProjectId}
                  </span>
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Scope / Description">
                <Textarea
                  value={form.Description}
                  rows={2}
                  placeholder="Describe the scope of work for this BOQ…"
                  onChange={(e) => set("Description", e.target.value)}
                  className="resize-none"
                />
              </Field>
              <Field label="Remarks">
                <Textarea
                  value={form.Remarks}
                  rows={2}
                  placeholder="Internal remarks or notes…"
                  onChange={(e) => set("Remarks", e.target.value)}
                  className="resize-none"
                />
              </Field>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs uppercase tracking-widest font-heading font-semibold text-muted-foreground flex items-center gap-1.5 border-b pb-2">
              <span className="w-5 h-5 rounded bg-primary/10 text-primary flex items-center justify-center">
                2
              </span>
              Items & Activities
            </h3>

            <div className="flex gap-2 bg-muted/50 p-1.5 rounded-xl w-fit">
              {(["items", "activities"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setLineTab(t)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    lineTab === t
                      ? "bg-background text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "items"
                    ? `📦 Items (${items.length})`
                    : `⚙ Activities (${activities.length})`}
                </button>
              ))}
            </div>

            {lineTab === "items" ? (
              <LineEditor
                mode="item"
                rows={items}
                uoms={uoms}
                itemOptions={itemOptions}
                onChange={setItems as any}
              />
            ) : (
              <LineEditor
                mode="activity"
                rows={activities}
                uoms={uoms}
                activityOptions={activityOptions}
                onChange={setActivities as any}
              />
            )}
          </div>

          <div className="bg-gradient-to-r from-primary to-blue-600 rounded-xl p-5 flex items-center justify-between text-primary-foreground shadow-lg">
            <div>
              <div className="text-xs font-bold opacity-80 uppercase tracking-wider">
                Grand Total (excl. tax)
              </div>
              <div className="text-xs opacity-70 mt-1">
                Items: {fmt(itemsTotal)} &nbsp;+&nbsp; Activities:{" "}
                {fmt(activitiesTotal)}
              </div>
            </div>
            <div className="text-2xl font-bold font-body">
              {fmt(grandTotal)}
            </div>
          </div>
        </CardContent>

        <div className="p-4 border-t border-border flex justify-end gap-3 bg-muted/10 shrink-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? (
              <RefreshCw className="animate-spin" size={16} />
            ) : (
              <Save size={16} />
            )}
            {isEdit ? "Update BOQ" : "Create BOQ"}
          </Button>
        </div>
      </Card>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Detail / View Modal
// ─────────────────────────────────────────────────────────────────────────────

interface DetailModalProps {
  record: BoqRecord;
  uoms: UomOption[];
  onClose: () => void;
  onEdit: () => void;
  onRefresh: () => void;
}

const DetailModal: React.FC<DetailModalProps> = ({
  record,
  uoms,
  onClose,
  onEdit,
  onRefresh,
}) => {
  const [lineTab, setLineTab] = useState<"items" | "activities">("items");
  const [acting, setActing] = useState(false);

  const doTransition = async (
    action: "submit" | "approve" | "reject",
    note?: string,
  ) => {
    setActing(true);
    try {
      await apiFetch(`/boq/${record.BoqID}/${action}`, {
        method: "PUT",
        body: JSON.stringify(note ? { note } : {}),
      });
      toast.success(
        action === "submit"
          ? "BOQ submitted for approval"
          : action === "approve"
            ? "BOQ approved"
            : "BOQ rejected",
      );
      onRefresh();
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? `${action} failed`);
    } finally {
      setActing(false);
    }
  };

  const doDelete = async () => {
    if (
      !window.confirm(
        "Delete this BOQ and all its items/activities? This cannot be undone.",
      )
    )
      return;
    setActing(true);
    try {
      await apiFetch(`/boq/${record.BoqID}`, { method: "DELETE" });
      toast.success("BOQ deleted");
      onRefresh();
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? "Delete failed");
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-background overflow-hidden">
      <Card className="w-full h-full flex flex-col rounded-none border-0 shadow-none animate-in fade-in">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-4 bg-muted/30">
          <div className="flex items-center gap-4">
            <CardTitle className="text-xl font-body text-primary">
              {record.BoqNo || record.DocNo}
            </CardTitle>
            <StatusBadge status={record.Status} />
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X size={20} />
          </Button>
        </CardHeader>

        <CardContent className="p-6 overflow-y-auto flex-1 space-y-6">
          {record.Status !== "Draft" && (
            <div
              className={`p-4 rounded-xl border flex items-center gap-3 ${
                record.Status === "Pending"
                  ? "bg-amber-500/10 border-amber-500/20 text-amber-700"
                  : record.Status === "Approved"
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700"
                    : "bg-red-500/10 border-red-500/20 text-red-700"
              }`}
            >
              <span className="font-semibold text-sm flex-1">
                {record.Status === "Pending" &&
                  "⏳ Awaiting approval — you can approve or reject below."}
                {record.Status === "Approved" &&
                  `✓ Approved${record.ApprovedBy ? ` by ${record.ApprovedBy}` : ""}.`}
                {record.Status === "Rejected" &&
                  `✕ Rejected${record.RejectedBy ? ` by ${record.RejectedBy}` : ""}${record.RejectionNote ? ` — ${record.RejectionNote}` : ""}.`}
              </span>
              {record.Status === "Pending" && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 border-emerald-200"
                    disabled={acting}
                    onClick={() => doTransition("approve")}
                  >
                    <CheckCircle2 size={14} className="mr-1.5" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 border-red-200"
                    disabled={acting}
                    onClick={() => {
                      const note =
                        window.prompt("Rejection note (optional):") ?? "";
                      doTransition("reject", note);
                    }}
                  >
                    <XCircle size={14} className="mr-1.5" /> Reject
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            <DetailRow label="Company" value={record.CompanyName} />
            <DetailRow label="Project" value={record.ProjectName} />
            <DetailRow label="BOQ Date" value={fmtDate(record.BoqDate)} />
            <DetailRow
              label="Document No"
              value={<span className="font-body">{record.DocNo}</span>}
            />
            <DetailRow label="Created By" value={record.CreatedBy} />
            <DetailRow
              label="Total Amount"
              value={
                <span className="font-body text-primary font-bold">
                  {fmt(record.TotalAmount)}
                </span>
              }
            />
          </div>

          {record.Description && (
            <div className="bg-muted/40 border-l-4 border-l-primary rounded-r-lg p-4 text-sm">
              {record.Description}
            </div>
          )}

          <div className="flex gap-2 bg-muted/50 p-1.5 rounded-xl w-fit">
            {(["items", "activities"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setLineTab(t)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                  lineTab === t
                    ? "bg-background text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "items"
                  ? `📦 Items (${record.BoqItems?.length ?? 0})`
                  : `⚙ Activities (${record.BoqActivities?.length ?? 0})`}
              </button>
            ))}
          </div>

          {lineTab === "items" ? (
            <LineEditor
              mode="item"
              rows={(record.BoqItems ?? []).map(rowToItem)}
              uoms={uoms}
              onChange={() => {}}
              readOnly
            />
          ) : (
            <LineEditor
              mode="activity"
              rows={(record.BoqActivities ?? []).map(rowToActivity)}
              uoms={uoms}
              onChange={() => {}}
              readOnly
            />
          )}
        </CardContent>

        <div className="p-4 border-t border-border flex justify-between gap-3 bg-muted/10 shrink-0">
          <Button
            variant="outline"
            className="text-destructive hover:bg-destructive/10 border-destructive/30"
            disabled={acting}
            onClick={doDelete}
          >
            <Trash2 size={16} className="mr-1.5" /> Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            {record.Status === "Draft" && (
              <>
                <Button variant="secondary" disabled={acting} onClick={onEdit}>
                  <Edit3 size={16} className="mr-1.5" /> Edit
                </Button>
                <Button
                  disabled={acting}
                  onClick={() => doTransition("submit")}
                  className="bg-primary hover:bg-primary/90"
                >
                  Submit for Approval <Send size={14} className="ml-1.5" />
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main BOQ Page
// ─────────────────────────────────────────────────────────────────────────────

const COLUMNS: ColumnDef<any, unknown>[] = [
  {
    accessorKey: "BoqNo",
    header: "BOQ No",
    cell: ({ row }) => (
      <span className="font-body font-semibold text-primary text-sm">
        {row.original.BoqNo || row.original.DocNo || "—"}
      </span>
    ),
  },
  {
    accessorKey: "BoqDate",
    header: "Date",
    cell: ({ getValue }) => (
      <span className="text-sm text-muted-foreground">
        {fmtDate(getValue() as string)}
      </span>
    ),
  },
  {
    accessorKey: "CompanyName",
    header: "Company",
    cell: ({ getValue }) => (
      <span className="text-sm text-foreground">
        {String(getValue() || "—")}
      </span>
    ),
  },
  {
    accessorKey: "ProjectName",
    header: "Project",
    cell: ({ getValue }) => (
      <span className="text-sm text-muted-foreground">
        {String(getValue() || "—")}
      </span>
    ),
  },
  {
    accessorKey: "TotalAmount",
    header: "Total Amount",
    cell: ({ getValue }) => (
      <span className="text-sm font-semibold">{fmt(getValue() as number)}</span>
    ),
  },
  {
    accessorKey: "Status",
    header: "Status",
    cell: ({ getValue }) => (
      <StatusBadge status={(getValue() as string) || "Draft"} />
    ),
  },
];

export default function BOQ() {
  const { finYears } = useFinYear();
  const [page, setPage] = useState(1);
  const PAGE_LIMIT = 10;

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("All");
  const searchRef = useRef<ReturnType<typeof setTimeout>>();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [uoms, setUoms] = useState<UomOption[]>([]);
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [activityOptions, setActivityOptions] = useState<ActivityOption[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editRecord, setEditRecord] = useState<BoqRecord | null>(null);
  const [viewRecord, setViewRecord] = useState<BoqRecord | null>(null);
  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year || undefined;

  const {
    data: listData,
    isLoading: loading,
    refetch: loadList,
  } = useQuery({
    queryKey: ["boqs", page, search, filterStatus],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_LIMIT),
        ...(search ? { search } : {}),
        ...(filterStatus && filterStatus !== "All"
          ? { status: filterStatus }
          : {}),
      });
      return apiFetch(`/boq?${params}`);
    },
  });

  const rows: BoqRecord[] = listData?.data ?? [];
  const totalPages = listData?.totalPages ?? 1;
  const total = listData?.total ?? 0;

  const totalValue = rows.reduce((s, r) => s + (r.TotalAmount ?? 0), 0);
  const countApproved = rows.filter((r) => r.Status === "Approved").length;
  const countPending = rows.filter((r) => r.Status === "Pending").length;

  const loadMasterData = useCallback(async () => {
    try {
      const [cosResult, prosResult, dtsResult, uomResult, itemResult, activityResult] =
        await Promise.allSettled([
          apiFetch("/enterprises/options?business_type=C"),
          apiFetch("/enterprises/options?business_type=P"),
          apiFetch("/document-type?module=BOQ"),
          apiFetch("/uom-master"),
          apiFetch("/item-master"),
          apiFetch("/activity-master"),
        ]);

      const cos = cosResult.status === "fulfilled" ? cosResult.value : [];
      const pros = prosResult.status === "fulfilled" ? prosResult.value : [];
      let dts = dtsResult.status === "fulfilled" ? dtsResult.value : [];
      const uomRes = uomResult.status === "fulfilled" ? uomResult.value : [];
      const itemRes = itemResult.status === "fulfilled" ? itemResult.value : [];
      const activityRes = activityResult.status === "fulfilled" ? activityResult.value : [];

      if (
        cosResult.status === "rejected" ||
        prosResult.status === "rejected" ||
        dtsResult.status === "rejected" ||
        uomResult.status === "rejected" ||
        itemResult.status === "rejected" ||
        activityResult.status === "rejected"
      ) {
        console.error("Some BOQ master data failed to load:", {
          companies: cosResult.status === "rejected" ? cosResult.reason : null,
          projects: prosResult.status === "rejected" ? prosResult.reason : null,
          docTypes: dtsResult.status === "rejected" ? dtsResult.reason : null,
          uoms: uomResult.status === "rejected" ? uomResult.reason : null,
          items: itemResult.status === "rejected" ? (itemResult as any).reason : null,
          activities: activityResult.status === "rejected" ? (activityResult as any).reason : null,
        });
      }

      const filteredDocData = Array.isArray(dts?.data)
        ? dts.data
        : Array.isArray(dts)
          ? dts
          : [];
      if (filteredDocData.length === 0) {
        dts = await apiFetch("/document-type").catch((err) => {
          console.error("BOQ document type fallback failed:", err);
          return [];
        });
      }

      // Companies
      const companyData = Array.isArray(cos?.data)
        ? cos.data
        : Array.isArray(cos)
          ? cos
          : [];

      setCompanies(
        companyData.map((item: any, idx: number) => ({
          id: Number(item.id ?? item.Id ?? item.EId ?? idx + 1),
          label:
            item.label ??
            item.name ??
            item.CompanyName ??
            item.EName ??
            "Unknown Company",
        })),
      );

      // Projects
      const projectData = Array.isArray(pros?.data)
        ? pros.data
        : Array.isArray(pros)
          ? pros
          : [];

      setProjects(
        projectData.map((item: any, idx: number) => ({
          id: Number(item.id ?? item.Id ?? item.EId ?? idx + 1),
          label:
            item.label ??
            item.name ??
            item.ProjectName ??
            item.EName ??
            "Unknown Project",
        })),
      );

      // Document Types
      const docData = Array.isArray(dts?.data)
        ? dts.data
        : Array.isArray(dts)
          ? dts
          : [];

      setDocTypes(
        docData.map((item: any, idx: number) => ({
          id: Number(item.id ?? item.TypeOfDocId ?? idx + 1),
          code: String(item.code ?? item.Prefix ?? item.FullPrefix ?? ""),
          name: String(item.name ?? item.EntryType ?? ""),
          description: String(item.description ?? item.Description ?? ""),
        })),
      );

      // UOM
      const uomData = Array.isArray(uomRes?.data)
        ? uomRes.data
        : Array.isArray(uomRes)
          ? uomRes
          : [];

      setUoms(
        uomData.map((item: any, idx: number) => ({
          Id: Number(item.Id ?? item.id ?? idx + 1),
          UOMName: item.UOMName ?? item.name ?? "",
          UOMCode: item.UOMCode ?? "",
        })),
      );

      // Item Master options (only leaf items, filter out groups if needed)
      const itemData: DbItem[] = Array.isArray(itemRes) ? itemRes : (itemRes?.data ?? []);
      setItemOptions(
        itemData.map((it) => ({
          id: String(it.M_Id),
          name: it.M_Name ?? "",
          code: it.M_code ?? "",
          uomCode: it.M_UOM ?? "",  // M_UOM stores UOMCode
        })),
      );

      // Activity Master options (activity_type === 1 = actual activities, not groups)
      const activityData: DbActivity[] = Array.isArray(activityRes) ? activityRes : (activityRes?.data ?? []);
      setActivityOptions(
        activityData
          .filter((a) => a.activity_type === 1 && a.is_active !== false)
          .map((a) => ({
            id: String(a.id),
            name: a.activity_name ?? "",
            code: String(a.id),
          })),
      );
    } catch (err) {
      console.error("Master data load failed:", err);
      toast.error("Failed to load dropdown data");
    }
  }, []);

  useEffect(() => {
    loadMasterData();
  }, [loadMasterData]);

  const onSearchChange = (val: string) => {
    setSearch(val);
    clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => {
      setPage(1);
    }, 350);
  };

  const refresh = () => loadList();

  const openDetail = async (r: BoqRecord) => {
    try {
      const full = await apiFetch(`/boq/${r.BoqID}`);
      setViewRecord({
        ...full,
        BoqItems: Array.isArray(full.BoqItems) ? full.BoqItems : [],
        BoqActivities: Array.isArray(full.BoqActivities)
          ? full.BoqActivities
          : [],
      });
    } catch {
      setViewRecord({
        ...r,
        BoqItems: r.BoqItems ?? [],
        BoqActivities: r.BoqActivities ?? [],
      });
    }
  };

  const openEdit = (r: BoqRecord) => {
    setViewRecord(null);
    setEditRecord(r);
    setShowForm(true);
  };

  const statuses: string[] = [
    "All",
    "Draft",
    "Pending",
    "Approved",
    "Rejected",
  ];

  const enrichedColumns = [
    ...COLUMNS,
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }: any) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openDetail(row.original)}
            className="h-8 w-8 p-0"
          >
            <Eye size={15} />
          </Button>
          {row.original.Status === "Draft" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const full = await apiFetch(`/boq/${row.original.BoqID}`).catch(
                  () => row.original,
                );
                openEdit({
                  ...full,
                  BoqItems: full.BoqItems ?? [],
                  BoqActivities: full.BoqActivities ?? [],
                });
              }}
              className="h-8 w-8 p-0 text-primary"
            >
              <Edit3 size={15} />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Breadcrumbs items={["Engineering", "BOQ"]} />

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <FileText size={24} className="text-primary" />
              Bill of Quantities
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage material items and work activities with structured cost
              estimation
            </p>
          </div>
          <Button
            onClick={() => {
              setEditRecord(null);
              setShowForm(true);
            }}
            className="gap-2"
          >
            <Plus size={16} /> New BOQ
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total BOQs", value: total, accent: "border-t-blue-500" },
            {
              label: "Portfolio Value",
              value: fmt(totalValue),
              accent: "border-t-emerald-500",
            },
            {
              label: "Pending Approval",
              value: countPending,
              accent: "border-t-amber-500",
            },
            {
              label: "Approved",
              value: countApproved,
              accent: "border-t-violet-500",
            },
          ].map((s) => (
            <Card
              key={s.label}
              className={`border-t-[3px] ${s.accent} shadow-sm`}
            >
              <CardContent className="p-4">
                <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  {s.label}
                </div>
                <div className="text-2xl font-bold mt-1 font-body">
                  {s.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="shadow-sm">
          <CardHeader className="p-4 border-b flex flex-col md:flex-row md:items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={search}
                placeholder="Search BOQ No, company, project…"
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {statuses.map((s) => (
                <Button
                  key={s}
                  variant={filterStatus === s ? "default" : "outline"}
                  size="sm"
                  className="h-8 rounded-full"
                  onClick={() => {
                    setFilterStatus(s);
                    setPage(1);
                  }}
                >
                  {s}
                </Button>
              ))}
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center p-12 text-muted-foreground text-sm gap-2">
                <RefreshCw size={16} className="animate-spin" /> Loading BOQs...
              </div>
            ) : (
              <>
                <DataTable
                  data={rows}
                  columns={enrichedColumns}
                  searchable={false}
                  paginated={false}
                  emptyMessage="No BOQs found. Adjust your filters or create a new one."
                />
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t p-4 text-sm">
                    <span className="text-muted-foreground">
                      Page {page} of {totalPages} ({total} records)
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 1}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        Prev
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page === totalPages}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {showForm && (
        <FormModal
          record={editRecord}
          companies={companies}
          projects={projects}
          docTypes={docTypes}
          uoms={uoms}
          itemOptions={itemOptions}
          activityOptions={activityOptions}
          finYear={activeFinYear}
          onClose={() => {
            setShowForm(false);
            setEditRecord(null);
          }}
          onSaved={refresh}
        />
      )}

      {viewRecord && (
        <DetailModal
          record={viewRecord}
          uoms={uoms}
          onClose={() => setViewRecord(null)}
          onEdit={() => openEdit(viewRecord)}
          onRefresh={() => {
            setViewRecord(null);
            refresh();
          }}
        />
      )}
    </>
  );
}