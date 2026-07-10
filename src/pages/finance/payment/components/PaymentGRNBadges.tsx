import React from "react";
import { Truck } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { GRNRef } from "../types";

export function PaymentGRNBadges({ expenseId }: { expenseId: string }) {
  const [grns, setGrns] = React.useState<GRNRef[]>([]);
  React.useEffect(() => {
    if (!expenseId) return;
    fetchWithAuth(`/api/expense-booking/${expenseId}/grns`)
      .then((r) => (r.ok ? r.json().catch(() => ({})) : []))
      .then((data) => setGrns(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [expenseId]);
  if (!grns.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {grns.map((g) => (
        <span
          key={g.GRNID}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400 border border-teal-200 dark:border-teal-800 font-mono"
        >
          <Truck size={9} />
          {g.GRNNo}
        </span>
      ))}
    </div>
  );
}
