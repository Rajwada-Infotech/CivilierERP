import React, { useMemo, useState } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import {
  Users2,
  Search,
  Building2,
  HardHat,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  CalendarDays,
  CheckCircle2,
  XCircle,
  CircleDashed,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getContractorAllocations } from "@/api/contractorAllocationApi";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getWorkers, getWorkerCalendar, type AttendanceStatus, type WorkerSummary } from "@/api/workerAttendanceApi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const inputCls =
  "w-full px-3 py-2.5 rounded-lg text-sm bg-muted border border-border text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/30";

const STATUS_LABEL: Record<AttendanceStatus, string> = { P: "Present", A: "Absent", H: "Half Day" };
const STATUS_DOT: Record<AttendanceStatus, string> = { P: "bg-emerald-500", A: "bg-red-500", H: "bg-amber-500" };
const STATUS_CELL_CLS: Record<AttendanceStatus, string> = {
  P: "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  A: "bg-red-500/15 border-red-500/40 text-red-700 dark:text-red-400",
  H: "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-400",
};

const PAGE_SIZE = 12;

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildCalendarGrid(month: string, days: { date: string; status: AttendanceStatus; remarks: string | null }[]) {
  const [y, m] = month.split("-").map(Number);
  const firstDay = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const startWeekday = firstDay.getDay(); // 0=Sun
  const byDate = new Map(days.map((d) => [d.date.slice(0, 10), d]));

  const cells: ({ day: number; entry: typeof days[0] | undefined } | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ day, entry: byDate.get(iso) });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// ─── Worker card ──────────────────────────────────────────────────────────────
function WorkerCard({ worker, onClick }: { worker: WorkerSummary; onClick: () => void }) {
  const total = worker.presentCount + worker.absentCount + worker.halfDayCount;
  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl border border-border bg-card hover:border-cyan-500/40 hover:shadow-md transition-all duration-150 p-4 flex flex-col gap-3 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-heading font-semibold text-foreground truncate">{worker.name}</p>
          <p className="text-[10px] text-muted-foreground font-mono">Worker #{worker.id}</p>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-600 font-medium shrink-0">
          {worker.skillType}
        </span>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5 truncate">
          <Building2 size={11} className="shrink-0" />
          <span className="truncate">{worker.companyName || "—"}</span>
        </div>
        <div className="flex items-center gap-1.5 truncate">
          <ClipboardList size={11} className="shrink-0" />
          <span className="truncate">{worker.activityName || "—"}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-border/60">
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden flex">
          {total > 0 && (
            <>
              <div className="h-full bg-emerald-500" style={{ width: `${(worker.presentCount / total) * 100}%` }} />
              <div className="h-full bg-amber-500" style={{ width: `${(worker.halfDayCount / total) * 100}%` }} />
              <div className="h-full bg-red-500" style={{ width: `${(worker.absentCount / total) * 100}%` }} />
            </>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {worker.presentCount} present</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> {worker.halfDayCount} half</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500" /> {worker.absentCount} absent</span>
      </div>
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
const WorkerAttendance: React.FC = () => {
  usePageRights("civilworkdpr-worker-attendance");
  const [companyId, setCompanyId] = useState<number | "">("");
  const [projectId, setProjectId] = useState<number | "">("");
  const [activityId, setActivityId] = useState<number | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // Company is a real enterprise record (business_type=C) — same source as
  // every other Company filter in the app — not a contractor.
  const { data: companyOptions = [] } = useQuery({
    queryKey: ["workerAttendanceCompanies"],
    queryFn: () => getEnterpriseOptions(undefined, "C"),
    staleTime: 5 * 60 * 1000,
  });
  const companies = useMemo(
    () => companyOptions.map((c: any) => ({ id: c.id, name: c.label })),
    [companyOptions],
  );

  // Project is also a real enterprise record (business_type=P); each one
  // carries the company_id of its parent Company, so selecting a Company
  // narrows Project options client-side without a separate endpoint.
  const { data: projects = [] } = useQuery({
    queryKey: ["workerAttendanceProjects"],
    queryFn: () => getEnterpriseOptions(undefined, "P"),
    staleTime: 5 * 60 * 1000,
  });
  const projectsForCompany = useMemo(() => {
    if (!companyId) return projects as any[];
    return (projects as any[]).filter((p) => p.company_id === companyId);
  }, [companyId, projects]);

  // Activity options come from ContractorAllocation — "what work has
  // actually been allocated" — scoped to whichever Project(s) belong to the
  // selected Company, and further narrowed once a specific Project is picked.
  const { data: allocations = [] } = useQuery({
    queryKey: ["contractorAllocations"],
    queryFn: getContractorAllocations,
    staleTime: 60 * 1000,
  });

  const companyProjectIds = useMemo(
    () => new Set(projectsForCompany.map((p) => p.id)),
    [projectsForCompany],
  );

  const allocationsForCompany = companyId
    ? allocations.filter((a) => a.projectId != null && companyProjectIds.has(a.projectId))
    : allocations;

  const allocationsForProject = projectId
    ? allocationsForCompany.filter((a) => a.projectId === projectId)
    : allocationsForCompany;

  const activities = useMemo(() => {
    const map = new Map<number, string>();
    for (const a of allocationsForProject) {
      if (a.activityId) map.set(a.activityId, a.activityName || `Activity #${a.activityId}`);
    }
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [allocationsForProject]);

  const {
    data: workersRes,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["workers", companyId, projectId, activityId, search, page],
    queryFn: () =>
      getWorkers({
        companyId: companyId || undefined,
        projectId: projectId || undefined,
        activityId: activityId || undefined,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    staleTime: 30 * 1000,
  });

  const workers = workersRes?.data ?? [];
  const total = workersRes?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const resetDependent = () => {
    setProjectId("");
    setActivityId("");
    setPage(1);
  };

  // ── Calendar dialog ─────────────────────────────────────────────────────
  const [calendarWorker, setCalendarWorker] = useState<WorkerSummary | null>(null);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const { data: calendarData, isLoading: calendarLoading } = useQuery({
    queryKey: ["workerCalendar", calendarWorker?.id, month],
    queryFn: () => getWorkerCalendar(calendarWorker?.id as number, month),
    enabled: !!calendarWorker,
  });

  const openCalendar = (worker: WorkerSummary) => {
    const d = new Date();
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    setSelectedDay(null);
    setCalendarWorker(worker);
  };

  const grid = calendarData ? buildCalendarGrid(month, calendarData.days as any) : [];
  const [selectedDay, setSelectedDay] = useState<{ date: string; status: AttendanceStatus; remarks: string | null } | null>(null);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Civil Work DPR", "Worker Attendance"]} />
      <CivilWorkDprShell
        title="Worker Attendance"
        subtitle="Centralized attendance history for every worker across projects, companies and activities"
        icon={Users2}
      >
        {/* ── Filters ── */}
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-heading font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1 mb-1.5">
                <HardHat size={11} /> Company
              </label>
              <select
                value={companyId}
                onChange={(e) => {
                  setCompanyId(e.target.value ? Number(e.target.value) : "");
                  resetDependent();
                }}
                className={inputCls}
                disabled={companies.length === 0}
              >
                <option value="">All companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-heading font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1 mb-1.5">
                <Building2 size={11} /> Project
              </label>
              <select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value ? Number(e.target.value) : "");
                  setActivityId("");
                  setPage(1);
                }}
                className={inputCls}
                disabled={projectsForCompany.length === 0}
              >
                <option value="">All projects</option>
                {projectsForCompany.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-heading font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1 mb-1.5">
                <ClipboardList size={11} /> Activity
              </label>
              <select
                value={activityId}
                onChange={(e) => {
                  setActivityId(e.target.value ? Number(e.target.value) : "");
                  setPage(1);
                }}
                className={inputCls}
                disabled={activities.length === 0}
              >
                <option value="">All activities</option>
                {activities.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="relative mt-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by worker name…"
              className={`${inputCls} pl-9`}
            />
          </div>
        </div>

        {/* ── Worker list ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {isFetching ? "Loading…" : `${total} worker${total === 1 ? "" : "s"} found`}
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 size={16} className="animate-spin" /> Loading workers...
            </div>
          ) : workers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
              <Users2 size={28} className="mx-auto opacity-30 mb-2" />
              <p className="text-sm">No workers found for the selected filters.</p>
              <p className="text-xs mt-1">Try a different project, company, or activity — or log Daily Labour attendance first.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {workers.map((w) => (
                <WorkerCard key={w.id} worker={w} onClick={() => openCalendar(w)} />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-2 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs text-muted-foreground px-2">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-2 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      </CivilWorkDprShell>

      {/* ── Attendance calendar dialog ── */}
      <Dialog open={!!calendarWorker} onOpenChange={(open) => !open && setCalendarWorker(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-cyan-500/15 border border-cyan-500/30">
                <CalendarDays size={16} className="text-cyan-600" />
              </div>
              <div>
                <DialogTitle className="font-heading text-base">{calendarWorker?.name}</DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">{calendarWorker?.companyName || "—"}</p>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            {/* Month nav */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => setMonth((m) => shiftMonth(m, -1))}
                className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted"
              >
                <ChevronLeft size={14} />
              </button>
              <p className="text-sm font-heading font-semibold text-foreground">{monthLabel(month)}</p>
              <button
                onClick={() => setMonth((m) => shiftMonth(m, 1))}
                className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted"
              >
                <ChevronRight size={14} />
              </button>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Present</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Absent</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Half Day</span>
            </div>

            {calendarLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                <Loader2 size={16} className="animate-spin" /> Loading calendar...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[420px]">
                  <div className="grid grid-cols-7 gap-1 mb-1">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                      <div key={d} className="text-[10px] text-center text-muted-foreground font-medium py-1">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {grid.map((cell, i) =>
                      cell === null ? (
                        <div key={i} />
                      ) : (
                        <button
                          key={i}
                          disabled={!cell.entry}
                          onClick={() => cell.entry && setSelectedDay({ date: `${month}-${String(cell.day).padStart(2, "0")}`, status: cell.entry.status, remarks: cell.entry.remarks })}
                          className={`aspect-square rounded-lg border text-xs font-medium flex flex-col items-center justify-center gap-0.5 transition-colors ${
                            cell.entry ? STATUS_CELL_CLS[cell.entry.status] : "border-border text-muted-foreground/50"
                          }`}
                        >
                          <span>{cell.day}</span>
                          {cell.entry && <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[cell.entry.status]}`} />}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              </div>
            )}

            {selectedDay && (
              <div className="rounded-lg border border-border bg-muted/40 p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-foreground">{selectedDay.date}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                    {selectedDay.status === "P" && <CheckCircle2 size={11} className="text-emerald-600" />}
                    {selectedDay.status === "A" && <XCircle size={11} className="text-red-600" />}
                    {selectedDay.status === "H" && <CircleDashed size={11} className="text-amber-600" />}
                    {STATUS_LABEL[selectedDay.status]}
                    {selectedDay.remarks ? ` — ${selectedDay.remarks}` : ""}
                  </p>
                </div>
                <button onClick={() => setSelectedDay(null)} className="p-1 rounded text-muted-foreground hover:bg-muted">
                  <X size={13} />
                </button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default WorkerAttendance;
