import React from "react";
import { Label } from "@/components/ui/label";
import { fmt } from "./helpers";
import type { PriceBreakdown, DiscountConfig } from "./types";

// ─── FormSection ──────────────────────────────────────────────────────────────

export function FormSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <p className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-foreground border-b border-border pb-1.5">
        {label}
      </p>
      {children}
    </div>
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────

export function Field({
  label,
  required,
  hint,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5${className ? ` ${className}` : ""}`}>
      <Label className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[0.625rem] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ─── ReadonlyField ────────────────────────────────────────────────────────────

export function ReadonlyField({
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
          "rounded-lg border px-3 py-2 text-sm font-heading tabular-nums min-h-[38px] flex items-center " +
          (highlight
            ? "border-foreground/40 bg-primary/10 text-foreground font-semibold"
            : "border-border/60 bg-muted/30 text-foreground")
        }
      >
        {value || (
          <span className="text-muted-foreground/50 font-sans font-normal text-xs">
            Auto-filled
          </span>
        )}
      </div>
    </div>
  );
}

// ─── BreakdownRow ─────────────────────────────────────────────────────────────

type BRVariant =
  | "neutral"
  | "debit"
  | "addition"
  | "tax"
  | "subtotal"
  | "total";

export function BreakdownRow({
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
  // A computation set out on paper: plain rows, an ink rule above each sub-total and the total, figures in one face.
  const rowStyles: Record<BRVariant, string> = {
    neutral: "",
    debit: "",
    addition: "",
    tax: "",
    subtotal: "border-t border-foreground",
    total: "border-t-2 border-foreground",
  };

  const labelStyles: Record<BRVariant, string> = {
    neutral: "text-foreground text-xs",
    debit: "text-foreground text-xs",
    addition: "text-foreground text-xs",
    tax: "text-muted-foreground text-xs",
    subtotal: "text-foreground font-heading text-[0.625rem] font-semibold uppercase tracking-[0.12em]",
    total: "text-foreground font-heading text-[0.625rem] font-semibold uppercase tracking-[0.12em]",
  };

  const valueStyles: Record<BRVariant, string> = {
    neutral: "text-foreground text-xs font-heading tabular-nums",
    debit: "text-destructive text-xs font-heading tabular-nums",
    addition: "text-foreground text-xs font-heading tabular-nums",
    tax: "text-foreground text-xs font-heading tabular-nums",
    subtotal: "text-foreground text-xs font-heading tabular-nums font-semibold",
    total: "text-foreground text-base font-heading tabular-nums font-bold",
  };

  return (
    <div
      className={`flex items-center justify-between px-4 py-3 ${rowStyles[variant]}`}
    >
      <div className="min-w-0 mr-4">
        <p className={labelStyles[variant]}>{label}</p>
        {sublabel && (
          <p className="text-[0.625rem] text-muted-foreground mt-0.5">{sublabel}</p>
        )}
      </div>
      <span className={`shrink-0 ${valueStyles[variant]}`}>{value}</span>
    </div>
  );
}

// ─── PriceBreakdownPanel ──────────────────────────────────────────────────────

export function PriceBreakdownPanel({
  bd,
  cgstRate,
  sgstRate,
  igstRate = 0,
  hasDiscount,
  tdsAmount = 0,
}: {
  bd: PriceBreakdown;
  cgstRate: number;
  sgstRate: number;
  igstRate?: number;
  hasDiscount: boolean;
  tdsAmount?: number;
}) {
  const preGstTerms = bd.preGstTerms ?? [];
  const postGstTerms = bd.postGstTerms ?? [];
  if (igstRate > 0) {
    bd = { ...bd, cgstAmount: bd.igstAmount ?? 0, sgstAmount: 0 };
  }

  const hasPreGst = preGstTerms.length > 0;
  const hasPostGst = postGstTerms.length > 0;


  // Calculate running base for per-term amount display
  let runningBase = bd.basicAmount;
  const preGstRows: { term: any; amt: number }[] = [];
  for (const t of preGstTerms) {
    const amt =
      t.type === "percentage" ? (runningBase * t.value) / 100 : t.value;
    preGstRows.push({ term: t, amt });
    if (t.termType === "Addition") runningBase += amt;
    else runningBase = Math.max(0, runningBase - amt);
  }

  return (
    <div className="border border-foreground overflow-hidden divide-y divide-border/60 bg-card">
      {/* Basic Amount */}
      <BreakdownRow
        label="Basic Amount"
        sublabel="Pre-tax value"
        value={"₹" + fmt(bd.basicAmount)}
        variant="neutral"
      />

      {/* Pre-GST Billing Terms */}
      {hasPreGst &&
        preGstRows.map(({ term, amt }, i) => {
          const isAddition = term.termType === "Addition";
          return (
            <BreakdownRow
              key={term._key ?? i}
              label={term.masterTermName ?? `Term ${i + 1}`}
              sublabel={`${isAddition ? "Addition" : "Deduction"} · Before GST${
                term.type === "percentage" ? ` · ${term.value}%` : ""
              }`}
              value={(isAddition ? "+ ₹" : "− ₹") + fmt(amt)}
              variant={isAddition ? "addition" : "debit"}
            />
          );
        })}

      {/* Taxable Amount (shown when there are pre-GST terms) */}
      {hasPreGst && (
        <BreakdownRow
          label="Taxable Amount"
          sublabel="After pre-GST adjustments"
          value={"₹" + fmt(bd.taxableAmount)}
          variant="subtotal"
        />
      )}

      {/* GST rows */}
      <BreakdownRow
        label={
          igstRate > 0 ? `IGST @ ${igstRate}%` : `CGST @ ${cgstRate}%`
        }
        sublabel={igstRate > 0 ? "Integrated GST" : "Central GST"}
        value={"₹" + fmt(bd.cgstAmount)}
        variant="tax"
      />
      {igstRate <= 0 && (
        <BreakdownRow
        label={`SGST @ ${sgstRate}%`}
        sublabel="State GST"
        value={"₹" + fmt(bd.sgstAmount)}
          variant="tax"
        />
      )}

      {/* Gross (before post-GST terms) */}
      <BreakdownRow
        label="Gross Amount"
        sublabel={
          igstRate > 0
            ? hasPreGst
              ? "Taxable + IGST"
              : "Basic + IGST"
            : hasPreGst
              ? "Taxable + CGST + SGST"
              : "Basic + CGST + SGST"
        }
        value={"₹" + fmt(bd.taxableAmount + bd.cgstAmount + bd.sgstAmount)}
        variant="subtotal"
      />

      {/* Post-GST Billing Terms */}
      {hasPostGst &&
        (() => {
          let pgBase = bd.taxableAmount + bd.cgstAmount + bd.sgstAmount;
          return postGstTerms.map((term, i) => {
            const amt =
              term.type === "percentage"
                ? (pgBase * term.value) / 100
                : term.value;
            const isAddition = term.termType === "Addition";
            if (isAddition) pgBase += amt;
            else pgBase = Math.max(0, pgBase - amt);
            return (
              <BreakdownRow
                key={term._key ?? `post-${i}`}
                label={term.masterTermName ?? `Term ${i + 1}`}
                sublabel={`${isAddition ? "Addition" : "Deduction"} · After GST${
                  term.type === "percentage" ? ` · ${term.value}%` : ""
                }`}
                value={(isAddition ? "+ ₹" : "− ₹") + fmt(amt)}
                variant={isAddition ? "addition" : "debit"}
              />
            );
          });
        })()}

      {/* Round off */}
      {Math.abs(bd.roundOff) > 0 && (
        <BreakdownRow
          label="Round Off"
          sublabel="Nearest rupee"
          value={(bd.roundOff >= 0 ? "+₹" : "−₹") + fmt(Math.abs(bd.roundOff))}
          variant="neutral"
        />
      )}

      {/* TDS withheld at source */}
      {tdsAmount > 0 && (
        <BreakdownRow
          label="TDS Withheld"
          sublabel="Deducted at source"
          value={"− ₹" + fmt(tdsAmount)}
          variant="debit"
        />
      )}

      {/* Net Payable */}
      <BreakdownRow
        label="Net Payable"
        sublabel={tdsAmount > 0 ? "Payable after TDS deduction" : "Final amount due"}
        value={"₹" + fmt(Math.max(0, bd.netAmount - tdsAmount))}
        variant="total"
      />
    </div>
  );
}