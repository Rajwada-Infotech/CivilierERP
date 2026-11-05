// The "price + GST" box shown wherever a unit, parking or extra charge is picked
// on an application. Every figure is the server's quote (usePriceQuote), worked
// out by the same functions that price the booking — this box only lays it out.
import React from "react";
import { inr, type PriceQuote } from "@/lib/crmPriceQuote";

const Line: React.FC<{ label: React.ReactNode; value: number; strong?: boolean; indent?: boolean; rule?: boolean }> = ({ label, value, strong, indent, rule }) => (
  <div className={`flex items-center justify-between text-foreground tabular-nums ${indent ? "pl-2" : ""} ${rule ? "border-t border-foreground/30 pt-1" : ""} ${strong ? "font-semibold" : ""}`}>
    <span>{label}</span>
    <span className={strong ? "" : "font-medium"}>{inr(value)}</span>
  </div>
);

// Why this sale carries the GST it does, in words.
export function gstReason(q: PriceQuote): string {
  if (q.isGstExempt) return "No GST — the building's OC / CC is received and nothing has been paid before it.";
  if (q.isLandSale) return "No GST — land is outside GST.";
  return `${q.gstRate}% from the GST rules for a sale of this value${q.landValue > 0 ? " (on the construction part only — land is outside GST)" : ""}. Changes by itself if parking moves the value across a band.`;
}

export const GstBreakdownBox: React.FC<{ quote: PriceQuote | undefined; loading?: boolean }> = ({ quote, loading }) => {
  if (!quote) {
    return <p className="text-[0.6875rem] text-muted-foreground">{loading ? "Working out the price…" : "Pick a unit and rate to see the price."}</p>;
  }
  const q = quote;
  const hasParking = q.parkingBase > 0;
  return (
    <div className="border border-foreground/30 bg-card px-3 py-2 text-xs space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-foreground font-medium">GST{q.hsnCode ? ` (${q.hsnCode})` : ""}</span>
        <span className="text-foreground font-semibold">{q.gstRate}%</span>
      </div>
      <Line label={q.isLandSale ? "Land" : "Unit"} value={q.unitValue} />
      {q.unitGstAmount > 0 && <Line indent label={`Unit GST (${q.gstRate}%)`} value={q.unitGstAmount} />}
      {hasParking && <Line label="Parking" value={q.parkingBase} />}
      {hasParking && q.parkingGstAmount > 0 && <Line indent label={`Parking GST (${q.gstRate}%)`} value={q.parkingGstAmount} />}
      <Line rule strong label={`Total (${q.isLandSale ? "Land" : "Unit"}${hasParking ? " + Parking" : ""})`} value={q.unitValue + q.unitGstAmount + q.parkingTotal} />
      <p className="text-[0.625rem] text-muted-foreground">{gstReason(q)}</p>
    </div>
  );
};

// The payment schedule the booking will get, from the server's quote — the
// same split booking creation stores (the Booking Amount, then each step's %
// of what's left, the last step taking the rounding so it adds up exactly).
export const QuoteSchedule: React.FC<{ quote: PriceQuote | undefined; title?: React.ReactNode; className?: string }> = ({ quote, title, className }) => {
  if (!quote?.schedule.length) return null;
  return (
    <div className={className ?? "border border-foreground/30 bg-card px-3 py-2 space-y-1 text-xs"}>
      {title && <p className="font-semibold text-foreground">{title}</p>}
      {quote.schedule.map((m) => (
        <div key={m.no} className="flex items-center justify-between text-muted-foreground tabular-nums">
          <span className="truncate pr-2">{m.name} {m.pct != null && <span className="text-[0.625rem]">({m.pct}%)</span>}</span>
          <span className="font-semibold text-foreground shrink-0">{inr(m.amount)}</span>
        </div>
      ))}
    </div>
  );
};
