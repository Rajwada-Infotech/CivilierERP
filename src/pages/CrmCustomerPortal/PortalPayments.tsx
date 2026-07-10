import React from "react";
import { useOutletContext } from "react-router-dom";
import { CheckCircle2, Circle, Clock, CreditCard } from "lucide-react";
import { fmtMoney, fmtDate } from "./portalApi";

type Ctx = { me: any; timeline: any };

const PortalPayments: React.FC = () => {
  const { timeline } = useOutletContext<Ctx>();
  const milestones = timeline.paymentMilestones || [];

  if (!milestones.length) {
    return (
      <div className="rounded-2xl border border-violet-100 bg-white p-8 text-center text-sm text-slate-500">
        Your payment schedule will appear here once your booking is confirmed.
      </div>
    );
  }

  const totalDue = milestones.reduce((s: number, m: any) => s + Number(m.AmountDue || 0), 0);
  const totalPaid = milestones.reduce((s: number, m: any) => s + Number(m.AmountPaid || 0), 0);
  const pctPaid = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0;
  const today = new Date(new Date().toDateString());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-heading text-slate-800">Payments</h1>
        <p className="text-sm text-slate-500 mt-0.5">Your full payment schedule, milestone by milestone.</p>
      </div>

      {/* Summary */}
      <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-400">Total Paid</span>
          <span className="text-xs font-semibold text-slate-700">{pctPaid}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-400 transition-all" style={{ width: `${pctPaid}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4 text-center">
          <div>
            <p className="text-lg font-bold text-slate-800">{fmtMoney(totalPaid)}</p>
            <p className="text-[11px] text-slate-400">Paid</p>
          </div>
          <div>
            <p className="text-lg font-bold text-amber-600">{fmtMoney(totalDue - totalPaid)}</p>
            <p className="text-[11px] text-slate-400">Remaining</p>
          </div>
          <div>
            <p className="text-lg font-bold text-slate-800">{fmtMoney(totalDue)}</p>
            <p className="text-[11px] text-slate-400">Total</p>
          </div>
        </div>
      </div>

      {/* Milestone list */}
      <div className="rounded-2xl border border-violet-100 bg-white overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-violet-50 flex items-center gap-2">
          <CreditCard size={14} className="text-violet-500" />
          <h2 className="text-sm font-bold text-slate-800">Milestone Schedule</h2>
        </div>
        {milestones.map((m: any) => {
          const isPaid = m.Status === "Paid";
          const isOverdue = !isPaid && m.DueDate && new Date(m.DueDate) < today;
          return (
            <div key={m.MilestoneNo} className="flex items-center gap-3 px-5 py-3.5 border-b border-violet-50 last:border-0">
              {isPaid ? <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                : isOverdue ? <Clock size={18} className="text-rose-500 shrink-0" />
                : <Circle size={18} className="text-slate-300 shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800">{m.MilestoneName}</p>
                <p className="text-[11px] text-slate-400">{m.DueDate ? `Due ${fmtDate(m.DueDate)}` : "Due date to be set"}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-slate-800">{fmtMoney(m.AmountDue)}</p>
                <span className={`text-[11px] font-medium ${isPaid ? "text-emerald-600" : isOverdue ? "text-rose-600" : "text-amber-600"}`}>
                  {isPaid ? "Paid" : isOverdue ? "Overdue" : "Pending"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PortalPayments;
