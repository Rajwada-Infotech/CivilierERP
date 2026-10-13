import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Coffee, Loader2, LogIn, LogOut, Timer, AlertTriangle, PlayCircle, StopCircle } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell, HR_PAYROLL_ACCENT as ACCENT, HR_GRADIENT } from "@/components/hrpayroll/HrPayrollShell";
import { HrAvatar, HrEmpty, HrSkeleton, HrStepHead, hrCard } from "@/components/hrpayroll/HrUi";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
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
  <div className="rounded-xl border border-border bg-background/50 p-3 text-center">
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

  // Which button is the natural next step (display only — `allowed` still decides what's clickable).
  const nextKind = data?.allowed.in ? "in" : data?.allowed.breakStop ? "break-stop" : data?.allowed.out ? "out" : null;
  const stateDot: Record<MyState, string> = { NOT_STARTED: "#94a3b8", WORKING: "#10b981", ON_BREAK: "#f59e0b", COMPLETED: "#0ea5e9" };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Attendance"]} />
      <HrPayrollShell title="Attendance" subtitle="Record your In Time, breaks and Out Time" icon={Timer}>
        {isLoading ? (
          <HrSkeleton rows={2} />
        ) : error || !data ? (
          <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-5 text-sm flex gap-3">
            <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Attendance isn't available for this login</p>
              <p className="text-muted-foreground mt-1">{(error as Error)?.message}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-5">
              {/* ── Clock ── */}
              <div className={`${hrCard} p-5 sm:p-6 flex flex-col justify-between gap-5`} style={{ background: `${ACCENT}0a` }}>
                <div className="flex items-center gap-3">
                  <HrAvatar name={data.employee.name} size={44} />
                  <div className="min-w-0">
                    <p className="text-base font-heading font-semibold text-foreground truncate">{data.employee.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      ID {data.employee.code}
                      {data.employee.department ? ` · ${data.employee.department}` : ""}
                      {data.employee.companyName ? ` · ${data.employee.companyName}` : ""}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-4xl sm:text-5xl font-heading font-bold tabular-nums tracking-tight text-foreground">{istClock}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{fmtDateIst(data.today)} · IST</p>
                </div>
                <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${STATE_LABEL[data.state].cls}`}>
                  <span className="relative flex h-2 w-2">
                    {(data.state === "WORKING" || data.state === "ON_BREAK") && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: stateDot[data.state] }} />}
                    <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: stateDot[data.state] }} />
                  </span>
                  {STATE_LABEL[data.state].text}
                </span>
              </div>

              {/* ── Punch pad ── */}
              <div className={`${hrCard} p-5 sm:p-6`}>
                <HrStepHead title="Punch" hint="Times are taken by the system the moment you click — they can't be typed or changed." />
                {rights.canCreate ? (
                  <div className="space-y-3">
                    {data.allowed.in && projects.length > 0 && (
                      <div className="max-w-sm">
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Project (optional)</label>
                        <SearchableNativeSelect value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full h-10 px-3 text-sm rounded-lg border border-border bg-background" searchPlaceholder="Search project…">
                          <option value="">— None —</option>
                          {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </SearchableNativeSelect>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {([
                        ["in", "In Time", LogIn, "bg-emerald-600 hover:bg-emerald-700", data.allowed.in],
                        ["break-start", "Break Start", Coffee, "bg-amber-500 hover:bg-amber-600", data.allowed.breakStart],
                        ["break-stop", "Break Stop", StopCircle, "bg-sky-600 hover:bg-sky-700", data.allowed.breakStop],
                        ["out", "Out Time", LogOut, "bg-rose-600 hover:bg-rose-700", data.allowed.out],
                      ] as const).map(([kind, label, Icon, tone, enabled]) => (
                        <div key={kind} className="relative">
                          {nextKind === kind && (
                            <span className="absolute -top-2 right-3 z-10 rounded-full px-2 py-0.5 text-[0.625rem] font-bold text-white shadow" style={{ background: HR_GRADIENT }}>Next</span>
                          )}
                          <PunchButton label={label} icon={Icon} tone={`${tone} w-full ${nextKind === kind ? "ring-4 ring-offset-2 ring-offset-background ring-black/5 shadow-lg" : ""}`} enabled={enabled} busy={busy === kind} onClick={() => punch.mutate(kind)} />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">You can view your attendance but don't have permission to record it.</p>
                )}
              </div>
            </div>

            {/* ── Today ── */}
            <div className={`${hrCard} p-5 sm:p-6 space-y-4`}>
              <HrStepHead title={c && c.attendanceDate !== data.today ? `Current session (started ${fmtDateIst(c.attendanceDate)})` : "Today"} hint={live ? "Live — updates every second" : undefined} />
              {!c ? (
                <HrEmpty icon={Timer} title="Nothing recorded yet today" text="Press In Time when you start work." />
              ) : (
                <>
                  {c.flags.length > 0 && (
                    <p className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600"><AlertTriangle size={14} /> This record is incomplete (Out Time or Break Stop missing) and has been flagged for HR review.</p>
                  )}
                  <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
                    <Stat label="In Time" value={fmtTimeIst(c.inTime)} />
                    <Stat label="Out Time" value={c.outTime ? fmtTimeIst(c.outTime) : "—"} />
                    <Stat label="Total Breaks" value={String(c.breakCount)} />
                    <Stat label="Break Duration" value={live ? fmtClock(live.brk) : fmtDuration(c.breakSeconds)} />
                    <Stat label="Working Duration" sub="before deducting breaks" value={live ? fmtClock(live.session) : fmtDuration(c.totalSeconds)} />
                    <Stat label="Net Working Hours" sub="after deducting breaks" value={live ? fmtClock(live.net) : fmtDuration(c.netSeconds)} />
                  </div>
                  {c.breaks.length > 0 && (
                    <div>
                      <p className="mb-2 text-[0.6875rem] font-heading uppercase tracking-wider text-muted-foreground">Breaks</p>
                      <div className="flex flex-wrap gap-2">
                        {c.breaks.map((b) => (
                          <div key={b.breakId} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${b.end ? "border-border bg-background/50" : "border-amber-500/40 bg-amber-500/10"}`}>
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[0.625rem] font-bold">{b.no}</span>
                            <span className="tabular-nums">{fmtTimeIst(b.start)} → {b.end ? fmtTimeIst(b.end) : <span className="inline-flex items-center gap-1 font-semibold text-amber-600"><PlayCircle size={12} /> running</span>}</span>
                            <span className="font-semibold tabular-nums">{b.end ? fmtDuration(b.seconds) : live ? fmtClock((nowMs - new Date(b.start).getTime()) / 1000) : "—"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── History ── */}
            <div className={`${hrCard} overflow-x-auto`}>
              <div className="px-5 py-3.5 border-b border-border"><p className="font-heading font-semibold text-sm">Last 30 days</p></div>
              {data.history.length === 0 ? (
                <HrEmpty icon={Timer} title="No attendance recorded yet" />
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">Date</th><th className="px-4 py-3 text-left">In</th><th className="px-4 py-3 text-left">Out</th>
                      <th className="px-4 py-3 text-right">Breaks</th><th className="px-4 py-3 text-right">Break Time</th>
                      <th className="px-4 py-3 text-right">Working</th><th className="px-4 py-3 text-right">Net Hours</th><th className="px-4 py-3 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {data.history.map((r) => (
                      <tr key={r.attendanceId}>
                        <td className="px-4 py-3 whitespace-nowrap font-medium">{fmtDateIst(r.attendanceDate)}</td>
                        <td className="px-4 py-3 tabular-nums">{fmtTimeIst(r.inTime)}</td>
                        <td className="px-4 py-3 tabular-nums">{r.outTime ? fmtTimeIst(r.outTime) : "—"}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{r.breakCount}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtDuration(r.breakSeconds)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtDuration(r.totalSeconds)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtDuration(r.netSeconds)}</td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLS[r.status]}`}>{r.status}</span></td>
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
