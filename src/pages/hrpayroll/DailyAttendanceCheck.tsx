// Payroll > Daily Attendance Check: pick an employee (or all) and a date range and see, day by day, the In / Out time, every
// break with its reason, the break time, official work out of the office, extra time over the allowance and the net working
// hours -- with the totals the salary calculation needs. Click a day to open its breaks.
import React, { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, ChevronDown, ChevronRight } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { HrError, HrSkeleton, HrStatStrip, HR_FIELD, HR_LBL, HR_RULE } from "@/components/hrpayroll/HrUi";
import { SheetMark, type MarkTone } from "@/components/sheet/Sheet";
import { ExportMenu } from "@/components/ExportMenu";
import { getHrFilterOptions, getHrRecords, type AttendanceRecord } from "@/api/employeeAttendanceApi";
import { fmtDateIst, fmtDuration, fmtTimeIst, todayIstDate } from "@/lib/attendanceFormat";

const NUM = "font-heading tabular-nums";
const labelCls = `block ${HR_LBL} mb-1.5`;
const STATUS_TONE: Record<string, MarkTone> = { Present: "done", Working: "moving", "On Break": "waiting", Incomplete: "stopped" };
const sum = (rows: AttendanceRecord[], pick: (r: AttendanceRecord) => number) => rows.reduce((t, r) => t + pick(r), 0);

export default function DailyAttendanceCheck() {
  const rights = usePageRights("hr-attendance-management");
  const today = todayIstDate();
  const [employeeId, setEmployeeId] = useState("");
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [open, setOpen] = useState<number | null>(null);

  const { data: opts } = useQuery({ queryKey: ["hr-attendance-filters"], queryFn: getHrFilterOptions, staleTime: 5 * 60_000 });
  const { data: records = [], isLoading, isError } = useQuery({
    queryKey: ["daily-attendance-check", employeeId, from, to],
    queryFn: () => getHrRecords({ from, to, employeeId: employeeId ? Number(employeeId) : undefined }),
    enabled: !!from && !!to && from <= to,
  });

  // Day by day: oldest first, grouped by employee when several are shown.
  const rows = useMemo(
    () => [...records].sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName)) || a.attendanceDate.localeCompare(b.attendanceDate)),
    [records],
  );
  const complete = rows.filter((r) => r.status === "Present");
  const totals = {
    days: rows.length,
    working: sum(complete, (r) => r.totalSeconds ?? 0),
    breaks: sum(rows, (r) => r.breakSeconds),
    official: sum(rows, (r) => r.officialSeconds ?? 0),
    extra: sum(rows, (r) => r.extraSeconds ?? 0),
    net: sum(complete, (r) => r.netSeconds ?? 0),
    flagged: rows.filter((r) => r.flags.length > 0).length,
  };
  const all = !employeeId;

  const exportColumns = [
    { header: "Employee", accessor: (r: Record<string, unknown>) => String(r.employeeName ?? "") },
    { header: "Code", accessor: (r: Record<string, unknown>) => String(r.employeeCode ?? "") },
    { header: "Date", accessor: (r: Record<string, unknown>) => String(r.attendanceDate ?? "") },
    { header: "In", accessor: (r: Record<string, unknown>) => fmtTimeIst(r.inTime as string) },
    { header: "Out", accessor: (r: Record<string, unknown>) => (r.outTime ? fmtTimeIst(r.outTime as string) : "") },
    { header: "Breaks", accessor: (r: Record<string, unknown>) => String(r.breakCount) },
    { header: "Break Time", accessor: (r: Record<string, unknown>) => fmtDuration(r.breakSeconds as number) },
    { header: "Official Work Out", accessor: (r: Record<string, unknown>) => fmtDuration((r.officialSeconds as number) ?? 0) },
    { header: "Extra Time", accessor: (r: Record<string, unknown>) => fmtDuration((r.extraSeconds as number) ?? 0) },
    { header: "Working", accessor: (r: Record<string, unknown>) => fmtDuration(r.totalSeconds as number) },
    { header: "Net Hours", accessor: (r: Record<string, unknown>) => fmtDuration(r.netSeconds as number) },
    { header: "Status", accessor: (r: Record<string, unknown>) => String(r.status ?? "") },
  ];
  const colSpan = all ? 12 : 11;
  const th = "font-semibold px-4 py-2.5";

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Payroll", "Daily Attendance Check"]} />
      <HrPayrollShell
        title="Daily Attendance Check"
        subtitle="Day-by-day punches, breaks and working hours for each employee"
        icon={CalendarCheck}
        action={rights.canExport ? (
          <ExportMenu
            data={rows as unknown as Record<string, unknown>[]}
            columns={exportColumns}
            title={`Daily Attendance Check (${from} to ${to})`}
            filename={`daily-attendance-check-${from}_${to}`}
          />
        ) : undefined}
      >
        <div className="grid sm:grid-cols-[2fr_1fr_1fr] gap-3 mb-4">
          <div>
            <label className={labelCls} htmlFor="dac-emp">Employee</label>
            <select id="dac-emp" className={HR_FIELD} value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setOpen(null); }}>
              <option value="">All employees</option>
              {(opts?.employees ?? []).map((e) => <option key={e.id} value={e.id}>{e.label} ({e.code})</option>)}
            </select>
          </div>
          <div><label className={labelCls} htmlFor="dac-from">From</label><input id="dac-from" type="date" className={HR_FIELD} value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className={labelCls} htmlFor="dac-to">To</label><input id="dac-to" type="date" className={HR_FIELD} value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
        </div>

        <HrStatStrip items={[
          { label: "Days", value: totals.days },
          { label: "Working", value: fmtDuration(totals.working) },
          { label: "Break time", value: fmtDuration(totals.breaks) },
          { label: "Official work out", value: fmtDuration(totals.official) },
          { label: "Extra time", value: fmtDuration(totals.extra), tone: totals.extra > 0 ? "hsl(var(--destructive))" : undefined },
          { label: "Net working", value: fmtDuration(totals.net) },
        ]} />

        <div className="bg-card mt-4 overflow-x-auto" style={{ border: HR_RULE }}>
          {from > to ? <p className="p-6 text-sm text-destructive">From date must be on or before To date.</p>
            : isLoading ? <div className="p-4"><HrSkeleton rows={4} /></div>
            : isError ? <div className="p-4"><HrError text="Failed to load attendance." /></div>
            : (
              <table className="w-full text-sm">
                <thead className={HR_LBL} style={{ borderBottom: HR_RULE }}>
                  <tr>
                    <th className={`${th} text-left w-8`} />
                    {all && <th className={`${th} text-left`}>Employee</th>}
                    <th className={`${th} text-left`}>Date</th><th className={`${th} text-left`}>In</th><th className={`${th} text-left`}>Out</th>
                    <th className={`${th} text-right`}>Breaks</th><th className={`${th} text-right`}>Break Time</th><th className={`${th} text-right`}>Official Out</th>
                    <th className={`${th} text-right`}>Extra</th><th className={`${th} text-right`}>Working</th><th className={`${th} text-right`}>Net Hours</th><th className={`${th} text-left`}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/15">
                  {rows.length === 0 && <tr><td colSpan={colSpan} className="p-8 text-center text-muted-foreground">No attendance for this employee and period.</td></tr>}
                  {rows.map((r) => {
                    const expanded = open === r.attendanceId;
                    return (
                      <Fragment key={r.attendanceId}>
                        <tr onClick={() => setOpen(expanded ? null : r.attendanceId)} className={`cursor-pointer hover:bg-primary/5 ${r.flags.length ? "bg-destructive/5" : ""}`} aria-expanded={expanded}>
                          <td className="px-3 py-3 text-muted-foreground">{r.breakCount > 0 ? (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}</td>
                          {all && <td className="px-4 py-3"><p className="font-medium">{r.employeeName}</p><p className={`text-xs text-muted-foreground ${NUM}`}>{r.employeeCode}</p></td>}
                          <td className={`px-4 py-3 whitespace-nowrap ${NUM}`}>{fmtDateIst(r.attendanceDate)}</td>
                          <td className={`px-4 py-3 ${NUM}`}>{fmtTimeIst(r.inTime)}</td>
                          <td className={`px-4 py-3 ${NUM}`}>{r.outTime ? fmtTimeIst(r.outTime) : <span className="text-destructive">—</span>}</td>
                          <td className={`px-4 py-3 text-right ${NUM}`}>{r.breakCount}</td>
                          <td className={`px-4 py-3 text-right ${NUM}`}>{fmtDuration(r.breakSeconds)}</td>
                          <td className={`px-4 py-3 text-right ${NUM}`}>{(r.officialSeconds ?? 0) > 0 ? fmtDuration(r.officialSeconds) : "—"}</td>
                          <td className={`px-4 py-3 text-right ${NUM} ${(r.extraSeconds ?? 0) > 0 ? "text-destructive font-semibold" : ""}`}>{(r.extraSeconds ?? 0) > 0 ? fmtDuration(r.extraSeconds) : "—"}</td>
                          <td className={`px-4 py-3 text-right ${NUM}`}>{fmtDuration(r.totalSeconds)}</td>
                          <td className={`px-4 py-3 text-right ${NUM} font-medium`}>{fmtDuration(r.netSeconds)}</td>
                          <td className="px-4 py-3"><SheetMark text={r.status} tone={STATUS_TONE[r.status] ?? "waiting"} /></td>
                        </tr>
                        {expanded && r.breaks.length > 0 && (
                          <tr className="bg-muted/20">
                            <td colSpan={colSpan} className="px-6 py-3">
                              <p className={`${HR_LBL} mb-2`}>Breaks on {fmtDateIst(r.attendanceDate)}</p>
                              <ul className="divide-y divide-foreground/15 border border-foreground/20 bg-card">
                                {r.breaks.map((b) => (
                                  <li key={b.breakId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                                    <span><b>{b.type ?? "Break"}</b>{b.note ? <span className="text-muted-foreground"> — {b.note}</span> : null}
                                      <span className={`text-muted-foreground ${NUM}`}> · {fmtTimeIst(b.start)} → {b.end ? fmtTimeIst(b.end) : "not stopped"}</span></span>
                                    <span className={NUM}>{b.end ? fmtDuration(b.seconds) : "—"}{b.deduct === false ? " (counts as work)" : ""}
                                      {(b.overSeconds ?? 0) > 0 && <b className="text-destructive"> · {fmtDuration(b.overSeconds)} extra</b>}</span>
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Working = Out − In. Break time comes off working time; official work out of the office (a meeting at another office) counts as work.
          Extra time is break time beyond the allowance. Net = Working − Break time. Days still open, or flagged for a missing Out, are marked.
        </p>
      </HrPayrollShell>
    </>
  );
}
