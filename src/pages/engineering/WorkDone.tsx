import React, { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePageRights } from "@/hooks/usePageRights";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EngineeringShell } from "@/components/engineering/EngineeringShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { ApprovalActions } from "@/components/ApprovalActions";
import { AmendedBadge } from "@/components/AmendedBadge";
import { useAmendmentStatus } from "@/hooks/useAmendmentStatus";
import { useFinYear } from "@/contexts/FinYearContext";
import {
  fetchCompanies,
  fetchProjects,
  fetchSuppliers,
} from "@/api/workOrderApi";
import { DocNumberPreview } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { Button } from "@/components/ui/button";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import {
  Hammer,
  Plus,
  RefreshCw,
  PenSquare,
  FilePenLine,
  Building2,
  Layers,
  Calendar,
  Hash,
  User,
  ArrowLeft,
  Save,
  RotateCcw,
  Eye,
  Printer,
  X,
} from "lucide-react";

// ─── Style constants ──────────────────────────────────────────────────────────
const inputCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";

const selectCls =
  "w-full text-sm rounded-lg border border-border pl-3 pr-8 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition wd-select-arrow";

const FieldLabel: React.FC<{
  children: React.ReactNode;
  required?: boolean;
}> = ({ children, required }) => (
  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-0.5 mb-1.5">
    {children}
    {required && <span className="text-red-500">*</span>}
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
  company_id?: number | null;
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
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: "hsl(var(--background))",
        border: "1px solid hsl(var(--border))",
        borderTop: `3px solid ${color}`,
        borderRadius: "calc(var(--radius) + 2px)",
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: "hsl(var(--muted-foreground))",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          marginTop: 4,
          fontFamily: "'DM Sans', 'Noto Sans', sans-serif",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
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
  const [woSummaryData, setWoSummaryData] = useState<{
    ContractValue: number;
    totalCertified: number;
    totalBooked: number;
    totalPaid: number;
    balance: number;
  } | null>(null);
  const [woActivities, setWoActivities] = useState<WoActivity[]>([]);

  // When editing an existing record, fetch activities for the pre-filled WO
  useEffect(() => {
    const woId = form.workOrderId;
    if (!woId) return;
    fetchWithAuth(`/api/work-orders/${woId}/activities?_t=${Date.now()}`)
      .then((res) => (res.ok ? res.json().catch(() => ({})) : Promise.reject()))
      .then((acts) => setWoActivities(Array.isArray(acts) ? acts : []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount — workOrderId is stable from initial form state

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
      return res.json().catch(() => ({}));
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
              {loadingDropdowns ? (
                <SelectSkeleton />
              ) : (
                <select
                  value={form.projectId}
                  onChange={(e) => setField("projectId", e.target.value)}
                  disabled={!form.companyId}
                  className={`${selectCls} ${errors.projectId ? "border-red-400" : ""} ${!form.companyId ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <option value="">
                    {!form.companyId
                      ? "Select a company first"
                      : "Select project…"}
                  </option>
                  {(form.companyId
                    ? projects.filter(
                        (p) =>
                          !p.company_id ||
                          p.company_id === parseInt(form.companyId),
                      )
                    : projects
                  ).map((o) => (
                    <option key={o.id} value={String(o.id)}>
                      {o.name}
                    </option>
                  ))}
                </select>
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
              <div className="relative">
                <Calendar
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  size={14}
                />
                <input
                  type="date"
                  value={form.docDate}
                  onChange={(e) => setField("docDate", e.target.value)}
                  className={`w-full pl-8 pr-3 py-2.5 rounded-lg text-sm bg-background border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer ${errors.docDate ? "border-red-400" : "border-border"}`}
                />
              </div>
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
                  if (!woId) {
                    setWoSummaryData(null);
                    return;
                  }
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
                      setWoSummaryData({
                        ContractValue: parseFloat(s.ContractValue || 0),
                        totalCertified: parseFloat(s.totalCertified || 0),
                        totalBooked: parseFloat(s.totalBooked || 0),
                        totalPaid: parseFloat(s.totalPaid || 0),
                        balance: parseFloat(s.balance || 0),
                      });
                      setForm((prev) => ({
                        ...prev,
                        workOrderId: woId,
                        // Auto-fill company/project/supplier from WO
                        companyId: s.CompanyId
                          ? String(s.CompanyId)
                          : prev.companyId,
                        projectId: s.ProjectId
                          ? String(s.ProjectId)
                          : prev.projectId,
                        supplierId: s.SupplierId
                          ? String(s.SupplierId)
                          : prev.supplierId,
                        // Set rate from WO contract value
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
                      const actList = Array.isArray(acts) ? acts : [];
                      setWoActivities(actList);
                      // Auto-fill Unit from first activity's UOMName
                      if (actList.length > 0 && actList[0].UOMName) {
                        setForm((prev) => ({
                          ...prev,
                          Unit: prev.Unit || actList[0].UOMName,
                        }));
                      }
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
            {woSummaryData && !woSummaryLoading && (
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  {
                    label: "Contract Value",
                    value: woSummaryData.ContractValue,
                    cls: "text-foreground",
                  },
                  {
                    label: "Certified So Far",
                    value: woSummaryData.totalCertified,
                    cls: "text-blue-600 dark:text-blue-400",
                  },
                  {
                    label: "Booked",
                    value: woSummaryData.totalBooked,
                    cls: "text-amber-600 dark:text-amber-400",
                  },
                  {
                    label: "Balance",
                    value: woSummaryData.balance,
                    cls:
                      woSummaryData.balance > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-500",
                  },
                ].map(({ label, value, cls }) => (
                  <div
                    key={label}
                    className="rounded-lg bg-muted/40 border border-border/60 px-2.5 py-2"
                  >
                    <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
                      {label}
                    </p>
                    <p className={`text-xs font-bold ${cls}`}>
                      ₹
                      {value.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                ))}
              </div>
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
          {/* Period range + Unit */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div>
              <FieldLabel>Period From</FieldLabel>
              <div className="relative">
                <Calendar
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  size={14}
                />
                <input
                  type="date"
                  value={form.PeriodFrom}
                  onChange={(e) => setField("PeriodFrom", e.target.value)}
                  className="w-full pl-8 pr-3 py-2.5 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                />
              </div>
            </div>
            <div>
              <FieldLabel>Period To</FieldLabel>
              <div className="relative">
                <Calendar
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  size={14}
                />
                <input
                  type="date"
                  value={form.PeriodTo}
                  onChange={(e) => setField("PeriodTo", e.target.value)}
                  className="w-full pl-8 pr-3 py-2.5 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                />
              </div>
            </div>
            <div>
              <FieldLabel>Unit</FieldLabel>
              <input
                type="text"
                value={form.Unit}
                onChange={(e) => setField("Unit", e.target.value)}
                placeholder="e.g. Sqft, Rmt, LS…"
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
                        className={`border-b border-border/50 ${
                          i % 2 === 0 ? "" : "bg-muted/10"
                        }`}
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
          className="gradient-engineering inline-flex items-center gap-1.5 font-heading font-semibold text-white text-xs px-4 py-1.5 rounded-lg disabled:opacity-60 transition-all"
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

// ─── Row actions — a real component (not an inline cell function) so it can
// call useAmendmentStatus per row without violating the rules of hooks. ────────
const WorkDoneRowActions: React.FC<{
  record: WorkDoneEntry;
  canEdit: boolean;
  canPrint: boolean;
  onView: () => void;
  onPrint: () => void;
  onEdit: () => void;
  onRefresh: () => void;
}> = ({ record, canEdit, canPrint, onView, onPrint, onEdit, onRefresh }) => {
  const navigate = useNavigate();
  const amendmentStatus = useAmendmentStatus("WorkDone", record.ID, record.Status);

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onView}
        title="View details"
        className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-primary"
      >
        <Eye size={13} />
      </button>
      {canPrint && (
        <button
          onClick={onPrint}
          title="Print"
          className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-violet-600"
        >
          <Printer size={13} />
        </button>
      )}

      {canEdit && !amendmentStatus.isApproved && (
        <button
          onClick={onEdit}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1 rounded hover:bg-muted transition-colors"
        >
          <PenSquare size={11} /> Edit
        </button>
      )}
      {canEdit && amendmentStatus.isApproved && (
        <button
          onClick={() =>
            navigate("/engineering/amendment-menu", {
              state: {
                prefill: {
                  tab: "WORK_DONE",
                  docId: record.ID,
                  docNo: record.DocNo,
                  projectName: record.ProjectName,
                  companyName: record.CompanyName,
                  totalAmount: record.CertifiedAmount,
                },
              },
            })
          }
          className="text-[10px] text-violet-600 dark:text-violet-400 hover:text-violet-700 flex items-center gap-1 px-2 py-1 rounded hover:bg-violet-500/10 transition-colors"
        >
          <FilePenLine size={11} /> Amend
        </button>
      )}
      {amendmentStatus.isAmended && <AmendedBadge />}
      <ApprovalActions
        status={record.Status}
        recordId={record.ID}
        endpoint="/api/engineering/work-done"
        onSuccess={onRefresh}
        submitOnly={true}
      />
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────
export default function WorkDone() {
  const rights = usePageRights("work-done");
  const { finYears } = useFinYear();
  const [view, setView] = useState<"list" | "form">("list");
  const [editRecord, setEditRecord] = useState<WorkDoneEntry | null>(null);
  const [viewRecord, setViewRecord] = useState<WorkDoneEntry | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [filterCompanyId, setFilterCompanyId] = useState<number | null>(null);
  const viewRecordAmendmentStatus = useAmendmentStatus("WorkDone", viewRecord?.ID, viewRecord?.Status);

  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year ?? "";

  const finYearOptions = finYears.filter((fy) => fy.status === "Active" && !fy.locked).map((fy) => ({
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
          const json = await r.json().catch(() => ({}));
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
    queryKey: ["engineering-work-done", filterCompanyId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterCompanyId) params.set("companyId", String(filterCompanyId));
      return fetchWithAuth(`/api/engineering/work-done?${params}`).then(async (r) => {
        const json = await r.json().catch(() => ({}));
        return Array.isArray(json) ? json : (json.data ?? []);
      });
    },
    enabled: !!filterCompanyId,
    staleTime: 30_000,
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

  // ── Print handler ────────────────────────────────────────────────────────────
  const handlePrint = (r: WorkDoneEntry) => {
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    const fmtN = (n: number) =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(n ?? 0);
    const fmtD = (d: string | null) =>
      d
        ? new Date(d).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
        : "—";
    win.document
      .write(`<!DOCTYPE html><html><head><title>Work Done — ${r.DocNo || r.ID}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #1a1a2e; background: #fff; padding: 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #7c3aed; padding-bottom: 16px; margin-bottom: 20px; }
  .logo-block h1 { font-size: 20px; font-weight: 800; color: #7c3aed; letter-spacing: -0.5px; }
  .logo-block p { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .doc-block { text-align: right; }
  .doc-block .doc-no { font-size: 16px; font-weight: 700; color: #7c3aed; font-family: monospace; }
  .doc-block .doc-label { font-size: 9px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; }
  .status-badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
    background: ${r.Status === "Approved" ? "#d1fae5" : r.Status === "Pending" ? "#fef3c7" : r.Status === "Rejected" ? "#fee2e2" : "#f3f4f6"};
    color: ${r.Status === "Approved" ? "#065f46" : r.Status === "Pending" ? "#92400e" : r.Status === "Rejected" ? "#991b1b" : "#374151"}; }
  .section { margin-bottom: 20px; }
  .section-title { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #7c3aed; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 1px solid #ede9fe; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .field { }
  .field label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: #9ca3af; font-weight: 600; display: block; margin-bottom: 3px; }
  .field span { font-size: 12px; color: #111827; font-weight: 500; }
  .amount-box { background: #f5f3ff; border: 1px solid #ede9fe; border-radius: 10px; padding: 16px; }
  .amount-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid #ede9fe; }
  .amount-row:last-child { border-bottom: none; }
  .amount-row .label { color: #6b7280; font-size: 11px; }
  .amount-row .value { font-weight: 600; color: #111827; font-family: monospace; }
  .net-row { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding: 12px 16px; background: #7c3aed; border-radius: 8px; }
  .net-row .label { color: #ede9fe; font-size: 12px; font-weight: 600; }
  .net-row .value { color: #fff; font-size: 16px; font-weight: 800; font-family: monospace; }
  .desc-box { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; font-size: 12px; color: #374151; line-height: 1.6; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 9px; color: #9ca3af; }
  @media print { body { padding: 20px; } }
</style></head><body>
<div class="header">
  <div class="logo-block">
    <h1>Civilier ERP</h1>
    <p>Work Done Certificate</p>
  </div>
  <div class="doc-block">
    <div class="doc-label">Document No</div>
    <div class="doc-no">${r.DocNo || "—"}</div>
    <div style="margin-top:6px"><span class="status-badge">${r.Status || "Draft"}</span></div>
  </div>
</div>

<div class="section">
  <div class="section-title">Project Information</div>
  <div class="grid-3">
    <div class="field"><label>Company</label><span>${r.CompanyName || "—"}</span></div>
    <div class="field"><label>Project / Site</label><span>${r.ProjectName || "—"}</span></div>
    <div class="field"><label>Financial Year</label><span>${r.FinYear || "—"}</span></div>
    <div class="field"><label>Document Date</label><span>${fmtD(r.DocDate)}</span></div>
    <div class="field"><label>Work Order Ref</label><span>${r.WorkOrderNo || "—"}</span></div>
    <div class="field"><label>Contractor</label><span>${r.ContractorName || r.SupplierName || "—"}</span></div>
  </div>
</div>

<div class="section">
  <div class="section-title">Work Period & Details</div>
  <div class="grid-3" style="margin-bottom:12px">
    <div class="field"><label>Period From</label><span>${fmtD(r.PeriodFrom)}</span></div>
    <div class="field"><label>Period To</label><span>${fmtD(r.PeriodTo)}</span></div>
    <div class="field"><label>Unit</label><span>${r.Unit || "—"}</span></div>
    <div class="field"><label>Quantity Done</label><span>${r.QuantityDone ?? "—"}</span></div>
    <div class="field"><label>Rate Per Unit</label><span>${fmtN(r.RatePerUnit)}</span></div>
  </div>
  <div class="field"><label>Description of Work</label></div>
  <div class="desc-box" style="margin-top:6px">${r.DescriptionOfWork || "—"}</div>
</div>

<div class="section">
  <div class="section-title">Amount Summary</div>
  <div class="amount-box">
    <div class="amount-row"><span class="label">Gross Amount</span><span class="value">${fmtN(r.GrossAmount)}</span></div>
    <div class="amount-row"><span class="label">Deductions</span><span class="value" style="color:#dc2626">− ${fmtN(r.Deductions)}</span></div>
  </div>
  <div class="net-row"><span class="label">Certified Amount</span><span class="value">${fmtN(r.CertifiedAmount)}</span></div>
</div>

${r.Remarks ? `<div class="section"><div class="section-title">Remarks</div><div class="desc-box">${r.Remarks}</div></div>` : ""}

<div class="footer">
  <span>Generated from Civilier ERP · ${new Date().toLocaleDateString("en-IN")}</span>
  <span>Doc: ${r.DocNo || r.ID} · Status: ${r.Status}</span>
</div>
</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
    }, 400);
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
      cell: ({ getValue, row }) => (
        <div>
          <ApprovalStatusChain table="WorkDone" recordId={row.original.ID} />
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <WorkDoneRowActions
          record={row.original}
          canEdit={rights.canEdit}
          canPrint={rights.canPrint}
          onView={() => setViewRecord(row.original)}
          onPrint={() => handlePrint(row.original)}
          onEdit={() => openEdit(row.original)}
          onRefresh={() => refetch()}
        />
      ),
    },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        .wd-select-arrow {
          appearance: none;
          -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
        }
      `}</style>
      <Breadcrumbs
        items={[
          { label: "Engineering", path: "/engineering" },
          { label: "Transaction", path: "/engineering/transaction" },
          { label: "Work Done" },
        ]}
      />
      {view === "form" && (
        <button
          onClick={closeForm}
          className="mb-2 inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-muted transition-colors text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Back
        </button>
      )}
      <EngineeringShell
        title={
          view === "form"
            ? editRecord
              ? `Edit — ${editRecord.DocNo || "Work Done"}`
              : "New Work Done Entry"
            : "Work Done"
        }
        subtitle={
          view === "form"
            ? "Fill in the document details and work information"
            : "Record and certify contractor work completion"
        }
        icon={Hammer}
        action={
          view === "list" && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="group flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-all duration-200 active:scale-90 disabled:opacity-50"
              >
                <RefreshCw
                  size={13}
                  className={`transition-transform duration-500 ${isFetching ? "animate-spin" : "group-hover:rotate-180"}`}
                />
                Refresh
              </button>
              {rights.canCreate && (
                <button
                  onClick={openNew}
                  className="gradient-engineering inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white text-xs px-4 py-1.5 rounded-lg transition-all"
                >
                  <Plus size={13} /> New Entry
                </button>
              )}
            </div>
          )
        }
      >
        {view === "list" ? (
          <>
            {/* Summary strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryCard
                label="Total Entries"
                value={String(entries.length)}
                color="#3b82f6"
              />
              <SummaryCard
                label="Certified Amount"
                value={fmt(totalCertified)}
                color="#10b981"
              />
              <SummaryCard
                label="Pending Approval"
                value={String(pendingCount)}
                color="#f59e0b"
              />
              <SummaryCard
                label="Approved"
                value={String(approvedCount)}
                color="#8b5cf6"
              />
            </div>

            {/* Filter row */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* Company filter */}
              <select
                value={filterCompanyId ?? ""}
                onChange={(e) => setFilterCompanyId(e.target.value ? Number(e.target.value) : null)}
                className={`${selectCls} h-9 w-52 text-xs`}
              >
                <option value="">Select company…</option>
                {(companies as { id: number; name: string }[]).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {/* Status pills */}
              {["all", "Draft", "Pending", "Approved", "Rejected"].map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    statusFilter === s
                      ? "gradient-engineering text-white border-transparent font-semibold"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {s === "all" ? "All" : s}
                </button>
              ))}
            </div>

            {/* Table */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              {!filterCompanyId ? (
                <div className="flex items-center justify-center p-12 text-muted-foreground text-sm">
                  Select a company above to view work done entries.
                </div>
              ) : (
                <DataTable
                  data={filtered}
                  columns={COLUMNS}
                  loading={isLoading}
                  searchable
                  paginated
                  emptyMessage="No work done entries found."
                />
              )}
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

        {/* ── View Modal ── */}
        {viewRecord && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setViewRecord(null)}
          >
            <div
              className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-orange-500/10">
                    <Hammer size={15} className="text-orange-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                      Work Done
                    </p>
                    <p className="text-sm font-heading font-bold text-foreground font-mono">
                      {viewRecord.DocNo || `#${viewRecord.ID}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {rights.canPrint && (
                    <button
                      onClick={() => handlePrint(viewRecord)}
                      title="Print"
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-violet-600 hover:border-violet-300 hover:bg-violet-500/5 transition-colors"
                    >
                      <Printer size={12} /> Print
                    </button>
                  )}

                  <button
                    onClick={() => setViewRecord(null)}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Modal body */}
              <div className="p-6 space-y-5">
                {/* Status badge */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Status</span>
                  <div className="flex items-center gap-2">
                    {viewRecordAmendmentStatus.isAmended && <AmendedBadge />}
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold border ${
                        viewRecord.Status === "Approved"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                          : viewRecord.Status === "Pending"
                            ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"
                            : viewRecord.Status === "Rejected"
                              ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800"
                              : "bg-muted text-muted-foreground border-border"
                      }`}
                    >
                      {viewRecord.Status || "Draft"}
                    </span>
                  </div>
                </div>

                {/* Project info */}
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="px-4 py-2.5 bg-muted/30 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Project Information
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-4">
                    {[
                      ["Company", viewRecord.CompanyName],
                      ["Project / Site", viewRecord.ProjectName],
                      ["Financial Year", viewRecord.FinYear],
                      ["Document Date", fmtDate(viewRecord.DocDate)],
                      ["Work Order", viewRecord.WorkOrderNo],
                      [
                        "Contractor",
                        viewRecord.ContractorName || viewRecord.SupplierName,
                      ],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-0.5">
                          {label}
                        </p>
                        <p className="text-sm text-foreground font-medium">
                          {value || "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Work period */}
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="px-4 py-2.5 bg-muted/30 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Work Period & Measurement
                  </div>
                  <div className="p-4 grid grid-cols-3 gap-4">
                    {[
                      ["Period From", fmtDate(viewRecord.PeriodFrom)],
                      ["Period To", fmtDate(viewRecord.PeriodTo)],
                      ["Unit", viewRecord.Unit],
                      ["Quantity Done", String(viewRecord.QuantityDone ?? "—")],
                      ["Rate Per Unit", fmt(viewRecord.RatePerUnit)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-0.5">
                          {label}
                        </p>
                        <p className="text-sm text-foreground font-medium">
                          {value || "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                  {viewRecord.DescriptionOfWork && (
                    <div className="px-4 pb-4">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1.5">
                        Description of Work
                      </p>
                      <p className="text-sm text-foreground bg-muted/30 rounded-lg px-3 py-2.5 leading-relaxed">
                        {viewRecord.DescriptionOfWork}
                      </p>
                    </div>
                  )}
                </div>

                {/* Amount summary */}
                <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-violet-500/20 text-xs font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wide">
                    Amount Summary
                  </div>
                  <div className="p-4 space-y-2">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">
                        Gross Amount
                      </span>
                      <span className="font-mono font-semibold text-foreground">
                        {fmt(viewRecord.GrossAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Deductions</span>
                      <span className="font-mono font-semibold text-red-500">
                        − {fmt(viewRecord.Deductions)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-violet-500/20">
                      <span className="font-semibold text-foreground text-sm">
                        Certified Amount
                      </span>
                      <span className="font-mono font-bold text-emerald-600 text-base">
                        {fmt(viewRecord.CertifiedAmount)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Remarks */}
                {viewRecord.Remarks && (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1.5">
                      Remarks
                    </p>
                    <p className="text-sm text-foreground bg-muted/30 rounded-lg px-3 py-2.5">
                      {viewRecord.Remarks}
                    </p>
                  </div>
                )}

                {/* Created info */}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t border-border">
                  <span>Created by {viewRecord.CreatedBy || "—"}</span>
                  <span>{fmtDate(viewRecord.CreatedAt)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </EngineeringShell>
    </>
  );
}