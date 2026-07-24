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
      <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground border-b border-border/60 pb-1.5">
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
      <Label className="text-xs">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
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
          "rounded-lg border px-3 py-2 text-sm font-mono min-h-[38px] flex items-center " +
          (highlight
            ? "border-emerald-500/30 bg-emerald-500/[0.05] text-foreground font-semibold"
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
  const rowStyles: Record<BRVariant, string> = {
    neutral: "bg-card",
    debit: "bg-card",
    addition: "bg-card",
    tax: "bg-muted/30",
    subtotal: "bg-muted/50",
    total: "bg-muted/60",
  };

  const labelStyles: Record<BRVariant, string> = {
    neutral: "text-foreground text-xs",
    debit: "text-foreground text-xs",
    addition: "text-foreground text-xs",
    tax: "text-foreground text-xs",
    subtotal: "text-foreground text-xs font-semibold font-heading",
    total: "text-foreground text-xs font-semibold font-heading",
  };

  const valueStyles: Record<BRVariant, string> = {
    neutral: "text-foreground text-xs font-mono",
    debit: "text-destructive text-xs font-mono",
    addition: "text-green-500 text-xs font-mono",
    tax: "text-emerald-600 dark:text-emerald-400 text-xs font-mono",
    subtotal: "text-foreground text-xs font-mono font-semibold",
    total: "text-foreground text-sm font-mono font-bold",
  };

  return (
    <div
      className={`flex items-center justify-between px-4 py-3 ${rowStyles[variant]}`}
    >
      <div className="min-w-0 mr-4">
        <p className={labelStyles[variant]}>{label}</p>
        {sublabel && (
          <p className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</p>
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
}: {
  bd: PriceBreakdown;
  cgstRate: number;
  sgstRate: number;
  igstRate?: number;
  hasDiscount: boolean;
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
    <div className="rounded-xl border border-border overflow-hidden divide-y divide-border/50">
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

      {/* Net Payable */}
      <BreakdownRow
        label="Net Payable"
        sublabel="Final amount due"
        value={"₹" + fmt(bd.netAmount)}
        variant="total"
      />
    </div>
  );
}