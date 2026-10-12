import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CalendarCheck, Loader2, Plus, Trash2, Save } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { ExportMenu } from "@/components/ExportMenu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getHrFilterOptions, getHrRecord, getHrRecords, getHrSummary, getNotMarked,
  hrAddBreak, hrDeleteBreak, hrUpdateBreak, hrUpdateRecord,
  type AttendanceRecord, type HrFilters,
} from "@/api/employeeAttendanceApi";
import { fmtDateIst, fmtDateTimeIst, fmtDuration, fmtTimeIst, fromIstInput, toIstInput, todayIstDate } from "@/lib/attendanceFormat";

const inputCls = "h-9 px-3 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30";
const labelCls = "block text-xs font-medium text-muted-foreground mb-1";
const STATUS_CLS: Record<string, string> = {
  Present: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Working: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  "On Break": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Incomplete: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};
const FLAG_TEXT: Record<string, string> = { MISSING_OUT: "Out Time missing", OPEN_BREAK: "Break not stopped" };

type Tab = "records" | "summary" | "missing";
type Period = "daily" | "weekly" | "monthly";

const addDays = (isoDate: string, n: number) => new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
function periodRange(period: Period, anchor: string): { from: string; to: string } {
  if (period === "daily") return { from: anchor, to: anchor };
  if (period === "weekly") {
    const dow = (new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    const from = addDays(anchor, -dow);
    return { from, to: addDays(from, 6) };
  }
  const [y, m] = anchor.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}` };
}

function StatusBadge({ r }: { r: AttendanceRecord }) {
  return (
    <div className="flex flex-col gap-1 items-start">
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLS[r.status]}`}>{r.status}</span>
      {r.flags.map((f) => (
        <span key={f} className="text-[0.625rem] text-red-600 flex items-center gap-1"><AlertTriangle size={10} /> {FLAG_TEXT[f]}</span>
      ))}
      {r.hrEdited && <span className="text-[0.625rem] text-muted-foreground">HR corrected</span>}
    </div>
  );
}

// ── Record detail + HR correction ───────────────────────────────────────────

function RecordDialog({ id, canEdit, onClose }: { id: number; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["hr-attendance-record", id], queryFn: () => getHrRecord(id) });
  const rec = data?.record;

  const [inV, setInV] = useState("");
  const [outV, setOutV] = useState("");
  const [reason, setReason] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [edits, setEdits] = useState<Record<number, { start: string; end: string }>>({});

  useEffect(() => {
    if (!rec) return;
    setInV(toIstInput(rec.inTime));
    setOutV(toIstInput(rec.outTime));
    setEdits(Object.fromEntries(rec.breaks.map((b) => [b.breakId, { start: toIstInput(b.start), end: toIstInput(b.end) }])));
  }, [rec]);

  const refresh = (res: { record: AttendanceRecord }) => {
    qc.setQueryData(["hr-attendance-record", id], res);
    qc.invalidateQueries({ queryKey: ["hr-attendance"] });
    setReason("");
  };
  const fail = (e: Error) => toast.error(e.message);
  const needReason = () => {
    if (reason.trim().length < 3) { toast.error("Enter the reason for this correction first"); return false; }
    return true;
  };

  const saveTimes = useMutation({
    mutationFn: () => hrUpdateRecord(id, { inTime: fromIstInput(inV) ?? undefined, outTime: outV ? fromIstInput(outV) : null, reason }),
    onSuccess: (r) => { refresh(r); toast.success("In / Out Time corrected"); }, onError: fail,
  });
  const addBreak = useMutation({
    mutationFn: () => hrAddBreak(id, { start: fromIstInput(newStart)!, end: newEnd ? fromIstInput(newEnd) : null, reason }),
    onSuccess: (r) => { refresh(r); setNewStart(""); setNewEnd(""); toast.success("Break added"); }, onError: fail,
  });
  const saveBreak = useMutation({
    mutationFn: (b: { id: number; start: string; end: string }) =>
      hrUpdateBreak(b.id, { start: fromIstInput(b.start) ?? undefined, end: b.end ? fromIstInput(b.end) : null, reason }),
    onSuccess: (r) => { refresh(r); toast.success("Break corrected"); }, onError: fail,
  });
  const delBreak = useMutation({
    mutationFn: (breakId: number) => hrDeleteBreak(breakId, reason),
    onSuccess: (r) => { refresh(r); toast.success("Break removed"); }, onError: fail,
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rec ? `${rec.employeeName} · ${rec.employeeCode} — ${fmtDateIst(rec.attendanceDate)}` : "Attendance"}</DialogTitle>
        </DialogHeader>
        {isLoading || !rec ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
        ) : (
          <div className="space-y-5 text-sm">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                ["In Time", fmtTimeIst(rec.inTime)], ["Out Time", rec.outTime ? fmtTimeIst(rec.outTime) : "—"], ["Breaks", String(rec.breakCount)],
                ["Break Duration", fmtDuration(rec.breakSeconds)], ["Working Duration", fmtDuration(rec.totalSeconds)], ["Net Working Hours", fmtDuration(rec.netSeconds)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-muted/40 p-3"><p className="text-[0.6875rem] uppercase text-muted-foreground">{k}</p><p className="font-semibold tabular-nums">{v}</p></div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge r={rec} />
              <span className="text-xs text-muted-foreground">{[rec.companyName, rec.department, rec.projectName].filter(Boolean).join(" · ") || "—"}</span>
            </div>

            {canEdit && (
              <div className="rounded-xl border border-border p-4 space-y-3">
                <p className="font-semibold">HR correction <span className="text-xs font-normal text-muted-foreground">— every change is recorded in the audit trail</span></p>
                <div>
                  <label className={labelCls}>Reason (required) *</label>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Employee forgot to punch out — confirmed by manager" className={`${inputCls} w-full`} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                  <div><label className={labelCls}>In Time (IST)</label><input type="datetime-local" value={inV} onChange={(e) => setInV(e.target.value)} className={`${inputCls} w-full`} /></div>
                  <div><label className={labelCls}>Out Time (IST) — clear to reopen</label><input type="datetime-local" value={outV} onChange={(e) => setOutV(e.target.value)} className={`${inputCls} w-full`} /></div>
                  <button onClick={() => needReason() && saveTimes.mutate()} disabled={saveTimes.isPending} className="h-9 px-4 rounded-lg text-sm font-semibold text-white btn-module inline-flex items-center gap-1.5 disabled:opacity-50">
                    {saveTimes.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                  </button>
                </div>
              </div>
            )}

            <div>
              <p className="font-semibold mb-2">Breaks</p>
              {rec.breaks.length === 0 && <p className="text-muted-foreground">No breaks recorded.</p>}
              <div className="space-y-2">
                {rec.breaks.map((b) => (
                  <div key={b.breakId} className="rounded-lg border border-border p-3">
                    {canEdit && edits[b.breakId] ? (
                      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_1fr_auto_auto] gap-2 items-center">
                        <span className="font-medium">#{b.no}</span>
                        <input type="datetime-local" value={edits[b.breakId].start} onChange={(e) => setEdits((p) => ({ ...p, [b.breakId]: { ...p[b.breakId], start: e.target.value } }))} className={inputCls} />
                        <input type="datetime-local" value={edits[b.breakId].end} onChange={(e) => setEdits((p) => ({ ...p, [b.breakId]: { ...p[b.breakId], end: e.target.value } }))} className={inputCls} />
                        <button onClick={() => needReason() && saveBreak.mutate({ id: b.breakId, ...edits[b.breakId] })} className="h-9 px-3 rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1"><Save size={13} /> Save</button>
                        <button onClick={() => needReason() && delBreak.mutate(b.breakId)} className="h-9 px-3 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 inline-flex items-center gap-1"><Trash2 size={13} /></button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-x-6 gap-y-1">
                        <span className="font-medium">#{b.no}</span>
                        <span>{fmtTimeIst(b.start)} → {b.end ? fmtTimeIst(b.end) : <b className="text-red-600">not stopped</b>}</span>
                        <span className="text-muted-foreground">{b.end ? fmtDuration(b.seconds) : "—"}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {canEdit && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                  <div><label className={labelCls}>Add a missed break — start (IST)</label><input type="datetime-local" value={newStart} onChange={(e) => setNewStart(e.target.value)} className={`${inputCls} w-full`} /></div>
                  <div><label className={labelCls}>Stop (IST)</label><input type="datetime-local" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} className={`${inputCls} w-full`} /></div>
                  <button onClick={() => newStart && needReason() && addBreak.mutate()} disabled={!newStart || addBreak.isPending} className="h-9 px-3 rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1 disabled:opacity-50"><Plus size={13} /> Add</button>
                </div>
              )}
            </div>

            <div>
              <p className="font-semibold mb-2">Audit trail</p>
              <div className="rounded-lg border border-border divide-y divide-border max-h-56 overflow-y-auto">
                {(data?.audit ?? []).map((a) => (
                  <div key={a.AuditId} className="px-3 py-2 text-xs">
                    <span className="font-semibold">{a.Action.replace(/_/g, " ")}</span> · {fmtDateTimeIst(a.ChangedAt)} · {a.ChangedBy}
                    {a.Detail && <p className="text-muted-foreground mt-0.5">{a.Detail}</p>}
                    {a.Reason && <p className="mt-0.5">Reason: {a.Reason}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function HrAttendanceManagement() {
  const rights = usePageRights("hr-attendance-management");
  const today = todayIstDate();

  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [employeeId, setEmployeeId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [department, setDepartment] = useState("");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState<Tab>("records");
  const [period, setPeriod] = useState<Period>("daily");
  const [anchor, setAnchor] = useState(today);
  const [missingDate, setMissingDate] = useState(today);
  const [openId, setOpenId] = useState<number | null>(null);

  const filters: HrFilters = useMemo(() => ({
    from, to,
    employeeId: employeeId ? Number(employeeId) : undefined, companyId: companyId ? Number(companyId) : undefined,
    department: department || undefined, projectId: projectId ? Number(projectId) : undefined, status: status || undefined,
  }), [from, to, employeeId, companyId, department, projectId, status]);

  const { data: opts } = useQuery({ queryKey: ["hr-attendance-filters"], queryFn: getHrFilterOptions });
  const { data: records = [], isFetching } = useQuery({ queryKey: ["hr-attendance", "records", filters], queryFn: () => getHrRecords(filters) });

  const range = periodRange(period, anchor);
  const summaryFilters: HrFilters = { ...filters, status: undefined, from: range.from, to: range.to };
  const { data: summary } = useQuery({ queryKey: ["hr-attendance", "summary", summaryFilters], queryFn: () => getHrSummary(summaryFilters), enabled: tab === "summary" });
  const missingFilters = { ...filters, status: undefined, date: missingDate };
  const { data: missing = [] } = useQuery({ queryKey: ["hr-attendance", "missing", missingFilters], queryFn: () => getNotMarked(missingFilters), enabled: tab === "missing" || (tab === "summary" && period === "daily") });

  const flagged = records.filter((r) => r.flags.length > 0).length;

  const recordColumns = [
    { header: "Employee", accessor: (r: Record<string, unknown>) => String(r.employeeName ?? "") },
    { header: "Employee ID", accessor: (r: Record<string, unknown>) => String(r.employeeCode ?? "") },
    { header: "Company", accessor: (r: Record<string, unknown>) => String(r.companyName ?? "") },
    { header: "Department", accessor: (r: Record<string, unknown>) => String(r.department ?? "") },
    { header: "Project", accessor: (r: Record<string, unknown>) => String(r.projectName ?? "") },
    { header: "Date", accessor: (r: Record<string, unknown>) => String(r.attendanceDate ?? "") },
    { header: "In Time", accessor: (r: Record<string, unknown>) => fmtTimeIst(r.inTime as string) },
    { header: "Out Time", accessor: (r: Record<string, unknown>) => (r.outTime ? fmtTimeIst(r.outTime as string) : "") },
    { header: "Breaks", accessor: (r: Record<string, unknown>) => String(r.breakCount ?? 0) },
    { header: "Break Duration", accessor: (r: Record<string, unknown>) => fmtDuration(r.breakSeconds as number) },
    { header: "Working Duration", accessor: (r: Record<string, unknown>) => fmtDuration(r.totalSeconds as number | null) },
    { header: "Net Working Hours", accessor: (r: Record<string, unknown>) => fmtDuration(r.netSeconds as number | null) },
    { header: "Status", accessor: (r: Record<string, unknown>) => `${r.status}${(r.flags as string[]).length ? ` (${(r.flags as string[]).map((f) => FLAG_TEXT[f]).join(", ")})` : ""}` },
  ];
  const summaryColumns = [
    { header: "Employee", accessor: (r: Record<string, unknown>) => String(r.employeeName ?? "") },
    { header: "Employee ID", accessor: (r: Record<string, unknown>) => String(r.employeeCode ?? "") },
    { header: "Department", accessor: (r: Record<string, unknown>) => String(r.department ?? "") },
    { header: "Days", accessor: (r: Record<string, unknown>) => String(r.days) },
    { header: "Incomplete Days", accessor: (r: Record<string, unknown>) => String(r.incompleteDays) },
    { header: "Breaks", accessor: (r: Record<string, unknown>) => String(r.breakCount) },
    { header: "Break Duration", accessor: (r: Record<string, unknown>) => fmtDuration(r.breakSeconds as number) },
    { header: "Working Duration", accessor: (r: Record<string, unknown>) => fmtDuration(r.totalSeconds as number) },
    { header: "Net Working Hours", accessor: (r: Record<string, unknown>) => fmtDuration(r.netSeconds as number) },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "HR Attendance Management"]} />
      <HrPayrollShell
        title="HR Attendance Management"
        subtitle="Attendance, breaks and working hours of every employee"
        icon={CalendarCheck}
        action={
          rights.canExport ? (
            <ExportMenu
              data={tab === "summary" ? (summary?.employees ?? []) as unknown as Record<string, unknown>[] : records as unknown as Record<string, unknown>[]}
              columns={tab === "summary" ? summaryColumns : recordColumns}
              title={tab === "summary" ? `Attendance Summary (${range.from} to ${range.to})` : `Attendance Records (${from} to ${to})`}
              filename={tab === "summary" ? `attendance-summary-${range.from}_${range.to}` : `attendance-${from}_${to}`}
              disabled={tab === "missing"}
            />
          ) : undefined
        }
      >
        {/* Filters */}
        <div className="rounded-xl border border-border bg-card p-4 mb-5 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <div><label className={labelCls}>From</label><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={`${inputCls} w-full`} /></div>
          <div><label className={labelCls}>To</label><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={`${inputCls} w-full`} /></div>
          <div><label className={labelCls}>Employee</label>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={`${inputCls} w-full`}><option value="">All</option>{opts?.employees.map((e) => <option key={e.id} value={e.id}>{e.label} ({e.code})</option>)}</select></div>
          <div><label className={labelCls}>Company</label>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={`${inputCls} w-full`}><option value="">All</option>{opts?.companies.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
          <div><label className={labelCls}>Department</label>
            <select value={department} onChange={(e) => setDepartment(e.target.value)} className={`${inputCls} w-full`}><option value="">All</option>{opts?.departments.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
          <div><label className={labelCls}>Project</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${inputCls} w-full`}><option value="">All</option>{opts?.projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
          <div><label className={labelCls}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} w-full`}>
              <option value="">All</option><option value="Flagged">Needs review (incomplete)</option><option value="Present">Present</option><option value="Working">Working</option><option value="On Break">On Break</option><option value="Incomplete">Incomplete</option>
            </select></div>
        </div>

        <div className="flex gap-1 mb-4 border-b border-border">
          {([["records", "Attendance Records"], ["summary", "Daily / Weekly / Monthly Summary"], ["missing", "Not Marked (Missing In Time)"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === k ? "border-yellow-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
          ))}
        </div>

        {tab === "records" && (
          <>
            <p className="text-xs text-muted-foreground mb-2 flex items-center gap-3">
              {isFetching ? <Loader2 size={12} className="animate-spin" /> : null}
              {records.length} record{records.length === 1 ? "" : "s"}
              {flagged > 0 && <span className="text-red-600 font-medium flex items-center gap-1"><AlertTriangle size={12} /> {flagged} incomplete — needs HR review</span>}
            </p>
            <div className="rounded-xl border border-border bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Employee</th><th className="px-4 py-3 text-left">Company / Dept</th><th className="px-4 py-3 text-left">Project</th>
                    <th className="px-4 py-3 text-left">Date</th><th className="px-4 py-3 text-left">In</th><th className="px-4 py-3 text-left">Out</th>
                    <th className="px-4 py-3 text-right">Breaks</th><th className="px-4 py-3 text-right">Break Time</th><th className="px-4 py-3 text-right">Working</th>
                    <th className="px-4 py-3 text-right">Net Hours</th><th className="px-4 py-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {records.length === 0 && <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">No attendance records for these filters.</td></tr>}
                  {records.map((r) => (
                    <tr key={r.attendanceId} onClick={() => setOpenId(r.attendanceId)} className={`cursor-pointer hover:bg-muted/40 ${r.flags.length ? "bg-red-500/[0.04]" : ""}`}>
                      <td className="px-4 py-3"><p className="font-medium">{r.employeeName}</p><p className="text-xs text-muted-foreground">{r.employeeCode}</p></td>
                      <td className="px-4 py-3 text-xs">{r.companyName || "—"}<br /><span className="text-muted-foreground">{r.department || "—"}</span></td>
                      <td className="px-4 py-3 text-xs">{r.projectName || "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{fmtDateIst(r.attendanceDate)}</td>
                      <td className="px-4 py-3">{fmtTimeIst(r.inTime)}</td>
                      <td className="px-4 py-3">{r.outTime ? fmtTimeIst(r.outTime) : <span className="text-red-600">—</span>}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.breakCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtDuration(r.breakSeconds)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtDuration(r.totalSeconds)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{fmtDuration(r.netSeconds)}</td>
                      <td className="px-4 py-3"><StatusBadge r={r} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "summary" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="inline-flex rounded-lg border border-border p-0.5 text-sm">
                {(["daily", "weekly", "monthly"] as const).map((p) => (
                  <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1.5 rounded-md capitalize ${period === p ? "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 font-semibold" : "text-muted-foreground"}`}>{p}</button>
                ))}
              </div>
              <div><label className={labelCls}>{period === "daily" ? "Date" : period === "weekly" ? "Any day of the week" : "Any day of the month"}</label>
                <input type="date" value={anchor} max={today} onChange={(e) => e.target.value && setAnchor(e.target.value)} className={inputCls} /></div>
              <p className="text-xs text-muted-foreground pb-2">{fmtDateIst(range.from)}{range.from !== range.to ? ` → ${fmtDateIst(range.to)}` : ""}</p>
            </div>
            {summary && (
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {[
                  ["Employees", String(summary.totals.employees)], ["Working Duration", fmtDuration(summary.totals.totalSeconds)],
                  ["Break Duration", fmtDuration(summary.totals.breakSeconds)], ["Net Working Hours", fmtDuration(summary.totals.netSeconds)],
                  ["Incomplete Days", String(summary.totals.incompleteDays)],
                ].map(([k, v]) => <div key={k} className="rounded-xl border border-border bg-card p-3 text-center"><p className="text-[0.6875rem] uppercase text-muted-foreground">{k}</p><p className="text-lg font-bold tabular-nums">{v}</p></div>)}
              </div>
            )}
            <div className="rounded-xl border border-border bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-4 py-3 text-left">Employee</th><th className="px-4 py-3 text-left">Department</th><th className="px-4 py-3 text-right">Days</th><th className="px-4 py-3 text-right">Incomplete</th>
                    <th className="px-4 py-3 text-right">Breaks</th><th className="px-4 py-3 text-right">Break Time</th><th className="px-4 py-3 text-right">Working</th><th className="px-4 py-3 text-right">Net Hours</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(summary?.employees ?? []).length === 0 && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No attendance in this period.</td></tr>}
                  {(summary?.employees ?? []).map((s) => (
                    <tr key={s.employeeId}>
                      <td className="px-4 py-3"><p className="font-medium">{s.employeeName}</p><p className="text-xs text-muted-foreground">{s.employeeCode}</p></td>
                      <td className="px-4 py-3 text-xs">{s.department || "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{s.days}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{s.incompleteDays ? <span className="text-red-600 font-medium">{s.incompleteDays}</span> : 0}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{s.breakCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtDuration(s.breakSeconds)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtDuration(s.totalSeconds)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{fmtDuration(s.netSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {period === "daily" && <p className="text-xs text-muted-foreground">{missing.length} active employee{missing.length === 1 ? "" : "s"} have no In Time on this day — see "Not Marked".</p>}
          </div>
        )}

        {tab === "missing" && (
          <div className="space-y-3">
            <div className="max-w-[200px]"><label className={labelCls}>Date</label><input type="date" value={missingDate} max={today} onChange={(e) => e.target.value && setMissingDate(e.target.value)} className={`${inputCls} w-full`} /></div>
            <div className="rounded-xl border border-border bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3 text-left">Employee</th><th className="px-4 py-3 text-left">Employee ID</th><th className="px-4 py-3 text-left">Company</th><th className="px-4 py-3 text-left">Department</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {missing.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">Everyone has an In Time on {fmtDateIst(missingDate)}.</td></tr>}
                  {missing.map((m) => (
                    <tr key={m.EmployeeId}><td className="px-4 py-3 font-medium">{m.EmployeeName}</td><td className="px-4 py-3">{m.EmployeeCode}</td><td className="px-4 py-3">{m.CompanyName || "—"}</td><td className="px-4 py-3">{m.Department || "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </HrPayrollShell>

      {openId != null && <RecordDialog id={openId} canEdit={rights.canEdit} onClose={() => setOpenId(null)} />}
    </>
  );
}
