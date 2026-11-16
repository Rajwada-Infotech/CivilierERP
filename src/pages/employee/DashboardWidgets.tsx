// The Employee Portal dashboard's cards: profile photo, weekly hours chart, leave usage, expandable summaries, a month
// calendar (attendance, holidays, leave) and the dark leave-applications checklist.
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  getPortalAttendance, getPortalHolidays, getPortalLeaves, getPortalSalary,
  type AttendanceDay, type LeaveApplication, type LeaveBalance, type PayslipSummary, type PortalProfile,
} from "@/api/employeePortalApi";
import { MONTHS, fmtDate, inr } from "./employeeUi";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

// ── Profile photo card ───────────────────────────────────────────────────────
export function ProfileCard({ profile, latest }: { profile?: PortalProfile; latest?: PayslipSummary }) {
  const initials = profile ? profile.EmployeeName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() : "";
  return (
    <section className="ep-card relative min-h-[18rem] h-full" aria-label="Profile">
      {profile?.Photo
        ? <img src={profile.Photo} alt={`${profile.EmployeeName}'s photo`} className="absolute inset-0 w-full h-full object-cover" />
        : <div className="absolute inset-0 ep-ink flex items-center justify-center font-heading text-6xl font-bold">{initials}</div>}
      <div className="absolute inset-x-0 bottom-0 p-4 pt-16 text-white flex items-end justify-between gap-2" style={{ background: "linear-gradient(to top, rgb(0 0 0 / .72), transparent)" }}>
        <div className="min-w-0">
          <p className="font-heading font-bold text-lg leading-tight truncate">{profile?.EmployeeName ?? "…"}</p>
          <p className="text-xs text-white/80 truncate">{profile ? [profile.Designation, profile.Department].filter(Boolean).join(" · ") : ""}</p>
          <p className="text-[0.6875rem] text-white/65 truncate">{profile?.EmployeeCode}</p>
        </div>
        {latest && <Link to="/employee/payslips" className="shrink-0 rounded-full border border-white/70 bg-white/15 backdrop-blur px-3 py-1.5 text-sm font-bold" title="Latest net pay">{inr(latest.NetSalary)}</Link>}
      </div>
    </section>
  );
}

// ── Hours this week ──────────────────────────────────────────────────────────
export function WeekHours() {
  const days = useMemo(() => {
    const t = new Date();
    const mon = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i));
  }, []);
  const keys = [...new Set(days.map(monthKey))];
  const results = useQueries({ queries: keys.map((k) => ({ queryKey: ["ep-attendance", k], queryFn: () => getPortalAttendance(k), staleTime: 60_000 })) });
  const byDate = new Map<string, AttendanceDay>();
  results.forEach((r) => r.data?.Days.forEach((d) => byDate.set(d.Date, d)));
  const hours = days.map((d) => byDate.get(ymd(d))?.Hours ?? 0);
  const total = hours.reduce((a, b) => a + b, 0);
  const max = Math.max(...hours, 0.01);
  const best = hours.indexOf(Math.max(...hours));
  const todayIdx = days.findIndex((d) => ymd(d) === ymd(new Date()));

  return (
    <section className="ep-card p-5 h-full flex flex-col" aria-label="Hours this week">
      <div className="flex items-center justify-between"><h2 className="font-heading text-base font-bold">Progress</h2>
        <Link to="/employee/attendance" className="w-8 h-8 rounded-full bg-card/80 border border-border flex items-center justify-center" aria-label="Open attendance"><ArrowUpRight size={15} /></Link></div>
      <div className="flex items-end gap-2 mt-2"><span className="font-heading text-3xl font-bold tabular-nums">{total.toFixed(1)} h</span><span className="text-xs text-muted-foreground pb-1">Work time<br />this week</span></div>
      <div className="flex-1 flex items-end justify-between gap-2 mt-4 min-h-[8rem]">
        {days.map((d, i) => {
          const h = hours[i];
          const isBest = i === best && h > 0;
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full">
              <div className="relative w-full flex-1 flex items-end justify-center">
                {isBest && <span className="absolute -top-1 -translate-y-full text-[0.625rem] font-bold px-1.5 py-0.5 rounded-md ep-gold whitespace-nowrap">{Math.floor(h)}h {String(Math.round((h % 1) * 60)).padStart(2, "0")}m</span>}
                <div className={`w-1.5 rounded-full ${isBest ? "" : "bg-foreground/80"}`} style={{ height: `${Math.max(6, (h / max) * 100)}%`, ...(isBest ? { background: "hsl(var(--ep-gold))" } : {}), opacity: h ? 1 : 0.25 }} />
              </div>
              <span className={`text-[0.6875rem] ${i === todayIdx ? "font-bold text-foreground" : "text-muted-foreground"}`}>{"MTWTFSS"[i]}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Leave usage (the "Onboarding" card) ──────────────────────────────────────
export function LeaveUsage({ balances }: { balances?: LeaveBalance[] }) {
  const rows = (balances ?? []).filter((b) => b.LeaveType !== "Unpaid" && b.Entitled);
  const entitled = rows.reduce((t, b) => t + Number(b.Entitled), 0);
  const used = rows.reduce((t, b) => t + Number(b.Used) + Number(b.Pending), 0);
  const pct = entitled ? Math.round((used / entitled) * 100) : 0;
  const shades = ["hsl(var(--ep-gold))", "hsl(var(--ep-ink))", "hsl(var(--muted-foreground) / .55)"];
  return (
    <section className="ep-card p-5 h-full flex flex-col" aria-label="Leave used">
      <div className="flex items-center justify-between"><h2 className="font-heading text-base font-bold">Leave</h2><span className="font-heading text-3xl font-bold tabular-nums">{pct}%</span></div>
      <p className="text-xs text-muted-foreground">of this year's leave used</p>
      <div className="flex gap-1.5 mt-4" aria-hidden>
        {rows.map((b, i) => <div key={b.LeaveType} className="h-9 rounded-xl" style={{ flex: Math.max(1, Number(b.Entitled)), background: shades[i % 3], opacity: 0.25 + 0.75 * (Number(b.Used) + Number(b.Pending)) / Math.max(1, Number(b.Entitled)) }} />)}
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {rows.map((b, i) => (
          <li key={b.LeaveType} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: shades[i % 3] }} />{b.LeaveType}</span>
            <span className="tabular-nums"><b>{b.Balance}</b><span className="text-muted-foreground"> left of {b.Entitled}</span></span>
          </li>
        ))}
      </ul>
      <Link to="/employee/leave" className="ep-btn ep-btn-ink mt-auto self-start">Apply for leave</Link>
    </section>
  );
}

// ── Expandable summaries ─────────────────────────────────────────────────────
function Row({ title, children, to, defaultOpen }: { title: string; children: React.ReactNode; to: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border-b border-border/70 last:border-0">
      <button className="w-full flex items-center justify-between py-3 text-sm font-semibold text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {title}<ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="pb-3 text-sm space-y-1">{children}<Link to={to} className="inline-flex items-center gap-1 text-xs font-bold underline underline-offset-2 mt-1">Open <ArrowUpRight size={12} /></Link></div>}
    </div>
  );
}
const kv = (k: string, v: React.ReactNode) => <p className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="font-medium tabular-nums text-right">{v}</span></p>;

export function Summaries({ balances, latest, month }: { balances?: LeaveBalance[]; latest?: PayslipSummary; month?: { Present: number; Absent: number; BreakMinutes: number; ExtraMinutes: number } }) {
  const salary = useQuery({ queryKey: ["ep-salary"], queryFn: getPortalSalary, staleTime: 60_000 });
  const s = salary.data;
  return (
    <section className="ep-card p-5 h-full" aria-label="Summaries">
      <Row title="Salary summary" to="/employee/salary" defaultOpen>
        {kv("CTC", s?.CTCAmount != null ? `${inr(s.CTCAmount)} / ${s.CTCFrequency === "Annual" ? "year" : "month"}` : "—")}
        {kv("Structure", s?.SalaryStructureName || "—")}
        {kv("Latest gross", s?.Latest ? inr(s.Latest.GrossSalary) : "—")}
      </Row>
      <Row title="Latest payslip" to="/employee/payslips">
        {latest ? <>{kv("Month", `${MONTHS[latest.PeriodMonth - 1]} ${latest.PeriodYear}`)}{kv("Deductions", inr(latest.TotalEmployeeDeduction))}{kv("Net pay", inr(latest.NetSalary))}</> : <p className="text-muted-foreground">Appears once HR locks a payroll month.</p>}
      </Row>
      <Row title="Leave balance" to="/employee/leave">
        {(balances ?? []).filter((b) => b.LeaveType !== "Unpaid").map((b) => <React.Fragment key={b.LeaveType}>{kv(b.LeaveType, `${b.Balance} of ${b.Entitled} left`)}</React.Fragment>)}
      </Row>
      <Row title="Attendance this month" to="/employee/attendance">
        {month ? <>{kv("Present days", month.Present)}{kv("Absent", month.Absent)}{kv("Break time", `${month.BreakMinutes} min`)}{kv("Extra time", `${month.ExtraMinutes} min`)}</> : <p className="text-muted-foreground">Loading…</p>}
      </Row>
    </section>
  );
}

// ── Month calendar ───────────────────────────────────────────────────────────
const DOT: Record<string, string> = { Present: "hsl(var(--ep-ink))", Holiday: "hsl(var(--ep-gold))", "On Leave": "#0ea5e9", Absent: "#dc2626", "Half Day": "#f59e0b", "Week Off": "hsl(var(--muted-foreground) / .5)" };

export function CalendarCard() {
  const [view, setView] = useState(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); });
  const key = monthKey(view);
  const att = useQuery({ queryKey: ["ep-attendance", key], queryFn: () => getPortalAttendance(key), staleTime: 60_000 });
  const holidays = useQuery({ queryKey: ["ep-holidays", view.getFullYear()], queryFn: () => getPortalHolidays(view.getFullYear()), staleTime: 5 * 60_000 });
  const status = new Map((att.data?.Days ?? []).map((d) => [d.Date, d.Status]));
  const today = ymd(new Date());
  const lead = (view.getDay() + 6) % 7; // Monday-first
  const count = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  const upcoming = (holidays.data ?? []).filter((h) => h.HolidayDate.slice(0, 10) >= today).slice(0, 2);
  const step = (n: number) => setView((v) => new Date(v.getFullYear(), v.getMonth() + n, 1));

  return (
    <section className="ep-card p-5 h-full flex flex-col" aria-label="Calendar">
      <div className="flex items-center justify-between">
        <button className="ep-icon-btn !w-8 !h-8" onClick={() => step(-1)} aria-label="Previous month"><ChevronLeft size={15} /></button>
        <h2 className="font-heading text-base font-bold">{MONTHS[view.getMonth()]} {view.getFullYear()}</h2>
        <button className="ep-icon-btn !w-8 !h-8" onClick={() => step(1)} aria-label="Next month"><ChevronRight size={15} /></button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 mt-4 text-center text-[0.6875rem] text-muted-foreground">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d}>{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-y-1 mt-1 text-center text-sm">
        {cells.map((n, i) => {
          if (!n) return <span key={i} />;
          const date = `${key}-${String(n).padStart(2, "0")}`;
          const st = status.get(date);
          const isToday = date === today;
          return (
            <span key={i} className="flex flex-col items-center py-0.5" title={st ?? undefined}>
              <span className={`w-8 h-8 rounded-full flex items-center justify-center tabular-nums ${isToday ? "ep-ink font-bold" : ""}`}>{n}</span>
              <span className="w-1.5 h-1.5 rounded-full mt-0.5" style={{ background: st ? DOT[st] ?? "transparent" : "transparent" }} />
            </span>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[0.6875rem] text-muted-foreground">
        {(["Present", "Holiday", "On Leave", "Absent"] as const).map((s) => <span key={s} className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: DOT[s] }} />{s}</span>)}
      </div>
      {upcoming.length > 0 && (
        <div className="mt-auto pt-4 space-y-2">
          {upcoming.map((h) => (
            <div key={h.HolidayId} className="rounded-2xl ep-ink px-4 py-2.5 text-sm flex items-center justify-between gap-3">
              <span className="font-semibold truncate">{h.HolidayName}</span><span className="text-white/70 text-xs shrink-0">{fmtDate(h.HolidayDate)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Leave applications (the dark task list) ──────────────────────────────────
export function LeaveChecklist() {
  const leaves = useQuery({ queryKey: ["ep-leaves"], queryFn: getPortalLeaves, staleTime: 60_000 });
  const list: LeaveApplication[] = (leaves.data ?? []).slice(0, 6);
  const approved = (leaves.data ?? []).filter((l) => l.Status === "Approved").length;
  return (
    <section className="ep-tile ep-ink p-5 h-full flex flex-col" aria-label="Leave applications">
      <div className="flex items-center justify-between"><h2 className="font-heading text-base font-bold">Leave applications</h2><span className="font-heading text-lg tabular-nums text-white/80">{approved}/{leaves.data?.length ?? 0}</span></div>
      <ul className="mt-4 space-y-3 flex-1">
        {leaves.isLoading && <li className="text-sm text-white/60">Loading…</li>}
        {leaves.data && list.length === 0 && <li className="text-sm text-white/60">You haven't applied for leave yet.</li>}
        {list.map((l) => (
          <li key={l.LeaveId} className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center shrink-0 text-xs font-bold">{l.LeaveType[0]}</span>
            <span className="min-w-0 flex-1">
              <span className={`block text-sm truncate ${l.Status === "Rejected" ? "line-through text-white/50" : ""}`}>{l.LeaveType} · {l.TotalDays} day{l.TotalDays > 1 ? "s" : ""}</span>
              <span className="block text-[0.6875rem] text-white/55">{fmtDate(l.FromDate)}{l.FromDate !== l.ToDate ? ` – ${fmtDate(l.ToDate)}` : ""} · {l.Status}</span>
            </span>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${l.Status === "Approved" ? "ep-gold" : l.Status === "Rejected" ? "bg-red-500/80" : "border border-white/30"}`}>
              {l.Status === "Approved" ? <Check size={13} /> : l.Status === "Rejected" ? <X size={13} /> : null}
            </span>
          </li>
        ))}
      </ul>
      <Link to="/employee/leave" className="ep-btn ep-btn-light mt-4 self-start">Apply / view all</Link>
    </section>
  );
}
