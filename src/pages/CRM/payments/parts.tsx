// Payment Milestones' parts: the booking's summary (price, collection, the token's state), the on-account panel and
// the milestone table, all ruled on the sheet.
import React from "react";
import { CrmStatus } from "@/constants/crmStatuses";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Hourglass, MessageSquare, Wallet } from "lucide-react";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { SheetMark } from "@/components/sheet/Sheet";
import { KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "../customers/config";
import { fmt, fmtDate, isOverdue, pct } from "./config";

const head = "px-4 py-2.5 font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground flex items-center gap-1.5";
const tag = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em]";

/** A label / value line in a ruled list. */
function Line({ l, v, strong, red, top }: { l: React.ReactNode; v: React.ReactNode; strong?: boolean; red?: boolean; top?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 ${top ? "pt-2 mt-1" : ""}`} style={top ? { borderTop: RULE_SOFT } : undefined}>
      <span className={strong ? "font-semibold" : "text-muted-foreground"}>{l}</span>
      <span className={`font-heading tabular-nums ${strong ? "font-bold" : "font-medium"} ${red ? "text-destructive" : ""}`}>{v}</span>
    </div>
  );
}

/** A ruled note: red edge for trouble, ink for "waiting on someone". */
function Note({ red, icon, title, children }: { red?: boolean; icon: React.ReactNode; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 text-xs" style={{ border: RULE_SOFT, borderLeft: `3px solid ${red ? "hsl(var(--destructive))" : "hsl(var(--foreground))"}` }}>
      <span className={`shrink-0 mt-0.5 ${red ? "text-destructive" : ""}`}>{icon}</span>
      <div className="space-y-0.5">
        <p className={`font-semibold ${red ? "text-destructive" : ""}`}>{title}</p>
        <p className="text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

export function BookingSummary({ booking, summary, onAccountBalance, totalPendingVerification, moneyReceipts }: {
  booking: any; summary: any; onAccountBalance: number; totalPendingVerification: number; moneyReceipts: any[];
}) {
  const grandTotal = Number(booking.GrandTotal ?? booking.TotalValue ?? 0);
  const unitGstAmount = Number(booking.UnitGstAmount || 0);
  const parkingTotal = Number(booking.ParkingTotal || 0);
  const extraTotal = Number(booking.ExtraChargesTotal || 0);
  const hasExtras = unitGstAmount > 0 || parkingTotal > 0 || extraTotal > 0;
  const collectionPct = pct(summary.totalPaid || 0, summary.totalDue || 0);
  const pendingPct = summary.totalDue > 0 ? Math.min(100 - collectionPct, Math.round((totalPendingVerification / summary.totalDue) * 100)) : 0;
  const bkgStatus = booking.BookingStatus;

  // The token's state, as on the booking's own Payments tab: bounced, with Finance, not yet sent, or not yet
  // receipted. Approved shows nowhere here: it's already in Collected.
  const token = (() => {
    if (!(Number(booking?.TokenValue) > 0)) return null;
    const receipt = moneyReceipts[0];
    const tokenAmt = Number(booking.TokenValue);
    const pmode = booking.PaymentMode || "—";
    if (receipt?.Status === "Bounced") {
      return <Note red icon={<AlertTriangle size={13} />} title={`Token payment bounced — ${fmt(tokenAmt)}`}>
        {receipt.BouncedReason ? `Reason: ${receipt.BouncedReason}. ` : ""}A new Money Receipt must be submitted.</Note>;
    }
    if (receipt?.Status === CrmStatus.PENDING && receipt?.RPStatus === CrmStatus.PENDING) {
      return <Note icon={<Hourglass size={13} />} title={`${fmt(receipt.Amount || tokenAmt)} held — awaiting Finance approval`}>
        Receipt {receipt.ReceiptNo} · {pmode} · submitted to Finance (Accounts head / admin). It counts as paid once approved.</Note>;
    }
    if (receipt?.Status === CrmStatus.PENDING && !receipt?.RPStatus) {
      return <Note icon={<Clock size={13} />} title={`${fmt(receipt.Amount || tokenAmt)} on hold — Money Receipt not yet sent to Finance`}>
        Receipt {receipt.ReceiptNo} · {pmode} · created but not yet sent to Finance for approval.</Note>;
    }
    if (!receipt) {
      return <Note icon={<Clock size={13} />} title={`Token received and on hold — ${fmt(tokenAmt)} via ${pmode}`}>
        Recorded but not yet processed. A Money Receipt is made when the booking is sent for approval ("Verify &amp; Send for
        Approval"); Finance approves it, and only then does it count as paid.</Note>;
    }
    return null;
  })();

  return (
    <div className="bg-card" style={{ border: RULE }}>
      <div className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap" style={{ borderBottom: RULE }}>
        <div className="min-w-0">
          <span className={`block ${LBL}`}>Booking</span>
          <div className="font-heading font-bold text-lg leading-tight"><ApplicantNames name={booking.ApplicantName} bookingId={booking.BookingId} applicationId={booking.ApplicationId} /></div>
          <div className="text-xs text-muted-foreground mt-1 tabular-nums">{booking.BookingNo} · {booking.UnitNo}{booking.ProjectName ? ` · ${booking.ProjectName}` : ""}</div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {bkgStatus && <SheetMark text={bkgStatus} tone={bkgStatus === "Approved" ? "done" : bkgStatus === "Cancelled" ? "stopped" : "waiting"} />}
          {booking.Mobile && <span className="text-xs text-muted-foreground tabular-nums">{booking.Mobile}</span>}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2">
        <div className="p-4 text-sm" style={{ borderRight: RULE_SOFT }}>
          <div className={`${LBL} mb-2`}>Price breakdown</div>
          <Line l={booking.IsPlotSale ? "Land value (no GST)" : "Unit value"} v={fmt(booking.TotalValue)} />
          {unitGstAmount > 0 && <Line l="+ Unit GST" v={fmt(unitGstAmount)} />}
          {parkingTotal > 0 && <Line l="+ Parking" v={fmt(parkingTotal)} />}
          {extraTotal > 0 && <Line l="+ Extra charges" v={fmt(extraTotal)} />}
          <Line l="Grand total" v={fmt(grandTotal)} strong top={hasExtras} />
          {booking.BookingAmount > 0 && <div className="text-xs"><Line l="Booking amount (M1)" v={fmt(booking.BookingAmount)} /></div>}
        </div>
        <div className="p-4 text-sm">
          <div className={`${LBL} mb-2`}>Collection</div>
          <Line l="Total due" v={fmt(summary.totalDue)} />
          <Line l="Collected" v={fmt(summary.totalPaid)} />
          {onAccountBalance > 0 && <Line l={<span className="flex items-center gap-1"><Wallet size={11} /> On-account, unapplied</span>} v={fmt(onAccountBalance)} />}
          {totalPendingVerification > 0 && <Line l={<span className="flex items-center gap-1"><Clock size={11} /> Pending approval</span>} v={fmt(totalPendingVerification)} />}
          <Line l="Balance" v={fmt(summary.balance)} strong red={summary.balance > 0} top />
          {summary.overdue > 0 && (
            <div className="flex items-baseline justify-between text-xs text-destructive py-1">
              <span className="flex items-center gap-1"><AlertCircle size={11} /> Overdue</span>
              <span className="font-semibold">{summary.overdue} milestone{summary.overdue > 1 ? "s" : ""}</span>
            </div>
          )}
          {/* Collected in ink, pending approval hatched */}
          <div className="mt-3">
            <div className="flex justify-between text-[0.6875rem] text-muted-foreground mb-1 tabular-nums">
              <span>Collection progress</span>
              <span>{collectionPct}%{pendingPct > 0 ? ` (+${pendingPct}% pending)` : ""}</span>
            </div>
            <div className="h-2 flex" style={{ border: RULE_SOFT }}>
              <div className="h-full bg-foreground" style={{ width: `${collectionPct}%` }} />
              {pendingPct > 0 && <div className="h-full" style={{ width: `${pendingPct}%`, background: "repeating-linear-gradient(135deg, hsl(var(--foreground)) 0, hsl(var(--foreground)) 1px, transparent 1px, transparent 4px)" }} />}
            </div>
          </div>
        </div>
      </div>
      {token && <div className="p-4" style={{ borderTop: RULE_SOFT }}>{token}</div>}
    </div>
  );
}

// Deposits that aren't usable money: never counted, never applied.
const UNAVAILABLE = ["Bounced", "Held", "Void", "Cancelled", "Refunded"];

export function OnAccountPanel({ onAccountData, onAccountBalance, notFullyPaid, fundsOnHand, requiredAmount, fullPaymentShortfall, milestones, canManuallyApply, canEdit, onApply }: {
  onAccountData: any; onAccountBalance: number; notFullyPaid: boolean; fundsOnHand: number; requiredAmount: number;
  fullPaymentShortfall: number; milestones: any[]; canManuallyApply: boolean; canEdit: boolean; onApply: (payment: any) => void;
}) {
  const funded = requiredAmount > 0 ? Math.min(100, (fundsOnHand / requiredAmount) * 100) : 0;
  const hasOutstanding = milestones.some((m: any) => m.Status !== CrmStatus.PAID && m.Status !== "Waived" && Number(m.AmountDue) > Number(m.AmountPaid || 0));
  const usableLeft = onAccountData.payments.some((p: any) => !UNAVAILABLE.includes(p.Status) && Number(p.Amount) > Number(p.AppliedAmount || 0));
  return (
    <div className="bg-card" style={{ border: RULE }}>
      <div className={`${head} justify-between`} style={{ borderBottom: RULE }}>
        <span className="flex items-center gap-1.5"><Wallet size={13} /> On-account balance</span>
        <span className="font-heading text-base font-bold tabular-nums normal-case tracking-normal">{fmt(onAccountBalance)}</span>
      </div>
      <div className="p-4 space-y-3">
        {notFullyPaid ? (
          <div className="px-3 py-2.5 space-y-1.5" style={{ border: RULE_SOFT }}>
            <div className="flex items-center justify-between gap-3 text-[0.6875rem] flex-wrap">
              <span className="font-semibold flex items-center gap-1.5"><Wallet size={12} /> Held on-account — settles itself once fully funded</span>
              <span className="text-muted-foreground tabular-nums">{fmt(fundsOnHand)} of {fmt(requiredAmount)} ({Math.round(funded)}%)</span>
            </div>
            <div className="h-1.5" style={{ border: RULE_SOFT }}><div className="h-full bg-foreground" style={{ width: `${funded}%` }} /></div>
            <div className="text-[0.6875rem] text-muted-foreground">
              {fmt(fullPaymentShortfall)} more in valid payments funds the remaining dues; eligible milestones then settle in order. Milestones already covered by money on hand show "Paid (on-account)" below.
            </div>
          </div>
        ) : (
          <div className="px-3 py-2 text-[0.6875rem] flex items-center gap-1.5" style={{ border: RULE_SOFT }}>
            <CheckCircle2 size={12} className="shrink-0" /> The booking is fully funded — eligible milestones settle themselves, in order.
          </div>
        )}
        {milestones.length > 0 && !hasOutstanding && usableLeft && (
          <div className="px-3 py-2 text-[0.6875rem]" style={{ border: RULE_SOFT }}>
            No milestone balance is outstanding. What's left on account stays unapplied on this booking until a balance is due.
          </div>
        )}
        <div>
          {onAccountData.payments.map((p: any) => {
            const isUnavailable = UNAVAILABLE.includes(p.Status);
            const remaining = isUnavailable ? 0 : Number(p.Amount) - Number(p.AppliedAmount || 0);
            const isApplied = p.Status === "Applied";
            const isPartial = p.Status === "PartiallyApplied";
            const canApply = canEdit && remaining > 0 && !isApplied && !isUnavailable && canManuallyApply && hasOutstanding;
            return (
              <div key={p.Id} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${isApplied || isUnavailable ? "opacity-60" : ""}`}
                style={{ borderBottom: RULE_SOFT, borderLeft: `3px solid ${isUnavailable ? "hsl(var(--destructive))" : isApplied ? "hsl(var(--foreground) / 0.25)" : "hsl(var(--foreground))"}` }}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap text-xs">
                    <span className="font-heading font-semibold tabular-nums">{p.ReceiptNo}</span>
                    <span className="font-heading tabular-nums">{fmt(p.Amount)}</span>
                    {p.PaymentMode && <span className="text-muted-foreground">· {p.PaymentMode}</span>}
                    {p.ReceivedDate && <span className="text-muted-foreground tabular-nums">· {fmtDate(p.ReceivedDate)}</span>}
                  </div>
                  {isUnavailable
                    ? <div className="text-[0.6875rem] font-medium mt-1 text-destructive">{p.Status} · not available to apply</div>
                    : remaining > 0 && remaining < Number(p.Amount) && <div className="text-[0.6875rem] font-medium mt-1 tabular-nums">{fmt(remaining)} remaining</div>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <SheetMark text={isUnavailable ? p.Status : isApplied ? "Applied" : isPartial ? "Partial" : "Unapplied"} tone={isUnavailable ? "stopped" : isApplied ? "done" : "waiting"} />
                  {canApply && (
                    <button onClick={() => onApply(p)} title="This deposit should apply itself once its milestone is eligible — use this only as a manual fallback"
                      className={`${KEY_LINE} h-7 px-2`}>Apply manually</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function MilestoneTable({ milestones, canEdit, onAccountData, onAccountBalance, notFullyPaid, fullPaymentShortfall, nextMilestone, canManuallyApply, onPay, onApply, onWaive, onRemarks }: {
  milestones: any[]; canEdit: boolean; onAccountData: any; onAccountBalance: number; notFullyPaid: boolean; fullPaymentShortfall: number;
  nextMilestone: any; canManuallyApply: boolean;
  onPay: (m: any) => void; onApply: (payment: any, m: any) => void; onWaive: (m: any) => void; onRemarks: (m: any) => void;
}) {
  const th = `!px-3 !py-2.5 text-left ${LBL}`;
  const td = "!px-3 !py-3.5";
  return (
    <div className="bg-card" style={{ border: RULE }}>
      <div className={head} style={{ borderBottom: RULE }}>Payment schedule</div>
      <div className="overflow-x-auto thin-scroll">
        <table className="w-full text-sm min-w-[1100px]">
          <thead>
            <tr style={{ borderBottom: RULE }}>
              <th className={th}>#</th><th className={th}>Milestone</th><th className={th}>Dept</th><th className={th}>Due</th>
              <th className={`${th} !text-right`}>Amount due</th><th className={`${th} !text-right`}>Paid</th><th className={th}>Paid on</th>
              <th className={`${th} !text-right`}>Balance</th><th className={th}>Status</th><th className={th}>Mode</th><th className={th}>Ref / remarks</th><th className={th} />
            </tr>
          </thead>
          <tbody>
            {milestones.length === 0 ? (
              <tr><td colSpan={12} className={`${td} text-center text-muted-foreground`}>No milestones on this booking.</td></tr>
            ) : milestones.map((m) => {
              const overdue = isOverdue(m);
              // Money on-account already covers this milestone: it shows "Paid (on-account)" (and no Pay / Waive,
              // which would read as owed / forgiven).
              const covered = m.Status !== CrmStatus.PAID && m.Status !== "Waived" && m.VirtuallyCovered;
              const balance = (m.AmountDue || 0) - (m.AmountPaid || 0);
              const status = covered ? "Paid (on-account)" : overdue ? "Overdue" : m.Status;
              const open = m.Status !== CrmStatus.PAID && m.Status !== "Waived";
              const pmt = onAccountBalance > 0 && m.Id === nextMilestone?.Id
                ? onAccountData?.payments?.find((p: any) => !UNAVAILABLE.includes(p.Status) && Number(p.Amount) - Number(p.AppliedAmount || 0) > 0)
                : null;
              const noAmount = Number(m.AmountDue) === 0 && Number(m.AmountPaid || 0) === 0 && m.Status === CrmStatus.PAID;
              return (
                <tr key={m.Id} className="align-top" style={{ borderBottom: RULE_SOFT, borderLeft: overdue && !covered ? "3px solid hsl(var(--destructive))" : undefined }}>
                  <td className={`${td} text-xs text-muted-foreground tabular-nums`}>{m.MilestoneNo}</td>
                  <td className={td}>
                    <div className="font-medium leading-snug">{m.MilestoneName}</div>
                    {m.DemandStatus && m.DemandStatus !== CrmStatus.PENDING && (m.DemandStatus === "Demanded" || m.DemandStatus === CrmStatus.PAID) && (
                      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                        <span className={`${tag} px-1.5 py-0.5 border border-foreground/40 whitespace-nowrap`}>
                          {m.DemandStatus === "Demanded" ? `Demand raised${m.DemandNo ? ` · ${m.DemandNo}` : ""}` : `Demand ${m.DemandStatus}`}
                        </span>
                        {m.DemandRaisedOn && <span className="text-[0.625rem] text-muted-foreground tabular-nums">{fmtDate(m.DemandRaisedOn)}</span>}
                      </div>
                    )}
                    {m.RequiredDocuments && <div className="text-[0.6875rem] text-muted-foreground mt-1 truncate max-w-[200px]" title={m.RequiredDocuments}>Docs: {m.RequiredDocuments}</div>}
                  </td>
                  <td className={`${td} text-xs text-muted-foreground`}>{m.ResponsibleDepartment || "—"}</td>
                  <td className={`${td} text-xs tabular-nums whitespace-nowrap ${overdue ? "text-destructive font-semibold" : ""}`}>{fmtDate(m.DueDate)}</td>
                  <td className={`${td} text-right`}>
                    {noAmount
                      ? <div className="text-xs font-medium text-muted-foreground whitespace-nowrap">No amount due</div>
                      : <div className="font-heading font-semibold tabular-nums whitespace-nowrap">{fmt(m.AmountDue)}{m.Status === "Waived" && <span className="ml-1 text-[0.625rem] font-medium text-muted-foreground">(waived)</span>}</div>}
                    {m.Percent != null && <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">{Number(m.Percent)}%</div>}
                  </td>
                  <td className={`${td} text-right`}>
                    <div className="font-heading tabular-nums whitespace-nowrap">{fmt(m.AmountPaid)}</div>
                    {Number(m.PendingVerificationAmount) > 0 && <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums whitespace-nowrap">+{fmt(m.PendingVerificationAmount)} pending</div>}
                  </td>
                  <td className={`${td} text-xs tabular-nums whitespace-nowrap`}>{m.PaidDate ? fmtDate(m.PaidDate) : <span className="text-muted-foreground">—</span>}</td>
                  <td className={`${td} text-right whitespace-nowrap`}>
                    {m.Status === "Waived" ? <span className="text-muted-foreground">—</span>
                      : covered ? <span className="inline-flex items-center gap-1 text-xs font-semibold"><Wallet size={12} /> Covered</span>
                      : balance > 0 ? <span className="font-heading font-bold tabular-nums text-destructive">{fmt(balance)}</span>
                      : <span className="inline-flex items-center gap-1 text-xs font-semibold"><CheckCircle2 size={12} /> Settled</span>}
                  </td>
                  <td className={td} title={covered ? "Money is on-account for this milestone; it settles itself once the full booking amount is in" : undefined}>
                    {status === "Waived"
                      ? <span className={`${tag} text-muted-foreground`}>Waived</span>
                      : <SheetMark text={status} tone={status === "Overdue" ? "stopped" : status === CrmStatus.PAID || covered ? "done" : "waiting"} />}
                  </td>
                  <td className={`${td} text-xs`}>
                    <div>{m.PaymentMode || "—"}</div>
                    {m.DepositBankName && <div className="text-[0.6875rem] text-muted-foreground mt-1 truncate max-w-[120px]" title={m.DepositBankName}>{m.DepositBankName}</div>}
                  </td>
                  <td className={`${td} text-xs`}>
                    <span className="font-heading tabular-nums">{m.TransactionRef || "—"}</span>
                    {m.Remarks && (
                      <button onClick={() => onRemarks(m)} title={m.Remarks} className="ml-1.5 text-muted-foreground hover:text-foreground align-middle inline-flex"><MessageSquare size={11} /></button>
                    )}
                  </td>
                  <td className={td}>
                    {canEdit && open && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {!covered && <button onClick={() => onPay(m)} className={`${KEY_INK} h-7 px-2`}>Pay</button>}
                        {pmt && (notFullyPaid
                          ? <span title={`Settles itself once the remaining dues are funded — ${fmt(fullPaymentShortfall)} more in valid payments`}
                              className={`${tag} px-2 h-7 inline-flex items-center border border-foreground/25 text-muted-foreground cursor-help`}>Auto</span>
                          : !canManuallyApply
                          ? <span title="Raise the Demand before applying on-account money to this milestone"
                              className={`${tag} px-2 h-7 inline-flex items-center border border-foreground/25 text-muted-foreground cursor-help`}>Raise demand</span>
                          : <button onClick={() => onApply(pmt, m)}
                              title="The booking is funded and this milestone should settle itself shortly — use this only if it hasn't"
                              className={`${KEY_LINE} h-7 px-2`}>Apply</button>)}
                        {!covered && <button onClick={() => onWaive(m)} className={`${KEY_LINE} h-7 px-2`}>Waive</button>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
