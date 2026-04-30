import React, { useEffect, useState, useMemo, useCallback } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import type { ColumnDef, RecordWithId } from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import { useFinYear } from "@/contexts/FinYearContext";
import {
  DocNumberPreview,
  fetchNextDocNumber,
} from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { BillingAccordion } from "@/pages/material/ExpenseBooking/BillingAccordion";
import { computeBreakdown, defaultDiscount } from "@/pages/material/ExpenseBooking/helpers";
import type { DiscountConfig } from "@/pages/material/ExpenseBooking/types";

import {
  getPurchaseOrders,
  getPurchaseOrderById,
  addPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  getSuppliers,
  getAllEnterprises,
  getUOMs,
  type POLineItem,
  type PurchaseOrder,
  type CreatePOPayload,
} from "@/api/purchaseOrdersApi";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TAX_RATES = [0, 5, 12, 18, 28];

const STATUS_OPTIONS = ["Draft", "Issued", "Partially Received", "Received", "Closed"];

const emptyItem = (): POLineItem => ({
  itemDescription: "",
  unit: "",
  quantity: 0,
  rate: 0,
  tax: 18,
  amount: 0,
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function calcAmount(item: POLineItem): number {
  const sub = item.quantity * item.rate;
  return sub + (sub * item.tax) / 100;
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface FormState {
  poNumber: string;
  poDate: string;
  expectedDate: string;
  supplierName: string;
  companyName: string;
  projectName: string;
  paymentTerms: string;
  status: string;
  remarks: string;
  docTypeId: number | null;
  docNo: string;
  discount: DiscountConfig;
}

const EMPTY_FORM: FormState = {
  poNumber: "",
  poDate: "",
  expectedDate: "",
  supplierName: "",
  companyName: "",
  projectName: "",
  paymentTerms: "",
  status: "Draft",
  remarks: "",
  docTypeId: null,
  docNo: "",
  discount: defaultDiscount(),
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** Thin labelled input wrapper */
const Field: React.FC<{
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}> = ({ label, required, children, className = "" }) => (
  <div className={className}>
    <label className="block text-xs font-medium text-muted-foreground mb-1">
      {label}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
    {children}
  </div>
);

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50";

const selectCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary";

// ─────────────────────────────────────────────────────────────────────────────
// POForm — the slide-over / modal form
// ─────────────────────────────────────────────────────────────────────────────

interface POFormProps {
  mode: "add" | "edit";
  editId: string | null;
  initialForm: FormState;
  items: POLineItem[];
  suppliers: Array<{ id: number; name: string }>;
  companies: Array<{ id: number; name: string }>;
  allProjects: Array<{ id: number; name: string; belongsTo: number | null }>;
  uoms: Array<{ id: number; name: string }>;
  finYears: Array<{ id: number; year: string; status: string }>;
  selectedFinYear: string;
  onFinYearChange: (fy: string) => void;
  poDocTypeId: number | null;
  poDocNo: string;
  docRefreshTrigger: number;
  onDocSelect: (docTypeId: number | null, docNo: string) => void;
  onSave: (form: FormState, items: POLineItem[]) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

const POForm: React.FC<POFormProps> = ({
  mode,
  editId,
  initialForm,
  items: initialItems,
  suppliers,
  companies,
  allProjects,
  uoms,
  finYears,
  selectedFinYear,
  onFinYearChange,
  poDocTypeId,
  poDocNo,
  docRefreshTrigger,
  onDocSelect,
  onSave,
  onCancel,
  saving,
}) => {
  const [form, setForm] = useState<FormState>(initialForm);
  const [items, setItems] = useState<POLineItem[]>(
    initialItems.length > 0 ? initialItems : [emptyItem()],
  );

  // Sync when parent pushes a new doc number patch
  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      poNumber: poDocNo || prev.poNumber,
      docNo: poDocNo || prev.docNo,
      docTypeId: poDocTypeId ?? prev.docTypeId,
    }));
  }, [poDocNo, poDocTypeId, docRefreshTrigger]);

  // Re-init when switching between add/edit
  useEffect(() => {
    setForm(initialForm);
    setItems(initialItems.length > 0 ? initialItems : [emptyItem()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Filter projects by selected company
  const selectedCompanyId = useMemo(
    () => companies.find((c) => c.name === form.companyName)?.id ?? null,
    [companies, form.companyName],
  );

  const filteredProjects = useMemo(
    () =>
      selectedCompanyId
        ? allProjects.filter((p) => p.belongsTo === selectedCompanyId)
        : allProjects,
    [allProjects, selectedCompanyId],
  );

  // ── Derived totals ──────────────────────────────────────────────────────────
  const subtotal = items.reduce((s, r) => s + r.quantity * r.rate, 0);
  const totalTax = items.reduce(
    (s, r) => s + (r.quantity * r.rate * r.tax) / 100,
    0,
  );
  const effectiveTaxRate = subtotal > 0 ? (totalTax / subtotal) * 100 : 0;
  const billingBreakdown = computeBreakdown(
    subtotal,
    effectiveTaxRate,
    0,
    form.discount,
  );
  const grandTotal = billingBreakdown.netAmount;

  // ── Line item handlers ──────────────────────────────────────────────────────
  const addItem = () => setItems((prev) => [...prev, emptyItem()]);

  const removeItem = (index: number) =>
    setItems((prev) => prev.filter((_, i) => i !== index));

  const updateItem = useCallback(
    (index: number, field: keyof POLineItem, raw: string | number) => {
      setItems((prev) =>
        prev.map((row, i) => {
          if (i !== index) return row;
          const updated: POLineItem = { ...row };
          if (field === "itemDescription" || field === "unit") {
            (updated as any)[field] = raw as string;
          } else {
            (updated as any)[field] = Number(raw) || 0;
          }
          updated.amount = calcAmount(updated);
          return updated;
        }),
      );
    },
    [],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(form, items);
  };

  const activeFinYears = finYears.filter((fy) => fy.status === "Active");

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    /* Full-screen slide-over overlay */
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Panel */}
      <div className="flex flex-col w-full max-w-5xl bg-background border-l border-border shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div>
            <h2 className="text-lg font-heading font-semibold text-foreground">
              {mode === "add" ? "New Purchase Order" : "Edit Purchase Order"}
            </h2>
            {form.poNumber && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {form.poNumber}
              </p>
            )}
          </div>
          <button
            onClick={onCancel}
            className="rounded-full p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 px-6 py-5 space-y-6">
          {/* ── Doc number + Fin year ─────────────────────────────────────── */}
          {mode === "add" && (
            <section className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h3 className="text-xs uppercase tracking-widest font-heading text-muted-foreground">
                Document
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Financial Year">
                  <select
                    value={selectedFinYear}
                    onChange={(e) => onFinYearChange(e.target.value)}
                    className={selectCls}
                  >
                    <option value="">Select Fin Year…</option>
                    {activeFinYears.map((fy) => (
                      <option key={fy.id} value={fy.year}>
                        {fy.year}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="PO Number" required>
                  <input
                    className={inputCls}
                    value={form.poNumber}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        poNumber: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="Auto-filled from doc type"
                  />
                </Field>
              </div>
              <DocNumberPreview
                finYear={selectedFinYear || undefined}
                selectedDocTypeId={poDocTypeId}
                preview={poDocNo}
                refreshTrigger={docRefreshTrigger}
                onSelect={onDocSelect}
              />
            </section>
          )}

          {/* ── Order details ─────────────────────────────────────────────── */}
          <section className="rounded-xl border border-border bg-card p-4 space-y-4">
            <h3 className="text-xs uppercase tracking-widest font-heading text-muted-foreground">
              Order Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="PO Date" required>
                <input
                  type="date"
                  className={inputCls}
                  value={form.poDate}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, poDate: e.target.value }))
                  }
                  required
                />
              </Field>
              <Field label="Expected Delivery" required>
                <input
                  type="date"
                  className={inputCls}
                  value={form.expectedDate}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      expectedDate: e.target.value,
                    }))
                  }
                  required
                />
              </Field>
              <Field label="Status" required>
                <select
                  className={selectCls}
                  value={form.status}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, status: e.target.value }))
                  }
                  required
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Supplier" required>
                <select
                  className={selectCls}
                  value={form.supplierName}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      supplierName: e.target.value,
                    }))
                  }
                  required
                >
                  <option value="">Select supplier…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Company">
                <select
                  className={selectCls}
                  value={form.companyName}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      companyName: e.target.value,
                      projectName: "", // clear stale project
                    }))
                  }
                >
                  <option value="">Select company…</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Project / Site">
                <select
                  className={selectCls}
                  value={form.projectName}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      projectName: e.target.value,
                    }))
                  }
                >
                  <option value="">Select project…</option>
                  {filteredProjects.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Payment Terms">
              <textarea
                className={`${inputCls} resize-none`}
                rows={2}
                value={form.paymentTerms}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    paymentTerms: e.target.value,
                  }))
                }
                placeholder="e.g. 30 days from invoice"
              />
            </Field>
          </section>

          {/* ── Line items ────────────────────────────────────────────────── */}
          <section className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-xs uppercase tracking-widest font-heading text-muted-foreground mb-3">
              Line Items
            </h3>

            {/* Scrollable table wrapper */}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm" style={{ minWidth: 780 }}>
                <thead>
                  <tr className="bg-muted/60 text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="px-3 py-2.5 text-left font-medium w-[30%]">
                      Item Description
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium w-[12%]">
                      Unit
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium w-[10%]">
                      Qty
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium w-[13%]">
                      Price (₹)
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium w-[10%]">
                      Tax %
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium w-[14%]">
                      Amount (₹)
                    </th>
                    <th className="px-3 py-2.5 w-[5%]" />
                  </tr>
                </thead>

                <tbody className="divide-y divide-border">
                  {items.map((row, idx) => (
                    <tr
                      key={idx}
                      className="hover:bg-muted/20 transition-colors"
                    >
                      {/* Description */}
                      <td className="px-2 py-1.5">
                        <input
                          className={inputCls}
                          value={row.itemDescription}
                          onChange={(e) =>
                            updateItem(idx, "itemDescription", e.target.value)
                          }
                          placeholder="Enter item name…"
                          required
                        />
                      </td>

                      {/* Unit */}
                      <td className="px-2 py-1.5">
                        <select
                          className={selectCls}
                          value={row.unit}
                          onChange={(e) =>
                            updateItem(idx, "unit", e.target.value)
                          }
                          required
                        >
                          <option value="">Unit</option>
                          {uoms.map((u) => (
                            <option key={u.id} value={u.name}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Qty */}
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={0}
                          className={`${inputCls} text-right`}
                          value={row.quantity || ""}
                          onChange={(e) =>
                            updateItem(idx, "quantity", e.target.value)
                          }
                          required
                        />
                      </td>

                      {/* Price */}
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={0}
                          className={`${inputCls} text-right`}
                          value={row.rate || ""}
                          onChange={(e) =>
                            updateItem(idx, "rate", e.target.value)
                          }
                          required
                        />
                      </td>

                      {/* Tax % */}
                      <td className="px-2 py-1.5">
                        <select
                          className={selectCls}
                          value={row.tax}
                          onChange={(e) =>
                            updateItem(idx, "tax", Number(e.target.value))
                          }
                        >
                          {TAX_RATES.map((t) => (
                            <option key={t} value={t}>
                              {t}%
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Amount — computed, read-only */}
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                        {row.quantity && row.rate ? (
                          <span className="text-foreground">
                            {fmt(row.amount)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Remove */}
                      <td className="px-2 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          disabled={items.length === 1}
                          className="rounded-full p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 transition-colors"
                          title="Remove row"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add row button */}
            <button
              type="button"
              onClick={addItem}
              className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-primary hover:bg-primary/5 transition-colors"
            >
              <span className="text-lg leading-none">+</span> Add item
            </button>

            {/* Totals */}
            <div className="flex justify-end mt-5">
              <div className="w-72 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium tabular-nums">₹{fmt(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Tax</span>
                  <span className="font-medium tabular-nums">
                    ₹{fmt(billingBreakdown.cgstAmount)}
                  </span>
                </div>
                {form.discount.applicable && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="font-medium tabular-nums text-destructive">
                      -₹{fmt(billingBreakdown.discountAmount)}
                    </span>
                  </div>
                )}
                {billingBreakdown.roundOff !== 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Round Off</span>
                    <span className="font-medium tabular-nums">
                      ₹{fmt(billingBreakdown.roundOff)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Taxable Amount</span>
                  <span className="font-medium tabular-nums">
                    ₹{fmt(billingBreakdown.taxableAmount)}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-border text-base">
                  <span className="font-semibold">Grand Total</span>
                  <span className="font-bold text-primary tabular-nums">
                    ₹{fmt(grandTotal)}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <BillingAccordion
            basicAmount={subtotal}
            cgstRate={effectiveTaxRate}
            sgstRate={0}
            discount={form.discount}
            onChange={(discount) => setForm((prev) => ({ ...prev, discount }))}
          />

          {/* ── Remarks ───────────────────────────────────────────────────── */}
          <section className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-xs uppercase tracking-widest font-heading text-muted-foreground mb-3">
              Notes
            </h3>
            <Field label="Remarks / Instructions">
              <textarea
                className={`${inputCls} resize-none`}
                rows={3}
                value={form.remarks}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, remarks: e.target.value }))
                }
                placeholder="Any additional notes…"
              />
            </Field>
          </section>

          {/* ── Actions ───────────────────────────────────────────────────── */}
          <div className="flex justify-end gap-3 pb-4">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="rounded-lg border border-border px-5 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || items.every((i) => !i.itemDescription)}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving
                ? "Saving…"
                : mode === "add"
                ? "Create PO"
                : "Update PO"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

const PurchaseOrderMaster = () => {
  const queryClient = useQueryClient();
  const { finYears } = useFinYear();

  // ── Pagination ─────────────────────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const limit = 10;

  // ── Panel state ────────────────────────────────────────────────────────────
  const [panelMode, setPanelMode] = useState<"add" | "edit" | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [editItems, setEditItems] = useState<POLineItem[]>([]);
  const [saving, setSaving] = useState(false);

  // ── Doc number state ───────────────────────────────────────────────────────
  const [poDocTypeId, setPoDocTypeId] = useState<number | null>(null);
  const [poDocNo, setPoDocNo] = useState("");
  const [docRefreshTrigger, setDocRefreshTrigger] = useState(0);

  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year ?? "";
  const [selectedFinYear, setSelectedFinYear] = useState("");

  useEffect(() => {
    if (!selectedFinYear && activeFinYear) setSelectedFinYear(activeFinYear);
  }, [activeFinYear, selectedFinYear]);

  const applyDocNumber = (docTypeId: number | null, docNo: string) => {
    setPoDocTypeId(docTypeId);
    setPoDocNo(docNo);
    setDocRefreshTrigger((n) => n + 1);
  };

  const refreshDocNumber = async (
    docTypeId: number | null = poDocTypeId,
    finYearOverride = selectedFinYear,
  ) => {
    if (!docTypeId) {
      applyDocNumber(null, "");
      return "";
    }
    const nextDocNo = await fetchNextDocNumber(docTypeId, finYearOverride || undefined);
    applyDocNumber(docTypeId, nextDocNo);
    return nextDocNo;
  };

  // ── Remote data ────────────────────────────────────────────────────────────
  const { data: dbData, isLoading, error } = useQuery({
    queryKey: ["purchase-orders", page, limit],
    queryFn: () => getPurchaseOrders({ page, limit }),
  });

  const { data: suppliersRaw = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: getSuppliers,
  });

  const { data: enterprisesRaw = [] } = useQuery({
    queryKey: ["all-enterprises"],
    queryFn: getAllEnterprises,
  });

  const { data: uomsRaw = [] } = useQuery({
    queryKey: ["uom-master"],
    queryFn: getUOMs,
  });

  // ── Normalise lookup data ──────────────────────────────────────────────────
  const suppliers: Array<{ id: number; name: string }> = (suppliersRaw as any[]).map(
    (s) => ({ id: s.LHeadId, name: s.LHeadName }),
  );

  const allEnterprises: Array<{
    id: number;
    name: string;
    businessType: string;
    belongsTo: number | null;
  }> = (enterprisesRaw as any[]).map((e) => ({
    id: e.id,
    name: e.name ?? "",
    businessType: e.business_type ?? "",
    belongsTo: e.belongs_to ?? null,
  }));

  const companies = useMemo(
    () => allEnterprises.filter((e) => e.businessType === "C"),
    [allEnterprises],
  );

  const allProjects = useMemo(
    () => allEnterprises.filter((e) => e.businessType === "P"),
    [allEnterprises],
  );

  const uoms: Array<{ id: number; name: string }> = (uomsRaw as any[])
    .filter((u) => u.IsActive !== false && u.IsActive !== 0)
    .map((u) => ({ id: u.Id, name: u.UOMName ?? "" }))
    .filter((u) => u.name !== "");

  // ── Table data ─────────────────────────────────────────────────────────────
  const dbItems: any[] = dbData?.data ?? [];
  const totalPages = Math.max(dbData?.totalPages ?? 1, 1);
  const totalRecords = dbData?.total ?? dbItems.length;

  const refetch = () =>
    queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });

  // ── Open add panel ─────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditId(null);
    setEditForm(EMPTY_FORM);
    setEditItems([]);
    setPanelMode("add");
  };

  // ── Open edit panel ────────────────────────────────────────────────────────
  const openEdit = async (item: any) => {
    const id = String(item.PurchaseOrderID ?? item._id ?? "");
    if (!id) return;

    try {
      const po: PurchaseOrder = await getPurchaseOrderById(Number(id));

      const supplierName =
        suppliers.find((s) => s.id === po.SupplierID)?.name ??
        po.SupplierName ??
        "";
      const companyName =
        companies.find((c) => c.id === po.CompanyId)?.name ??
        po.CompanyName ??
        "";
      const projectName =
        allProjects.find((p) => p.id === po.ProjectId)?.name ??
        po.ProjectName ??
        "";

      setEditForm({
        poNumber: po.PurchaseOrderNo ?? "",
        poDate: po.PODate?.slice(0, 10) ?? "",
        expectedDate: po.ExpectedDeliveryDate?.slice(0, 10) ?? "",
        supplierName,
        companyName,
        projectName,
        paymentTerms: po.PaymentTerms ?? "",
        status: po.Status ?? "Draft",
        remarks: po.Remarks ?? "",
        docTypeId: po.DocTypeId ?? null,
        docNo: po.DocNo ?? "",
        discount: po.Discount ?? defaultDiscount(),
      });

      // Prefer new multi-item list; fall back to legacy single-item fields
      if (po.POItems && po.POItems.length > 0) {
        setEditItems(po.POItems);
      } else if (po.ItemDescription) {
        setEditItems([
          {
            itemDescription: po.ItemDescription,
            unit: po.Unit ?? "",
            quantity: po.Quantity ?? 0,
            rate: po.Rate ?? 0,
            tax: 18,
            amount: po.TotalAmount ?? 0,
          },
        ]);
      } else {
        setEditItems([emptyItem()]);
      }

      setEditId(id);
      setPanelMode("edit");
    } catch (err: any) {
      toast.error(`Failed to load PO: ${err.message}`);
    }
  };

  // ── Save handler ───────────────────────────────────────────────────────────
  const handleSave = async (form: FormState, items: POLineItem[]) => {
    setSaving(true);
    try {
      const supplier = suppliers.find((s) => s.name === form.supplierName);
      const company = companies.find((c) => c.name === form.companyName);
      const project = allProjects.find((p) => p.name === form.projectName);
      const subtotal = items.reduce((s, r) => s + r.quantity * r.rate, 0);
      const totalTax = items.reduce(
        (s, r) => s + (r.quantity * r.rate * r.tax) / 100,
        0,
      );
      const effectiveTaxRate = subtotal > 0 ? (totalTax / subtotal) * 100 : 0;
      const grandTotal = computeBreakdown(
        subtotal,
        effectiveTaxRate,
        0,
        form.discount,
      ).netAmount;

      const payload: CreatePOPayload = {
        PurchaseOrderNo: form.poNumber || null,
        PODate: form.poDate || null,
        ExpectedDeliveryDate: form.expectedDate || null,
        SupplierID: supplier?.id ?? null,
        CompanyId: company?.id ?? null,
        ProjectId: project?.id ?? null,
        POItems: items,
        TotalAmount: grandTotal,
        PaymentTerms: form.paymentTerms || null,
        Status: form.status || "Draft",
        Remarks: form.remarks || null,
        DocTypeId: form.docTypeId ?? null,
        DocNo: form.poNumber || form.docNo || null,
        finYear: selectedFinYear || null,
        Discount: form.discount,
      };

      if (panelMode === "edit" && editId) {
        await updatePurchaseOrder(editId, payload);
        toast.success("Purchase Order updated!");
      } else {
        await addPurchaseOrder(payload);
        toast.success("Purchase Order created!");
        await refreshDocNumber();
      }

      await refetch();
      setPage(1);
      setPanelMode(null);
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this Purchase Order?")) return;
    try {
      await deletePurchaseOrder(id);
      await refetch();
      setPage(1);
      toast.success("Purchase Order deleted.");
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (isLoading)
    return (
      <div className="p-6 text-muted-foreground">Loading purchase orders…</div>
    );
  if (error)
    return (
      <div className="p-6 text-destructive">
        Failed to load purchase orders.
      </div>
    );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "Purchase Order Master"]} />

      {/* Page header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-heading font-bold text-foreground">
          Purchase Order Master
        </h1>
        <button
          onClick={openAdd}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + New PO
        </button>
      </div>

      {/* List table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/60 text-muted-foreground text-xs uppercase tracking-wide border-b border-border">
                {[
                  "PO No",
                  "Date",
                  "Supplier",
                  "Project / Site",
                  "Items",
                  "Amount",
                  "Status",
                  "",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left font-medium first:rounded-tl-xl last:rounded-tr-xl"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {dbItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    No purchase orders found.
                  </td>
                </tr>
              ) : (
                dbItems.map((item: any) => {
                  const supplierName =
                    suppliers.find((s) => s.id === item.SupplierID)?.name ??
                    item.SupplierName ??
                    "—";
                  const projectName =
                    allProjects.find((p) => p.id === item.ProjectId)?.name ??
                    item.ProjectName ??
                    "—";
                  const itemCount = Array.isArray(item.POItems)
                    ? item.POItems.length
                    : item.ItemDescription
                    ? 1
                    : 0;

                  return (
                    <tr
                      key={item.PurchaseOrderID}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-medium">
                        {item.PurchaseOrderNo || item.DocNo || "—"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {fmtDate(item.PODate)}
                      </td>
                      <td className="px-4 py-3">{supplierName}</td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                        {projectName}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                        {itemCount > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                            {itemCount} {itemCount === 1 ? "item" : "items"}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums">
                        ₹
                        {Number(item.TotalAmount ?? 0).toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusBadge status={String(item.Status ?? "")} />
                          <ApprovalActions
                            status={String(item.Status ?? "")}
                            recordId={String(item.PurchaseOrderID)}
                            endpoint="/api/purchase-orders"
                            onSuccess={refetch}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEdit(item)}
                            className="rounded px-2.5 py-1 text-xs border border-border hover:bg-muted transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() =>
                              handleDelete(String(item.PurchaseOrderID))
                            }
                            className="rounded px-2.5 py-1 text-xs border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            Del
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm">
        <span className="text-muted-foreground">
          Page {page} of {totalPages} ({totalRecords} records)
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
            disabled={page <= 1}
            className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
            disabled={page >= totalPages}
            className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {/* Slide-over form panel */}
      {panelMode && (
        <POForm
          mode={panelMode}
          editId={editId}
          initialForm={panelMode === "edit" ? editForm : EMPTY_FORM}
          items={panelMode === "edit" ? editItems : []}
          suppliers={suppliers}
          companies={companies}
          allProjects={allProjects}
          uoms={uoms}
          finYears={finYears}
          selectedFinYear={selectedFinYear}
          onFinYearChange={(fy) => {
            setSelectedFinYear(fy);
            if (poDocTypeId) void refreshDocNumber(poDocTypeId, fy);
          }}
          poDocTypeId={poDocTypeId}
          poDocNo={poDocNo}
          docRefreshTrigger={docRefreshTrigger}
          onDocSelect={applyDocNumber}
          onSave={handleSave}
          onCancel={() => setPanelMode(null)}
          saving={saving}
        />
      )}
    </>
  );
};

export default PurchaseOrderMaster;
