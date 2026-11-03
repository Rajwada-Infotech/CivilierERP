// A buyer's money on one booking, read-only and in date order: demands raised,
// payments, on-account deposits (and what was applied from them), receipts
// still awaiting approval, refunds. Totals are the server's (the same funding
// figures On Account uses), so nothing is added up here. Every action stays on
// the forms below and on the Payments pages.
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { fmtInr } from "@/lib/crmGst";

type Kind = "demand" | "payment" | "applied" | "deposit" | "awaiting" | "refund" | "void";
interface Entry { kind: Kind; date: string | null; ref: string | null; text: string; amount: number; status: string | null; detail: string | null }
interface Statement {
  totals: { price: number; paid: number; onAccount: number; balance: number; demandedOpen: number; awaitingApproval: number };
  entries: Entry[];
  upcoming: { text: string; dueDate: string | null; amount: number; paid: number }[];
}

async function fetchStatement(bookingId: number): Promise<Statement> {
  const r = await fetchWithAuth(`/api/crm/booking-statement/${bookingId}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Could not load the statement");
  return r.json();
}

// Which side of the account a row sits on. "Applied" moves money already
// received, so it is shown but in neither column.
const COLUMN: Record<Kind, "due" | "in" | "none"> = {
  demand: "due", payment: "in", deposit: "in", applied: "none", awaiting: "none", refund: "none", void: "none",
};
const KIND_LABEL: Record<Kind, string> = {
  demand: "Demand", payment: "Payment", applied: "Applied", deposit: "On account", awaiting: "Awaiting approval", refund: "Refund", void: "Not counted",
};

const H3 = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground flex items-center gap-1.5";
const CAP = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block";

export const BookingStatement: React.FC<{ bookingId: number; refreshKey?: string }> = ({ bookingId, refreshKey }) => {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["crm-booking-statement", bookingId, refreshKey],
    queryFn: () => fetchStatement(bookingId),
    staleTime: 30_000,
  });

  return (
    <div className="border border-border p-4 space-y-3">
      <h3 className={H3}><FileText size={15} /> Statement</h3>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : isError || !data ? (
        <p className="text-xs text-destructive">{(error as Error)?.message || "Could not load the statement"}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
            {[
              { label: "Price", value: data.totals.price },
              { label: "Paid", value: data.totals.paid },
              { label: "On account (unused)", value: data.totals.onAccount },
              { label: "Balance to pay", value: data.totals.balance, strong: true },
              { label: "Demanded, unpaid", value: data.totals.demandedOpen, warn: data.totals.demandedOpen > 0 },
              { label: "Awaiting approval", value: data.totals.awaitingApproval },
            ].map((t) => (
              <div key={t.label} className="border border-border px-3 py-2">
                <span className={CAP}>{t.label}</span>
                <span className={`tabular-nums ${t.strong ? "font-bold" : "font-semibold"} ${t.warn ? "text-destructive" : "text-foreground"}`}>{fmtInr(t.value)}</span>
              </div>
            ))}
          </div>

          {data.entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No demand or payment recorded yet.</p>
          ) : (
            <div className="overflow-x-auto max-h-80 overflow-y-auto border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left">
                    <th className={`${CAP} px-2.5 py-2 font-semibold`}>Date</th>
                    <th className={`${CAP} px-2.5 py-2 font-semibold`}>Entry</th>
                    <th className={`${CAP} px-2.5 py-2 font-semibold`}>Ref</th>
                    <th className={`${CAP} px-2.5 py-2 font-semibold text-right`}>Due</th>
                    <th className={`${CAP} px-2.5 py-2 font-semibold text-right`}>Received</th>
                    <th className={`${CAP} px-2.5 py-2 font-semibold text-right`}>Other</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e, i) => {
                    const col = COLUMN[e.kind];
                    const muted = e.kind === "void";
                    return (
                      <tr key={i} className={`border-b border-border/50 align-top ${muted ? "text-muted-foreground" : ""}`}>
                        <td className="px-2.5 py-1.5 tabular-nums whitespace-nowrap">{e.date || "—"}</td>
                        <td className="px-2.5 py-1.5">
                          <span className="font-medium">{KIND_LABEL[e.kind]}</span> — {e.text}
                          {e.status && <span className="text-muted-foreground"> · {e.status}</span>}
                          {e.detail && <span className="block text-[0.6875rem] text-muted-foreground">{e.detail}</span>}
                        </td>
                        <td className="px-2.5 py-1.5 tabular-nums whitespace-nowrap text-muted-foreground">{e.ref || "—"}</td>
                        <td className="px-2.5 py-1.5 tabular-nums text-right whitespace-nowrap">{col === "due" ? fmtInr(e.amount) : ""}</td>
                        <td className="px-2.5 py-1.5 tabular-nums text-right whitespace-nowrap">{col === "in" ? fmtInr(e.amount) : ""}</td>
                        <td className={`px-2.5 py-1.5 tabular-nums text-right whitespace-nowrap ${muted ? "line-through" : ""}`}>{col === "none" ? fmtInr(e.amount) : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {data.upcoming.length > 0 && (
            <div className="text-xs">
              <span className={CAP}>Not yet demanded</span>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {data.upcoming.map((u, i) => (
                  <li key={i} className="tabular-nums">
                    {u.text} <span className="text-muted-foreground">{u.dueDate ? `· due ${u.dueDate}` : ""} · {fmtInr(u.amount)}{u.paid > 0 ? ` (${fmtInr(u.paid)} paid)` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[0.6875rem] text-muted-foreground">
            "Applied" moves money already received on account to a demand, so it is not counted again. Totals use the same figures as On Account.
          </p>
        </>
      )}
    </div>
  );
};
