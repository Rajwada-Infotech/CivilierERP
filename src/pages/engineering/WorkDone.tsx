import React, { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { useFinYear } from "@/contexts/FinYearContext";
import {
  fetchCompanies,
  fetchProjects,
  fetchSuppliers,
} from "@/api/workOrderApi";
import { DocNumberPreview } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import {
  Hammer,
  Plus,
  RefreshCw,
  FileText,
  PenSquare,
  CheckCircle2,
  Clock,
  IndianRupee,
  Building2,
  Layers,
  Calendar,
  Hash,
  User,
  ArrowLeft,
  Save,
  RotateCcw,
} from "lucide-react";

// ─── Style constants ──────────────────────────────────────────────────────────
const inputCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";

const selectCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none";

const FieldLabel: React.FC<{
  children: React.ReactNode;
  required?: boolean;
}> = ({ children, required }) => (
  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
    {children}
    {required && <span className="text-red-500 ml-0.5">*</span>}
  </label>
);

const SelectSkeleton: React.FC = () => (
  <div className="w-full h-10 rounded-lg border border-border bg-muted/30 animate-pulse" />
);

// ─── Types ────────────────────────────────────────────────────────────────────
interface WorkDoneEntry {
  ID: number;
  DocNo: string;
  DocTypeId: number | null;
  DocDate: string;
  CompanyId: number | null;
  CompanyName: string;
  ProjectId: number | null;
  ProjectName: string;
  FinYear: string;
  SupplierId: number | null;
  SupplierName: string;
  WorkOrderID: number;
  WorkOrderNo: string;
  ContractorName: string;
  PeriodFrom: string;
  PeriodTo: string;
  DescriptionOfWork: string;
  QuantityDone: number;
  Unit: string;
  RatePerUnit: number;
  GrossAmount: number;
  Deductions: number;
  CertifiedAmount: number;
  Status: string;
  Remarks: string;
  CreatedAt: string;
  CreatedBy: string;
}

interface DropdownOption {
  id: number;
  name: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n ?? 0);

const fmtDate = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

// ─── Summary card ─────────────────────────────────────────────────────────────
function SummaryCard({
  label,
  value,
  icon: Icon,
  iconColor,
  iconBg,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3">
      <div className={`p-2 rounded-lg ${iconBg}`}>
        <Icon size={15} className={iconColor} />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-heading font-bold text-foreground">
          {value}
        </p>
      </div>
    </div>
  );
}

// ─── Form state ───────────────────────────────────────────────────────────────
interface FormState {
  companyId: string;
  projectId: string;
  finYear: string;
  docTypeId: number | null;
  docNo: string;
  docDate: string;
  supplierId: string;
  workOrderId: string;
  remarks: string;
  PeriodFrom: string;
  PeriodTo: string;
  DescriptionOfWork: string;
  QuantityDone: string;
  Unit: string;
  RatePerUnit: string;
  Deductions: string;
  Status: string;
}

const EMPTY_FORM = (activeFinYear?: string): FormState => ({
  companyId: "",
  projectId: "",
  finYear: activeFinYear ?? "",
  docTypeId: null,
  docNo: "",
  docDate: new Date().toISOString().slice(0, 10),
  supplierId: "",
  workOrderId: "",
  remarks: "",
  PeriodFrom: "",
  PeriodTo: "",
  DescriptionOfWork: "",
  QuantityDone: "",
  Unit: "",
  RatePerUnit: "",
  Deductions: "0",
  Status: "Draft",
});

// ─── WO Activity type (from /api/work-orders/:id/activities) ─────────────────
interface WoActivity {
  Id: number;
  ActivityGroupName: string | null;
  ActivityName: string | null;
  UOMName: string | null;
  Rate: number | null;
  Area: number | null;
  LabourAmount: number | null;
  MaterialAmount: number | null;
  GrandTotal: number | null;
  Remarks: string | null;
}

// ─── Form ─────────────────────────────────────────────────────────────────────
function WorkDoneForm({
  record,
  onClose,
  companies,
  projects,
  suppliers,
  workOrders,
  finYearOptions,
  loadingDropdowns,
  activeFinYear,
}: {
  record: WorkDoneEntry | null;
  onClose: () => void;
  companies: DropdownOption[];
  projects: DropdownOption[];
  suppliers: DropdownOption[];
  workOrders: DropdownOption[];
  finYearOptions: { id: string; year: string }[];
  loadingDropdowns: boolean;
  activeFinYear: string;
}) {
  const qc = useQueryClient();
  const isEdit = !!record;

  const [form, setForm] = useState<FormState>(
    record
      ? {
          companyId: String(record.CompanyId ?? ""),
          projectId: String(record.ProjectId ?? ""),
          finYear: record.FinYear ?? activeFinYear,
          docTypeId: record.DocTypeId ?? null,
          docNo: record.DocNo ?? "",
          docDate:
            record.DocDate?.slice(0, 10) ??
            new Date().toISOString().slice(0, 10),
          supplierId: String(record.SupplierId ?? ""),
          workOrderId: String(record.WorkOrderID ?? ""),
          remarks: record.Remarks ?? "",
          PeriodFrom: record.PeriodFrom?.slice(0, 10) ?? "",
          PeriodTo: record.PeriodTo?.slice(0, 10) ?? "",
          DescriptionOfWork: record.DescriptionOfWork ?? "",
          QuantityDone: String(record.QuantityDone ?? ""),
          Unit: record.Unit ?? "",
          RatePerUnit: String(record.RatePerUnit ?? ""),
          Deductions: String(record.Deductions ?? "0"),
          Status: record.Status ?? "Draft",
        }
      : EMPTY_FORM(activeFinYear),
  );

  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [docRefreshTrigger, setDocRefreshTrigger] = useState(0);
  const [woSummaryLoading, setWoSummaryLoading] = useState(false);
  const [woActivities, setWoActivities] = useState<WoActivity[]>([]);

  const setField = useCallback(
    <K extends keyof FormState>(k: K, v: FormState[K]) =>
      setForm((prev) => ({ ...prev, [k]: v })),
    [],
  );

  const gross =
    (parseFloat(form.QuantityDone) || 0) * (parseFloat(form.RatePerUnit) || 0);
  const certified = gross - (parseFloat(form.Deductions) || 0);

  const validate = () => {
    const e: Record<string, boolean> = {};
    if (!form.companyId) e.companyId = true;
    if (!form.projectId) e.projectId = true;
    if (!form.docDate) e.docDate = true;
    if (!form.DescriptionOfWork.trim()) e.DescriptionOfWork = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        CompanyId: parseInt(form.companyId) || null,
        ProjectId: parseInt(form.projectId) || null,
        FinYear: form.finYear,
        DocTypeId: form.docTypeId,
        DocNo: form.docNo,
        DocDate: form.docDate,
        SupplierId: parseInt(form.supplierId) || null,
        WorkOrderID: parseInt(form.workOrderId) || null,
        Remarks: form.remarks,
        PeriodFrom: form.PeriodFrom,
        PeriodTo: form.PeriodTo,
        DescriptionOfWork: form.DescriptionOfWork,
        QuantityDone: parseFloat(form.QuantityDone) || 0,
        Unit: form.Unit,
        RatePerUnit: parseFloat(form.RatePerUnit) || 0,
        Deductions: parseFloat(form.Deductions) || 0,
        GrossAmount: gross,
        CertifiedAmount: certified,
        Status: form.Status,
      };
      const url = isEdit
        ? `/api/engineering/work-done/${record!.ID}`
        : "/api/engineering/work-done";
      const res = await fetchWithAuth(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["engineering-work-done"] });
      qc.invalidateQueries({ queryKey: ["engineering-dashboard"] });
      toast.success(isEdit ? "Work Done updated" : "Work Done entry created");
      onClose();
    },
    onError: (err: any) => toast.error(err.message || "Save failed"),
  });

  const handleSave = () => {
    if (!validate()) return;
    saveMutation.mutate();
  };

  const handleReset = () => {
    setForm(EMPTY_FORM(activeFinYear));
    setErrors({});
    setDocRefreshTrigger((n) => n + 1);
  };

  const renderSelect = (
    value: string,
    onChange: (v: string) => void,
    options: DropdownOption[],
    placeholder: string,
    hasError = false,
  ) => {
    if (loadingDropdowns) return <SelectSkeleton />;
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${selectCls} ${hasError ? "border-red-400" : ""}`}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={String(o.id)}>
            {o.name}
          </option>
        ))}
      </select>
    );
  };

  return (
    <div className="space-y-6">
      {/* ── Document Header ── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
          <Hash size={14} className="text-violet-500" />
          <span className="text-sm font-heading font-semibold text-foreground">
            Document Header
          </span>
        </div>

        <div className="p-5 space-y-5">
          {/* Row 1: Company | Project | Financial Year */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div>
              <FieldLabel required>
                <span className="flex items-center gap-1.5">
                  <Building2 size={11} />
                  Company
                </span>
              </FieldLabel>
              {renderSelect(
                form.companyId,
                (v) => setField("companyId", v),
                companies,
                "Select company…",
                errors.companyId,
              )}
              {errors.companyId && (
                <p className="text-xs text-red-500 mt-1">Required</p>
              )}
            </div>

            <div>
              <FieldLabel required>
                <span className="flex items-center gap-1.5">
                  <Layers size={11} />
                  Project
                </span>
              </FieldLabel>
              {renderSelect(
                form.projectId,
                (v) => setField("projectId", v),
                projects,
                "Select project…",
                errors.projectId,
              )}
              {errors.projectId && (
                <p className="text-xs text-red-500 mt-1">Required</p>
              )}
            </div>

            <div>
              <FieldLabel>
                <span className="flex items-center gap-1.5">
                  <Calendar size={11} />
                  Financial Year
                </span>
              </FieldLabel>
              {loadingDropdowns ? (
                <SelectSkeleton />
              ) : (
                <select
                  value={form.finYear}
                  onChange={(e) => {
                    setField("finYear", e.target.value);
                    setDocRefreshTrigger((n) => n + 1);
                  }}
                  className={selectCls}
                >
                  <option value="">Select financial year…</option>
                  {finYearOptions.map((fy) => (
                    <option key={fy.id} value={fy.year}>
                      {fy.year}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Row 2: Document Name | Date | Supplier */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div>
              <FieldLabel>
                <span className="flex items-center gap-1.5">
                  <Hash size={11} />
                  Document Name
                </span>
              </FieldLabel>
              <DocNumberPreview
                module="WD"
                finYear={form.finYear || undefined}
                selectedDocTypeId={form.docTypeId}
                preview={form.docNo}
                refreshTrigger={docRefreshTrigger}
                onSelect={(id, preview) => {
                  setField("docTypeId", id);
                  setField("docNo", preview);
                }}
              />
            </div>

            <div>
              <FieldLabel required>
                <span className="flex items-center gap-1.5">
                  <Calendar size={11} />
                  Date
                </span>
              </FieldLabel>
              <input
                type="date"
                value={form.docDate}
                onChange={(e) => setField("docDate", e.target.value)}
                className={`${inputCls} ${errors.docDate ? "border-red-400" : ""}`}
              />
              {errors.docDate && (
                <p className="text-xs text-red-500 mt-1">Required</p>
              )}
            </div>

            <div>
              <FieldLabel>
                <span className="flex items-center gap-1.5">
                  <User size={11} />
                  Supplier
                </span>
              </FieldLabel>
              {renderSelect(
                form.supplierId,
                (v) => setField("supplierId", v),
                suppliers,
                "Select supplier…",
              )}
            </div>
          </div>

          {/* Row 3: Work Order */}
          <div>
            <FieldLabel>
              <span className="flex items-center gap-1.5">
                <Hammer size={11} />
                Work Order
              </span>
            </FieldLabel>
            {loadingDropdowns ? (
              <SelectSkeleton />
            ) : (
              <select
                value={form.workOrderId}
                onChange={async (e) => {
                  const woId = e.target.value;
                  setField("workOrderId", woId);
                  setWoActivities([]);
                  if (!woId) return;
                  setWoSummaryLoading(true);
                  try {
                    const [sumRes, actRes] = await Promise.all([
                      fetchWithAuth(
                        `/api/engineering/work-order-summary/${woId}`,
                      ),
                      fetchWithAuth(
                        `/api/work-orders/${woId}/activities?_t=${Date.now()}`,
                      ),
                    ]);
                    if (sumRes.ok) {
                      const s = await sumRes.json();
                      setForm((prev) => ({
                        ...prev,
                        workOrderId: woId,
                        RatePerUnit: s.GrossAmount
                          ? String(s.GrossAmount)
                          : prev.RatePerUnit,
                        QuantityDone: "1",
                        Deductions: "0",
                      }));
                    }
                    if (actRes.ok) {
                      const acts = await actRes.json();
                      console.log("[WO activities raw]", acts);
                      setWoActivities(Array.isArray(acts) ? acts : []);
                    } else {
                      console.error(
                        "[WO activities] non-ok",
                        actRes.status,
                        await actRes.text().catch(() => ""),
                      );
                    }
                  } catch (err) {
                    console.error("[WO select] fetch failed", err);
                  } finally {
                    setWoSummaryLoading(false);
                  }
                }}
                className={selectCls}
              >
                <option value="">Select work order…</option>
                {workOrders.map((wo) => (
                  <option key={wo.id} value={String(wo.id)}>
                    {wo.name}
                  </option>
                ))}
              </select>
            )}
            {woSummaryLoading && (
              <p className="text-[10px] text-muted-foreground mt-1 animate-pulse">
                Loading WO summary…
              </p>
            )}
          </div>

          {/* Row 4: Remarks full width */}
          <div>
            <FieldLabel>Remarks</FieldLabel>
            <textarea
              value={form.remarks}
              onChange={(e) => setField("remarks", e.target.value)}
              placeholder="Optional remarks…"
              rows={2}
              className="w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition resize-none"
            />
          </div>
        </div>
      </div>

      {/* ── Work Details ── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
          <Hammer size={14} className="text-orange-500" />
          <span className="text-sm font-heading font-semibold text-foreground">
            Work Details
          </span>
        </div>

        <div className="p-5 space-y-5">
          {/* Period range */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <FieldLabel>Period From</FieldLabel>
              <input
                type="date"
                value={form.PeriodFrom}
                onChange={(e) => setField("PeriodFrom", e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <FieldLabel>Period To</FieldLabel>
              <input
                type="date"
                value={form.PeriodTo}
                onChange={(e) => setField("PeriodTo", e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {/* Activity breakdown table */}
          {woSummaryLoading ? (
            <div className="rounded-xl border border-border bg-muted/20 p-6 flex items-center justify-center gap-2 text-sm text-muted-foreground animate-pulse">
              <Hammer size={14} className="text-orange-400" />
              Loading activity breakdown…
            </div>
          ) : woActivities.length > 0 ? (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Activity Breakdown
                </span>
                <span className="text-xs text-muted-foreground">
                  {woActivities.length} activit
                  {woActivities.length === 1 ? "y" : "ies"}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/10">
                      <th className="text-left px-3 py-2 text-muted-foreground font-semibold">
                        Group
                      </th>
                      <th className="text-left px-3 py-2 text-muted-foreground font-semibold">
                        Activity
                      </th>
                      <th className="text-right px-3 py-2 text-muted-foreground font-semibold">
                        UOM
                      </th>
                      <th className="text-right px-3 py-2 text-muted-foreground font-semibold">
                        Area
                      </th>
                      <th className="text-right px-3 py-2 text-muted-foreground font-semibold">
                        Rate
                      </th>
                      <th className="text-right px-3 py-2 text-muted-foreground font-semibold">
                        Labour
                      </th>
                      <th className="text-right px-3 py-2 text-muted-foreground font-semibold">
                        Material
                      </th>
                      <th className="text-right px-3 py-2 text-muted-foreground font-semibold">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {woActivities.map((a, i) => (
                      <tr
                        key={a.Id}
                        className={`border-b border-border/50 ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                      >
                        <td className="px-3 py-2 text-muted-foreground">
                          {a.ActivityGroupName || "—"}
                        </td>
                        <td className="px-3 py-2 font-medium text-foreground">
                          {a.ActivityName || "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          {a.UOMName || "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {a.Area != null ? a.Area : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {a.Rate != null ? fmt(a.Rate) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-blue-600">
                          {a.LabourAmount != null ? fmt(a.LabourAmount) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-amber-600">
                          {a.MaterialAmount != null
                            ? fmt(a.MaterialAmount)
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-foreground">
                          {a.GrandTotal != null ? fmt(a.GrandTotal) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/20">
                      <td
                        colSpan={5}
                        className="px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase"
                      >
                        Totals
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-bold text-blue-600">
                        {fmt(
                          woActivities.reduce(
                            (s, a) => s + (a.LabourAmount ?? 0),
                            0,
                          ),
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-bold text-amber-600">
                        {fmt(
                          woActivities.reduce(
                            (s, a) => s + (a.MaterialAmount ?? 0),
                            0,
                          ),
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-bold text-foreground">
                        {fmt(
                          woActivities.reduce(
                            (s, a) => s + (a.GrandTotal ?? 0),
                            0,
                          ),
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : form.workOrderId ? (
            <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
              No activities found for this Work Order.
            </div>
          ) : null}

          {/* Amount breakdown + deductions */}
          {(woActivities.length > 0 || parseFloat(form.RatePerUnit) > 0) && (
            <div className="rounded-xl bg-violet-500/5 border border-violet-500/20 p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Amount Summary
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Labour
                  </p>
                  <p className="text-sm font-bold text-blue-600 mt-0.5">
                    {fmt(
                      woActivities.reduce(
                        (s, a) => s + (a.LabourAmount ?? 0),
                        0,
                      ) ||
                        parseFloat(form.RatePerUnit) ||
                        0,
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Material
                  </p>
                  <p className="text-sm font-bold text-amber-600 mt-0.5">
                    {fmt(
                      woActivities.reduce(
                        (s, a) => s + (a.MaterialAmount ?? 0),
                        0,
                      ),
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Gross Amount
                  </p>
                  <p className="text-sm font-bold text-foreground mt-0.5">
                    {fmt(gross)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Certified Amount
                  </p>
                  <p className="text-sm font-bold text-emerald-600 mt-0.5">
                    {fmt(certified)}
                  </p>
                </div>
              </div>
              <div className="pt-2 border-t border-violet-500/20">
                <FieldLabel>Deductions (₹)</FieldLabel>
                <input
                  type="number"
                  value={form.Deductions}
                  onChange={(e) => setField("Deductions", e.target.value)}
                  placeholder="0.00"
                  className={`${inputCls} max-w-[200px]`}
                />
              </div>
            </div>
          )}

          {/* Description at bottom */}
          <div>
            <FieldLabel required>Description of Work</FieldLabel>
            <textarea
              value={form.DescriptionOfWork}
              onChange={(e) => setField("DescriptionOfWork", e.target.value)}
              placeholder="Describe the work completed…"
              rows={3}
              className={`w-full text-sm rounded-lg border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition resize-none ${
                errors.DescriptionOfWork ? "border-red-400" : "border-border"
              }`}
            />
            {errors.DescriptionOfWork && (
              <p className="text-xs text-red-500 mt-1">Required</p>
            )}
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between pt-1">
        <button
          onClick={handleReset}
          disabled={saveMutation.isPending}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-4 py-2 hover:bg-muted transition-colors"
        >
          <RotateCcw size={13} />
          Reset
        </button>
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="flex items-center gap-1.5 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-5 py-2 font-medium transition-colors disabled:opacity-60"
        >
          <Save size={13} />
          {saveMutation.isPending
            ? "Saving…"
            : isEdit
              ? "Update Work Done"
              : "Save Work Done"}
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function WorkDone() {
  const { finYears } = useFinYear();
  const [view, setView] = useState<"list" | "form">("list");
  const [editRecord, setEditRecord] = useState<WorkDoneEntry | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year ?? "";

  const finYearOptions = finYears.map((fy) => ({
    id: String(fy.id),
    year: fy.year,
  }));

  // ── Dropdown queries ─────────────────────────────────────────────────────────
  const { data: companies = [], isLoading: loadingCompanies } = useQuery({
    queryKey: ["companies-wd"],
    queryFn: fetchCompanies,
    staleTime: 5 * 60 * 1000,
  });

  const { data: projects = [], isLoading: loadingProjects } = useQuery({
    queryKey: ["projects-wd"],
    queryFn: fetchProjects,
    staleTime: 5 * 60 * 1000,
  });

  const { data: suppliers = [], isLoading: loadingSuppliers } = useQuery({
    queryKey: ["suppliers-wd"],
    queryFn: fetchSuppliers,
    staleTime: 5 * 60 * 1000,
  });

  const { data: workOrders = [], isLoading: loadingWorkOrders } = useQuery<
    DropdownOption[]
  >({
    queryKey: ["work-orders-wd-list"],
    queryFn: () =>
      fetchWithAuth("/api/engineering/work-orders-with-activities").then(
        async (r) => {
          const json = await r.json();
          const rows = Array.isArray(json) ? json : [];
          return rows.map((w: any) => ({
            id: w.Id,
            name: `${w.DocNo || "WO"} — ${w.ContractorName || "No contractor"} (${w.ActivityCount} activities)`,
          }));
        },
      ),
    staleTime: 5 * 60 * 1000,
  });

  const loadingDropdowns =
    loadingCompanies ||
    loadingProjects ||
    loadingSuppliers ||
    loadingWorkOrders;

  // ── List query ───────────────────────────────────────────────────────────────
  const {
    data: entries = [],
    isLoading,
    refetch,
    isFetching,
  } = useQuery<WorkDoneEntry[]>({
    queryKey: ["engineering-work-done"],
    queryFn: () =>
      fetchWithAuth("/api/engineering/work-done").then(async (r) => {
        const json = await r.json();
        return Array.isArray(json) ? json : (json.data ?? []);
      }),
    staleTime: 60 * 1000,
  });

  const filtered =
    statusFilter === "all"
      ? entries
      : entries.filter((e) => e.Status === statusFilter);

  const totalCertified = filtered.reduce(
    (sum, e) => sum + (e.CertifiedAmount ?? 0),
    0,
  );
  const pendingCount = entries.filter((e) => e.Status === "Pending").length;
  const approvedCount = entries.filter((e) => e.Status === "Approved").length;

  const openNew = () => {
    setEditRecord(null);
    setView("form");
  };

  const openEdit = (r: WorkDoneEntry) => {
    setEditRecord(r);
    setView("form");
  };

  const closeForm = () => {
    setView("list");
    setEditRecord(null);
  };

  // ── Columns ──────────────────────────────────────────────────────────────────
  const COLUMNS: ColumnDef<WorkDoneEntry>[] = [
    {
      id: "DocNo",
      accessorKey: "DocNo",
      header: "Doc No",
      cell: ({ getValue }) => (
        <span className="font-mono text-[11px] text-primary font-medium">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      id: "CompanyName",
      accessorKey: "CompanyName",
      header: "Company",
      cell: ({ getValue }) => (
        <span className="text-xs">{(getValue() as string) || "—"}</span>
      ),
    },
    {
      id: "ProjectName",
      accessorKey: "ProjectName",
      header: "Project",
      cell: ({ getValue }) => (
        <span className="text-xs">{(getValue() as string) || "—"}</span>
      ),
    },
    {
      id: "SupplierName",
      accessorKey: "SupplierName",
      header: "Supplier",
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      id: "DocDate",
      accessorKey: "DocDate",
      header: "Date",
      cell: ({ getValue }) => (
        <span className="text-xs">{fmtDate(getValue() as string)}</span>
      ),
    },
    {
      id: "DescriptionOfWork",
      accessorKey: "DescriptionOfWork",
      header: "Description",
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return (
          <span
            className="text-xs text-muted-foreground max-w-[160px] truncate block"
            title={v}
          >
            {v || "—"}
          </span>
        );
      },
    },
    {
      id: "CertifiedAmount",
      accessorKey: "CertifiedAmount",
      header: "Certified",
      cell: ({ getValue }) => (
        <span className="text-xs font-semibold text-emerald-600">
          {fmt(getValue() as number)}
        </span>
      ),
    },
    {
      id: "Status",
      accessorKey: "Status",
      header: "Status",
      cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <button
          onClick={() => openEdit(row.original)}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1 rounded hover:bg-muted transition-colors"
        >
          <PenSquare size={11} /> Edit
        </button>
      ),
    },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Breadcrumbs
            items={[
              { label: "Engineering", href: "/engineering" },
              { label: "Work Done" },
            ]}
          />
          <div className="flex items-center gap-3 mt-1">
            {view === "form" && (
              <button
                onClick={closeForm}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <div className="p-2 rounded-lg bg-orange-500/10">
              <Hammer size={18} className="text-orange-600" />
            </div>
            <div>
              <h1 className="text-xl font-heading font-bold text-foreground">
                {view === "form"
                  ? editRecord
                    ? `Edit — ${editRecord.DocNo || "Work Done"}`
                    : "New Work Done Entry"
                  : "Work Done"}
              </h1>
              <p className="text-xs text-muted-foreground">
                {view === "form"
                  ? "Fill in the document details and work information"
                  : "Record and certify contractor work completion"}
              </p>
            </div>
          </div>
        </div>

        {view === "list" && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors"
            >
              <RefreshCw
                size={12}
                className={isFetching ? "animate-spin" : ""}
              />
            </button>
            <button
              onClick={openNew}
              className="flex items-center gap-1.5 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-4 py-2 font-medium transition-colors"
            >
              <Plus size={14} /> New Entry
            </button>
          </div>
        )}
      </div>

      {view === "list" ? (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard
              label="Total Entries"
              value={String(entries.length)}
              icon={FileText}
              iconColor="text-orange-600"
              iconBg="bg-orange-500/10"
            />
            <SummaryCard
              label="Certified Amount"
              value={fmt(totalCertified)}
              icon={IndianRupee}
              iconColor="text-emerald-600"
              iconBg="bg-emerald-500/10"
            />
            <SummaryCard
              label="Pending Approval"
              value={String(pendingCount)}
              icon={Clock}
              iconColor="text-amber-600"
              iconBg="bg-amber-500/10"
            />
            <SummaryCard
              label="Approved"
              value={String(approvedCount)}
              icon={CheckCircle2}
              iconColor="text-blue-600"
              iconBg="bg-blue-500/10"
            />
          </div>

          {/* Filter pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {["all", "Draft", "Pending", "Approved", "Rejected"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  statusFilter === s
                    ? "bg-violet-600 text-white border-violet-600"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {s === "all" ? "All" : s}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <DataTable
              data={filtered}
              columns={COLUMNS}
              loading={isLoading}
              searchable
              paginated
              emptyMessage="No work done entries found."
            />
          </div>
        </>
      ) : (
        <WorkDoneForm
          record={editRecord}
          onClose={closeForm}
          companies={companies}
          projects={projects}
          suppliers={suppliers}
          workOrders={workOrders}
          finYearOptions={finYearOptions}
          loadingDropdowns={loadingDropdowns}
          activeFinYear={activeFinYear}
        />
      )}
    </div>
  );
}
