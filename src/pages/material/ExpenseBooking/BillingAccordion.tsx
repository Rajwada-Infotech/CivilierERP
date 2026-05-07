import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Receipt,
  X,
  ChevronDown,
  ChevronUp,
  Tag,
  Percent,
  ToggleLeft,
  ToggleRight,
  Link2,
  AlertCircle,
  BookOpen,
  Clock,
  BadgePercent,
} from "lucide-react";
import { toast } from "sonner";
import {
  useBillingTerms,
  type BillingTerm as MasterBillingTerm,
} from "@/contexts/BillingTermsContext";
import { Field, PriceBreakdownPanel } from "./FormPrimitives";
import { computeBreakdown, defaultDiscount, fmt } from "./helpers";
import type { DiscountConfig } from "./types";

// ─── MasterTermPicker ─────────────────────────────────────────────────────────

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

function MasterTermPicker({
  open,
  onClose,
  terms,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  terms: MasterBillingTerm[];
  onSelect: (term: MasterBillingTerm) => void;
}) {
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
                No active billing terms found in master
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
                    {term.calculationType && (
                      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-heading bg-muted text-muted-foreground border-border">
                        {term.calculationType}
                      </span>
                    )}
                  </div>
                  {term.description && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {term.description}
                    </p>
                  )}
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

// ─── BillingAccordion ─────────────────────────────────────────────────────────

interface Props {
  basicAmount: number;
  cgstRate: number;
  sgstRate: number;
  discount: DiscountConfig;
  onChange: (d: DiscountConfig) => void;
}

export function BillingAccordion({
  basicAmount,
  cgstRate,
  sgstRate,
  discount,
  onChange,
}: Props) {
  const { activeBillingTerms = [] } = useBillingTerms();
  const [open, setOpen] = useState(discount.applicable);
  const [pickerOpen, setPickerOpen] = useState(false);

  const bd = computeBreakdown(basicAmount, cgstRate, sgstRate, discount);
  const hasBase = basicAmount > 0;

  const toggle = (applicable: boolean) => {
    onChange({ ...discount, applicable });
    if (applicable) setOpen(true);
  };

  const applyMasterTerm = (term: MasterBillingTerm) => {
    const hasDiscount = term.discountType !== "none" && term.discountValue > 0;
    const mapped: DiscountConfig = {
      applicable: hasDiscount,
      type: term.discountType === "flat" ? "fixed" : "percentage",
      value: hasDiscount ? term.discountValue : 0,
      appliedOn: "pre-gst",
      masterTermId: term._id,
      masterTermName: term.name,
    };
    onChange(mapped);
    if (hasDiscount) setOpen(true);
    toast.success(`Billing term "${term.name}" applied!`);
    setPickerOpen(false);
  };

  const clearMasterTerm = () => {
    onChange(defaultDiscount());
    toast.info("Master billing term cleared.");
  };

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
                    Discount applied · Net Rs.{" "}
                    {hasBase ? fmt(bd.netAmount) : "-"}
                  </span>
                ) : (
                  "No discount / master term applied"
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
              {discount.masterTermName ? "Change Term" : "Pick from Master"}
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

        {/* Body */}
        {open && (
          <div className="border-t border-border bg-card">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-border">
              {/* Left: Discount Config */}
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

              {/* Right: Price Breakdown */}
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
                  </div>
                ) : (
                  <PriceBreakdownPanel
                    bd={bd}
                    cgstRate={cgstRate}
                    sgstRate={sgstRate}
                    hasDiscount={discount.applicable}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
