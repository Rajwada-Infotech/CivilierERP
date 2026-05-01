import React from "react";
import { Label } from "@/components/ui/label";
import { fmt } from "./helpers";
import type { PriceBreakdown } from "./types";

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
            ? "border-primary/30 bg-primary/5 text-foreground font-semibold"
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

type BRVariant = "neutral" | "debit" | "tax" | "subtotal" | "total";

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
    tax: "bg-muted/30",
    subtotal: "bg-muted/50",
    total: "bg-muted/60",
  };

  const labelStyles: Record<BRVariant, string> = {
    neutral: "text-foreground text-xs",
    debit: "text-foreground text-xs",
    tax: "text-foreground text-xs",
    subtotal: "text-foreground text-xs font-semibold font-heading",
    total: "text-foreground text-xs font-semibold font-heading",
  };

  const valueStyles: Record<BRVariant, string> = {
    neutral: "text-foreground text-xs font-mono",
    debit: "text-destructive text-xs font-mono",
    tax: "text-primary text-xs font-mono",
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
  hasDiscount,
}: {
  bd: PriceBreakdown;
  cgstRate: number;
  sgstRate: number;
  hasDiscount: boolean;
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden divide-y divide-border/50">
      <BreakdownRow
        label="Basic Amount"
        sublabel="Pre-tax value from linked order"
        value={"₹" + fmt(bd.basicAmount)}
        variant="neutral"
      />

      {hasDiscount && (
        <BreakdownRow
          label="Discount"
          sublabel="Applied before GST"
          value={"− ₹" + fmt(bd.discountAmount)}
          variant="debit"
        />
      )}

      {hasDiscount && (
        <BreakdownRow
          label="Taxable Amount"
          sublabel="After discount"
          value={"₹" + fmt(bd.taxableAmount)}
          variant="subtotal"
        />
      )}

      <BreakdownRow
        label={`CGST @ ${cgstRate}%`}
        sublabel="Central GST"
        value={"₹" + fmt(bd.cgstAmount)}
        variant="tax"
      />

      <BreakdownRow
        label={`SGST @ ${sgstRate}%`}
        sublabel="State GST"
        value={"₹" + fmt(bd.sgstAmount)}
        variant="tax"
      />

      <BreakdownRow
        label="Gross Amount"
        sublabel={hasDiscount ? "Taxable + CGST + SGST" : "Basic + CGST + SGST"}
        value={"₹" + fmt(bd.grossAmount)}
        variant="subtotal"
      />

      {Math.abs(bd.roundOff) > 0 && (
        <BreakdownRow
          label="Round Off"
          sublabel="Nearest rupee"
          value={(bd.roundOff >= 0 ? "+₹" : "−₹") + fmt(Math.abs(bd.roundOff))}
          variant="neutral"
        />
      )}

      <BreakdownRow
        label="Net Payable"
        sublabel="Final amount due"
        value={"₹" + fmt(bd.netAmount)}
        variant="total"
      />
    </div>
  );
}
