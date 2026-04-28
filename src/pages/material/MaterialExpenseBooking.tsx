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
import { Plus, Edit, Trash2, ArrowLeft, Link2 } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import { getEnterprises } from "@/api/enterpriseApi";

// ─── Sub-components ───────────────────────────────────────────────────────────
import {
  FormSection,
  Field,
  ReadonlyField,
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
  PurchaseOrder,
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function MaterialExpenseBooking() {
  const { finYears } = useFinYear();
  const activeFinYears = finYears.filter((fy) => fy.status === "Active");

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [poLoading, setPoLoading] = useState(true);
  const [companyOptions, setCompanyOptions] = useState<{ id: number; label: string }[]>([]);
  const [records, setRecords] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<PageView>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<ExpenseRecord, "id">>(blankForm());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Doc number state
  const [selectedDocTypeId, setSelectedDocTypeId] = useState<number | null>(
    null,
  );
  const [docNumberPreview, setDocNumberPreview] = useState("");
  const [docRefreshTrigger, setDocRefreshTrigger] = useState(0);
  // Status filter for list view — default to "Received" payment status
  const [statusFilter, setStatusFilter] = useState<string>("Received");
  // Approval trail for selected record
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

  const fetchPurchaseOrders = React.useCallback(async () => {
    try {
      setPoLoading(true);
      const data = await apiFetch(`${API}?limit=200`);
      // Safely extract the array regardless of response shape:
      // { data: [...] }, { recordset: [...] }, or a bare array
      const rows: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.recordset)
            ? data.recordset
            : [];
      const mapped: PurchaseOrder[] = rows.map(
        (row: any) => ({
          id: row.POId ?? row.Eid ?? null,
          poNumber:
            row.PODocNo ??
            row.EDocNo ??
            ((row.POId ?? row.Eid) ? `PO-${row.POId ?? row.Eid}` : "N/A"),
          supplier: row.SupplierName ?? row.EProjectName ?? "Unknown",
          projectSite: row.ProjectName ?? row.EProjectName ?? "",
          itemDescription:
            row.ItemDescription ?? row.EDocumentType ?? "Material",
          quantity: parseFloat(row.Quantity) || 1,
          unit: row.UOMCode ?? "Nos",
          rate: parseFloat(row.Rate ?? row.EAmount) || 0,
          totalAmount: parseFloat(row.TotalAmount ?? row.EAmount) || 0,
          paymentTerms: row.PaymentTerms ?? "Net-30",
          cgstRate: parseFloat(row.CGSTRate ?? row.ECgstRate) || 18,
          sgstRate: parseFloat(row.SGSTRate ?? row.ESgstRate) || 0,
          invoiceReference: row.InvoiceRef ?? row.EDocNo ?? "",
        }),
      );
      setPurchaseOrders(mapped);
    } catch (err: any) {
      console.error("PO load failed:", err.message);
      setPurchaseOrders([]);
    } finally {
      setPoLoading(false);
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

  React.useEffect(() => {
    fetchRecords();
    fetchPurchaseOrders();
    getEnterprises()
      .then((list) => {
        const companies = list
          .filter((e) => (e.business_type ?? "").toUpperCase() === "C" && !e.discontinue)
          .map((e) => ({ id: e.id, label: e.name ?? "" }))
          .filter((o) => o.label !== "");
        setCompanyOptions(companies);
      })
      .catch(() => {/* silently ignore */});
  }, [fetchRecords, fetchPurchaseOrders]);

  const set = <K extends keyof Omit<ExpenseRecord, "id">>(
    field: K,
    value: Omit<ExpenseRecord, "id">[K],
  ) => setForm((prev) => ({ ...prev, [field]: value }));

  const linkPO = (poNumber: string) => {
    const po = purchaseOrders.find((p) => p.poNumber === poNumber);
    if (!po) {
      set("poId", null);
      return;
    }
    setForm((prev) => ({
      ...prev,
      poId: String(po.id ?? po.poNumber),
      supplier: po.supplier,
      projectSite: po.projectSite,
      materialCategory: prev.materialCategory || po.itemDescription,
      invoiceReference: po.invoiceReference,
      basicAmount: po.totalAmount,
      cgstRate: po.cgstRate,
      sgstRate: po.sgstRate,
    }));
  };

  const openNew = () => {
    setEditingId(null);
    setForm({
      ...blankForm(),
      financialYear: activeFinYears[0]?.year || "",
    });
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
    // preview from backend already has finYear if it was passed — but if financialYear
    // is set and preview doesn't already contain it, append it now
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
    // Pass selectedDocTypeId so the backend locks the sequence on new records
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
        // Server returns the authoritative locked doc number — show it in success toast
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
          setDocRefreshTrigger((current) => current + 1);
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

  // Status options for the list filter (all booking statuses + Received)
  const ALL_STATUSES = [
    "Draft",
    "Pending",
    "Approved",
    "Rejected",
    "Booked",
    "Hold",
    "Received",
  ] as const;
  // Default filter: show Received payment records only
  const filteredRecords = statusFilter
    ? records.filter((r) => r.status === statusFilter)
    : records;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "Expense Booking"]} />
      <div className="space-y-4">
        {/* ── Page Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-heading font-bold text-foreground">
              Expense Booking
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Record and manage material expense bookings
            </p>
          </div>
          {view === "list" && (
            <Button className="gradient-accent shrink-0" onClick={openNew}>
              <Plus size={15} className="mr-1.5" />
              <span className="hidden sm:inline">New Booking</span>
              <span className="sm:hidden">New</span>
            </Button>
          )}
        </div>

        {/* ── Form View ───────────────────────────────────────────────────── */}
        {view === "form" && (
          <Card className="border-primary/20 shadow-sm">
            <CardHeader className="pb-4 border-b border-border px-4 sm:px-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={cancelForm}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <ArrowLeft size={15} />
                    <span className="hidden sm:inline">Back to list</span>
                  </button>
                  <span className="text-muted-foreground/40 hidden sm:inline">
                    |
                  </span>
                  <CardTitle className="text-base sm:text-lg font-heading">
                    {editingId ? "Edit Expense Booking" : "New Expense Booking"}
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={cancelForm}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="gradient-accent"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : editingId ? "Update" : "Save"}
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-5 space-y-6 px-4 sm:px-6">
              {/* ── Document Numbering ──────────────────────────────────── */}
              <FormSection label="Document Numbering">
                <DocNumberPreview
                  finYear={form.financialYear || undefined}
                  selectedDocTypeId={selectedDocTypeId}
                  onSelect={handleDocTypeSelect}
                  preview={docNumberPreview}
                  refreshTrigger={docRefreshTrigger}
                />
                {/* Manual override */}
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
                  />
                </Field>
              </FormSection>

              {/* ── Booking Information ─────────────────────────────────── */}
              <FormSection label="Booking Information">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                            (nextDocNo) => {
                              setDocNumberPreview(nextDocNo);
                              if (nextDocNo) set("bookingReference", nextDocNo);
                            },
                          );
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select year..." />
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
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Booking Status">
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
                  <Field label="Company" required>
                    <Select
                      value={form.companyId ? String(form.companyId) : ""}
                      onValueChange={(v) => set("companyId", v ? parseInt(v, 10) : null)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select company..." />
                      </SelectTrigger>
                      <SelectContent>
                        {companyOptions.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </FormSection>

              {/* ── Purchase Order Link ─────────────────────────────────── */}
              <FormSection label="Purchase Order">
                <Field
                  label="Link Purchase Order"
                  hint="Selecting a PO auto-fills supplier, invoice reference, project site and amounts."
                >
                  <Select
                    value={form.poId ?? ""}
                    onValueChange={linkPO}
                    disabled={poLoading}
                  >
                    <SelectTrigger>
                      <div className="flex items-center gap-2">
                        <Link2
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                        <SelectValue
                          placeholder={
                            poLoading
                              ? "Loading purchase orders..."
                              : purchaseOrders.length === 0
                                ? "No POs found"
                                : "Select purchase order..."
                          }
                        />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {purchaseOrders.map((po) => (
                        <SelectItem key={po.poNumber} value={po.poNumber}>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold">
                              {po.poNumber}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              — {po.supplier}
                            </span>
                            <span className="text-muted-foreground text-xs ml-auto">
                              Rs.{fmt(po.totalAmount)}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                {form.poId && (
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-3 sm:p-4 space-y-3 mt-4">
                    <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground">
                      Auto-filled from PO
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <ReadonlyField
                        label="Vendor / Supplier"
                        value={form.supplier}
                      />
                      <ReadonlyField
                        label="Project / Site"
                        value={form.projectSite}
                      />
                      <ReadonlyField
                        label="Material Category"
                        value={form.materialCategory}
                      />
                      <ReadonlyField
                        label="Invoice Reference"
                        value={form.invoiceReference}
                        highlight
                      />
                    </div>
                  </div>
                )}
              </FormSection>

              {/* ── Billing Terms (discount) ─────────────────────────────── */}
              {form.poId && (
                <FormSection label="Billing Terms">
                  <BillingAccordion
                    basicAmount={form.basicAmount}
                    cgstRate={form.cgstRate}
                    sgstRate={form.sgstRate}
                    discount={form.discount}
                    onChange={(d) => set("discount", d)}
                  />
                </FormSection>
              )}

              {/* ── EMI Options ─────────────────────────────────────────── */}
              <FormSection label="EMI / Installment Options">
                <EmiSection
                  emi={form.emi}
                  netAmount={bd.netAmount}
                  onChange={(emi) => set("emi", emi)}
                />
              </FormSection>

              {/* ── Approval Trail (edit mode only) ─────────────────────── */}
              {editingId && (
                <FormSection label="Approval Workflow">
                  <ApprovalTrailPanel
                    trail={approvalTrail}
                    currentStatus={form.status}
                  />
                </FormSection>
              )}

              {/* ── Remarks ─────────────────────────────────────────────── */}
              <FormSection label="Remarks">
                <textarea
                  value={form.remarks}
                  onChange={(e) => set("remarks", e.target.value)}
                  placeholder="Optional notes..."
                  rows={3}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </FormSection>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button variant="outline" onClick={cancelForm}>
                  Cancel
                </Button>
                <Button
                  className="gradient-accent"
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
            {loading && (
              <div className="text-center py-12 text-muted-foreground text-sm">
                Loading bookings…
              </div>
            )}
            {!loading && (
              <>
                {/* ── Status filter bar ──────────────────────────────────── */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium shrink-0">
                    Filter:
                  </span>
                  {(
                    [
                      "Received",
                      "Draft",
                      "Pending",
                      "Approved",
                      "Rejected",
                      "Booked",
                      "Hold",
                    ] as const
                  ).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() =>
                        setStatusFilter(statusFilter === s ? "" : s)
                      }
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        statusFilter === s
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-primary/40"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                  {statusFilter && (
                    <button
                      type="button"
                      onClick={() => setStatusFilter("")}
                      className="px-2 py-1 rounded-full text-xs text-muted-foreground hover:text-foreground border border-dashed border-border"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Mobile cards */}
                <div className="flex flex-col gap-3 sm:hidden">
                  {filteredRecords.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground text-sm border rounded-xl border-dashed border-border">
                      No bookings
                      {statusFilter ? ` with status "${statusFilter}"` : ""}.{" "}
                      {statusFilter
                        ? "Try a different filter."
                        : 'Tap "New" to get started.'}
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
                <Card className="hidden sm:block">
                  <CardContent className="p-0">
                    <div className="rounded-md overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Doc Type</TableHead>
                            <TableHead>Doc Number</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Due Date</TableHead>
                            <TableHead>Supplier</TableHead>
                            <TableHead className="hidden md:table-cell">
                              Invoice Ref
                            </TableHead>
                            <TableHead>Basic Amt</TableHead>
                            <TableHead>EMI</TableHead>
                            <TableHead>Net Amt</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Actions</TableHead>
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
                            return (
                              <TableRow key={rec.id}>
                                <TableCell className="text-xs text-muted-foreground max-w-[110px] truncate">
                                  {rec.docTypeName || "—"}
                                </TableCell>
                                <TableCell className="font-mono text-xs font-semibold text-primary">
                                  {rec.bookingReference || "—"}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {rec.bookingDate}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {rec.dueDate || "-"}
                                </TableCell>
                                <TableCell className="text-xs max-w-[110px] truncate">
                                  {rec.supplier}
                                </TableCell>
                                <TableCell className="font-mono text-xs hidden md:table-cell">
                                  {rec.invoiceReference || "-"}
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  Rs.{fmt(rec.basicAmount)}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {rec.emi.enabled ? (
                                    <span className="text-primary font-medium">
                                      {rec.emi.installmentCount}x
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="font-mono text-xs font-semibold">
                                  Rs.{fmt(rbd.netAmount)}
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
                                      <Edit size={13} />
                                    </Button>
                                    <Button
                                      variant="destructive"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      onClick={() => setDeleteId(rec.id)}
                                    >
                                      <Trash2 size={13} />
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
                                className="text-center py-10 text-muted-foreground text-sm"
                              >
                                {statusFilter
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

      {/* ── Delete Confirm ─────────────────────────────────────────────── */}
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
