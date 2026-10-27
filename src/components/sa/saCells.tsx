import React from "react";
import { formatINR } from "@/utils/formatCurrency";
import { StatusBadge } from "@/components/StatusBadge";
import type { RecordWithId } from "@/components/MasterPage";

// Shared cell/value renderers for Sales Automation masters (Ads, Campaigns,
// ...) so every SA list formats money, ROI and status the same way.

export const fmtPct = (n: number) => `${n.toFixed(1)}%`;

/** ₹ amount, or a dash when there is nothing to show. */
export const moneyText = (v: unknown) => (Number(v) > 0 ? formatINR(v) : "—");

export const MoneyCell = (v: unknown) => <span className="tabular-nums">{moneyText(v)}</span>;

/** For MasterPage viewConfig `render`. */
export const MoneyView = (v: unknown) => <p className="text-sm tabular-nums">{moneyText(v)}</p>;

export const PctView = (v: unknown) => <p className="text-sm tabular-nums">{fmtPct(Number(v ?? 0))}</p>;

export const CountCell = (v: unknown) => <span className="font-semibold tabular-nums">{Number(v ?? 0)}</span>;

export const RoiCell = (v: unknown) => {
  const n = Number(v ?? 0);
  return (
    <span className={`font-semibold tabular-nums ${n > 0 ? "text-emerald-600" : n < 0 ? "text-red-500" : "text-muted-foreground"}`}>
      {n ? fmtPct(n) : "—"}
    </span>
  );
};

/** Status badge, with "Inactive" beside it when the record is switched off. */
export const StatusCell = (v: unknown, row?: RecordWithId) => (
  <span className="inline-flex items-center gap-1.5">
    <StatusBadge status={String(v || "Active")} />
    {row?.isActive === false && <span className="text-[0.6875rem] text-muted-foreground">Inactive</span>}
  </span>
);

export const CodeCell = (v: unknown) => <span className="font-mono text-xs text-muted-foreground">{String(v || "—")}</span>;

/** Record name with an optional muted second line. */
export const TitleCell = (title: unknown, sub?: unknown) => (
  <div className="min-w-0">
    <div className="font-medium text-foreground truncate">{String(title)}</div>
    {sub ? <div className="text-xs text-muted-foreground truncate max-w-[16rem]">{String(sub)}</div> : null}
  </div>
);
