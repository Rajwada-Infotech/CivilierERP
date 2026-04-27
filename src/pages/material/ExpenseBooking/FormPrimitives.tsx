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
    <div className="rounded-lg border border-border overflow-hidden divide-y divide-border/60 text-xs">
      <BreakdownRow
        label="Basic Amount"
        sublabel="From purchase order"
        value={"Rs." + fmt(bd.basicAmount)}
        variant="neutral"
      />

      {hasDiscount && (
        <BreakdownRow
          label="Discount"
          sublabel="Applied before GST"
          value={"- Rs." + fmt(bd.discountAmount)}
          variant="debit"
        />
      )}

      {hasDiscount && (
        <BreakdownRow
          label="Taxable Amount"
          sublabel="After discount"
          value={"Rs." + fmt(bd.taxableAmount)}
          variant="subtotal"
        />
      )}

      <BreakdownRow
        label={`CGST @ ${cgstRate}%`}
        sublabel="Central GST"
        value={"Rs." + fmt(bd.cgstAmount)}
        variant="tax"
      />
      <BreakdownRow
        label={`SGST @ ${sgstRate}%`}
        sublabel="State GST"
        value={"Rs." + fmt(bd.sgstAmount)}
        variant="tax"
      />

      <BreakdownRow
        label="Gross Amount"
        sublabel={hasDiscount ? "Taxable + CGST + SGST" : "Basic + CGST + SGST"}
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
  );
}
