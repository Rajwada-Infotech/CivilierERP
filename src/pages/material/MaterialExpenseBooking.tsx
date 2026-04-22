import React, { useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useFinYear } from "@/contexts/FinYearContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Plus,
  Edit,
  Trash2,
  Receipt,
  X,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Tag,
  Percent,
  ToggleLeft,
  ToggleRight,
  Link2,
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clock,
  BadgePercent,
} from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import {
  useBillingTerms,
  type BillingTerm as MasterBillingTerm,
} from "@/contexts/BillingTermsContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type BookingStatus = "Draft" | "Approved" | "Booked" | "Hold";
type PageView = "list" | "form";

interface PurchaseOrder {
  poNumber: string;
  supplier: string;
  projectSite: string;
  itemDescription: string;
  quantity: number;
  unit: string;
  rate: number;
  totalAmount: number;
  paymentTerms: string;
  cgstRate: number;
  sgstRate: number;
  invoiceReference: string;
}

interface DiscountConfig {
  applicable: boolean;
  type: "percentage" | "fixed";
  value: number;
  appliedOn: "pre-gst" | "post-gst";
  masterTermId: string | null;
  masterTermName: string | null;
}

interface ExpenseRecord {
  id: string;
  bookingReference: string;
  bookingDate: string;
  dueDate: string;
  financialYear: string;
  poId: string | null;
  supplier: string;
  projectSite: string;
  materialCategory: string;
  invoiceReference: string;
  basicAmount: number;
  cgstRate: number;
  sgstRate: number;
  discount: DiscountConfig;
  netAmount: number | null;
  status: BookingStatus;
  remarks: string;
}

function defaultDiscount(): DiscountConfig {
  return {
    applicable: false,
    type: "percentage",
    value: 0,
    appliedOn: "pre-gst",
    masterTermId: null,
    masterTermName: null,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface PriceBreakdown {
  basicAmount: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  grossAmount: number;
  roundOff: number;
  netAmount: number;
}

function computeBreakdown(
  basicAmount: number,
  cgstRate: number,
  sgstRate: number,
  discount: DiscountConfig,
): PriceBreakdown {
  const discountAmount = discount.applicable
    ? discount.type === "percentage"
      ? (basicAmount * discount.value) / 100
      : discount.value
    : 0;

  const taxableAmount = Math.max(0, basicAmount - discountAmount);
  const cgstAmount = (taxableAmount * cgstRate) / 100;
  const sgstAmount = (taxableAmount * sgstRate) / 100;
  const grossAmount = taxableAmount + cgstAmount + sgstAmount;
  const rounded = Math.round(grossAmount);
  const roundOff = rounded - grossAmount;

  return {
    basicAmount,
    discountAmount,
    taxableAmount,
    cgstAmount,
    sgstAmount,
    grossAmount,
    roundOff,
    netAmount: rounded,
  };
}

const STATUS_STYLES: Record<BookingStatus, string> = {
  Draft: "bg-slate-100 text-slate-700 border-slate-200",
  Approved: "bg-blue-100 text-blue-700 border-blue-200",
  Booked: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Hold: "bg-amber-100 text-amber-700 border-amber-200",
};

function blankForm(): Omit<ExpenseRecord, "id"> {
  return {
    bookingReference: "",
    bookingDate: "",
    dueDate: "",
    financialYear: "",
    poId: null,
    supplier: "",
    projectSite: "",
    materialCategory: "",
    invoiceReference: "",
    basicAmount: 0,
    cgstRate: 18,
    sgstRate: 0,
    discount: defaultDiscount(),
    netAmount: null,
    status: "Draft",
    remarks: "",
  };
}

// ─── Small helpers ─────────────────────────────────────────────────────────────

function FormSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground border-b border-border/60 pb-1.5">
        {label}
      </p>
      {children}
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ReadonlyField({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div
        className={
          "rounded-lg border px-3 py-2 text-sm font-mono min-h-[38px] flex items-center " +
          (highlight
            ? "border-border bg-muted/40 text-foreground font-semibold"
            : "border-border/60 bg-muted/30 text-foreground")
        }
      >
        {value || (
          <span className="text-muted-foreground/50 font-sans font-normal text-xs">
            Auto-filled from PO
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Master Term Picker Dialog ────────────────────────────────────────────────

interface MasterTermPickerProps {
  open: boolean;
  onClose: () => void;
  terms: MasterBillingTerm[];
  onSelect: (term: MasterBillingTerm) => void;
}

function MasterTermPicker({
  open,
  onClose,
  terms,
  onSelect,
}: MasterTermPickerProps) {
  const BILL_TYPE_COLORS: Record<string, string> = {
    "Tax Invoice": "bg-blue-100 text-blue-700 border-blue-200",
    "Proforma Invoice": "bg-violet-100 text-violet-700 border-violet-200",
    "Credit Note": "bg-emerald-100 text-emerald-700 border-emerald-200",
    "Debit Note": "bg-orange-100 text-orange-700 border-orange-200",
    "Bill of Supply": "bg-amber-100 text-amber-700 border-amber-200",
    "Receipt Voucher": "bg-cyan-100 text-cyan-700 border-cyan-200",
    "Delivery Challan": "bg-pink-100 text-pink-700 border-pink-200",
    "Self Invoice": "bg-slate-100 text-slate-700 border-slate-200",
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <BookOpen size={16} className="text-primary" />
            Select Billing Term
          </DialogTitle>
          <DialogDescription>
            Choose a term from the Billing Terms Master to auto-populate
            discount settings.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-2 py-1">
          {terms.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <BookOpen size={20} className="text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No active billing terms in master
              </p>
            </div>
          )}
          {terms.map((term) => (
            <button
              key={term._id}
              type="button"
              onClick={() => {
                onSelect(term);
                onClose();
              }}
              className="w-full text-left rounded-xl border border-border bg-background hover:border-primary/40 hover:bg-primary/[0.03] transition-all px-4 py-3 group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-heading font-semibold text-foreground group-hover:text-primary transition-colors">
                      {term.name}
                    </p>
                    <span
                      className={
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-heading " +
                        (BILL_TYPE_COLORS[term.billType] ??
                          "bg-muted text-muted-foreground border-border")
                      }
                    >
                      {term.billType}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 truncate">
                    {term.description}
                  </p>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <BadgePercent size={10} />
                      {term.discountType === "none"
                        ? "No discount"
                        : term.discountType === "percentage"
                          ? term.discountValue + "% discount"
                          : "Rs." + fmt(term.discountValue) + " flat off"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {term.paymentDueDays === 0
                        ? "Immediate"
                        : "Net-" + term.paymentDueDays}
                    </span>
                  </div>
                </div>
                <ChevronDown
                  size={14}
                  className="text-muted-foreground group-hover:text-primary rotate-[-90deg] shrink-0 mt-1 transition-colors"
                />
              </div>
            </button>
          ))}
        </div>

        <DialogFooter className="pt-3 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Billing / Discount Accordion ─────────────────────────────────────────────

interface BillingAccordionProps {
  basicAmount: number;
  cgstRate: number;
  sgstRate: number;
  discount: DiscountConfig;
  onChange: (d: DiscountConfig) => void;
}

function BillingAccordion({
  basicAmount,
  cgstRate,
  sgstRate,
  discount,
  onChange,
}: BillingAccordionProps) {
  const { activeBillingTerms } = useBillingTerms();
  const [open, setOpen] = useState(discount.applicable);
  const [pickerOpen, setPickerOpen] = useState(false);

  const bd = computeBreakdown(basicAmount, cgstRate, sgstRate, discount);
  const hasBase = basicAmount > 0;

  const toggle = (applicable: boolean) => {
    onChange({ ...discount, applicable });
    if (applicable) setOpen(true);
  };

  const applyMasterTerm = (term: MasterBillingTerm) => {
    const mapped: DiscountConfig = {
      applicable: term.discountType !== "none",
      type: term.discountType === "flat" ? "fixed" : "percentage",
      value: term.discountValue,
      appliedOn: "pre-gst",
      masterTermId: term._id,
      masterTermName: term.name,
    };
    onChange(mapped);
    if (mapped.applicable) setOpen(true);
    toast.success(`Billing term "${term.name}" applied.`);
  };

  const clearMasterTerm = () =>
    onChange({ ...discount, masterTermId: null, masterTermName: null });

  return (
    <>
      <MasterTermPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        terms={activeBillingTerms}
        onSelect={applyMasterTerm}
      />

      <div className="rounded-xl border border-border overflow-hidden">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3.5 bg-muted/40">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 shrink-0">
              <Receipt size={14} className="text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-heading font-semibold text-foreground">
                Billing Terms
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {discount.masterTermName ? (
                  <span className="text-primary font-medium">
                    From master: {discount.masterTermName}
                  </span>
                ) : discount.applicable ? (
                  <span className="text-primary font-medium">
                    Discount applied · Net Rs.
                    {hasBase ? fmt(bd.netAmount) : "-"}
                  </span>
                ) : (
                  "No discount applied"
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPickerOpen(true)}
              className="h-7 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/[0.06]"
            >
              <BookOpen size={12} />
              {discount.masterTermName ? "Change Term" : "Add New Term"}
            </Button>

            {discount.masterTermName && (
              <button
                type="button"
                onClick={clearMasterTerm}
                className="flex items-center gap-1 text-[11px] text-destructive hover:underline"
              >
                <X size={10} /> Clear
              </button>
            )}

            <button
              type="button"
              onClick={() => toggle(!discount.applicable)}
              className="flex items-center gap-1.5 text-xs font-medium transition-colors"
            >
              {discount.applicable ? (
                <>
                  <ToggleRight size={18} className="text-primary" />
                  <span className="text-primary">Discount On</span>
                </>
              ) : (
                <>
                  <ToggleLeft size={18} className="text-muted-foreground" />
                  <span className="text-muted-foreground">Discount Off</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          </div>
        </div>

        {/* Applied master term badge */}
        {discount.masterTermName && (
          <div className="px-4 py-2 bg-primary/[0.04] border-b border-primary/10 flex items-center gap-2">
            <CheckCircle2 size={12} className="text-primary shrink-0" />
            <p className="text-[11px] text-primary">
              Term{" "}
              <span className="font-semibold">{discount.masterTermName}</span>{" "}
              applied from master
              {discount.applicable
                ? " - " +
                  (discount.type === "percentage"
                    ? discount.value + "% discount"
                    : "Rs." + fmt(discount.value) + " flat off")
                : " - No discount"}
            </p>
          </div>
        )}

        {/* Body */}
        {open && (
          <div className="border-t border-border bg-card">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-border">
              {/* Left: discount config */}
              <div className="p-4 space-y-4">
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground">
                  Discount Configuration
                </p>

                {!discount.applicable && (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 flex flex-col items-center gap-2 text-center">
                    <Tag size={18} className="text-muted-foreground/40" />
                    <p className="text-xs text-muted-foreground">
                      Toggle discount on or pick a term from master
                    </p>
                    <div className="flex items-center gap-3 mt-1 flex-wrap justify-center">
                      <button
                        type="button"
                        onClick={() => toggle(true)}
                        className="text-xs text-primary font-medium hover:underline"
                      >
                        Enable manually
                      </button>
                      <span className="text-muted-foreground/40 text-xs">
                        or
                      </span>
                      <button
                        type="button"
                        onClick={() => setPickerOpen(true)}
                        className="text-xs text-primary font-medium hover:underline"
                      >
                        Pick from master
                      </button>
                    </div>
                  </div>
                )}

                {discount.applicable && (
                  <div className="space-y-4">
                    <Field label="Discount Type">
                      <div className="grid grid-cols-2 gap-2">
                        {(["percentage", "fixed"] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => onChange({ ...discount, type: t })}
                            className={
                              "rounded-lg border px-3 py-2 text-xs font-heading font-semibold transition-all " +
                              (discount.type === t
                                ? "border-primary bg-primary/[0.07] text-primary ring-1 ring-primary/20"
                                : "border-border bg-background text-muted-foreground hover:border-primary/30")
                            }
                          >
                            {t === "percentage"
                              ? "Percentage (%)"
                              : "Fixed Amount (Rs.)"}
                          </button>
                        ))}
                      </div>
                    </Field>

                    <Field
                      label={
                        discount.type === "percentage"
                          ? "Discount %"
                          : "Discount Amount (Rs.)"
                      }
                    >
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
                          {discount.type === "percentage" ? (
                            <Percent size={12} />
                          ) : (
                            "Rs."
                          )}
                        </span>
                        <Input
                          type="number"
                          min={0}
                          max={discount.type === "percentage" ? 100 : undefined}
                          value={discount.value || ""}
                          onChange={(e) =>
                            onChange({
                              ...discount,
                              value: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="pl-8"
                          placeholder="0"
                        />
                      </div>
                    </Field>
                  </div>
                )}
              </div>

              {/* Right: price breakdown */}
              <div className="p-4">
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground mb-3">
                  Price Breakdown
                </p>

                {!hasBase ? (
                  <div className="flex flex-col items-center justify-center gap-2 text-center py-8 rounded-lg border border-dashed border-border bg-muted/20">
                    <AlertCircle
                      size={16}
                      className="text-muted-foreground/40"
                    />
                    <p className="text-xs text-muted-foreground">
                      Basic amount not yet set
                    </p>
                    <p className="text-[10px] text-muted-foreground/60">
                      Link a purchase order to auto-fill amounts
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border overflow-hidden divide-y divide-border/60 text-xs">
                    <BreakdownRow
                      label="Basic Amount"
                      sublabel="From purchase order"
                      value={"Rs." + fmt(bd.basicAmount)}
                      variant="neutral"
                    />

                    {discount.applicable && (
                      <BreakdownRow
                        label={
                          "Discount " +
                          (discount.type === "percentage"
                            ? "(" + discount.value + "%)"
                            : "Fixed")
                        }
                        sublabel="Applied before GST"
                        value={"- Rs." + fmt(bd.discountAmount)}
                        variant="debit"
                      />
                    )}

                    {discount.applicable && (
                      <BreakdownRow
                        label="Taxable Amount"
                        sublabel="After discount"
                        value={"Rs." + fmt(bd.taxableAmount)}
                        variant="subtotal"
                      />
                    )}

                    <BreakdownRow
                      label={"CGST @ " + cgstRate + "%"}
                      sublabel="Central GST"
                      value={"Rs." + fmt(bd.cgstAmount)}
                      variant="tax"
                    />
                    <BreakdownRow
                      label={"SGST @ " + sgstRate + "%"}
                      sublabel="State GST"
                      value={"Rs." + fmt(bd.sgstAmount)}
                      variant="tax"
                    />

                    <BreakdownRow
                      label="Gross Amount"
                      sublabel={
                        discount.applicable
                          ? "Taxable + CGST + SGST"
                          : "Basic + CGST + SGST"
                      }
                      value={"Rs." + fmt(bd.grossAmount)}
                      variant="subtotal"
                    />

                    {Math.abs(bd.roundOff) > 0 && (
                      <BreakdownRow
                        label="Round Off"
                        sublabel="Nearest rupee"
                        value={
                          (bd.roundOff >= 0 ? "+" : "") +
                          "Rs." +
                          fmt(Math.abs(bd.roundOff))
                        }
                        variant="neutral"
                      />
                    )}

                    <BreakdownRow
                      label="Net Payable"
                      sublabel="Final amount due"
                      value={"Rs." + fmt(bd.netAmount)}
                      variant="total"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

type BRVariant = "neutral" | "debit" | "tax" | "subtotal" | "total";

function BreakdownRow({
  label,
  sublabel,
  value,
  variant,
}: {
  label: string;
  sublabel?: string;
  value: string;
  variant: BRVariant;
}) {
  const bg: Record<BRVariant, string> = {
    neutral: "bg-background",
    debit: "bg-background",
    tax: "bg-amber-50/40 dark:bg-amber-900/10",
    subtotal: "bg-muted/40",
    total: "bg-muted/50",
  };
  const vc: Record<BRVariant, string> = {
    neutral: "text-foreground",
    debit: "text-destructive",
    tax: "text-amber-700 dark:text-amber-400",
    subtotal: "text-foreground font-semibold",
    total: "text-foreground font-bold text-sm",
  };
  return (
    <div
      className={
        "flex items-center justify-between px-3.5 py-2.5 " + bg[variant]
      }
    >
      <div className="min-w-0 mr-2">
        <p
          className={
            "text-xs truncate " +
            (variant === "total" || variant === "subtotal"
              ? "font-heading font-semibold text-foreground"
              : "text-foreground")
          }
        >
          {label}
        </p>
        {sublabel && (
          <p className="text-[10px] text-muted-foreground mt-0.5 hidden sm:block">
            {sublabel}
          </p>
        )}
      </div>
      <span className={"text-xs font-mono shrink-0 " + vc[variant]}>
        {value}
      </span>
    </div>
  );
}

// ─── Mobile record card ───────────────────────────────────────────────────────

function RecordCard({
  rec,
  onEdit,
  onDelete,
  onApprovalSuccess,
}: {
  rec: ExpenseRecord;
  onEdit: () => void;
  onDelete: () => void;
  onApprovalSuccess: () => void;
}) {
  const rbd = computeBreakdown(
    rec.basicAmount,
    rec.cgstRate,
    rec.sgstRate,
    rec.discount,
  );
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold text-foreground">
            {rec.bookingReference}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {rec.supplier}
          </p>
        </div>
        <StatusBadge status={rec.status} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div>
          <span className="text-muted-foreground">Date: </span>
          <span>{rec.bookingDate}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Due: </span>
          <span>{rec.dueDate || "-"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">PO: </span>
          <span className="font-mono text-foreground/80">{rec.poId || "-"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Invoice: </span>
          <span className="font-mono">{rec.invoiceReference || "-"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Basic: </span>
          <span className="font-mono">Rs.{fmt(rec.basicAmount)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Discount: </span>
          {rec.discount.applicable ? (
            <span className="text-destructive font-medium">
              {rec.discount.type === "percentage"
                ? rec.discount.value + "%"
                : "Rs." + fmt(rec.discount.value)}
            </span>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <div>
          <p className="text-[10px] text-muted-foreground">Net Payable</p>
          <p className="text-sm font-mono font-semibold text-foreground">
            Rs.{fmt(rbd.netAmount)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 items-center justify-end">
          <ApprovalActions
            status={rec.status}
            recordId={rec.id}
            endpoint="/api/expense-booking"
            onSuccess={onApprovalSuccess}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onEdit}
          >
            <Edit size={13} />
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onDelete}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const API = "/api/expense-booking";

async function apiFetch(url: string, opts?: RequestInit) {
  const token = localStorage.getItem("token");
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** Map DB row → ExpenseRecord (frontend shape) */
function dbToRecord(row: any): ExpenseRecord {
  return {
    id: String(row.Eid),
    bookingReference: row.EDocNo ?? "",
    bookingDate: row.EDocDate ? row.EDocDate.slice(0, 10) : "",
    dueDate: row.EReminder ? row.EReminder.slice(0, 10) : "",
    financialYear: "",
    poId: null,
    supplier: row.EProjectName ?? "",   // closest available field
    projectSite: row.EProjectName ?? "",
    materialCategory: row.EDocumentType ?? "",
    invoiceReference: row.EDocNo ?? "",
    basicAmount: parseFloat(row.EAmount) || 0,
    cgstRate: 18,
    sgstRate: 0,
    discount: defaultDiscount(),
    netAmount: parseFloat(row.EAmount) || 0,
    status: (row.Status ?? row.EStatus ?? "Draft") as BookingStatus,
    remarks: row.ERemarks ?? "",
  };
}

/** Map form state → POST/PUT body */
function recordToDb(form: Omit<ExpenseRecord, "id">) {
  return {
    EProjectName: form.supplier || form.projectSite || null,
    EDocumentType: form.materialCategory || null,
    EDocDate: form.bookingDate || null,
    EAmount: form.basicAmount || null,
    EDocNo: form.bookingReference || null,
    EEmiPayment: false,
    EReminder: form.dueDate || null,
    ERemarks: form.remarks || null,
    EStatus: form.status ?? "Draft",
    ECompanyId: null,
  };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MaterialExpenseBooking() {
  const { finYears } = useFinYear();
  const activeFinYears = finYears.filter((fy) => fy.status === "Active");

  const [purchaseOrders] = useState<PurchaseOrder[]>([]);
  const [records, setRecords] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<PageView>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<ExpenseRecord, "id">>(blankForm());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Fetch list from API ──
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

  React.useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const set = <K extends keyof Omit<ExpenseRecord, "id">>(
    field: K,
    value: Omit<ExpenseRecord, "id">[K],
  ) => setForm((prev) => ({ ...prev, [field]: value }));

  const linkPO = (poNumber: string) => {
    const po = purchaseOrders.find((p) => p.poNumber === poNumber);
    if (!po) { set("poId", null); return; }
    setForm((prev) => ({
      ...prev,
      poId: po.poNumber,
      supplier: po.supplier,
      projectSite: po.projectSite,
      materialCategory: prev.materialCategory,
      invoiceReference: po.invoiceReference,
      basicAmount: po.totalAmount,
      cgstRate: po.cgstRate,
      sgstRate: po.sgstRate,
    }));
  };

  const openNew = () => {
    setEditingId(null);
    setForm(blankForm());
    setView("form");
  };
  const openEdit = (rec: ExpenseRecord) => {
    setEditingId(rec.id);
    const { id, ...rest } = rec;
    setForm(rest);
    setView("form");
  };
  const cancelForm = () => {
    setView("list");
    setEditingId(null);
    setForm(blankForm());
  };

  const handleSave = async () => {
    if (!form.bookingReference.trim() || !form.bookingDate) {
      toast.error("Please fill in the Booking Reference and Date.");
      return;
    }
    const bd = computeBreakdown(form.basicAmount, form.cgstRate, form.sgstRate, form.discount);
    const body = { ...recordToDb(form), EAmount: bd.netAmount };

    try {
      setSaving(true);
      if (editingId) {
        await apiFetch(`${API}/${editingId}`, { method: "PUT", body: JSON.stringify(body) });
        toast.success("Expense booking updated.");
      } else {
        await apiFetch(API, { method: "POST", body: JSON.stringify(body) });
        toast.success("Expense booking created.");
      }
      await fetchRecords();
      cancelForm();
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

  /** Called by ApprovalActions after any status change — refetch to get live status */
  const handleApprovalSuccess = async () => {
    await fetchRecords();
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "Expense Booking"]} />
      <div className="space-y-4">
        {/* Page header */}
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

        {/* ── Inline Form ─────────────────────────────────────────────────── */}
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
                  <div className="min-w-0">
                    <CardTitle className="text-base sm:text-lg font-heading">
                      {editingId
                        ? "Edit Expense Booking"
                        : "New Expense Booking"}
                    </CardTitle>
                    <CardDescription className="text-xs mt-0.5 hidden sm:block">
                      Link a purchase order to auto-fill supplier, invoice and
                      amount details.
                    </CardDescription>
                  </div>
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
              {/* ── Booking Info ── */}
              <FormSection label="Booking Information">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label="Booking Reference" required>
                    <Input
                      value={form.bookingReference}
                      onChange={(e) =>
                        set("bookingReference", e.target.value.toUpperCase())
                      }
                      placeholder="e.g. MEB-25001"
                    />
                  </Field>
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
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Financial Year">
                    <Select
                      value={form.financialYear}
                      onValueChange={(v) => set("financialYear", v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select financial year..." />
                      </SelectTrigger>
                      <SelectContent>
                        {activeFinYears.map((fy) => (
                          <SelectItem key={fy.id} value={fy.year}>
                            {fy.year}
                          </SelectItem>
                        ))}
                        {finYears
                          .filter((fy) => fy.status !== "Active")
                          .map((fy) => (
                            <SelectItem
                              key={fy.id}
                              value={fy.year}
                              className="text-muted-foreground"
                            >
                              {fy.year} ({fy.status})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </Field>
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
                            "Approved",
                            "Booked",
                            "Hold",
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
              </FormSection>

              {/* ── Purchase Order Link ── */}
              <FormSection label="Purchase Order">
                <Field
                  label="Link Purchase Order"
                  required
                  hint="Selecting a PO auto-fills supplier, invoice reference, project site and amounts."
                >
                  <Select value={form.poId ?? ""} onValueChange={linkPO}>
                    <SelectTrigger>
                      <div className="flex items-center gap-2">
                        <Link2
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                        <SelectValue placeholder="Select purchase order..." />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {purchaseOrders.map((po) => (
                        <SelectItem key={po.poNumber} value={po.poNumber}>
                          <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2">
                            <span className="font-mono text-xs font-semibold">
                              {po.poNumber}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              - {po.supplier}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                {form.poId && (
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-3 sm:p-4 space-y-3">
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
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <ReadonlyField
                        label="Basic Amount (Rs.)"
                        value={"Rs." + fmt(form.basicAmount)}
                        highlight
                      />
                      <ReadonlyField
                        label={"CGST @ " + form.cgstRate + "%"}
                        value={
                          "Rs." + fmt((form.basicAmount * form.cgstRate) / 100)
                        }
                      />
                      <ReadonlyField
                        label={"SGST @ " + form.sgstRate + "%"}
                        value={
                          "Rs." + fmt((form.basicAmount * form.sgstRate) / 100)
                        }
                      />
                    </div>
                  </div>
                )}
              </FormSection>

              {/* ── Billing Terms ── */}
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

              {/* ── Remarks ── */}
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
                <Button className="gradient-accent" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : editingId ? "Update Booking" : "Save Booking"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Bookings List ── */}
        {view === "list" && (
          <>
            {loading && (
              <div className="text-center py-12 text-muted-foreground text-sm">
                Loading bookings…
              </div>
            )}
            {!loading && (
            <>
            {/* Mobile: card layout */}
            <div className="flex flex-col gap-3 sm:hidden">
              {records.length === 0 && (
                <div className="text-center py-12 text-muted-foreground text-sm border rounded-xl border-dashed border-border">
                  No bookings yet. Tap "New" to get started.
                </div>
              )}
              {records.map((rec) => (
                <RecordCard
                  key={rec.id}
                  rec={rec}
                  onEdit={() => openEdit(rec)}
                  onDelete={() => setDeleteId(rec.id)}
                  onApprovalSuccess={handleApprovalSuccess}
                />
              ))}
            </div>

            {/* Desktop: table layout */}
            <Card className="hidden sm:block">
              <CardContent className="p-0">
                <div className="rounded-md overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead>PO No.</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead className="hidden md:table-cell">
                          Invoice Ref
                        </TableHead>
                        <TableHead>Basic Amt</TableHead>
                        <TableHead>Discount</TableHead>
                        <TableHead>Net Amt</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {records.map((rec) => {
                        const rbd = computeBreakdown(
                          rec.basicAmount,
                          rec.cgstRate,
                          rec.sgstRate,
                          rec.discount,
                        );
                        return (
                          <TableRow key={rec.id}>
                            <TableCell className="font-mono text-xs">
                              {rec.bookingReference}
                            </TableCell>
                            <TableCell className="text-xs">
                              {rec.bookingDate}
                            </TableCell>
                            <TableCell className="text-xs">
                              {rec.dueDate || "-"}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-foreground/80">
                              {rec.poId || "-"}
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
                            <TableCell>
                              {rec.discount.applicable ? (
                                <span className="text-xs text-destructive font-medium">
                                  {rec.discount.type === "percentage"
                                    ? rec.discount.value + "%"
                                    : "Rs." + fmt(rec.discount.value)}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  -
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              <span className="text-foreground font-semibold">
                                Rs.{fmt(rbd.netAmount)}
                              </span>
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
                                  onSuccess={handleApprovalSuccess}
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
                      {records.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={11}
                            className="text-center py-10 text-muted-foreground text-sm"
                          >
                            No bookings yet. Click "New Booking" to get started.
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

      {/* Delete confirmation */}
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


