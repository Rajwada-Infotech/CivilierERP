// The company's figures, kept quiet: one muted line along the foot of the sign-in page.
import React from "react";
import type { PublicStats } from "./config";

const num = (n: number | undefined) => (n ?? 0).toLocaleString("en-IN");

export function LoginFigures({ stats }: { stats: PublicStats | null }) {
  if (!stats) return null;
  const items: [string, string][] = [
    [num(stats.projects), "projects"],
    [num(stats.activeSuppliers), "active suppliers"],
    [num(stats.grns), "GRNs received"],
    [num(stats.quotations), "quotations"],
    [num(stats.workOrders), "work orders"],
    [`${Math.min(100, Math.max(0, stats.workOrderCompletionPct ?? 0))}%`, "work completed"],
  ];
  return (
    <p className="flex flex-wrap justify-center gap-x-5 gap-y-1 px-6 text-[12px] ls-in" style={{ color: "var(--muted)", animationDelay: "180ms" }}>
      {items.map(([v, label]) => (
        <span key={label} className="whitespace-nowrap">
          <span className="font-heading font-semibold tabular-nums" style={{ color: "var(--ink-2)" }}>{v}</span> {label}
        </span>
      ))}
    </p>
  );
}
