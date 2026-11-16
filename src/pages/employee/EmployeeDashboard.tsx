// Employee Portal home: who you are, this year's leave balances, your latest payslip, pending applications and the next holidays.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getPortalHolidays, getPortalLeaveBalances, getPortalLeaves, getPortalPayslips, getPortalProfile } from "@/api/employeePortalApi";
import { Card, Loading, MONTHS, Mark, Note, PageHeader, Stat, fmtDate, inr, labelCls } from "./employeeUi";

export default function EmployeeDashboard() {
  const year = new Date().getFullYear();
  const profile = useQuery({ queryKey: ["ep-profile"], queryFn: getPortalProfile, staleTime: 5 * 60_000 });
  const payslips = useQuery({ queryKey: ["ep-payslips"], queryFn: getPortalPayslips, staleTime: 60_000 });
  const balances = useQuery({ queryKey: ["ep-balances", year], queryFn: () => getPortalLeaveBalances(year), staleTime: 60_000 });
  const leaves = useQuery({ queryKey: ["ep-leaves"], queryFn: getPortalLeaves, staleTime: 60_000 });
  const holidays = useQuery({ queryKey: ["ep-holidays", year], queryFn: () => getPortalHolidays(year), staleTime: 5 * 60_000 });

  const p = profile.data;
  const latest = payslips.data?.[0];
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (holidays.data ?? []).filter((h) => h.HolidayDate.slice(0, 10) >= today).slice(0, 4);
  const pending = (leaves.data ?? []).filter((l) => l.Status === "Pending");

  if (profile.isError) return <Note tone="error">{(profile.error as Error).message}</Note>;

  return (
    <>
      <PageHeader title={p ? `Welcome, ${p.EmployeeName.split(" ")[0]}` : "Welcome"} subtitle={p ? `${p.Designation || "Employee"}${p.Department ? ` · ${p.Department}` : ""} · ${p.EmployeeCode}` : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Latest net pay" value={latest ? inr(latest.NetSalary) : "—"} note={latest ? `${MONTHS[latest.PeriodMonth - 1]} ${latest.PeriodYear}` : "No payslip yet"} />
        {(balances.data?.Balances ?? []).filter((b) => b.LeaveType !== "Unpaid").map((b) => (
          <Stat key={b.LeaveType} label={`${b.LeaveType} leave left`} value={b.Balance ?? "—"} note={`of ${b.Entitled} days in ${year}`} />
        ))}
        {balances.isLoading && <Stat label="Leave" value="…" />}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Upcoming holidays" right={<Link to="/employee/holidays" className={`${labelCls} hover:text-foreground`}>All holidays</Link>}>
          {holidays.isLoading ? <Loading /> : upcoming.length === 0 ? <Note>No upcoming holidays this year.</Note> : (
            <ul className="divide-y divide-foreground/15">
              {upcoming.map((h) => (
                <li key={h.HolidayId} className="flex justify-between gap-3 px-4 py-2.5 text-sm"><span>{h.HolidayName}</span><span className="text-muted-foreground tabular-nums">{fmtDate(h.HolidayDate)}</span></li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Leave applications awaiting approval" right={<Link to="/employee/leave" className={`${labelCls} hover:text-foreground`}>Apply for leave</Link>}>
          {leaves.isLoading ? <Loading /> : pending.length === 0 ? <Note>Nothing pending.</Note> : (
            <ul className="divide-y divide-foreground/15">
              {pending.map((l) => (
                <li key={l.LeaveId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span>{l.LeaveType} · {fmtDate(l.FromDate)}{l.FromDate !== l.ToDate ? ` – ${fmtDate(l.ToDate)}` : ""} ({l.TotalDays}d)</span>
                  <Mark text={l.Status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
