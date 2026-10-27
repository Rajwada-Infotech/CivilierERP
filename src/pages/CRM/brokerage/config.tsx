// Brokerage and Broker Payments: a brokerage row's state, and how its tranche unlocks.
import React from "react";
import { CrmStatus } from "@/constants/crmStatuses";
import { SheetMark } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";

export const API = "/api/crm/brokerage";
export const fmt = (n: any) => fmtRupees(Number(n || 0));

/** How a tranche unlocks — the payment plan decides: one payout, or a booking part and an agreement part. */
export function trancheText(r: any): string {
  if (r.TrancheLabel === "Full" || (r.UnlockGate == null && r.MilestoneNo == null)) return "Full payout";
  if (r.UnlockGate === "Agreement") return `${r.TrancheLabel || "Agreement"} — on agreement executed`;
  if (r.UnlockGate === "Booking") return `${r.TrancheLabel || "Booking"} — on booking amount paid`;
  return `Milestone ${r.MilestoneNo}${r.MilestoneName ? ` — ${r.MilestoneName}` : ""}`;
}

export function BrokerageMark({ r }: { r: any }) {
  if (r.IsLocked) return <SheetMark text="Locked" tone="stopped" />;
  if (r.Status === CrmStatus.PAID) return <SheetMark text="Paid" tone="done" />;
  if (r.Status === CrmStatus.APPROVED) return <SheetMark text="With Finance" tone="waiting" />;
  if (r.Status === CrmStatus.REJECTED) return <SheetMark text="Rejected" tone="stopped" />;
  return <SheetMark text={r.Status || "Pending"} tone="waiting" />;
}
