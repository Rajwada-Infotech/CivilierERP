import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Coffee, Loader2, LogIn, LogOut, Timer, AlertTriangle, PlayCircle, StopCircle } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import {
  clockIn, clockOut, getMyAttendance, startBreak, stopBreak,
  type AttendanceRecord, type MyAttendance, type MyState,
} from "@/api/employeeAttendanceApi";
import { fmtClock, fmtDateIst, fmtDuration, fmtTimeIst } from "@/lib/attendanceFormat";

const STATE_LABEL: Record<MyState, { text: string; cls: string }> = {
  NOT_STARTED: { text: "Not clocked in", cls: "bg-slate-200 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300" },
  WORKING: { text: "Working", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  ON_BREAK: { text: "On break", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  COMPLETED: { text: "Day complete", cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300" },
};

const STATUS_CLS: Record<string, string> = {
  Present: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Working: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  "On Break": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Incomplete: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

function PunchButton({
  label, icon: Icon, tone, enabled, busy, onClick,
}: { label: string; icon: React.ElementType; tone: string; enabled: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled || busy}
      className={`flex flex-col items-center justify-center gap-2 rounded-2xl px-4 py-5 text-sm font-semibold text-white shadow-sm transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none ${tone}`}
    >
      {busy ? <Loader2 size={24} className="animate-spin" /> : <Icon size={24} />}
      {label}
    </button>
  );
}

const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="rounded-xl bg-muted/40 p-3 text-center">
    <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
    {sub && <p className="text-[0.625rem] text-muted-foreground">{sub}</p>}
  </div>
);

export default function EmployeeAttendance() {
  const rights = usePageRights("employee-attendance");
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, isLoading } = useQuery({
    queryKey: ["employee-attendance-me"],
    queryFn: getMyAttendance,
    refetchInterval: 60_000,
    retry: false,
  });
  const { data: projects = [] } = useQuery({ queryKey: ["enterprise-options-P"], queryFn: () => getEnterpriseOptions(undefined, "P") });

  // The clock runs off the SERVER's time (offset captured at each fetch), so a wrong PC clock can't
  // make the running timers disagree with what will actually be recorded.
  const [offsetMs, setOffsetMs] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => { if (data) setOffsetMs(new Date(data.serverNow).getTime() - Date.now()); }, [data]);
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now() + offsetMs), 1000);
    return () => clearInterval(t);
  }, [offsetMs]);

  const punch = useMutation({
    mutationFn: async (kind: "in" | "out" | "break-start" | "break-stop") => {
      setBusy(kind);
      if (kind === "in") return clockIn(projectId ? Number(projectId) : undefined);
      if (kind === "out") return clockOut();
      if (kind === "break-start") return startBreak();
      return stopBreak();
    },
    onSuccess: (res: MyAttendance, kind) => {
      qc.setQueryData(["employee-attendance-me"], res);
      toast.success(
        kind === "in" ? "In Time recorded" : kind === "out" ? "Out Time recorded" : kind === "break-start" ? "Break started" : "Break stopped",
      );
    },
    onError: (e: Error) => {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: ["employee-attendance-me"] });
    },
    onSettled: () => setBusy(null),
  });

  // Live figures for a running day, computed locally off server time.
  const live = useMemo(() => {
    const c = data?.current;
    if (!c || c.outTime || !c.live) return null;
    const inMs = new Date(c.inTime).getTime();
    const session = Math.max(0, (nowMs - inMs) / 1000);
    const brk = c.breaks.reduce((s, b) => s + (b.end ? b.seconds || 0 : Math.max(0, (nowMs - new Date(b.start).getTime()) / 1000)), 0);
    return { session, brk, net: Math.max(0, session - brk) };
  }, [data, nowMs]);

  const istClock = new Date(nowMs).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
  const c: AttendanceRecord | null = data?.current ?? null;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Attendance"]} />
      <HrPayrollShell title="Attendance" subtitle="Record your In Time, breaks and Out Time" icon={Timer}>
        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</p>
        ) : error || !data ? (
          <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-5 text-sm flex gap-3">
            <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Attendance isn't available for this login</p>
              <p className="text-muted-foreground mt-1">{(error as Error)?.message}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Who / when */}
            <div className="rounded-2xl border border-border bg-card p-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-lg font-semibold">{data.employee.name}</p>
                <p className="text-sm text-muted-foreground">
                  ID {data.employee.code}
                  {data.employee.department ? ` · ${data.employee.department}` : ""}
                  {data.employee.companyName ? ` · ${data.employee.companyName}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold tabular-nums tracking-tight">{istClock}</p>
                <p className="text-xs text-muted-foreground">{fmtDateIst(data.today)} · IST</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATE_LABEL[data.state].cls}`}>{STATE_LABEL[data.state].text}</span>
            </div>

            {/* Punch buttons */}
            {rights.canCreate ? (
              <div className="space-y-3">
                {data.allowed.in && projects.length > 0 && (
                  <div className="max-w-sm">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Project (optional)</label>
                    <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full h-10 px-3 text-sm rounded-lg border border-border bg-background">
                      <option value="">— None —</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <PunchButton label="In Time" icon={LogIn} tone="bg-emerald-600 hover:bg-emerald-700" enabled={data.allowed.in} busy={busy === "in"} onClick={() => punch.mutate("in")} />
                  <PunchButton label="Break Start" icon={Coffee} tone="bg-amber-500 hover:bg-amber-600" enabled={data.allowed.breakStart} busy={busy === "break-start"} onClick={() => punch.mutate("break-start")} />
                  <PunchButton label="Break Stop" icon={StopCircle} tone="bg-sky-600 hover:bg-sky-700" enabled={data.allowed.breakStop} busy={busy === "break-stop"} onClick={() => punch.mutate("break-stop")} />
                  <PunchButton label="Out Time" icon={LogOut} tone="bg-rose-600 hover:bg-rose-700" enabled={data.allowed.out} busy={busy === "out"} onClick={() => punch.mutate("out")} />
                </div>
                <p className="text-xs text-muted-foreground">Times are recorded automatically by the system when you click — they can't be typed or changed by you.</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">You can view your attendance but don't have permission to record it.</p>
            )}

            {/* Today */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <h2 className="font-semibold text-sm">{c && c.attendanceDate !== data.today ? `Current session (started ${fmtDateIst(c.attendanceDate)})` : "Today"}</h2>
              {!c ? (
                <p className="text-sm text-muted-foreground">No attendance recorded yet today.</p>
              ) : (
                <>
                  {c.flags.length > 0 && (
                    <p className="flex items-center gap-2 text-sm text-red-600"><AlertTriangle size={14} /> This record is incomplete (Out Time or Break Stop missing) and has been flagged for HR review.</p>
                  )}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Stat label="In Time" value={fmtTimeIst(c.inTime)} />
                    <Stat label="Out Time" value={c.outTime ? fmtTimeIst(c.outTime) : "—"} />
                    <Stat label="Total Breaks" value={String(c.breakCount)} />
                    <Stat label="Break Duration" value={live ? fmtClock(live.brk) : fmtDuration(c.breakSeconds)} />
                    <Stat label="Working Duration" sub="before deducting breaks" value={live ? fmtClock(live.session) : fmtDuration(c.totalSeconds)} />
                    <Stat label="Net Working Hours" sub="after deducting breaks" value={live ? fmtClock(live.net) : fmtDuration(c.netSeconds)} />
                  </div>
                  {c.breaks.length > 0 && (
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                        <tr><th className="py-2 text-left">Break</th><th className="py-2 text-left">Start</th><th className="py-2 text-left">Stop</th><th className="py-2 text-right">Duration</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {c.breaks.map((b) => (
                          <tr key={b.breakId}>
                            <td className="py-2">#{b.no}</td>
                            <td className="py-2">{fmtTimeIst(b.start)}</td>
                            <td className="py-2">{b.end ? fmtTimeIst(b.end) : <span className="text-amber-600 font-medium flex items-center gap-1"><PlayCircle size={13} /> running</span>}</td>
                            <td className="py-2 text-right tabular-nums">{b.end ? fmtDuration(b.seconds) : live ? fmtClock((nowMs - new Date(b.start).getTime()) / 1000) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>

            {/* History */}
            <div className="rounded-2xl border border-border bg-card overflow-x-auto">
              <div className="px-5 py-3 border-b border-border"><h2 className="font-semibold text-sm">Last 30 days</h2></div>
              {data.history.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No attendance recorded yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">Date</th><th className="px-4 py-3 text-left">In</th><th className="px-4 py-3 text-left">Out</th>
                      <th className="px-4 py-3 text-right">Breaks</th><th className="px-4 py-3 text-right">Break Time</th>
                      <th className="px-4 py-3 text-right">Working</th><th className="px-4 py-3 text-right">Net Hours</th><th className="px-4 py-3 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.history.map((r) => (
                      <tr key={r.attendanceId}>
                        <td className="px-4 py-3 whitespace-nowrap">{fmtDateIst(r.attendanceDate)}</td>
                        <td className="px-4 py-3">{fmtTimeIst(r.inTime)}</td>
                        <td className="px-4 py-3">{r.outTime ? fmtTimeIst(r.outTime) : "—"}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{r.breakCount}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtDuration(r.breakSeconds)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtDuration(r.totalSeconds)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">{fmtDuration(r.netSeconds)}</td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLS[r.status]}`}>{r.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </HrPayrollShell>
    </>
  );
}
