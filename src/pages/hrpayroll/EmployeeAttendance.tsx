import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Coffee, Loader2, LogIn, LogOut, Timer, AlertTriangle, PlayCircle, StopCircle } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { HrAvatar, HrEmpty, HrSkeleton, HrStepHead, hrCard, HR_FIELD, HR_HEAD, HR_LBL, HR_NUM, HR_RULE } from "@/components/hrpayroll/HrUi";
import { SheetMark, type MarkTone } from "@/components/sheet/Sheet";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import {
  clockIn, clockOut, getMyAttendance, startBreak, stopBreak,
  type AttendanceRecord, type MyAttendance, type MyState,
} from "@/api/employeeAttendanceApi";
import { fmtClock, fmtDateIst, fmtDuration, fmtTimeIst } from "@/lib/attendanceFormat";

// Status on the sheet is a SheetMark (docs/DESIGN.md): solid = settled, half = under way, hatched = waiting,
// red = stopped, empty = not started.
const STATE_LABEL: Record<MyState, { text: string; tone: MarkTone }> = {
  NOT_STARTED: { text: "Not clocked in", tone: "draft" },
  WORKING: { text: "Working", tone: "moving" },
  ON_BREAK: { text: "On break", tone: "waiting" },
  COMPLETED: { text: "Day complete", tone: "done" },
};

const STATUS_TONE: Record<string, MarkTone> = {
  Present: "done",
  Working: "moving",
  "On Break": "waiting",
  Incomplete: "stopped",
};

const TH = "px-4 py-2.5 font-semibold";

// The punch pad's keys: large ruled cells in the sheet's key type. The natural next step is filled (and says
// "Next"); the rest are outlines; what can't be pressed now is faded. Out Time is drawn in red.
function PunchButton({
  label, icon: Icon, next, red, enabled, busy, onClick,
}: { label: string; icon: React.ElementType; next: boolean; red?: boolean; enabled: boolean; busy: boolean; onClick: () => void }) {
  const ink = red ? "border-destructive" : "border-foreground";
  const look = next
    ? `${red ? "bg-destructive text-white" : "bg-foreground text-card"} ${ink}`
    : `bg-card ${red ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-primary/10"} ${ink}`;
  return (
    <button
      onClick={onClick}
      disabled={!enabled || busy}
      className={`relative w-full flex flex-col items-center justify-center gap-2 border px-4 py-5 font-heading text-[0.6875rem] font-semibold uppercase tracking-[0.1em] transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${look}`}
    >
      {next && <span className="absolute top-1.5 right-2 text-[0.5625rem] tracking-[0.12em] opacity-80">Next</span>}
      {busy ? <Loader2 size={22} className="animate-spin" /> : <Icon size={22} />}
      {label}
    </button>
  );
}

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

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "My Attendance"]} />
      <HrPayrollShell title="My Attendance" subtitle="Record your In Time, breaks and Out Time" icon={Timer}>
        {isLoading ? (
          <HrSkeleton rows={2} />
        ) : error || !data ? (
          <div className="bg-card p-5 text-sm flex gap-3" style={{ border: HR_RULE }}>
            <AlertTriangle size={16} className="text-destructive shrink-0 mt-0.5" />
            <div>
              <p className={HR_HEAD}>Attendance isn't available for this login</p>
              <p className="text-muted-foreground mt-1">{(error as Error)?.message}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-5">
              {/* ── Clock ── */}
              <div className={`${hrCard} p-5 sm:p-6 flex flex-col justify-between gap-5`}>
                <div className="flex items-center gap-3">
                  <HrAvatar name={data.employee.name} size={40} />
                  <div className="min-w-0">
                    <p className="text-base font-heading font-semibold text-foreground truncate">{data.employee.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      <span className={HR_NUM}>{data.employee.code}</span>
                      {data.employee.department ? ` · ${data.employee.department}` : ""}
                      {data.employee.companyName ? ` · ${data.employee.companyName}` : ""}
                    </p>
                  </div>
                </div>
                <div style={{ borderTop: "1px solid hsl(var(--foreground) / 0.15)", paddingTop: 16 }}>
                  <p className={HR_LBL}>Time now · IST</p>
                  <p className={`${HR_NUM} mt-2 text-4xl sm:text-5xl font-bold tracking-tight text-foreground`}>{istClock}</p>
                  <p className="mt-1.5 text-sm text-muted-foreground">{fmtDateIst(data.today)}</p>
                </div>
                <SheetMark text={STATE_LABEL[data.state].text} tone={STATE_LABEL[data.state].tone} />
              </div>

              {/* ── Punch pad ── */}
              <div className={`${hrCard} p-5 sm:p-6`}>
                <HrStepHead title="Punch" hint="Times are taken by the system the moment you click — they can't be typed or changed." />
                {rights.canCreate ? (
                  <div className="space-y-3">
                    {data.allowed.in && projects.length > 0 && (
                      <div className="max-w-sm">
                        <label className={`block ${HR_LBL} mb-1.5`}>Project (optional)</label>
                        <SearchableNativeSelect value={projectId} onChange={(e) => setProjectId(e.target.value)} className={HR_FIELD} searchPlaceholder="Search project…">
                          <option value="">— None —</option>
                          {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </SearchableNativeSelect>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {([
                        ["in", "In Time", LogIn, false, data.allowed.in],
                        ["break-start", "Break Start", Coffee, false, data.allowed.breakStart],
                        ["break-stop", "Break Stop", StopCircle, false, data.allowed.breakStop],
                        ["out", "Out Time", LogOut, true, data.allowed.out],
                      ] as const).map(([kind, label, Icon, red, enabled]) => (
                        <PunchButton key={kind} label={label} icon={Icon} next={nextKind === kind} red={red} enabled={enabled} busy={busy === kind} onClick={() => punch.mutate(kind)} />
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
                    <p className="flex items-center gap-2 border border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive"><AlertTriangle size={14} /> This record is incomplete (Out Time or Break Stop missing) and has been flagged for HR review.</p>
                  )}
                  <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 bg-card" style={{ border: HR_RULE }}>
                    {([
                      ["In Time", fmtTimeIst(c.inTime), undefined],
                      ["Out Time", c.outTime ? fmtTimeIst(c.outTime) : "—", undefined],
                      ["Total Breaks", String(c.breakCount), undefined],
                      ["Break Duration", live ? fmtClock(live.brk) : fmtDuration(c.breakSeconds), undefined],
                      ["Working Duration", live ? fmtClock(live.session) : fmtDuration(c.totalSeconds), "before breaks"],
                      ["Net Working Hours", live ? fmtClock(live.net) : fmtDuration(c.netSeconds), "after breaks"],
                    ] as const).map(([label, value, sub], i) => (
                      <div key={label} className="px-3.5 py-3" style={{ borderLeft: i ? "1px solid hsl(var(--foreground) / 0.15)" : undefined }}>
                        <p className={HR_LBL}>{label}</p>
                        <p className={`${HR_NUM} mt-1.5 text-lg font-bold text-foreground`}>{value}</p>
                        {sub && <p className="text-[0.625rem] text-muted-foreground mt-0.5">{sub}</p>}
                      </div>
                    ))}
                  </div>
                  {c.breaks.length > 0 && (
                    <div>
                      <p className={`${HR_LBL} mb-2`}>Breaks</p>
                      <div className="flex flex-wrap gap-2">
                        {c.breaks.map((b) => (
                          <div key={b.breakId} className={`flex items-center gap-2 border px-3 py-2 text-xs ${b.end ? "border-foreground/30 bg-card" : "border-foreground bg-primary/5"}`}>
                            <span className={`flex h-5 w-5 items-center justify-center border border-foreground text-[0.625rem] font-bold ${HR_NUM}`}>{b.no}</span>
                            <span className={HR_NUM}>{fmtTimeIst(b.start)} → {b.end ? fmtTimeIst(b.end) : <span className="inline-flex items-center gap-1 font-semibold text-primary"><PlayCircle size={12} /> running</span>}</span>
                            <span className={`${HR_NUM} font-semibold`}>{b.end ? fmtDuration(b.seconds) : live ? fmtClock((nowMs - new Date(b.start).getTime()) / 1000) : "—"}</span>
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
              <div className="px-5 py-3.5 flex items-baseline gap-2.5" style={{ borderBottom: HR_RULE }}>
                <p className={HR_HEAD}>Last 30 days</p>
                <span className={`${HR_NUM} text-[0.6875rem] text-muted-foreground`}>{data.history.length}</span>
              </div>
              {data.history.length === 0 ? (
                <HrEmpty icon={Timer} title="No attendance recorded yet" />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className={HR_LBL} style={{ borderBottom: HR_RULE }}>
                      <th className={`${TH} text-left`}>Date</th>
                      <th className={`${TH} text-left`}>In</th>
                      <th className={`${TH} text-left`}>Out</th>
                      <th className={`${TH} text-right`}>Breaks</th>
                      <th className={`${TH} text-right`}>Break Time</th>
                      <th className={`${TH} text-right`}>Working</th>
                      <th className={`${TH} text-right`}>Net Hours</th>
                      <th className={`${TH} text-left`}>Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-foreground/15">
                    {data.history.map((r) => (
                      <tr key={r.attendanceId} className="hover:bg-primary/5 transition-colors">
                        <td className={`px-4 py-2.5 whitespace-nowrap ${HR_NUM}`}>{fmtDateIst(r.attendanceDate)}</td>
                        <td className={`px-4 py-2.5 ${HR_NUM}`}>{fmtTimeIst(r.inTime)}</td>
                        <td className={`px-4 py-2.5 ${HR_NUM}`}>{r.outTime ? fmtTimeIst(r.outTime) : "—"}</td>
                        <td className={`px-4 py-2.5 text-right ${HR_NUM}`}>{r.breakCount}</td>
                        <td className={`px-4 py-2.5 text-right ${HR_NUM}`}>{fmtDuration(r.breakSeconds)}</td>
                        <td className={`px-4 py-2.5 text-right ${HR_NUM}`}>{fmtDuration(r.totalSeconds)}</td>
                        <td className={`px-4 py-2.5 text-right font-semibold ${HR_NUM}`}>{fmtDuration(r.netSeconds)}</td>
                        <td className="px-4 py-2.5"><SheetMark text={r.status} tone={STATUS_TONE[r.status] ?? "waiting"} /></td>
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
