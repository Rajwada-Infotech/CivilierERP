import React, { useEffect, useState } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { safeHtml } from "@/utils/escapeHtml";
import {
  MasterPage,
  FieldDef,
  ColumnDef,
  RecordWithId,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import {
  FileWarning,
  Percent,
  IndianRupee,
  Receipt,
  CheckCircle2,
  ChevronDown,
  Plus,
  Trash2,
} from "lucide-react";
import { MaterialShell } from "@/components/material/MaterialShell";

// ─── Line Item types & renderer ───────────────────────────────────────────────
interface DebitNoteItem {
  Description: string;
  Quantity: string;
  UOMSymbol: string;
  Rate: string;
  Amount: string;
}

const emptyItem = (): DebitNoteItem => ({
  Description: "", Quantity: "", UOMSymbol: "", Rate: "", Amount: "",
});

function calcAmount(qty: string, rate: string): string {
  const q = parseFloat(qty), r = parseFloat(rate);
  if (!isNaN(q) && !isNaN(r)) return (q * r).toFixed(2);
  return "";
}

function ItemsRenderer({ value, onChange }: { value: DebitNoteItem[]; onChange: (v: DebitNoteItem[]) => void }) {
  const items: DebitNoteItem[] = Array.isArray(value) && value.length ? value : [emptyItem()];

  const update = (idx: number, field: keyof DebitNoteItem, val: string) => {
    const next = items.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [field]: val };
      if (field === "Quantity" || field === "Rate")
        updated.Amount = calcAmount(
          field === "Quantity" ? val : it.Quantity,
          field === "Rate" ? val : it.Rate,
        );
      return updated;
    });
    onChange(next);
  };

  const addRow = () => onChange([...items, emptyItem()]);
  const removeRow = (idx: number) => {
    const next = items.filter((_, i) => i !== idx);
    onChange(next.length ? next : [emptyItem()]);
  };

  const total = items.reduce((s, it) => s + (parseFloat(it.Amount) || 0), 0);
  const thCls = "text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 py-1.5";
  const inp = "w-full text-xs rounded border border-border px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/30";

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 border-b border-border">
            <tr>
              <th className={thCls + " w-6 hidden sm:table-cell"}>#</th>
              <th className={thCls}>Description *</th>
              <th className={thCls + " w-16"}>Qty</th>
              <th className={thCls + " w-14 hidden sm:table-cell"}>UOM</th>
              <th className={thCls + " w-20"}>Rate</th>
              <th className={thCls + " w-20"}>Amount</th>
              <th className={thCls + " w-6"}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx} className="border-b border-border/50">
                <td className="px-2 py-1 text-muted-foreground text-center hidden sm:table-cell">{idx + 1}</td>
                <td className="px-2 py-1">
                  <input className={inp} value={it.Description} onChange={(e) => update(idx, "Description", e.target.value)} placeholder="Item / description" />
                </td>
                <td className="px-2 py-1">
                  <input className={inp + " text-right"} type="number" value={it.Quantity} onChange={(e) => update(idx, "Quantity", e.target.value)} placeholder="0" step="any" min={0} />
                </td>
                <td className="px-2 py-1 hidden sm:table-cell">
                  <input className={inp} value={it.UOMSymbol} onChange={(e) => update(idx, "UOMSymbol", e.target.value)} placeholder="Nos" />
                </td>
                <td className="px-2 py-1">
                  <input className={inp + " text-right"} type="number" value={it.Rate} onChange={(e) => update(idx, "Rate", e.target.value)} placeholder="0.00" step="any" min={0} />
                </td>
                <td className="px-2 py-1">
                  <input className={inp + " text-right bg-muted/30"} value={it.Amount} onChange={(e) => update(idx, "Amount", e.target.value)} placeholder="0.00" />
                </td>
                <td className="px-2 py-1 text-center">
                  <button type="button" onClick={() => removeRow(idx)} className="p-1 rounded text-red-400 hover:bg-red-500/10">
                    <Trash2 size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-muted/20">
            <tr>
              <td colSpan={4} className="px-2 py-1.5 text-right text-xs font-semibold text-muted-foreground">Total</td>
              <td className="hidden sm:table-cell" />
              <td className="px-2 py-1.5 text-right text-xs font-bold text-foreground">
                ₹{total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <button type="button" onClick={addRow} className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700 font-medium">
        <Plus size={13} /> Add Row
      </button>
    </div>
  );
}
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDebitNotes,
  addDebitNote,
  updateDebitNote,
  deleteDebitNote,
} from "@/api/debitNoteApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { toast } from "sonner";
import { useFinYear } from "@/contexts/FinYearContext";

// ─── Types ────────────────────────────────────────────────────────────────────
interface DbDebitNote {
  id: number;
  company_id: number | null;
  project_id: number | null;
  supplier_id: number | null;
  bill_id: number | null;
  is_active: boolean | null;
}

interface BillDiscountGroup {
  billNumber: string;
  billAmount: number | null;
  discMode: "percent" | "amount";
  discPercent: string;
  discAmount: string;
  finalAmount: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function labelById(
  options: { id: number; label: string }[],
  id: number | null,
) {
  return options.find((o) => o.id === id)?.label ?? "—";
}

function idByLabel(options: { id: number; label: string }[], label: string) {
  return options.find((o) => o.label === label)?.id ?? null;
}

function formatINR(amount: number): string {
  return amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ─── Bill & Discount Renderer ─────────────────────────────────────────────────
const EMPTY_GROUP: BillDiscountGroup = {
  billNumber: "",
  billAmount: null,
  discMode: "percent",
  discPercent: "",
  discAmount: "",
  finalAmount: null,
};

function computeFinal(g: BillDiscountGroup): number | null {
  if (g.billAmount === null) return null;
  let disc = 0;
  if (g.discMode === "percent") {
    const pct = parseFloat(g.discPercent);
    if (!isNaN(pct) && pct >= 0) disc = (g.billAmount * pct) / 100;
  } else {
    const amt = parseFloat(g.discAmount);
    if (!isNaN(amt) && amt >= 0) disc = amt;
  }
  return Math.max(0, g.billAmount - disc);
}

function makeBillRenderer(
  billOptions: any[],
  onOptionSelect?: (opt: any) => void,
) {
  const regularOptions = billOptions.filter((b) => b.type !== "emi");
  const emiOptions = billOptions.filter((b) => b.type === "emi");

  return function BillDiscountRenderer({ value, onChange, error }: any) {
    const group: BillDiscountGroup =
      value && typeof value === "object"
        ? (value as BillDiscountGroup)
        : { ...EMPTY_GROUP };

    const selectedOption = billOptions.find(
      (b) => b.value === group.billNumber || b.id === group.billNumber,
    );

    const update = (patch: Partial<BillDiscountGroup>) => {
      const next = { ...group, ...patch };
      next.finalAmount = computeFinal(next);
      onChange(next);
    };

    const handleBillSelect = (billValue: string) => {
      if (!billValue) {
        update({
          billNumber: "",
          billAmount: null,
          discPercent: "",
          discAmount: "",
          finalAmount: null,
        });
        onOptionSelect?.(null);
        return;
      }
      const opt = billOptions.find(
        (b) => b.value === billValue || b.id === billValue,
      );
      update({
        billNumber: billValue,
        billAmount: opt?.amount ?? null,
        discPercent: "",
        discAmount: "",
        finalAmount: opt?.amount ?? null,
      });
      onOptionSelect?.(opt ?? null);
    };

    const hasBill = !!group.billNumber;
    const discountValue =
      group.discMode === "percent" && group.discPercent && group.billAmount
        ? (group.billAmount * parseFloat(group.discPercent)) / 100
        : group.discMode === "amount" && group.discAmount
          ? parseFloat(group.discAmount)
          : 0;

    const hasDiscount =
      hasBill && discountValue > 0 && group.billAmount !== null;

    return (
      <div className="space-y-4">
        <div>
          <div className="relative">
            <Receipt
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <select
              value={group.billNumber}
              onChange={(e) => handleBillSelect(e.target.value)}
              className={`w-full appearance-none pl-8 pr-8 py-2 rounded-lg text-sm font-body bg-muted border transition-all
                focus:outline-none focus:ring-2 focus:ring-primary text-foreground
                ${error && !group.billNumber ? "border-destructive" : "border-border"}`}
            >
              <option value="">Select expense document…</option>

              {regularOptions.length > 0 && (
                <optgroup label="── Expense Bookings (unpaid)">
                  {regularOptions.map((b: any) => (
                    <option key={b.id} value={b.value || b.id}>
                      {b.label}
                    </option>
                  ))}
                </optgroup>
              )}

              {emiOptions.length > 0 && (
                <optgroup label="── EMI Installments (pending)">
                  {emiOptions.map((b: any) => (
                    <option key={b.id} value={b.value || b.id}>
                      {b.label}
                    </option>
                  ))}
                </optgroup>
              )}

              {billOptions.length === 0 && (
                <option disabled value="">
                  No unpaid expense bookings found
                </option>
              )}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
          </div>

          {/* Show selected option details */}
          {selectedOption && (
            <p className="text-[11px] text-muted-foreground mt-1 pl-1">
              {selectedOption.type === "emi"
                ? `EMI Installment #${selectedOption.installmentNo} · Parent: ${selectedOption.parentDocNo} · Due: ${selectedOption.dueDate ?? "—"}`
                : `Doc: ${selectedOption.docNo} · Project: ${selectedOption.projectName}`}
            </p>
          )}
        </div>

        {hasBill && (
          <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-2">
                Apply Discount
              </p>
              <div className="flex gap-2 mb-3">
                {(["percent", "amount"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() =>
                      update({ discMode: m, discPercent: "", discAmount: "" })
                    }
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading border transition-all ${
                      group.discMode === m
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-card text-muted-foreground border-border hover:border-primary/50"
                    }`}
                  >
                    {m === "percent" ? (
                      <>
                        <Percent size={11} /> By Percentage
                      </>
                    ) : (
                      <>
                        <IndianRupee size={11} /> By Amount
                      </>
                    )}
                  </button>
                ))}
              </div>

              {group.discMode === "percent" ? (
                <div className="relative">
                  <Percent
                    size={13}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={group.discPercent}
                    onChange={(e) =>
                      update({
                        discMode: "percent",
                        discPercent: e.target.value,
                        discAmount: "",
                      })
                    }
                    placeholder="Enter discount %"
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm font-body bg-card border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground transition-all"
                  />
                </div>
              ) : (
                <div className="relative">
                  <IndianRupee
                    size={13}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={group.discAmount}
                    onChange={(e) =>
                      update({
                        discMode: "amount",
                        discAmount: e.target.value,
                        discPercent: "",
                      })
                    }
                    placeholder="Enter discount amount"
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm font-body bg-card border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground transition-all"
                  />
                </div>
              )}

              {hasDiscount && (
                <div className="flex items-center justify-between mt-2 px-1">
                  <span className="text-[11px] text-muted-foreground">
                    Discount applied
                  </span>
                  <span className="text-[12px] font-mono text-destructive font-semibold">
                    − ₹{formatINR(discountValue)}
                  </span>
                </div>
              )}
            </div>

            {group.finalAmount !== null && (
              <div className="border-t border-border/60 pt-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-primary" />
                    <span className="text-[11px] uppercase tracking-widest font-heading text-primary font-semibold">
                      Final Amount
                    </span>
                  </div>
                  <span className="text-xl font-heading font-bold flex items-center gap-1 text-primary">
                    <IndianRupee size={16} />
                    {formatINR(group.finalAmount)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────
const DebitNoteMaster: React.FC = () => {
  const rights = usePageRights("debit-note");
  const queryClient = useQueryClient();
  const { finYears } = useFinYear();
  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year || undefined;
  const [selectedFinYear, setSelectedFinYear] = useState<string | null>(null);
  const [autoFillPatch, setAutoFillPatch] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [autoFillPatchKey, setAutoFillPatchKey] = useState(0);

  // Only auto-set once on first load, never override user's explicit selection
  useEffect(() => {
    if (selectedFinYear === null && activeFinYear) {
      setSelectedFinYear(activeFinYear);
    }
  }, [activeFinYear]); // eslint-disable-line react-hooks/exhaustive-deps

  // Data Queries
  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["debit-notes"],
    queryFn: getDebitNotes,
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const { data: companyData } = useQuery({
    queryKey: ["enterprises-companies"],
    queryFn: () =>
      fetchWithAuth("/api/enterprises/options?business_type=C").then((r) =>
        r.json().catch(() => ({})),
      ),
    staleTime: 5 * 60 * 1000,
  });

  const { data: projectData } = useQuery({
    queryKey: ["enterprises-projects"],
    queryFn: () =>
      fetchWithAuth("/api/enterprises/options?business_type=P").then((r) =>
        r.json().catch(() => ({})),
      ),
    staleTime: 5 * 60 * 1000,
  });

  const { data: accountHeadData } = useQuery({
    queryKey: ["supplier-head-options"],
    queryFn: () =>
      fetchWithAuth("/api/account-head/options?type=S").then((r) => r.json().catch(() => ({}))),
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: expenseData,
    refetch: refetchExpenses,
    error: expenseError,
  } = useQuery({
    queryKey: ["expense-booking-options", selectedFinYear ?? ""],
    queryFn: async () => {
      const url = selectedFinYear
        ? `/api/expense-booking/options?finYear=${encodeURIComponent(selectedFinYear)}`
        : "/api/expense-booking/options";
      const r = await fetchWithAuth(url);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(
          body.error || `Failed to load expense options (${r.status})`,
        );
      }
      return r.json().catch(() => ({}));
    },
    enabled: selectedFinYear !== null,
    staleTime: 0,
    refetchOnMount: true,
  });

  // Options
  const COMPANY_OPTIONS: { id: number; label: string }[] = Array.isArray(
    companyData,
  )
    ? companyData
        .map((o: any) => ({ id: o.id, label: o.label ?? o.name ?? "" }))
        .filter((o) => o.label)
    : [];

  const PROJECT_OPTIONS: { id: number; label: string }[] = Array.isArray(
    projectData,
  )
    ? projectData
        .map((o: any) => ({ id: o.id, label: o.label ?? o.name ?? "" }))
        .filter((o) => o.label)
    : [];

  const SUPPLIER_OPTIONS: { id: number; label: string }[] = Array.isArray(
    accountHeadData,
  )
    ? accountHeadData
    : [];

  // Normalise each expense option so auto-fill works regardless of whether the
  // backend returns camelCase (supplierId) or snake_case (supplier_id) fields.
  const BILL_OPTIONS: any[] = Array.isArray(expenseData)
    ? expenseData.map((b: any) => ({
        ...b,
        supplierId: b.supplierId ?? b.supplier_id ?? null,
        projectId: b.projectId ?? b.project_id ?? null,
        companyId: b.companyId ?? b.company_id ?? null,
      }))
    : [];

  // Lookup Function
  const billIdByValue = (selectedValue: string) =>
    BILL_OPTIONS.find(
      (b: any) => b.value === selectedValue || String(b.id) === selectedValue,
    )?.id ?? null;

  // Map DB data to UI
  const mappedData: RecordWithId[] = Array.isArray(dbData)
    ? dbData.map((item: any) => ({
        _id: String(item.id),
        company: labelById(COMPANY_OPTIONS, item.company_id),
        project: labelById(PROJECT_OPTIONS, item.project_id),
        supplier: labelById(SUPPLIER_OPTIONS, item.supplier_id),
        billDiscountGroup: {
          billNumber: (() => {
            const found = BILL_OPTIONS.find((b: any) => b.id === item.bill_id);
            return found ? (found.value ?? String(found.id)) : "";
          })(),
          billAmount: null,
          discMode: "percent",
          discPercent: "",
          discAmount: "",
          finalAmount: null,
        } as BillDiscountGroup,
        status: Boolean(item.is_active),
        items: Array.isArray(item.items)
          ? item.items.map((i: any) => ({
              Description: i.Description || "",
              Quantity: String(i.Quantity ?? ""),
              UOMSymbol: i.UOMSymbol || "",
              Rate: String(i.Rate ?? ""),
              Amount: String(i.Amount ?? ""),
            }))
          : [],
        docTypeId: item.doc_type_id ?? null,
        docNo: item.doc_no ?? "",
        docTypePrefix: item.doc_type_prefix ?? "",
        createdBy: (() => {
          const name = item.created_by_name ?? null;
          const role = item.created_by_role ?? null;
          if (!name) return null;
          return role ? `${name} (${role})` : name;
        })(),
        updatedBy: item.updated_by_name ?? item.updated_by ?? null,
        createdAt: item.created_at ?? null,
      }))
    : [];

  // Convert form to payload
  const toPayload = (formData: Record<string, unknown>) => {
    const g = formData.billDiscountGroup as BillDiscountGroup | undefined;
    const rawItems = formData.items as DebitNoteItem[] | undefined;
    const items = (rawItems ?? []).filter((it) => it.Description.trim());
    return {
      company_id: idByLabel(COMPANY_OPTIONS, formData.company as string),
      project_id: idByLabel(PROJECT_OPTIONS, formData.project as string),
      supplier_id: idByLabel(SUPPLIER_OPTIONS, formData.supplier as string),
      bill_id: g?.billNumber ? billIdByValue(g.billNumber) : null,
      is_active: formData.status !== false,
      finYear: selectedFinYear || null,
      items,
    };
  };

  const handleCustomSave = (formData: Record<string, unknown>) => {
    const g = formData.billDiscountGroup as BillDiscountGroup | undefined;
    if (!g?.billNumber) return null;
    return { ...formData, status: formData.status ?? true };
  };

  // Handle Add/Update/Delete
  const handleDataEvent = async (event: any) => {
    if (event.action === "add") {
      try {
        await addDebitNote(toPayload(event.record));
        await queryClient.invalidateQueries({ queryKey: ["debit-notes"] });
        toast.success("Debit note saved!");
        await refetchExpenses();
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
        throw err;
      }
    }
    if (event.action === "update") {
      try {
        await updateDebitNote(Number(event.id), toPayload(event.record));
        toast.success("Debit note updated!");
        await refetchExpenses();
        await queryClient.invalidateQueries({ queryKey: ["debit-notes"] });
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
        throw err;
      }
    }
    if (event.action === "delete") {
      try {
        await deleteDebitNote(Number(event.id));
        toast.success("Debit note deleted!");
        await queryClient.invalidateQueries({ queryKey: ["debit-notes"] });
      } catch (err: any) {
        toast.error("Delete failed: " + err.message);
        throw err;
      }
    }
    return undefined;
  };

  const handleBillOptionSelect = (opt: any) => {
    if (!opt) {
      setAutoFillPatch({ company: "", project: "", supplier: "" });
      setAutoFillPatchKey((k) => k + 1);
      return;
    }

    const patch: Record<string, unknown> = {};

    if (opt.companyId != null) {
      const matched = COMPANY_OPTIONS.find(
        (c) => c.id === Number(opt.companyId),
      );
      patch.company = matched ? matched.label : "";
    }

    if (opt.projectId != null) {
      const matched = PROJECT_OPTIONS.find(
        (p) => p.id === Number(opt.projectId),
      );
      patch.project = matched ? matched.label : "";
    } else if (opt.projectName) {
      const matched = PROJECT_OPTIONS.find(
        (p) =>
          p.label.toLowerCase() === (opt.projectName as string).toLowerCase(),
      );
      patch.project = matched ? matched.label : "";
    } else {
      patch.project = "";
    }

    if (opt.supplierId != null) {
      const matched = SUPPLIER_OPTIONS.find(
        (s) => s.id === Number(opt.supplierId),
      );
      patch.supplier = matched ? matched.label : "";
    } else {
      patch.supplier = "";
    }

    setAutoFillPatch(patch);
    setAutoFillPatchKey((k) => k + 1);
  };

  const BillDiscountRenderer = makeBillRenderer(
    BILL_OPTIONS,
    handleBillOptionSelect,
  );

  const fields: FieldDef[] = [
    {
      name: "referenceSection",
      label: "Reference",
      type: "section",
    },
    {
      name: "billDiscountGroup",
      label: "Expense Booking / Bill",
      type: "custom",
      required: true,
      fullWidth: true,
      render: BillDiscountRenderer as FieldDef["render"],
    },
    {
      name: "partiesSection",
      label: "Company, Project & Supplier",
      type: "section",
    },
    {
      name: "supplier",
      label: "Supplier",
      type: "select",
      required: true,
      options: SUPPLIER_OPTIONS.map((o) => o.label),
    },
    { name: "status", label: "Status", type: "toggle", defaultValue: true },
    {
      name: "company",
      label: "Company",
      type: "select",
      required: true,
      options: COMPANY_OPTIONS.map((o) => o.label),
    },
    {
      name: "project",
      label: "Project",
      type: "select",
      required: true,
      options: PROJECT_OPTIONS.map((o) => o.label),
    },
    {
      name: "itemsSection",
      label: "Line Items",
      type: "section",
    },
    {
      name: "items",
      label: "",
      type: "custom",
      fullWidth: true,
      render: ({ value, onChange }: any) => (
        <ItemsRenderer value={value as DebitNoteItem[]} onChange={onChange} />
      ),
    },
  ];

  const columns: ColumnDef[] = [
    { key: "supplier", label: "Supplier" },
    { key: "company", label: "Company", hideOnMobile: true },
    { key: "project", label: "Project", hideOnMobile: true },
    { key: "billDiscountGroup", label: "Bill / Doc", hideOnMobile: true },
    { key: "discountDisplay", label: "Discount", hideOnMobile: true },
    { key: "createdBy", label: "Created By", hideOnMobile: true },
    { key: "status", label: "Status" },
  ];

  const columnRenderers: Record<string, any> = {
    docNo: (value: unknown) =>
      value ? (
        <span className="font-mono text-xs text-primary">{String(value)}</span>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      ),
    billDiscountGroup: billDiscountColumnRenderer,
    createdBy: (value: unknown) =>
      value ? (
        <span className="text-xs text-foreground font-body">
          {String(value)}
        </span>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      ),
    discountDisplay: (_value: unknown, row: RecordWithId) =>
      discountSummaryRenderer(row.billDiscountGroup),
    status: (value: boolean) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${
          value
            ? "bg-green-500/10 border-green-500/20 text-green-600"
            : "bg-red-500/10 border-red-500/20 text-red-600"
        }`}
      >
        {value ? "Active" : "Inactive"}
      </span>
    ),
  };

  function billDiscountColumnRenderer(value: unknown) {
    const g = value as BillDiscountGroup | undefined;
    if (!g?.billNumber)
      return <span className="text-muted-foreground text-xs">—</span>;
    const opt = BILL_OPTIONS.find(
      (b: any) => b.value === g.billNumber || String(b.id) === g.billNumber,
    );
    const displayLabel = opt?.label ?? g.billNumber;
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-mono text-foreground">
          {displayLabel}
        </span>
        {opt?.projectName && (
          <span className="text-[10px] text-muted-foreground">
            {opt.projectName}
          </span>
        )}
      </div>
    );
  }

  function discountSummaryRenderer(value: unknown) {
    const g = value as BillDiscountGroup | undefined;
    if (!g?.billNumber)
      return <span className="text-muted-foreground text-xs">—</span>;
    return (
      <span className="text-xs text-muted-foreground">Discount Applied</span>
    );
  }

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return (
      <div className="p-6 text-red-500">
        Failed to load debit notes. Check backend connection.
      </div>
    );

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Finance Module", "Debit Note Master"]}
      />
      <MaterialShell
        title="Debit Note Master"
        subtitle="Manage debit notes against expense bookings"
        icon={FileWarning}
      >
      {expenseError && (
        <div className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
          ⚠️ Could not load expense documents: {(expenseError as Error).message}
          . Bill dropdown will be empty.
        </div>
      )}
      <div className="rounded-xl bg-card border border-border p-4">
        <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground mb-2">
          Financial Year
        </label>
        <div className="relative">
          <select
            value={selectedFinYear ?? ""}
            onChange={(e) => setSelectedFinYear(e.target.value || "")}
            className="w-full appearance-none rounded-lg border border-border bg-muted px-3 py-2 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">— All Years —</option>
            {finYears
              .filter((fy) => fy.status === "Active" && !fy.locked)
              .sort((a, b) => b.year.localeCompare(a.year))
              .map((fy) => (
              <option key={fy.id} value={fy.year}>
                {fy.year}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
        </div>
        {selectedFinYear ? (
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Showing unpaid expense bookings for{" "}
            <span className="font-semibold text-foreground">
              {selectedFinYear}
            </span>
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Showing unpaid expense bookings across{" "}
            <span className="font-semibold text-foreground">all years</span>
          </p>
        )}
      </div>
      <MasterPage
        title="Debit Note"
        fields={fields}
        columns={columns}
        columnRenderers={columnRenderers}
        initialData={mappedData}
        onCustomSave={handleCustomSave}
        onDataEvent={handleDataEvent}
        externalFormPatch={autoFillPatch}
        externalFormPatchKey={autoFillPatchKey}
        exportConfig={rights.canExport ? {
          title: "Debit Note Master",
          filename: "debit-note-master",
          columns: [
            { header: "Company", accessor: "company" },
            { header: "Project", accessor: "project" },
            { header: "Supplier", accessor: "supplier" },
            { header: "Bill/Doc", accessor: "billDiscountGroup" },
            { header: "Discount", accessor: "discountDisplay" },
            { header: "Created By", accessor: "createdBy" },
            { header: "Status", accessor: "status" },
          ],
        } : undefined}
        viewConfig={{
          title: "Debit Note Details",
          fields: [
            { key: "company", label: "Company" },
            { key: "project", label: "Project" },
            { key: "supplier", label: "Supplier" },
            { key: "billDiscountGroup", label: "Bill / Doc" },
            { key: "discountDisplay", label: "Discount" },
            { key: "createdBy", label: "Created By" },
            { key: "status", label: "Status" },
          ],
        }}
        onPrint={(row) => {
          const win = window.open("", "_blank", "width=700,height=550");
          if (!win) return;
          win.document.write(safeHtml`
            <html><head><title>Debit Note</title>
            <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
            </head><body>
            <h2>Debit Note</h2>
            <table>
              <tr><td>Company</td><td>${row.company || "—"}</td></tr>
              <tr><td>Project</td><td>${row.project || "—"}</td></tr>
              <tr><td>Supplier</td><td>${row.supplier || "—"}</td></tr>
              <tr><td>Bill / Doc</td><td>${row.billDiscountGroup || "—"}</td></tr>
              <tr><td>Discount</td><td>${row.discountDisplay || "—"}</td></tr>
              <tr><td>Created By</td><td>${row.createdBy || "—"}</td></tr>
              <tr><td>Status</td><td>${row.status ? "Active" : "Inactive"}</td></tr>
            </table>
            </body></html>
          `);
          win.document.close();
          win.print();
        }}
      />
      </MaterialShell>
    </>
  );
};

export default DebitNoteMaster;