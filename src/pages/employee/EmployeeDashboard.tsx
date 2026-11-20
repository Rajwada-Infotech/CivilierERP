// Employee Portal dashboard, laid out as a soft bento grid: a welcome line with this month's numbers and leave-usage bars,
// then the profile photo, weekly hours, the live time tracker and leave usage, then summaries, the month calendar and the
// dark leave-applications list. On a phone the cards stack, time tracker first.
import { NoticeItem, useNotices } from "./EmployeeNotices";
import { Link } from "react-router-dom";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { getPortalAttendance, getPortalLeaveBalances, getPortalPayslips, getPortalProfile } from "@/api/employeePortalApi";
import TimeTracker from "./TimeTracker";
import { CalendarCard, LeaveChecklist, LeaveUsage, ProfileCard, Summaries, WeekHours } from "./DashboardWidgets";
import { Note } from "./employeeUi";

/** A leave-usage pill: label above, a bar filled to the share used. `dark` is the charcoal one, the rest gold or striped. */
function Pill({ label, pct, tone }: { label: string; pct: number; tone: "ink" | "gold" | "stripe" }) {
  const fill = tone === "ink" ? "ep-ink" : tone === "gold" ? "ep-gold" : "";
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="relative h-9 rounded-full overflow-hidden bg-foreground/10" style={tone === "stripe" ? { backgroundImage: "repeating-linear-gradient(135deg, hsl(var(--foreground) / .12) 0 3px, transparent 3px 7px)" } : undefined}>
        <div className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: pct ? `${Math.max(pct, 16)}%` : 0, ...(tone === "stripe" ? { background: "hsl(var(--muted-foreground) / .45)" } : {}) }} />
        <span className={`absolute inset-0 flex items-center pl-3 text-xs font-bold ${tone === "stripe" ? "text-foreground" : ""}`} style={{ color: pct ? (tone === "ink" ? "#fff" : tone === "gold" ? "#1a1405" : undefined) : undefined }}>{pct}%</span>
      </div>
    </div>
  );
}

function BigNumber({ value, label }: { value: React.ReactNode; label: string }) {
  return <div className="text-right"><p className="font-heading text-3xl sm:text-4xl font-bold tabular-nums leading-none">{value}</p><p className="text-xs text-muted-foreground mt-1">{label}</p></div>;
}

/** Live notices from HR (pinned / important first); unread ones are bold with a dot. */
function LatestNotices() {
  const { data, openId, toggle } = useNotices();
  const list = (data ?? []).slice(0, 4);
  if (!list.length) return null;
  const unread = (data ?? []).filter((n) => !n.IsRead).length;
  return (
    <section className="ep-card mb-4" aria-label="Notices">
      <div className="flex items-center justify-between px-5 pt-4"><h2 className="font-heading text-base font-bold">Notices{unread ? ` · ${unread} new` : ""}</h2>
        <Link to="/employee/notices" className="text-xs font-bold underline underline-offset-2">View all</Link></div>
      <ul className="divide-y divide-foreground/10 pb-1">{list.map((n) => <NoticeItem key={n.NoticeId} n={n} open={openId === n.NoticeId} onOpen={() => toggle(n)} />)}</ul>
    </section>
  );
}

export default function EmployeeDashboard() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${year}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const profile = useQuery({ queryKey: ["ep-profile"], queryFn: getPortalProfile, staleTime: 5 * 60_000 });
  const payslips = useQuery({ queryKey: ["ep-payslips"], queryFn: getPortalPayslips, staleTime: 60_000 });
  const balances = useQuery({ queryKey: ["ep-balances", year], queryFn: () => getPortalLeaveBalances(year), staleTime: 60_000 });
  const attendance = useQuery({ queryKey: ["ep-attendance", month], queryFn: () => getPortalAttendance(month), staleTime: 60_000 });

  const p = profile.data;
  const bal = balances.data?.Balances;
  const latest = payslips.data?.[0];
  const limited = (bal ?? []).filter((b) => b.LeaveType !== "Unpaid" && b.Entitled);
  const pctUsed = (b: { Used: number; Pending: number; Entitled: number | null }) => (b.Entitled ? Math.min(100, Math.round(((Number(b.Used) + Number(b.Pending)) / Number(b.Entitled)) * 100)) : 0);
  const left = limited.reduce((t, b) => t + (b.Balance ?? 0), 0);
  const summary = attendance.data?.Summary;

  if (profile.isError) return <Note tone="error">{(profile.error as Error).message}</Note>;

  return (
    <div>
      {/* Welcome + this month */}
      <div className="grid lg:grid-cols-[1fr_auto] gap-5 mb-5 items-end">
        <div>
          <h1 className="font-heading text-3xl sm:text-4xl font-medium leading-tight">Welcome, <span className="font-bold">{p ? p.EmployeeName.split(" ")[0] : ""}</span></h1>
          <div className="grid grid-cols-3 gap-3 mt-4 max-w-xl">
            {limited.slice(0, 3).map((b, i) => <Pill key={b.LeaveType} label={`${b.LeaveType} leave used`} pct={pctUsed(b)} tone={(["ink", "gold", "stripe"] as const)[i]} />)}
          </div>
        </div>
        <div className="flex items-end gap-6 sm:gap-8">
          <BigNumber value={summary?.Present ?? "–"} label="Present days" />
          <BigNumber value={bal ? left : "–"} label="Leave left" />
          <BigNumber value={summary ? `${summary.BreakMinutes}m` : "–"} label="Break time" />
        </div>
      </div>

      <LatestNotices />

      {/* Row 1 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
        <div className="order-2 sm:order-1 lg:order-1"><ProfileCard profile={p} latest={latest} /></div>
        <div className="order-3 lg:order-2"><WeekHours /></div>
        <div className="order-1 sm:order-2 lg:order-3"><TimeTracker /></div>
        <div className="order-4"><LeaveUsage balances={bal} /></div>
      </div>

      {/* Row 2 */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr_1fr] mb-4">
        <Summaries balances={bal} latest={latest} month={summary} />
        <CalendarCard />
        <LeaveChecklist />
      </div>

      <p className="text-center text-xs text-muted-foreground pb-2">© {year} {p?.CompanyName || "CivilierERP"}. All rights reserved.</p>
    </div>
  );
}
