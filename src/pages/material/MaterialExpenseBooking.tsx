import React, { useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useFinYear } from "@/contexts/FinYearContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Plus,
  Edit,
  Trash2,
  ArrowLeft,
  Receipt,
  Building2,
  CalendarDays,
  FileText,
  BadgePercent,
  CreditCard,
  StickyNote,
  CheckCircle2,
  Clock,
  AlertCircle,
  TrendingUp,
  FolderKanban,
  User2,
} from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";

// ─── Sub-components ───────────────────────────────────────────────────────────
import {
  FormSection,
  Field,
  PriceBreakdownPanel,
} from "./ExpenseBooking/FormPrimitives";
import { BillingAccordion } from "./ExpenseBooking/BillingAccordion";
import { EmiSection } from "./ExpenseBooking/EmiSection";
import {
  DocNumberPreview,
  fetchNextDocNumber,
} from "./ExpenseBooking/DocNumberPreview";
import { ApprovalTrailPanel } from "./ExpenseBooking/ApprovalTrailPanel";
import { RecordCard } from "./ExpenseBooking/RecordCard";
import {
  blankForm,
  computeBreakdown,
  dbToRecord,
  defaultEmi,
  fmt,
  recordToDb,
} from "./ExpenseBooking/helpers";
import type {
  BookingStatus,
  ExpenseRecord,
  PageView,
} from "./ExpenseBooking/types";

// ─── API ──────────────────────────────────────────────────────────────────────

const API = "/api/expense-booking";

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetchWithAuth(url, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Master option types ───────────────────────────────────────────────────────

interface CompanyOption {
  id: number;
  label: string;
}

interface ProjectOption {
  id: number;
  label: string;
}

interface SupplierOption {
  id: number;
  label: string;
}

// ─── Section icon map ──────────────────────────────────────────────────────────

const SECTION_ICONS: Record<string, React.ElementType> = {
  "Document Numbering": FileText,
  "Booking Information": CalendarDays,
  "Amount & GST": BadgePercent,
  "Billing Terms": Receipt,
  "EMI / Installment Options": CreditCard,
  "Approval Workflow": CheckCircle2,
  Remarks: StickyNote,
};

function SectionHeader({ label }: { label: string }) {
  const Icon = SECTION_ICONS[label];
  return (
    <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
      {Icon && (
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
          <Icon size={12} className="text-primary" />
        </div>
      )}
      <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MaterialExpenseBooking() {
  const { finYears } = useFinYear();
  const activeFinYears = finYears.filter((fy) => fy.status === "Active");

  // ── Master lists fetched from their respective APIs ──────────────────────────
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<SupplierOption[]>([]);

  const [records, setRecords] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<PageView>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<ExpenseRecord, "id">>(blankForm());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedDocTypeId, setSelectedDocTypeId] = useState<number | null>(
    null,
  );
  const [docNumberPreview, setDocNumberPreview] = useState("");
  const [docRefreshTrigger, setDocRefreshTrigger] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [approvalTrail, setApprovalTrail] =
    useState<ExpenseRecord["approvalTrail"]>(undefined);

  const fetchRecords = React.useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch(`${API}?limit=100`);
      setRecords((data.data ?? []).map(dbToRecord));
    } catch (err: any) {
      toast.error("Failed to load bookings: " + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchApprovalTrail = async (recordId: string) => {
    try {
      const data = await apiFetch(`${API}/${recordId}/approval-trail`);
      setApprovalTrail(data);
    } catch {
      setApprovalTrail(undefined);
    }
  };

  // ── Fetch masters in parallel on mount ────────────────────────────────────────
  React.useEffect(() => {
    fetchRecords();

// Company master: enterprise where business_type = 'C'
    apiFetch("/api/enterprises/options?business_type=C")
      .then((list: CompanyOption[]) => setCompanyOptions(list ?? []))
      .catch(() => {});

    // Project master: enterprise where business_type = 'P'
    apiFetch("/api/enterprises/options?business_type=P")
      .then((list: ProjectOption[]) => setProjectOptions(list ?? []))
      .catch(() => {});

// Supplier master: AccountHeadMaster options (filtered by type=S for suppliers)
    apiFetch("/api/account-head/options?type=S")
      .then((list: SupplierOption[]) => setSupplierOptions(list ?? []))
      .catch(() => {});
  }, [fetchRecords]);

  const set = <K extends keyof Omit<ExpenseRecord, "id">>(
    field: K,
    value: Omit<ExpenseRecord, "id">[K],
  ) => setForm((prev) => ({ ...prev, [field]: value }));

  const openNew = () => {
    setEditingId(null);
    setForm({ ...blankForm(), financialYear: activeFinYears[0]?.year || "" });
    setSelectedDocTypeId(null);
    setDocNumberPreview("");
    setApprovalTrail(undefined);
    setView("form");
  };

  const openEdit = (rec: ExpenseRecord) => {
    setEditingId(rec.id);
    const { id, ...rest } = rec;
    setForm(rest);
    setSelectedDocTypeId(null);
    setDocNumberPreview(rec.bookingReference);
    fetchApprovalTrail(rec.id);
    setView("form");
  };

  const cancelForm = () => {
    setView("list");
    setEditingId(null);
    setForm(blankForm());
    setApprovalTrail(undefined);
  };

  const handleDocTypeSelect = (docTypeId: number | null, preview: string) => {
    setSelectedDocTypeId(docTypeId);
    const fy = form.financialYear;
    const finalPreview =
      preview && fy && !preview.includes(fy) ? `${preview}/${fy}` : preview;
    setDocNumberPreview(finalPreview);
    if (finalPreview) set("bookingReference", finalPreview);
  };

  const handleSave = async () => {
    if (!form.bookingReference.trim() || !form.bookingDate) {
      toast.error("Booking reference and date are required.");
      return;
    }
    if (!form.companyId) {
      toast.error("Please select a company.");
      return;
    }
    const bd = computeBreakdown(
      form.basicAmount,
      form.cgstRate,
      form.sgstRate,
      form.discount,
    );
    const body = recordToDb(
      form,
      bd.netAmount,
      editingId ? null : selectedDocTypeId,
    );

    try {
      setSaving(true);
      if (editingId) {
        await apiFetch(`${API}/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        toast.success("Expense booking updated.");
        cancelForm();
      } else {
        const result = await apiFetch(API, {
          method: "POST",
          body: JSON.stringify(body),
        });
        const confirmedDocNo = result?.docNo || form.bookingReference;
        toast.success(`Expense booking created — Ref: ${confirmedDocNo}`);
        await fetchRecords();
        if (selectedDocTypeId) {
          const nextDocNo = await fetchNextDocNumber(
            selectedDocTypeId,
            form.financialYear || undefined,
          );
          setForm({
            ...blankForm(),
            bookingReference: nextDocNo,
            financialYear: form.financialYear,
          });
          setDocNumberPreview(nextDocNo);
          setDocRefreshTrigger((c) => c + 1);
        } else {
          cancelForm();
        }
        return;
      }
      await fetchRecords();
    } catch (err: any) {
      toast.error("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`${API}/${id}`, { method: "DELETE" });
      setDeleteId(null);
      toast.success("Booking deleted.");
      await fetchRecords();
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
  };

  const bd = computeBreakdown(
    form.basicAmount,
    form.cgstRate,
    form.sgstRate,
    form.discount,
  );

  const ALL_STATUSES = [
    "All",
    "Draft",
    "Pending",
    "Approved",
    "Rejected",
    "Booked",
    "Hold",
    "Received",
  ] as const;

  const filteredRecords =
    statusFilter && statusFilter !== "All"
      ? records.filter((r) => r.status === statusFilter)
      : records;

  // ── Summary stats ────────────────────────────────────────────────────────────
  const totalNet = records.reduce((s, r) => s + (r.netAmount ?? 0), 0);
  const approvedCount = records.filter((r) => r.status === "Approved").length;
  const pendingCount = records.filter((r) => r.status === "Pending").length;
  const emiCount = records.filter((r) => r.emi?.enabled).length;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "Expense Booking"]} />
      <div className="space-y-5">
        {/* ── Page Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Expense Booking
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Record and manage material expense bookings with EMI tracking
            </p>
          </div>
          {view === "list" && (
            <Button
              className="gradient-accent shrink-0 gap-1.5"
              onClick={openNew}
            >
              <Plus size={14} />
              New Booking
            </Button>
          )}
        </div>

        {/* ── Form View ───────────────────────────────────────────────────── */}
        {view === "form" && (
          <Card className="border-border shadow-sm">
            {/* Card header */}
            <CardHeader className="pb-4 border-b border-border px-5 sm:px-6">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={cancelForm}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowLeft size={15} />
                    <span className="hidden sm:inline">Back</span>
                  </button>
                  <span className="text-border">|</span>
                  <CardTitle className="text-base font-heading">
                    {editingId ? "Edit Expense Booking" : "New Expense Booking"}
                  </CardTitle>
                  {form.bookingReference && (
                    <span className="hidden sm:inline font-mono text-xs bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-md">
                      {form.bookingReference}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={cancelForm}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="gradient-accent"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : editingId ? "Update" : "Save Booking"}
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-6 space-y-7 px-5 sm:px-6">
              {/* ── 1. Document Numbering ────────────────────────────────── */}
              <div className="space-y-3">
                <SectionHeader label="Document Numbering" />
                <DocNumberPreview
                  finYear={form.financialYear || undefined}
                  selectedDocTypeId={selectedDocTypeId}
                  onSelect={handleDocTypeSelect}
                  preview={docNumberPreview}
                  refreshTrigger={docRefreshTrigger}
                />
                <Field
                  label="Booking Reference"
                  required
                  hint="Auto-filled when you pick a document type above; or enter manually."
                >
                  <Input
                    value={form.bookingReference}
                    onChange={(e) => {
                      set("bookingReference", e.target.value.toUpperCase());
                      setDocNumberPreview(e.target.value.toUpperCase());
                    }}
                    placeholder="e.g. PR/REC/000500"
                    className="font-mono"
                  />
                </Field>
              </div>

              {/* ── 2. Booking Information ───────────────────────────────── */}
              <div className="space-y-3">
                <SectionHeader label="Booking Information" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Field label="Booking Date" required>
                    <Input
                      type="date"
                      value={form.bookingDate}
                      onChange={(e) => set("bookingDate", e.target.value)}
                    />
                  </Field>
                  <Field label="Due Date">
                    <Input
                      type="date"
                      value={form.dueDate}
                      onChange={(e) => set("dueDate", e.target.value)}
                    />
                  </Field>
                  <Field label="Financial Year">
                    <Select
                      value={form.financialYear}
                      onValueChange={(v) => {
                        set("financialYear", v);
                        if (selectedDocTypeId) {
                          void fetchNextDocNumber(selectedDocTypeId, v).then(
                            (next) => {
                              setDocNumberPreview(next);
                              if (next) set("bookingReference", next);
                            },
                          );
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select year…" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeFinYears.map((fy) => (
                          <SelectItem key={fy.id} value={fy.year}>
                            {fy.year}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Status">
                    <Select
                      value={form.status}
                      onValueChange={(v) => set("status", v as BookingStatus)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(
                          [
                            "Draft",
                            "Pending",
                            "Approved",
                            "Rejected",
                            "Booked",
                            "Hold",
                            "Received",
                          ] as BookingStatus[]
                        ).map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                {/* ── Company + Supplier row ─────────────────────────────── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Company — from enterprise where business_type = 'C' */}
                  <Field label="Company" required>
                    <Select
                      value={form.companyId ? String(form.companyId) : ""}
                      onValueChange={(v) =>
                        set("companyId", v ? parseInt(v, 10) : null)
                      }
                    >
                      <SelectTrigger>
                        <div className="flex items-center gap-2">
                          <Building2
                            size={13}
                            className="text-muted-foreground shrink-0"
                          />
                          <SelectValue placeholder="Select company…" />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {companyOptions.length === 0 && (
                          <SelectItem value="__none__" disabled>
                            No companies found
                          </SelectItem>
                        )}
{companyOptions.map((c) => (
                          <SelectItem
                            key={c.id}
                            value={String(c.id)}
                          >
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  {/* Supplier — from AccountHeadMaster */}
                  <Field label="Vendor / Supplier">
                    <Select
                      value={form.supplier ? String(form.supplier) : ""}
                      onValueChange={(v) => set("supplier", v || "")}
                    >
                      <SelectTrigger>
                        <div className="flex items-center gap-2">
                          <User2
                            size={13}
                            className="text-muted-foreground shrink-0"
                          />
                          <SelectValue placeholder="Select supplier…" />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {supplierOptions.length === 0 && (
                          <SelectItem value="__none__" disabled>
                            No suppliers found
                          </SelectItem>
                        )}
                        {supplierOptions.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                {/* ── Project row ───────────────────────────────────────── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Project — from enterprise where business_type = 'P' */}
                  <Field label="Project / Site">
                    <Select
                      value={form.projectSite || ""}
                      onValueChange={(v) => set("projectSite", v || "")}
                    >
                      <SelectTrigger>
                        <div className="flex items-center gap-2">
                          <FolderKanban
                            size={13}
                            className="text-muted-foreground shrink-0"
                          />
                          <SelectValue placeholder="Select project…" />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {projectOptions.length === 0 && (
                          <SelectItem value="__none__" disabled>
                            No projects found
                          </SelectItem>
                        )}
{projectOptions.map((p) => (
                          <SelectItem
                            key={p.id}
                            value={String(p.id)}
                          >
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {/* Material Category removed */}
                </div>
              </div>

              {/* ── 3. Amount & GST ──────────────────────────────────────── */}
              <div className="space-y-4">
                <SectionHeader label="Amount & GST" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label="Basic Amount (₹)" required>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-semibold">
                        ₹
                      </span>
                      <Input
                        type="number"
                        min={0}
                        value={form.basicAmount || ""}
                        onChange={(e) =>
                          set("basicAmount", parseFloat(e.target.value) || 0)
                        }
                        className="pl-7 font-mono"
                        placeholder="0.00"
                      />
                    </div>
                  </Field>

                  <Field label="CGST Rate (%)">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-semibold">
                        %
                      </span>
                      <Input
                        type="number"
                        min={0}
                        max={28}
                        step={0.5}
                        value={form.cgstRate ?? ""}
                        onChange={(e) =>
                          set("cgstRate", parseFloat(e.target.value) || 0)
                        }
                        className="pl-7 font-mono"
                        placeholder="18"
                      />
                    </div>
                  </Field>

                  <Field label="SGST Rate (%)">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-semibold">
                        %
                      </span>
                      <Input
                        type="number"
                        min={0}
                        max={28}
                        step={0.5}
                        value={form.sgstRate ?? ""}
                        onChange={(e) =>
                          set("sgstRate", parseFloat(e.target.value) || 0)
                        }
                        className="pl-7 font-mono"
                        placeholder="0"
                      />
                    </div>
                  </Field>
                </div>

                {/* Live price breakdown */}
                {form.basicAmount > 0 && (
                  <PriceBreakdownPanel
                    bd={bd}
                    cgstRate={form.cgstRate}
                    sgstRate={form.sgstRate}
                    hasDiscount={form.discount.applicable}
                  />
                )}

                {/* Net amount highlight */}
                {form.basicAmount > 0 && (
                  <div className="flex items-center justify-between rounded-xl bg-primary/5 border border-primary/20 px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <TrendingUp size={15} className="text-primary" />
                      <span className="text-sm font-heading font-semibold text-foreground">
                        Net Payable Amount
                      </span>
                    </div>
                    <span className="font-mono text-lg font-bold text-primary">
                      ₹{fmt(bd.netAmount)}
                    </span>
                  </div>
                )}
              </div>

              {/* ── 4. Billing Terms ─────────────────────────────────────── */}
              <div className="space-y-3">
                <SectionHeader label="Billing Terms" />
                <BillingAccordion
                  basicAmount={form.basicAmount}
                  cgstRate={form.cgstRate}
                  sgstRate={form.sgstRate}
                  discount={form.discount}
                  onChange={(d) => set("discount", d)}
                />
              </div>

              {/* ── 5. EMI Options ───────────────────────────────────────── */}
              <div className="space-y-3">
                <SectionHeader label="EMI / Installment Options" />
                <EmiSection
                  emi={form.emi}
                  netAmount={bd.netAmount}
                  baseDocNo={form.bookingReference}
                  onChange={(emi) => set("emi", emi)}
                />
              </div>

              {/* ── 6. Approval Trail ────────────────────────────────────── */}
              {editingId && (
                <div className="space-y-3">
                  <SectionHeader label="Approval Workflow" />
                  <ApprovalTrailPanel
                    trail={approvalTrail}
                    currentStatus={form.status}
                  />
                </div>
              )}

              {/* ── 7. Remarks ───────────────────────────────────────────── */}
              <div className="space-y-3">
                <SectionHeader label="Remarks" />
                <textarea
                  value={form.remarks}
                  onChange={(e) => set("remarks", e.target.value)}
                  placeholder="Optional notes or internal comments…"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none text-foreground placeholder:text-muted-foreground"
                />
              </div>

              {/* ── Save row ─────────────────────────────────────────────── */}
              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button variant="outline" onClick={cancelForm}>
                  Cancel
                </Button>
                <Button
                  className="gradient-accent gap-1.5"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving
                    ? "Saving…"
                    : editingId
                      ? "Update Booking"
                      : "Save Booking"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── List View ───────────────────────────────────────────────────── */}
        {view === "list" && (
          <>
            {/* ── Summary cards ────────────────────────────────────────────── */}
            {!loading && records.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  {
                    label: "Total Booked",
                    value: `₹${fmt(totalNet)}`,
                    icon: Receipt,
                    color: "text-primary bg-primary/10",
                  },
                  {
                    label: "Approved",
                    value: approvedCount,
                    icon: CheckCircle2,
                    color: "text-emerald-600 bg-emerald-500/10",
                  },
                  {
                    label: "Pending",
                    value: pendingCount,
                    icon: Clock,
                    color: "text-amber-600 bg-amber-500/10",
                  },
                  {
                    label: "EMI Active",
                    value: emiCount,
                    icon: CreditCard,
                    color: "text-violet-600 bg-violet-500/10",
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-xl bg-card border border-border p-4 flex items-center gap-3"
                  >
                    <div className={`p-2 rounded-lg shrink-0 ${s.color}`}>
                      <s.icon size={15} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] text-muted-foreground font-heading uppercase tracking-wider truncate">
                        {s.label}
                      </p>
                      <p className="text-base font-bold font-mono text-foreground mt-0.5">
                        {s.value}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {loading && (
              <div className="text-center py-16 text-muted-foreground text-sm">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                Loading bookings…
              </div>
            )}

            {!loading && (
              <>
                {/* ── Status filter tabs ──────────────────────────────────── */}
                <div className="flex flex-wrap items-center gap-2">
                  {ALL_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStatusFilter(s)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        statusFilter === s
                          ? "bg-primary text-primary-foreground border-primary shadow-sm"
                          : "bg-background text-muted-foreground border-border hover:border-primary/40"
                      }`}
                    >
                      {s}
                      {s !== "All" && (
                        <span className="ml-1.5 text-[10px] opacity-70">
                          ({records.filter((r) => r.status === s).length})
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Mobile cards */}
                <div className="flex flex-col gap-3 sm:hidden">
                  {filteredRecords.length === 0 && (
                    <div className="text-center py-16 text-muted-foreground text-sm border rounded-xl border-dashed border-border">
                      <AlertCircle
                        size={20}
                        className="mx-auto mb-2 opacity-30"
                      />
                      No bookings
                      {statusFilter !== "All"
                        ? ` with status "${statusFilter}"`
                        : ""}
                      .
                    </div>
                  )}
                  {filteredRecords.map((rec) => (
                    <RecordCard
                      key={rec.id}
                      rec={rec}
                      onEdit={() => openEdit(rec)}
                      onDelete={() => setDeleteId(rec.id)}
                      onApprovalSuccess={fetchRecords}
                    />
                  ))}
                </div>

                {/* Desktop table */}
                <Card className="hidden sm:block border-border shadow-sm">
                  <CardContent className="p-0">
                    <div className="rounded-md overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/30">
                            <TableHead className="text-xs font-heading">
                              Doc Type
                            </TableHead>
                            <TableHead className="text-xs font-heading">
                              Doc Number
                            </TableHead>
                            <TableHead className="text-xs font-heading">
                              Date
                            </TableHead>
                            <TableHead className="text-xs font-heading">
                              Supplier
                            </TableHead>
                            <TableHead className="text-xs font-heading hidden md:table-cell">
                              Basic Amt
                            </TableHead>
                            <TableHead className="text-xs font-heading hidden md:table-cell">
                              CGST
                            </TableHead>
                            <TableHead className="text-xs font-heading hidden md:table-cell">
                              SGST
                            </TableHead>
                            <TableHead className="text-xs font-heading">
                              Net Amt
                            </TableHead>
                            <TableHead className="text-xs font-heading">
                              EMI
                            </TableHead>
                            <TableHead className="text-xs font-heading">
                              Status
                            </TableHead>
                            <TableHead className="text-xs font-heading">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredRecords.map((rec) => {
                            const rbd = computeBreakdown(
                              rec.basicAmount,
                              rec.cgstRate,
                              rec.sgstRate,
                              rec.discount,
                            );
                            // Resolve supplier label from options list for display
                            const supplierLabel =
                              supplierOptions.find(
                                (s) => String(s.id) === String(rec.supplier),
                              )?.label ??
                              rec.supplier ??
                              "—";

                            return (
                              <TableRow
                                key={rec.id}
                                className="hover:bg-muted/20"
                              >
                                <TableCell className="text-xs text-muted-foreground max-w-[100px] truncate">
                                  {rec.docTypeName || "—"}
                                </TableCell>
                                <TableCell className="font-mono text-xs font-semibold text-primary">
                                  {rec.bookingReference || "—"}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {rec.bookingDate}
                                </TableCell>
                                <TableCell className="text-xs max-w-[110px] truncate">
                                  {supplierLabel}
                                </TableCell>
                                <TableCell className="font-mono text-xs hidden md:table-cell text-muted-foreground">
                                  ₹{fmt(rec.basicAmount)}
                                </TableCell>
                                <TableCell className="font-mono text-xs hidden md:table-cell text-amber-600 dark:text-amber-400">
                                  {rec.cgstRate}%
                                </TableCell>
                                <TableCell className="font-mono text-xs hidden md:table-cell text-amber-600 dark:text-amber-400">
                                  {rec.sgstRate}%
                                </TableCell>
                                <TableCell className="font-mono text-xs font-semibold">
                                  ₹{fmt(rbd.netAmount)}
                                </TableCell>
                                <TableCell>
                                  {rec.emi?.enabled ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-heading font-semibold bg-violet-100 text-violet-700 border border-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-700 px-2 py-0.5 rounded-full">
                                      <CreditCard size={9} />
                                      {rec.emi.installmentCount}x
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">
                                      —
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <StatusBadge status={rec.status} />
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1.5 items-center">
                                    <ApprovalActions
                                      status={rec.status}
                                      recordId={rec.id}
                                      endpoint="/api/expense-booking"
                                      onSuccess={fetchRecords}
                                    />
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      onClick={() => openEdit(rec)}
                                    >
                                      <Edit size={12} />
                                    </Button>
                                    <Button
                                      variant="destructive"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      onClick={() => setDeleteId(rec.id)}
                                    >
                                      <Trash2 size={12} />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          {filteredRecords.length === 0 && (
                            <TableRow>
                              <TableCell
                                colSpan={11}
                                className="text-center py-14 text-muted-foreground text-sm"
                              >
                                <AlertCircle
                                  size={18}
                                  className="mx-auto mb-2 opacity-30"
                                />
                                {statusFilter !== "All"
                                  ? `No bookings with status "${statusFilter}". Try a different filter.`
                                  : `No bookings yet. Click "New Booking" to get started.`}
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
      </div>

      {/* ── Delete Confirm ──────────────────────────────────────────────── */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Booking</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this expense booking? This cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && handleDelete(deleteId)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
