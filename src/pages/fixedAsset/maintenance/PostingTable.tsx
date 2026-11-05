// The accounting entry of a maintenance record, as a ruled schedule: account, Dr/Cr mark, debit and credit.
import type { PostingPlan } from "@/api/fixedAssetMaintenanceApi";
import { LBL, RULE } from "../record/config";
import { fmtAmt } from "./config";

const SOFT = "1px solid hsl(var(--foreground) / 0.12)";

export function DrCr({ debit }: { debit: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-7 h-5 font-heading text-[0.625rem] font-bold uppercase tracking-[0.06em] ${
        debit ? "bg-foreground text-card" : "border border-foreground text-foreground"
      }`}
    >
      {debit ? "Dr" : "Cr"}
    </span>
  );
}

export function PostingTable({ plan, compact }: { plan: PostingPlan; compact?: boolean }) {
  const totalDr = plan.entries.reduce((s, e) => s + (e.debit || 0), 0);
  const totalCr = plan.entries.reduce((s, e) => s + (e.credit || 0), 0);
  const cell = compact ? "py-2 pr-2" : "py-2.5 pr-3";
  return (
    <div className="overflow-x-auto">
      <table className={`w-full ${compact ? "text-xs" : "text-sm min-w-[420px]"}`}>
        <thead>
          <tr style={{ borderBottom: RULE }}>
            <th className={`${cell} text-left ${LBL}`}>Account</th>
            <th className={`${cell} text-center ${LBL}`}>Dr / Cr</th>
            <th className={`${cell} text-right ${LBL}`}>Debit</th>
            <th className={`py-2 text-right ${LBL}`}>Credit</th>
          </tr>
        </thead>
        <tbody>
          {plan.entries.map((e, i) => (
            <tr key={i} style={{ borderBottom: SOFT }}>
              <td className={`${cell} text-foreground`}>{e.account}</td>
              <td className={`${cell} text-center`}><DrCr debit={!!e.debit} /></td>
              <td className={`${cell} text-right tabular-nums`}>{e.debit ? fmtAmt(e.debit) : "—"}</td>
              <td className="py-2 text-right tabular-nums">{e.credit ? fmtAmt(e.credit) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: RULE }}>
            <td className={`${cell} font-heading font-bold text-right`} colSpan={2}>Total</td>
            <td className={`${cell} text-right tabular-nums font-heading font-bold`}>{fmtAmt(totalDr)}</td>
            <td className="py-2 text-right tabular-nums font-heading font-bold">{fmtAmt(totalCr)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
