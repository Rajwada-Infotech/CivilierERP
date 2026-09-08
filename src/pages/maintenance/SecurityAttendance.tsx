import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ShieldCheck,
  Users,
  UserCheck,
  UserX,
  Clock,
  Timer,
  ClipboardList,
  Plus,
  Search,
  LogIn,
  LogOut,
  Pencil,
  CheckCircle2,
  XCircle,
  Ban,
  History as HistoryIcon,
  Loader2,
  X,
  CalendarClock,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell, MAINTENANCE_ACCENT as ACCENT } from "@/components/maintenance/MaintenanceShell";
import { usePageRights } from "@/hooks/usePageRights";
import { GlassCard, GlassSection } from "@/components/dashboard/GlassShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getSecurityAttendanceDashboard,
  getSecurityShifts,
  createSecurityShift,
  updateSecurityShift,
  getSecurityPersonnel,
  createSecurityPersonnel,
  updateSecurityPersonnel,
  getSecurityAttendance,
  checkInSecurity,
  checkOutSecurity,
  markSecurityAbsent,
  verifySecurityAttendance,
  rejectSecurityAttendance,
  cancelSecurityAttendance,
  getSecurityAttendanceLogs,
  type SecurityShift,
  type SecurityPersonnelRow,
  type SecurityAttendanceRow,
  type AttendanceStatus,
} from "@/api/securityAttendanceApi";

const PAGE_KEY = "maintenance-security-attendance";
const TABS = ["overview", "checkinout", "personnel", "history", "shifts"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview",
  checkinout: "Check-In / Check-Out",
  personnel: "Personnel",
  history: "History",
  shifts: "Shifts",
};

const todayStr = () => new Date().toISOString().slice(0, 10);

// A SQL Server TIME column round-trips as a Date anchored to 1970-01-01 —
// always read it back in UTC or the displayed hour drifts with the
// viewer's timezone.
const fmtTimeOfDay = (t: string | null | undefined) => {
  if (!t) return "—";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return String(t);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "UTC" });
};
const fmtDateTime = (t: string | null | undefined) => {
  if (!t) return "—";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return String(t);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
};
const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-");
  if (!y || !m || !day) return d;
  return `${day}/${m}/${y}`;
};

const STATUS_STYLE: Record<AttendanceStatus, string> = {
  Present: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600",
  Late: "bg-amber-500/10 border-amber-500/20 text-amber-600",
  Absent: "bg-red-500/10 border-red-500/20 text-red-600",
  HalfDay: "bg-sky-500/10 border-sky-500/20 text-sky-600",
};

function StatusBadge({ status }: { status: AttendanceStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${STATUS_STYLE[status] || "bg-muted border-border text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function VerificationBadge({ status }: { status: string }) {
  const style =
    status === "Verified" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" :
    status === "Rejected" ? "bg-red-500/10 border-red-500/20 text-red-600" :
    "bg-amber-500/10 border-amber-500/20 text-amber-600";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${style}`}>{status}</span>;
}

const inputCls = "px-3 py-1.5 rounded-lg text-xs font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground";
const labelCls = "block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5";
const fieldCls = "w-full px-3.5 py-2.5 rounded-xl text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 text-foreground";

export default function SecurityAttendance() {
  const rights = usePageRights(PAGE_KEY);
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Security Attendance"]} />
      <MaintenanceShell
        title="Security Attendance"
        subtitle="Check-in/out, verification and audit trail for security personnel"
        icon={ShieldCheck}
      >
        <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-heading font-semibold transition-all ${
                tab === t ? "text-white" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              style={tab === t ? { background: ACCENT } : undefined}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>

        {tab === "overview" && <OverviewTab />}
        {tab === "checkinout" && <CheckInOutTab rights={rights} />}
        {tab === "personnel" && <PersonnelTab rights={rights} />}
        {tab === "history" && <HistoryTab rights={rights} />}
        {tab === "shifts" && <ShiftsTab rights={rights} />}
      </MaintenanceShell>
    </>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────
function OverviewTab() {
  const [now, setNow] = useState(new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["security-attendance-dashboard"],
    queryFn: getSecurityAttendanceDashboard,
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-4 pt-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarClock size={13} />
        {now.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
        {" · "}
        {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <GlassCard label="Total Security Personnel" value={isLoading ? "…" : data?.totalPersonnel ?? 0} icon={Users} accentColor={ACCENT} />
        <GlassCard label="Present Today" value={isLoading ? "…" : data?.presentToday ?? 0} icon={UserCheck} accentColor="#22c55e" />
        <GlassCard label="Absent Today" value={isLoading ? "…" : data?.absentToday ?? 0} icon={UserX} accentColor="#ef4444" />
        <GlassCard label="Late Today" value={isLoading ? "…" : data?.lateToday ?? 0} icon={Clock} accentColor="#f59e0b" />
        <GlassCard label="Currently On Duty" value={isLoading ? "…" : data?.currentlyOnDuty ?? 0} icon={Timer} accentColor="#0ea5e9" />
        <GlassCard label="Total Attendance Records" value={isLoading ? "…" : data?.totalAttendanceRecords ?? 0} icon={ClipboardList} accentColor="#8b5cf6" />
      </div>
    </div>
  );
}

// ─── Check-In / Check-Out ────────────────────────────────────────────────
function CheckInOutTab({ rights }: { rights: ReturnType<typeof usePageRights> }) {
  const queryClient = useQueryClient();
  const date = todayStr();

  const { data: personnel, isLoading: personnelLoading } = useQuery({
    queryKey: ["security-personnel", ""],
    queryFn: () => getSecurityPersonnel(""),
  });
  const { data: shifts } = useQuery({ queryKey: ["security-shifts"], queryFn: getSecurityShifts });
  const { data: todayRows, isLoading: rowsLoading } = useQuery({
    queryKey: ["security-attendance", { date }],
    queryFn: () => getSecurityAttendance({ date }),
    refetchInterval: 30_000,
  });

  const [checkInFor, setCheckInFor] = useState<SecurityPersonnelRow | null>(null);
  const [checkOutFor, setCheckOutFor] = useState<SecurityAttendanceRow | null>(null);
  const [absentFor, setAbsentFor] = useState<SecurityPersonnelRow | null>(null);

  const activePersonnel = (personnel || []).filter((p) => p.Status === "Active");
  const rows = Array.isArray(todayRows) ? todayRows : [];
  const attendedIds = new Set(rows.map((r) => r.SecurityId));
  const notYetAttended = activePersonnel.filter((p) => !attendedIds.has(p.Id));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["security-attendance"] });
    queryClient.invalidateQueries({ queryKey: ["security-attendance-dashboard"] });
  };

  return (
    <div className="space-y-5 pt-1">
      <GlassSection title={`Not Yet Checked In — ${fmtDate(date)}`} icon={LogIn} accentColor={ACCENT}>
        {personnelLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : notYetAttended.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
            Everyone active has an attendance record for today.
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground font-heading">
                <tr>
                  <th className="text-left px-4 py-2.5">Security ID</th>
                  <th className="text-left px-4 py-2.5">Name</th>
                  <th className="text-left px-4 py-2.5">Default Shift</th>
                  <th className="text-right px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {notYetAttended.map((p) => (
                  <tr key={p.Id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-mono text-xs">{p.SecurityCode}</td>
                    <td className="px-4 py-2.5 font-medium text-foreground">{p.Name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.DefaultShiftName || "—"}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        {rights.canCreate && (
                          <button
                            onClick={() => setCheckInFor(p)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-heading font-semibold gradient-maintenance text-white"
                          >
                            <LogIn size={12} /> Check-In
                          </button>
                        )}
                        {rights.canEdit && (
                          <button
                            onClick={() => setAbsentFor(p)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-heading font-medium border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40"
                          >
                            <UserX size={12} /> Mark Absent
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassSection>

      <GlassSection title="Today's Attendance" icon={ClipboardList} accentColor={ACCENT}>
        {rowsLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
            No attendance recorded yet today.
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground font-heading">
                <tr>
                  <th className="text-left px-4 py-2.5">Security ID</th>
                  <th className="text-left px-4 py-2.5">Name</th>
                  <th className="text-left px-4 py-2.5">Shift</th>
                  <th className="text-left px-4 py-2.5">Check-In</th>
                  <th className="text-left px-4 py-2.5">Check-Out</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-right px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.Id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-mono text-xs">{r.SecurityCode}</td>
                    <td className="px-4 py-2.5 font-medium text-foreground">{r.SecurityName}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.ShiftName}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{fmtDateTime(r.CheckIn)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{fmtDateTime(r.CheckOut)}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={r.Status} /></td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        {rights.canEdit && r.CheckIn && !r.CheckOut && (
                          <button
                            onClick={() => setCheckOutFor(r)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-heading font-semibold border border-border text-foreground hover:bg-muted"
                          >
                            <LogOut size={12} /> Check-Out
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassSection>

      {checkInFor && (
        <CheckInDialog
          person={checkInFor}
          shifts={shifts || []}
          onClose={() => setCheckInFor(null)}
          onDone={() => { setCheckInFor(null); invalidate(); }}
        />
      )}
      {checkOutFor && (
        <CheckOutDialog
          row={checkOutFor}
          onClose={() => setCheckOutFor(null)}
          onDone={() => { setCheckOutFor(null); invalidate(); }}
        />
      )}
      {absentFor && (
        <MarkAbsentDialog
          person={absentFor}
          shifts={shifts || []}
          date={date}
          onClose={() => setAbsentFor(null)}
          onDone={() => { setAbsentFor(null); invalidate(); }}
        />
      )}
    </div>
  );
}

function CheckInDialog({
  person, shifts, onClose, onDone,
}: { person: SecurityPersonnelRow; shifts: SecurityShift[]; onClose: () => void; onDone: () => void }) {
  const [shiftId, setShiftId] = useState<string>(person.DefaultShiftId ? String(person.DefaultShiftId) : "");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!shiftId) { toast.error("Select a shift"); return; }
    setSaving(true);
    try {
      const res = await checkInSecurity({ securityId: person.Id, shiftId: Number(shiftId), remarks: remarks || undefined });
      toast.success(`Checked in — marked ${res.status}`);
      onDone();
    } catch (err: any) {
      toast.error(err?.message || "Check-in failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-heading text-base">Check-In — {person.Name}</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <p className="text-xs text-muted-foreground">
            Date &amp; time are recorded automatically and can't be edited after submission.
          </p>
          <div>
            <label className={labelCls}>Shift</label>
            <select value={shiftId} onChange={(e) => setShiftId(e.target.value)} className={fieldCls}>
              <option value="">Select shift…</option>
              {shifts.map((s) => (
                <option key={s.Id} value={s.Id}>{s.Name} ({fmtTimeOfDay(s.StartTime)} – {fmtTimeOfDay(s.EndTime)})</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Remarks (optional)</label>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSubmit} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-maintenance text-white disabled:opacity-60">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />} Check-In
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CheckOutDialog({
  row, onClose, onDone,
}: { row: SecurityAttendanceRow; onClose: () => void; onDone: () => void }) {
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const res = await checkOutSecurity(row.Id, remarks || undefined);
      toast.success(`Checked out — duty ${res.dutyHoursLabel}, status ${res.status}`);
      onDone();
    } catch (err: any) {
      toast.error(err?.message || "Check-out failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-heading text-base">Check-Out — {row.SecurityName}</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <p className="text-xs text-muted-foreground">
            Checked in at <span className="font-mono text-foreground">{fmtDateTime(row.CheckIn)}</span>. Duty hours are computed automatically on submit.
          </p>
          <div>
            <label className={labelCls}>Remarks (optional)</label>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSubmit} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-maintenance text-white disabled:opacity-60">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />} Check-Out
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MarkAbsentDialog({
  person, shifts, date, onClose, onDone,
}: { person: SecurityPersonnelRow; shifts: SecurityShift[]; date: string; onClose: () => void; onDone: () => void }) {
  const [shiftId, setShiftId] = useState<string>(person.DefaultShiftId ? String(person.DefaultShiftId) : "");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!shiftId) { toast.error("Select a shift"); return; }
    setSaving(true);
    try {
      await markSecurityAbsent({ securityId: person.Id, shiftId: Number(shiftId), date, remarks: remarks || undefined });
      toast.success("Marked absent");
      onDone();
    } catch (err: any) {
      toast.error(err?.message || "Failed to mark absent");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-heading text-base">Mark Absent — {person.Name}</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div>
            <label className={labelCls}>Shift</label>
            <select value={shiftId} onChange={(e) => setShiftId(e.target.value)} className={fieldCls}>
              <option value="">Select shift…</option>
              {shifts.map((s) => (<option key={s.Id} value={s.Id}>{s.Name}</option>))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Remarks</label>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} placeholder="Reason for the documented no-show" className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSubmit} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-destructive text-destructive-foreground disabled:opacity-60">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <UserX size={13} />} Mark Absent
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Personnel ───────────────────────────────────────────────────────────
function PersonnelTab({ rights }: { rights: ReturnType<typeof usePageRights> }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SecurityPersonnelRow | null>(null);

  const { data: shifts } = useQuery({ queryKey: ["security-shifts"], queryFn: getSecurityShifts });
  const { data, isLoading, error } = useQuery({
    queryKey: ["security-personnel", search],
    queryFn: () => getSecurityPersonnel(search),
  });
  const rows = Array.isArray(data) ? data : [];

  return (
    <div className="space-y-4 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code, name, phone…" className={`pl-8 pr-3 w-56 ${inputCls}`} />
        </div>
        {rights.canCreate && (
          <button onClick={() => { setEditing(null); setFormOpen(true); }} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-maintenance text-white">
            <Plus size={13} /> Add Personnel
          </button>
        )}
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="text-sm text-red-500">Failed to load personnel.</div>}

      {!isLoading && !error && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-10 flex flex-col items-center gap-2 text-center px-6">
          <Users size={20} className="text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No security personnel yet</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground font-heading">
              <tr>
                <th className="text-left px-4 py-2.5">Security ID</th>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Phone</th>
                <th className="text-left px-4 py-2.5">Default Shift</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((p) => (
                <tr key={p.Id} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-mono text-xs">{p.SecurityCode}</td>
                  <td className="px-4 py-2.5 font-medium text-foreground">{p.Name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{p.Phone || "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{p.DefaultShiftName || "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${p.Status === "Active" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" : "bg-muted border-border text-muted-foreground"}`}>
                      {p.Status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {rights.canEdit && (
                        <button onClick={() => { setEditing(p); setFormOpen(true); }} title="Edit" className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
                          <Pencil size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <PersonnelFormDialog
          person={editing}
          shifts={shifts || []}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); queryClient.invalidateQueries({ queryKey: ["security-personnel"] }); }}
        />
      )}
    </div>
  );
}

function PersonnelFormDialog({
  person, shifts, onClose, onSaved,
}: { person: SecurityPersonnelRow | null; shifts: SecurityShift[]; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!person;
  const [securityCode, setSecurityCode] = useState(person?.SecurityCode || "");
  const [name, setName] = useState(person?.Name || "");
  const [phone, setPhone] = useState(person?.Phone || "");
  const [defaultShiftId, setDefaultShiftId] = useState(person?.DefaultShiftId ? String(person.DefaultShiftId) : "");
  const [status, setStatus] = useState(person?.Status || "Active");
  const [remarks, setRemarks] = useState(person?.Remarks || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!isEdit && !securityCode.trim()) { toast.error("Security ID is required"); return; }
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const shiftId = defaultShiftId ? Number(defaultShiftId) : null;
      if (isEdit) {
        await updateSecurityPersonnel(person!.Id, { name, phone: phone || undefined, defaultShiftId: shiftId, status, remarks: remarks || undefined });
        toast.success("Personnel updated");
      } else {
        await createSecurityPersonnel({ securityCode, name, phone: phone || undefined, defaultShiftId: shiftId, remarks: remarks || undefined });
        toast.success("Personnel added");
      }
      onSaved();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save personnel");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-heading text-base">{isEdit ? "Edit Personnel" : "Add Security Personnel"}</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div>
            <label className={labelCls}>Security ID</label>
            <input value={securityCode} onChange={(e) => setSecurityCode(e.target.value)} disabled={isEdit} className={`${fieldCls} disabled:opacity-60`} />
          </div>
          <div>
            <label className={labelCls}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} />
          </div>
          <div>
            <label className={labelCls}>Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={fieldCls} />
          </div>
          <div>
            <label className={labelCls}>Default Shift</label>
            <select value={defaultShiftId} onChange={(e) => setDefaultShiftId(e.target.value)} className={fieldCls}>
              <option value="">Not assigned</option>
              {shifts.map((s) => (<option key={s.Id} value={s.Id}>{s.Name}</option>))}
            </select>
          </div>
          {isEdit && (
            <div>
              <label className={labelCls}>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as "Active" | "Inactive")} className={fieldCls}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          )}
          <div>
            <label className={labelCls}>Remarks</label>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-maintenance text-white disabled:opacity-60">
              {saving ? <Loader2 size={13} className="animate-spin" /> : null} Save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── History ─────────────────────────────────────────────────────────────
function HistoryTab({ rights }: { rights: ReturnType<typeof usePageRights> }) {
  const queryClient = useQueryClient();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [securityId, setSecurityId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [status, setStatus] = useState("");
  const [verificationStatus, setVerificationStatus] = useState("");
  const [rejecting, setRejecting] = useState<SecurityAttendanceRow | null>(null);
  const [cancelling, setCancelling] = useState<SecurityAttendanceRow | null>(null);
  const [viewingLogsFor, setViewingLogsFor] = useState<SecurityAttendanceRow | null>(null);

  const { data: personnel } = useQuery({ queryKey: ["security-personnel", ""], queryFn: () => getSecurityPersonnel("") });
  const { data: shifts } = useQuery({ queryKey: ["security-shifts"], queryFn: getSecurityShifts });

  const filters = useMemo(
    () => ({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, securityId: securityId || undefined, shiftId: shiftId || undefined, status: status || undefined, verificationStatus: verificationStatus || undefined }),
    [dateFrom, dateTo, securityId, shiftId, status, verificationStatus],
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ["security-attendance-history", filters],
    queryFn: () => getSecurityAttendance(filters),
  });
  const rows = Array.isArray(data) ? data : [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["security-attendance-history"] });

  const handleVerify = async (row: SecurityAttendanceRow) => {
    try {
      await verifySecurityAttendance(row.Id);
      toast.success("Attendance verified");
      invalidate();
    } catch (err: any) {
      toast.error(err?.message || "Failed to verify");
    }
  };

  return (
    <div className="space-y-4 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
        <span className="text-xs text-muted-foreground">to</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
        <select value={securityId} onChange={(e) => setSecurityId(e.target.value)} className={inputCls}>
          <option value="">All Personnel</option>
          {(personnel || []).map((p) => (<option key={p.Id} value={p.Id}>{p.Name}</option>))}
        </select>
        <select value={shiftId} onChange={(e) => setShiftId(e.target.value)} className={inputCls}>
          <option value="">All Shifts</option>
          {(shifts || []).map((s) => (<option key={s.Id} value={s.Id}>{s.Name}</option>))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
          <option value="">All Status</option>
          {["Present", "Late", "Absent", "HalfDay"].map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
        <select value={verificationStatus} onChange={(e) => setVerificationStatus(e.target.value)} className={inputCls}>
          <option value="">All Verification</option>
          {["Pending", "Verified", "Rejected"].map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="text-sm text-red-500">Failed to load history.</div>}

      {!isLoading && !error && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No attendance records match these filters.
        </div>
      )}

      {rows.length > 0 && (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground font-heading">
              <tr>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Security ID</th>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Shift</th>
                <th className="text-left px-4 py-2.5">Check-In</th>
                <th className="text-left px-4 py-2.5">Check-Out</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Verification</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.Id} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5">{fmtDate(r.AttendanceDate)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{r.SecurityCode}</td>
                  <td className="px-4 py-2.5 font-medium text-foreground">{r.SecurityName}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.ShiftName}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{fmtDateTime(r.CheckIn)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{fmtDateTime(r.CheckOut)}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={r.Status} /></td>
                  <td className="px-4 py-2.5"><VerificationBadge status={r.VerificationStatus} /></td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setViewingLogsFor(r)} title="View Logs" className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
                        <HistoryIcon size={14} />
                      </button>
                      {rights.canEdit && r.VerificationStatus === "Pending" && (
                        <>
                          <button onClick={() => handleVerify(r)} title="Verify" className="p-1.5 rounded-md text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10">
                            <CheckCircle2 size={14} />
                          </button>
                          <button onClick={() => setRejecting(r)} title="Reject" className="p-1.5 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-500/10">
                            <XCircle size={14} />
                          </button>
                        </>
                      )}
                      {rights.canDelete && !r.IsCancelled && (
                        <button onClick={() => setCancelling(r)} title="Cancel" className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                          <Ban size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rejecting && (
        <RemarkActionDialog
          title={`Reject Attendance — ${rejecting.SecurityName}`}
          actionLabel="Reject"
          requireRemarks
          onClose={() => setRejecting(null)}
          onSubmit={async (remarks) => {
            await rejectSecurityAttendance(rejecting.Id, remarks);
            toast.success("Attendance rejected");
            setRejecting(null);
            invalidate();
          }}
        />
      )}
      {cancelling && (
        <RemarkActionDialog
          title={`Cancel Attendance — ${cancelling.SecurityName}`}
          actionLabel="Cancel Record"
          requireRemarks
          destructive
          onClose={() => setCancelling(null)}
          onSubmit={async (remarks) => {
            await cancelSecurityAttendance(cancelling.Id, remarks);
            toast.success("Attendance record cancelled");
            setCancelling(null);
            invalidate();
          }}
        />
      )}
      {viewingLogsFor && (
        <AttendanceLogsModal row={viewingLogsFor} onClose={() => setViewingLogsFor(null)} />
      )}
    </div>
  );
}

function RemarkActionDialog({
  title, actionLabel, requireRemarks, destructive, onClose, onSubmit,
}: {
  title: string; actionLabel: string; requireRemarks?: boolean; destructive?: boolean;
  onClose: () => void; onSubmit: (remarks: string) => Promise<void>;
}) {
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (requireRemarks && !remarks.trim()) { toast.error("Remarks are required"); return; }
    setSaving(true);
    try {
      await onSubmit(remarks.trim());
    } catch (err: any) {
      toast.error(err?.message || "Action failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-heading text-base">{title}</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div>
            <label className={labelCls}>Remarks{requireRemarks ? "" : " (optional)"}</label>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted">Back</button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold text-white disabled:opacity-60 ${destructive ? "bg-destructive" : "gradient-maintenance"}`}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : null} {actionLabel}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AttendanceLogsModal({ row, onClose }: { row: SecurityAttendanceRow; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["security-attendance-logs", row.Id],
    queryFn: () => getSecurityAttendanceLogs(row.Id),
  });
  const logs = Array.isArray(data) ? data : [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-heading text-base">Audit Log — {row.SecurityName} ({fmtDate(row.AttendanceDate)})</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : logs.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No log entries.</div>
        ) : (
          <div className="space-y-2 pt-1">
            {logs.map((l) => (
              <div key={l.Id} className="rounded-lg border border-border p-3 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-heading font-semibold text-foreground">{l.Action}</span>
                  <span className="text-muted-foreground">{new Date(l.PerformedAt).toLocaleString("en-IN")}</span>
                </div>
                <div className="text-muted-foreground">By: {l.PerformedBy || "—"}{l.IPAddress ? ` · ${l.IPAddress}` : ""}</div>
                {l.Remarks && <div className="text-foreground">{l.Remarks}</div>}
                {(l.OldValue || l.NewValue) && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div><p className="text-[9px] uppercase text-muted-foreground">Old</p><pre className="whitespace-pre-wrap break-all text-[10px] text-muted-foreground">{l.OldValue || "—"}</pre></div>
                    <div><p className="text-[9px] uppercase text-muted-foreground">New</p><pre className="whitespace-pre-wrap break-all text-[10px] text-foreground">{l.NewValue || "—"}</pre></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Shifts ──────────────────────────────────────────────────────────────
function ShiftsTab({ rights }: { rights: ReturnType<typeof usePageRights> }) {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SecurityShift | null>(null);

  const { data, isLoading, error } = useQuery({ queryKey: ["security-shifts"], queryFn: getSecurityShifts });
  const rows = Array.isArray(data) ? data : [];

  return (
    <div className="space-y-4 pt-1">
      <div className="flex justify-end">
        {rights.canCreate && (
          <button onClick={() => { setEditing(null); setFormOpen(true); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-maintenance text-white">
            <Plus size={13} /> Add Shift
          </button>
        )}
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="text-sm text-red-500">Failed to load shifts.</div>}

      {rows.length > 0 && (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground font-heading">
              <tr>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Start</th>
                <th className="text-left px-4 py-2.5">End</th>
                <th className="text-left px-4 py-2.5">Grace (min)</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((s) => (
                <tr key={s.Id} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium text-foreground">{s.Name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{fmtTimeOfDay(s.StartTime)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{fmtTimeOfDay(s.EndTime)}</td>
                  <td className="px-4 py-2.5">{s.GraceMinutes}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${s.Status === "Active" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" : "bg-muted border-border text-muted-foreground"}`}>
                      {s.Status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {rights.canEdit && (
                        <button onClick={() => { setEditing(s); setFormOpen(true); }} title="Edit" className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
                          <Pencil size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <ShiftFormDialog
          shift={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); queryClient.invalidateQueries({ queryKey: ["security-shifts"] }); }}
        />
      )}
    </div>
  );
}

function ShiftFormDialog({
  shift, onClose, onSaved,
}: { shift: SecurityShift | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!shift;
  const toInputTime = (t?: string | null) => {
    if (!t) return "";
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return "";
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };
  const [name, setName] = useState(shift?.Name || "");
  const [startTime, setStartTime] = useState(toInputTime(shift?.StartTime));
  const [endTime, setEndTime] = useState(toInputTime(shift?.EndTime));
  const [graceMinutes, setGraceMinutes] = useState(shift ? String(shift.GraceMinutes) : "10");
  const [status, setStatus] = useState(shift?.Status || "Active");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !startTime || !endTime) { toast.error("Name, start and end time are required"); return; }
    setSaving(true);
    try {
      const payload = { name, startTime: `${startTime}:00`, endTime: `${endTime}:00`, graceMinutes: Number(graceMinutes) || 0 };
      if (isEdit) {
        await updateSecurityShift(shift!.Id, { ...payload, status });
        toast.success("Shift updated");
      } else {
        await createSecurityShift(payload);
        toast.success("Shift created");
      }
      onSaved();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save shift");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-heading text-base">{isEdit ? "Edit Shift" : "Add Shift"}</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div>
            <label className={labelCls}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start Time</label>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>End Time</label>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={fieldCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Grace Minutes</label>
            <input type="number" min={0} value={graceMinutes} onChange={(e) => setGraceMinutes(e.target.value)} className={fieldCls} />
          </div>
          {isEdit && (
            <div>
              <label className={labelCls}>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as "Active" | "Inactive")} className={fieldCls}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-maintenance text-white disabled:opacity-60">
              {saving ? <Loader2 size={13} className="animate-spin" /> : null} Save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
