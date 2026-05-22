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
  AlertCircle,
  BookOpen,
  Plus,
  Trash2,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import {
  useBillingTerms,
  type BillingTerm as MasterBillingTerm,
} from "@/contexts/BillingTermsContext";
import { Field, PriceBreakdownPanel } from "./FormPrimitives";
import { computeBreakdown, defaultDiscount, fmt } from "./helpers";
import type { DiscountConfig } from "./types";

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeKey() {
  return `bt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function newTerm(): DiscountConfig {
  return { ...defaultDiscount(), applicable: true, _key: makeKey() };
}

// ─── MasterTermPicker ─────────────────────────────────────────────────────────

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

// ─── SingleTermRow ─────────────────────────────────────────────────────────────

function SingleTermRow({
  term,
  index,
  total,
  basicAmount,
  runningBase,
  onUpdate,
  onRemove,
  onPickMaster,
}: {
  term: DiscountConfig;
  index: number;
  total: number;
  basicAmount: number;
  runningBase: number;
  onUpdate: (updated: DiscountConfig) => void;
  onRemove: () => void;
  onPickMaster: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const isAddition = term.deductionType === "Addition";
  const discountAmount = term.applicable
    ? term.type === "percentage"
      ? (runningBase * term.value) / 100
      : term.value
    : 0;
  const afterThisTerm = isAddition
    ? runningBase + discountAmount
    : Math.max(0, runningBase - discountAmount);

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {/* Row header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-[10px] font-heading font-semibold text-primary shrink-0">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-heading font-semibold text-foreground truncate flex items-center gap-1.5">
              {term.masterTermName ?? `Term ${index + 1}`}
              {term.masterTermName && (
                <span
                  className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                    isAddition
                      ? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
                      : "bg-destructive/10 text-destructive border-destructive/20"
                  }`}
                >
                  {isAddition ? "+ Addition" : "− Deduction"}
                </span>
              )}
            </p>
            {term.applicable && basicAmount > 0 && (
              <p className="text-[10px] text-muted-foreground">
                {isAddition ? "+" : "−"}₹{fmt(discountAmount)}{" "}
                <span className="opacity-60">
                  ({term.appliedOn === "post-gst" ? "After GST" : "Before GST"})
                </span>{" "}
                → ₹{fmt(afterThisTerm)}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onPickMaster}
            className="flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <BookOpen size={11} />
            {term.masterTermName ? "Change" : "From Master"}
          </button>

          <button
            type="button"
            onClick={() => onUpdate({ ...term, applicable: !term.applicable })}
            className="flex items-center gap-1 text-[11px] font-medium transition-colors"
          >
            {term.applicable ? (
              <>
                <ToggleRight size={15} className="text-primary" />
                <span className="text-primary hidden sm:inline">On</span>
              </>
            ) : (
              <>
                <ToggleLeft size={15} className="text-muted-foreground" />
                <span className="text-muted-foreground hidden sm:inline">
                  Off
                </span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {total > 1 && (
            <button
              type="button"
              onClick={onRemove}
              className="text-destructive/60 hover:text-destructive transition-colors"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border bg-card p-3 space-y-3">
          {!term.applicable ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-4 flex flex-col items-center gap-1.5 text-center">
              <Tag size={15} className="text-muted-foreground/40" />
              <p className="text-[11px] text-muted-foreground">
                Toggle on to configure this discount term
              </p>
            </div>
          ) : (
            <>
              <Field label="Type">
                <div className="grid grid-cols-2 gap-2">
                  {(["percentage", "fixed"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => onUpdate({ ...term, type: t })}
                      className={
                        "rounded-lg border px-3 py-1.5 text-xs font-heading font-semibold transition-all " +
                        (term.type === t
                          ? "border-primary bg-primary/[0.07] text-primary ring-1 ring-primary/20"
                          : "border-border bg-background text-muted-foreground hover:border-primary/30")
                      }
                    >
                      {t === "percentage"
                        ? "Percentage (%)"
                        : "Fixed Amount (₹)"}
                    </button>
                  ))}
                </div>
              </Field>

              <Field
                label={
                  term.type === "percentage"
                    ? `${isAddition ? "Addition" : "Deduction"} % (${term.appliedOn === "post-gst" ? "After GST" : "Before GST"})`
                    : `${isAddition ? "Addition" : "Deduction"} Amount (₹)`
                }
              >
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
                    {term.type === "percentage" ? <Percent size={11} /> : "₹"}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    max={term.type === "percentage" ? 100 : undefined}
                    value={term.value || ""}
                    onChange={(e) =>
                      onUpdate({
                        ...term,
                        value: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="pl-8 h-8 text-sm"
                    placeholder="0"
                  />
                </div>
              </Field>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── BillingAccordion ─────────────────────────────────────────────────────────

interface Props {
  basicAmount: number;
  cgstRate: number;
  sgstRate: number;
  /** Legacy single-term (kept for backward compat) */
  discount: DiscountConfig;
  /** Multi-term list — the primary prop going forward */
  billingTerms?: DiscountConfig[];
  onChange: (d: DiscountConfig) => void;
  onChangeBillingTerms?: (terms: DiscountConfig[]) => void;
}

export function BillingAccordion({
  basicAmount,
  cgstRate,
  sgstRate,
  discount,
  billingTerms,
  onChange,
  onChangeBillingTerms,
}: Props) {
  const { activeBillingTerms = [] } = useBillingTerms();
  const [open, setOpen] = useState(true);

  const isMulti = onChangeBillingTerms !== undefined;

  const terms: DiscountConfig[] =
    isMulti && billingTerms && billingTerms.length > 0
      ? billingTerms
      : isMulti
        ? [{ ...discount, _key: discount._key ?? makeKey() }]
        : [discount];

  const setTerms = (next: DiscountConfig[]) => {
    if (isMulti && onChangeBillingTerms) {
      onChangeBillingTerms(next);
      const first =
        next.find((t) => t.applicable) ?? next[0] ?? defaultDiscount();
      onChange(first);
    } else {
      onChange(next[0] ?? defaultDiscount());
    }
  };

  const [pickerForIndex, setPickerForIndex] = useState<number | null>(null);

  const applyMasterTerm = (masterTerm: MasterBillingTerm, idx: number) => {
    const hasDiscount =
      masterTerm.discountType !== "none" && masterTerm.discountValue > 0;
    const updated: DiscountConfig = {
      ...terms[idx],
      applicable: true,
      type: masterTerm.discountType === "flat" ? "fixed" : "percentage",
      value: hasDiscount ? masterTerm.discountValue : 0,
      appliedOn: masterTerm.appliedOn ?? "pre-gst",
      masterTermId: masterTerm._id,
      masterTermName: masterTerm.name,
      deductionType: masterTerm.deductionType ?? "Deduction",
    };
    setTerms(terms.map((t, i) => (i === idx ? updated : t)));
    toast.success(`Billing term "${masterTerm.name}" applied!`);
  };

  const addTerm = () => setTerms([...terms, newTerm()]);
  const removeTerm = (idx: number) => {
    const next = terms.filter((_, i) => i !== idx);
    setTerms(next.length > 0 ? next : [newTerm()]);
  };
  const updateTerm = (idx: number, updated: DiscountConfig) =>
    setTerms(terms.map((t, i) => (i === idx ? updated : t)));

  const bd = computeBreakdown(basicAmount, cgstRate, sgstRate, terms);
  const hasBase = basicAmount > 0;
  const activeCount = terms.filter((t) => t.applicable).length;

  // Running base amounts for per-row display
  // Pre-GST terms: track against basic amount
  // Post-GST terms: track against gross (taxable + cgst + sgst)
  const runningBases: number[] = [];
  let rb = basicAmount;
  const grossForPostGst = bd.taxableAmount + bd.cgstAmount + bd.sgstAmount;
  let pgRb = grossForPostGst;
  for (const t of terms) {
    if (t.appliedOn === "post-gst") {
      runningBases.push(pgRb);
      if (t.applicable) {
        const d = t.type === "percentage" ? (pgRb * t.value) / 100 : t.value;
        if (t.deductionType === "Addition") pgRb += d;
        else pgRb = Math.max(0, pgRb - d);
      }
    } else {
      runningBases.push(rb);
      if (t.applicable) {
        const d = t.type === "percentage" ? (rb * t.value) / 100 : t.value;
        if (t.deductionType === "Addition") rb += d;
        else rb = Math.max(0, rb - d);
      }
    }
  }

  return (
    <>
      <MasterTermPicker
        open={pickerForIndex !== null}
        onClose={() => setPickerForIndex(null)}
        terms={activeBillingTerms}
        onSelect={(masterTerm) => {
          if (pickerForIndex !== null)
            applyMasterTerm(masterTerm, pickerForIndex);
          setPickerForIndex(null);
        }}
      />

      <div className="rounded-xl border border-border overflow-hidden">
        {/* ── Section Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3.5 bg-muted/40">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 shrink-0">
              <Receipt size={14} className="text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-heading font-semibold text-foreground flex items-center gap-1.5">
                Billing Terms
                {isMulti && terms.length > 1 && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading px-1.5 py-0.5 border border-primary/20">
                    <Layers size={9} />
                    {terms.length}
                  </span>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {activeCount > 0 && hasBase ? (
                  <span className="text-primary font-medium">
                    {activeCount} term{activeCount > 1 ? "s" : ""} applied · Net
                    ₹{fmt(bd.netAmount)}
                  </span>
                ) : (
                  "No discount / master term applied"
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {isMulti && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addTerm}
                className="h-7 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/[0.06]"
              >
                <Plus size={11} />
                Add Term
              </Button>
            )}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        {open && (
          <div className="border-t border-border bg-card">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-border">
              {/* Left: Term list */}
              <div className="p-4 space-y-3">
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground">
                  {isMulti ? "Discount Terms" : "Discount Configuration"}
                </p>

                {isMulti ? (
                  <div className="space-y-2">
                    {terms.map((term, idx) => (
                      <SingleTermRow
                        key={term._key ?? idx}
                        term={term}
                        index={idx}
                        total={terms.length}
                        basicAmount={basicAmount}
                        runningBase={runningBases[idx] ?? basicAmount}
                        onUpdate={(updated) => updateTerm(idx, updated)}
                        onRemove={() => removeTerm(idx)}
                        onPickMaster={() => setPickerForIndex(idx)}
                      />
                    ))}

                    <button
                      type="button"
                      onClick={addTerm}
                      className="w-full rounded-xl border border-dashed border-border hover:border-primary/40 hover:bg-primary/[0.03] transition-all px-4 py-3 flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-primary"
                    >
                      <Plus size={13} />
                      Add another billing term
                    </button>
                  </div>
                ) : (
                  /* Legacy single-term UI */
                  <div className="space-y-4">
                    {!discount.applicable ? (
                      <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 flex flex-col items-center gap-2 text-center">
                        <Tag size={18} className="text-muted-foreground/40" />
                        <p className="text-xs text-muted-foreground">
                          Toggle discount on or pick a term from master
                        </p>
                      </div>
                    ) : (
                      <>
                        <Field label="Discount Type">
                          <div className="grid grid-cols-2 gap-2">
                            {(["percentage", "fixed"] as const).map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() =>
                                  onChange({ ...discount, type: t })
                                }
                                className={
                                  "rounded-lg border px-3 py-2 text-xs font-heading font-semibold transition-all " +
                                  (discount.type === t
                                    ? "border-primary bg-primary/[0.07] text-primary ring-1 ring-primary/20"
                                    : "border-border bg-background text-muted-foreground hover:border-primary/30")
                                }
                              >
                                {t === "percentage"
                                  ? "Percentage (%)"
                                  : "Fixed Amount (₹)"}
                              </button>
                            ))}
                          </div>
                        </Field>
                        <Field
                          label={
                            discount.type === "percentage"
                              ? "Discount %"
                              : "Discount Amount (₹)"
                          }
                        >
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
                              {discount.type === "percentage" ? (
                                <Percent size={12} />
                              ) : (
                                "₹"
                              )}
                            </span>
                            <Input
                              type="number"
                              min={0}
                              max={
                                discount.type === "percentage" ? 100 : undefined
                              }
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
                      </>
                    )}
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
                    hasDiscount={activeCount > 0}
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
