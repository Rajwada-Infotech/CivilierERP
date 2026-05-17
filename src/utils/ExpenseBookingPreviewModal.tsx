import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  Truck,
  User,
  Package,
  Banknote,
  BadgePercent,
  TrendingUp,
  CreditCard,
  Hash,
  Receipt,
  StickyNote,
  CheckCircle2,
  Clock,
  AlertCircle,
  Edit,
  FileText,
} from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { parseJsonArray } from "@/utils/parseJsonArray";
import { computeBreakdown, fmt } from "@/pages/material/ExpenseBooking/helpers";
import type { ExpenseRecord } from "@/pages/material/ExpenseBooking/types";

interface GRNItemLine {
  itemName?: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  uom?: string;
  rate?: number;
  quantity?: number;
  totalAmount?: number;
}

interface ExpenseBookingPreviewModalProps {
  previewRecord: ExpenseRecord | null;
  onClose: () => void;
  onEdit: (record: ExpenseRecord) => void;
}

export function ExpenseBookingPreviewModal({
  previewRecord,
  onClose,
  onEdit,
}: ExpenseBookingPreviewModalProps) {
  if (!previewRecord) return null;

  const hasEmi = !!(
    previewRecord.emi?.enabled && previewRecord.emi?.installmentCount
  );

  const rbd = computeBreakdown(
    previewRecord.basicAmount,
    previewRecord.cgstRate,
    previewRecord.sgstRate,
    previewRecord.discount,
  );
  const hasIgst = (previewRecord.igstRate || 0) > 0;
  const hasDiscount =
    previewRecord.discount && (previewRecord.discount.value || 0) > 0;
  const cgstAmt =
    (rbd as any).cgstAmt ??
    (previewRecord.basicAmount * (previewRecord.cgstRate || 0)) / 100;
  const sgstAmt =
    (rbd as any).sgstAmt ??
    (previewRecord.basicAmount * (previewRecord.sgstRate || 0)) / 100;
  const igstAmt =
    (rbd as any).igstAmt ??
    (previewRecord.basicAmount * (previewRecord.igstRate || 0)) / 100;

  const billingTerms = parseJsonArray(previewRecord.billingTerms);

  return (
    <Dialog open={!!previewRecord} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Expense Booking Preview</DialogTitle>
          <DialogDescription>
            Details for booking {previewRecord?.bookingReference}
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-5">
          {/* ── Section 1: Booking Info ── */}
          <div>
            <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <CalendarDays size={10} className="text-primary" /> Booking
              Information
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4">
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Booking Date
                </p>
                <p className="text-sm font-medium">
                  {previewRecord.bookingDate || "—"}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Due Date
                </p>
                <p className="text-sm font-medium">
                  {previewRecord.dueDate || "—"}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Document Type
                </p>
                <p className="text-sm font-medium truncate">
                  {previewRecord.docTypeName ||
                    previewRecord.materialCategory ||
                    "—"}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Source Document
                </p>
                <p className="text-sm font-mono font-semibold text-foreground">
                  {previewRecord.sourceDocNo || previewRecord.purchaseOrderId
                    ? `PO-${previewRecord.purchaseOrderId}`
                    : previewRecord.workOrderId
                      ? `WO-${previewRecord.workOrderId}`
                      : "—"}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Company
                </p>
                <p className="text-sm font-medium truncate">
                  {previewRecord.companyName ||
                    (previewRecord.companyId
                      ? `Company #${previewRecord.companyId}`
                      : "—")}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Project
                </p>
                <p className="text-sm font-medium truncate">
                  {previewRecord.projectName ||
                    (previewRecord.projectId
                      ? `Project #${previewRecord.projectId}`
                      : "—")}
                </p>
              </div>
            </div>
          </div>

          {/* ── Section 2: Vendor / Supplier ── */}
          <div className="border-t border-border/60 pt-4">
            <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <Truck size={10} className="text-primary" /> Vendor / Supplier
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 flex items-center gap-3 bg-muted/30 border border-border rounded-xl px-4 py-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <User size={14} className="text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Supplier / Contractor
                  </p>
                  <p className="text-sm font-semibold truncate">
                    {previewRecord.supplier || "—"}
                  </p>
                </div>
              </div>
              {previewRecord.materialCategory && (
                <div className="flex-1 flex items-center gap-3 bg-muted/30 border border-border rounded-xl px-4 py-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                    <Package size={14} className="text-blue-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Material Category
                    </p>
                    <p className="text-sm font-semibold truncate">
                      {previewRecord.materialCategory}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Section 3: Amount Breakdown ── */}
          <div className="border-t border-border/60 pt-4">
            <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <Banknote size={10} className="text-primary" /> Amount Breakdown
            </p>
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="divide-y divide-border/60">
                <div className="flex items-center justify-between px-4 py-2.5 bg-muted/10">
                  <p className="text-xs text-muted-foreground">Basic Amount</p>
                  <p className="font-mono text-sm font-semibold">
                    ₹{fmt(previewRecord.basicAmount)}
                  </p>
                </div>
                {!hasIgst && (previewRecord.cgstRate || 0) > 0 && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <BadgePercent size={10} className="text-amber-500" />
                      CGST{" "}
                      <span className="font-mono text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded">
                        {previewRecord.cgstRate}%
                      </span>
                    </p>
                    <p className="font-mono text-sm text-foreground/80">
                      + ₹{fmt(cgstAmt)}
                    </p>
                  </div>
                )}
                {!hasIgst && (previewRecord.sgstRate || 0) > 0 && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <BadgePercent size={10} className="text-amber-500" />
                      SGST{" "}
                      <span className="font-mono text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded">
                        {previewRecord.sgstRate}%
                      </span>
                    </p>
                    <p className="font-mono text-sm text-foreground/80">
                      + ₹{fmt(sgstAmt)}
                    </p>
                  </div>
                )}
                {hasIgst && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <BadgePercent size={10} className="text-amber-500" />
                      IGST{" "}
                      <span className="font-mono text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded">
                        {previewRecord.igstRate}%
                      </span>
                    </p>
                    <p className="font-mono text-sm text-foreground/80">
                      + ₹{fmt(igstAmt)}
                    </p>
                  </div>
                )}
                {!hasIgst &&
                  (previewRecord.cgstRate || 0) === 0 &&
                  (previewRecord.sgstRate || 0) === 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <p className="text-xs text-muted-foreground">GST</p>
                      <p className="text-xs text-muted-foreground">
                        Not applicable
                      </p>
                    </div>
                  )}
                {hasDiscount && (
                  <div className="flex items-center justify-between px-4 py-2.5 bg-red-500/5">
                    <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
                      <TrendingUp size={10} />
                      Discount
                      {previewRecord.discount?.type === "percentage" &&
                      previewRecord.discount?.value ? (
                        <span className="font-mono text-[10px] bg-red-500/10 px-1.5 py-0.5 rounded">
                          {previewRecord.discount.value}%
                        </span>
                      ) : null}
                    </p>
                    <p className="font-mono text-sm text-red-500 dark:text-red-400">
                      − ₹{fmt((rbd as any).discountAmount)}
                    </p>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between px-4 py-3 bg-primary/10 border-t border-primary/20">
                <p className="text-xs font-heading font-bold text-primary uppercase tracking-wider">
                  Net Payable
                </p>
                <p className="font-mono text-base font-bold text-primary">
                  ₹{fmt(previewRecord.netAmount ?? rbd.netAmount)}
                </p>
              </div>
            </div>
          </div>

          {/* ── Section 4: EMI Details ── */}
          {hasEmi && (
            <div className="border-t border-border/60 pt-4">
              <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                <CreditCard size={10} className="text-primary" /> EMI /
                Installment Plan
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Installments
                  </p>
                  <p className="font-mono text-lg font-bold text-violet-600 dark:text-violet-400">
                    {previewRecord.emi!.installmentCount}
                  </p>
                  <p className="text-[10px] text-muted-foreground">total</p>
                </div>
                <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Per EMI
                  </p>
                  <p className="font-mono text-base font-bold text-violet-600 dark:text-violet-400">
                    ₹{fmt(previewRecord.emi!.emiAmount ?? 0)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">amount</p>
                </div>
                <div className="bg-muted/30 border border-border rounded-xl p-3 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Start Date
                  </p>
                  <p className="text-sm font-semibold">
                    {previewRecord.emi!.startDate || "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">first emi</p>
                </div>
                <div className="bg-muted/30 border border-border rounded-xl p-3 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Frequency
                  </p>
                  <p className="text-sm font-semibold capitalize">
                    {previewRecord.emi!.frequency || "Monthly"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">cycle</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Section 5: GRN Items ── */}
          {previewRecord.grnItems &&
            Array.isArray(previewRecord.grnItems) &&
            previewRecord.grnItems.length > 0 && (
              <div className="border-t border-border/60 pt-4">
                <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Truck size={10} className="text-primary" /> GRN Items Summary
                  <span className="ml-auto font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded-full border border-border">
                    {previewRecord.grnItems.length} items
                  </span>
                </p>
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/40 border-b border-border">
                          <th className="text-left px-3 py-2 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                            Item
                          </th>
                          <th className="text-right px-3 py-2 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                            Ordered
                          </th>
                          <th className="text-right px-3 py-2 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                            Received
                          </th>
                          <th className="text-right px-3 py-2 text-[10px] font-heading uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                            Remaining
                          </th>
                          <th className="text-left px-3 py-2 text-[10px] font-heading uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                            UOM
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {(previewRecord.grnItems as GRNItemLine[]).map(
                          (item, idx) => (
                            <tr key={idx} className="hover:bg-muted/20">
                              <td className="px-3 py-2.5 font-medium max-w-[140px] truncate">
                                {item.itemName || `Item ${idx + 1}`}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                                {item.orderedQty}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                                {item.receivedQty}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono hidden sm:table-cell">
                                <span
                                  className={
                                    item.remainingQty > 0
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-muted-foreground"
                                  }
                                >
                                  {item.remainingQty}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                                {item.uom || "—"}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

          {/* ── Section 6: Billing Terms ── */}
          {previewRecord.billingTerms && (
            <div className="border-t border-border/60 pt-4">
              <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                <Receipt size={10} className="text-primary" /> Billing Terms
              </p>
              <div className="bg-muted/20 border border-border rounded-xl px-4 py-3 text-sm text-foreground">
                {billingTerms.length > 0 ? (
                  <div className="space-y-1.5">
                    {billingTerms.map((t: any, idx: number) => (
                      <div
                        key={t?.BillingTermID ?? t?.id ?? idx}
                        className="flex flex-col gap-0.5"
                      >
                        <span className="font-medium">
                          {t?.TermName || t?.Name || t?.name || "Billing Term"}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {t?.TermValue || t?.Description || t?.value || ""}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </div>
          )}

          {/* ── Section 7: Invoice Details & Allocation ── */}
          {(previewRecord.vendorInvoiceNo ||
            previewRecord.vendorInvoiceDate ||
            previewRecord.costCenter ||
            previewRecord.glAccount ||
            previewRecord.workDoneRef ||
            (previewRecord.additionalCharges ?? []).length > 0) && (
            <div className="border-t border-border/60 pt-4">
              <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                <FileText size={10} className="text-primary" /> Invoice &
                Allocation
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4">
                {previewRecord.vendorInvoiceNo && (
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Vendor Invoice No.
                    </p>
                    <p className="text-sm font-mono font-semibold">
                      {previewRecord.vendorInvoiceNo}
                    </p>
                  </div>
                )}
                {previewRecord.vendorInvoiceDate && (
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Vendor Invoice Date
                    </p>
                    <p className="text-sm font-medium">
                      {previewRecord.vendorInvoiceDate}
                    </p>
                  </div>
                )}
                {previewRecord.costCenter && (
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Cost Centre
                    </p>
                    <p className="text-sm font-medium">
                      {previewRecord.costCenter}
                    </p>
                  </div>
                )}
                {previewRecord.glAccount && (
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      GL Account
                    </p>
                    <p className="text-sm font-medium">
                      {previewRecord.glAccount}
                    </p>
                  </div>
                )}
                {previewRecord.workDoneRef && (
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Work Done Ref
                    </p>
                    <p className="text-sm font-mono font-semibold text-violet-600 dark:text-violet-400">
                      {previewRecord.workDoneRef}
                    </p>
                  </div>
                )}
              </div>
              {(previewRecord.additionalCharges ?? []).length > 0 && (
                <div className="mt-3 rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        <th className="px-3 py-2 text-left font-heading uppercase tracking-wider text-muted-foreground text-[10px]">
                          Additional Charge
                        </th>
                        <th className="px-3 py-2 text-right font-heading uppercase tracking-wider text-muted-foreground text-[10px]">
                          Amount (₹)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(previewRecord.additionalCharges ?? []).map(
                        (charge, idx) => (
                          <tr key={idx}>
                            <td className="px-3 py-2 text-foreground">
                              {charge.label || "—"}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold">
                              ₹{charge.amount?.toLocaleString("en-IN") ?? "0"}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                    <tfoot className="border-t border-border bg-muted/20">
                      <tr>
                        <td className="px-3 py-2 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                          Total
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-foreground">
                          ₹
                          {(previewRecord.additionalCharges ?? [])
                            .reduce((s, c) => s + (Number(c.amount) || 0), 0)
                            .toLocaleString("en-IN")}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Section 8: Remarks ── */}
          {previewRecord.remarks && (
            <div className="border-t border-border/60 pt-4">
              <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                <StickyNote size={10} className="text-primary" /> Remarks
              </p>
              <div className="bg-muted/20 border border-border rounded-xl px-4 py-3 text-sm text-foreground leading-relaxed">
                {previewRecord.remarks}
              </div>
            </div>
          )}

          {/* ── Section 9: Approval Status ── */}
          <div className="border-t border-border/60 pt-4">
            <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <CheckCircle2 size={10} className="text-primary" /> Approval
              Status
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 bg-muted/30 border border-border rounded-xl px-4 py-2.5">
                <StatusBadge status={previewRecord.status} />
                <span className="text-xs text-muted-foreground">
                  Current Status
                </span>
              </div>
              {previewRecord.status === "Approved" && (
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-xl">
                  <CheckCircle2 size={11} /> Approved & Processed
                </div>
              )}
              {previewRecord.status === "Pending" && (
                <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-xl">
                  <Clock size={11} /> Awaiting Approval
                </div>
              )}
              {previewRecord.status === "Rejected" && (
                <div className="flex items-center gap-1.5 text-[10px] text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">
                  <AlertCircle size={11} /> Rejected — Review Required
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-border px-4 sm:px-6 py-3 flex flex-col-reverse sm:flex-row items-center justify-between gap-2 bg-muted/10">
          <p className="text-[10px] text-muted-foreground">
            ID: <span className="font-mono">{previewRecord.id || "—"}</span>
          </p>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              className="flex-1 sm:flex-none h-8 text-xs"
              onClick={() => {
                onClose();
                onEdit(previewRecord);
              }}
            >
              <Edit size={11} className="mr-1.5" /> Edit
            </Button>
            <Button
              variant="outline"
              className="flex-1 sm:flex-none h-8 text-xs"
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
