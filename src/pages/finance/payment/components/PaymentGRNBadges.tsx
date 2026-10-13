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
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[0.625rem] font-semibold bg-primary/10 text-foreground border border-foreground/40 font-heading tabular-nums"
        >
          <Truck size={9} />
          {g.GRNNo}
        </span>
      ))}
    </div>
  );
}
