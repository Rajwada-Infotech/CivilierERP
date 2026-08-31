import React, { useEffect, useMemo, useState } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import {
  Users2,
  Search,
  Building2,
  HardHat,
  ClipboardList,
  CalendarDays,
  Loader2,
  Plus,
  Save,
  UserX,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  getActivitiesForProject,
  getAttendance,
  saveAttendance,
  searchWorkers,
  createWorker,
  addToRoster,
  removeFromRoster,
  type AttendanceStatus,
  type ActivityOption,
  type WorkerSearchResult,
} from "@/api/workerAttendanceApi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const inputCls =
  "w-full px-3 py-2.5 rounded-lg text-sm bg-muted border border-border text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/30";

// Leaner variant for the filter bar — same look, smaller footprint so
// Company/Project/Activity/Date fit comfortably in a row without feeling
// oversized relative to how little text most of them hold.
const filterInputCls =
  "w-full px-2.5 py-1.5 rounded-lg text-xs bg-muted border border-border text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/30";

export const STATUS_LABEL: Record<AttendanceStatus, string> = { P: "Present", A: "Absent", H: "Half Day" };
export const STATUS_CLS: Record<AttendanceStatus, string> = {
  P: "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  A: "bg-red-500/15 border-red-500/40 text-red-700 dark:text-red-400",
  H: "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-400",
};

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface ContractorOption { id: number; label: string }

// ─── "+ Add Worker" picker ───────────────────────────────────────────────────
export function AddWorkerDialog({
  open,
  onOpenChange,
  rungId,
  existingWorkerIds,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rungId: number | null;
  existingWorkerIds: Set<number>;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [newName, setNewName] = useState("");
  const [newContractorId, setNewContractorId] = useState<number | "">("");
  const [newAadhaar, setNewAadhaar] = useState("");
  const [busy, setBusy] = useState(false);

  const aadhaarValid = /^\d{12}$/.test(newAadhaar);

  useEffect(() => {
    if (!open) { setQuery(""); setSelected(new Set()); setNewName(""); setNewContractorId(""); setNewAadhaar(""); }
  }, [open]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["worker-attendance-worker-search", query],
    queryFn: () => searchWorkers({ search: query || undefined }),
    enabled: open,
    staleTime: 15 * 1000,
  });

  const { data: contractors = [] } = useQuery({
    queryKey: ["worker-attendance-contractors"],
    queryFn: () => fetchWithAuth("/api/account-head/options?type=C").then((r) => r.json().catch(() => [])),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAddSelected = async () => {
    if (!rungId || selected.size === 0) return;
    setBusy(true);
    try {
      await addToRoster(rungId, Array.from(selected));
      toast.success(`Added ${selected.size} worker${selected.size > 1 ? "s" : ""} to this activity`);
      onAdded();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to add workers");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAndAdd = async () => {
    if (!rungId || !newName.trim() || !newContractorId || !aadhaarValid) return;
    setBusy(true);
    try {
      const { id, existed } = await createWorker({ name: newName.trim(), contractorId: newContractorId, aadhaarNo: newAadhaar });
      await addToRoster(rungId, [id]);
      toast.success(existed ? `${newName.trim()} is already registered — added to this activity` : `${newName.trim()} added to this activity`);
      onAdded();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to create worker");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-base">Select Worker</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search worker…"
              className={`${inputCls} pl-9`}
              autoFocus
            />
          </div>

          <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
            {isFetching ? (
              <div className="p-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Searching…
              </div>
            ) : results.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">No workers found.</div>
            ) : (
              results.map((w: WorkerSearchResult) => {
                const already = existingWorkerIds.has(w.id);
                return (
                  <label
                    key={w.id}
                    className={`flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 ${already ? "opacity-40 pointer-events-none" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(w.id) || already}
                      disabled={already}
                      onChange={() => toggle(w.id)}
                      className="accent-cyan-600"
                    />
                    <span className="flex-1 truncate">{w.name}</span>
                    <span className="text-[10px] text-muted-foreground">{already ? "Already added" : w.contractorName}</span>
                  </label>
                );
              })
            )}
          </div>

          <button
            onClick={handleAddSelected}
            disabled={busy || selected.size === 0}
            className="w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Add Selected Workers
          </button>

          <div className="pt-3 border-t border-border/60 space-y-2">
            <p className="text-[10px] font-heading uppercase tracking-wide text-muted-foreground">Worker not listed? Create new</p>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Worker name"
              className={inputCls}
            />
            <select
              value={newContractorId}
              onChange={(e) => setNewContractorId(e.target.value ? Number(e.target.value) : "")}
              className={inputCls}
            >
              <option value="">Select contractor…</option>
              {contractors.map((c: ContractorOption) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <div>
              <input
                value={newAadhaar}
                onChange={(e) => setNewAadhaar(e.target.value.replace(/\D/g, "").slice(0, 12))}
                placeholder="Aadhaar number (12 digits)"
                inputMode="numeric"
                className={inputCls}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Used to recognize this worker if they're re-added later — the record itself is auto-removed after 4 months with no attendance.
              </p>
            </div>
            <button
              onClick={handleCreateAndAdd}
              disabled={busy || !newName.trim() || !newContractorId || !aadhaarValid}
              className="w-full py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              <Plus size={14} /> Create &amp; Add
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
const WorkerAttendance: React.FC = () => {
  const rights = usePageRights("civilworkdpr-worker-attendance");
  const queryClient = useQueryClient();

  const [companyId, setCompanyId] = useState<number | "">("");
  const [projectId, setProjectId] = useState<number | "">("");
  const [rungId, setRungId] = useState<number | "">("");
  const [date, setDate] = useState(todayIso());
  const [search, setSearch] = useState("");
  const [addWorkerOpen, setAddWorkerOpen] = useState(false);
  const [statusByWorker, setStatusByWorker] = useState<Record<number, AttendanceStatus>>({});
  const [saving, setSaving] = useState(false);

  const { data: companyOptions = [] } = useQuery({
    queryKey: ["workerAttendanceCompanies"],
    queryFn: () => getEnterpriseOptions(undefined, "C"),
    staleTime: 5 * 60 * 1000,
  });
  const companies = useMemo(() => companyOptions.map((c: any) => ({ id: c.id, name: c.label })), [companyOptions]);

  const { data: projects = [] } = useQuery({
    queryKey: ["workerAttendanceProjects"],
    queryFn: () => getEnterpriseOptions(undefined, "P"),
    staleTime: 5 * 60 * 1000,
  });
  const projectsForCompany = useMemo(() => {
    if (!companyId) return projects as any[];
    return (projects as any[]).filter((p) => p.company_id === companyId);
  }, [companyId, projects]);

  const { data: activities = [], isFetching: loadingActivities } = useQuery({
    queryKey: ["workerAttendanceActivities", projectId],
    queryFn: () => getActivitiesForProject(projectId as number),
    enabled: !!projectId,
    staleTime: 30 * 1000,
  });
  const selectedActivity = activities.find((a: ActivityOption) => a.rungId === rungId) ?? null;

  const {
    data: attendanceRows = [],
    isFetching: loadingAttendance,
  } = useQuery({
    queryKey: ["workerAttendanceAttendance", rungId, date],
    queryFn: () => getAttendance(rungId as number, date),
    enabled: !!rungId && !!date,
    staleTime: 10 * 1000,
  });

  // Sync local editable status map whenever fresh attendance data loads —
  // roster members with no saved row yet default to "Present" (typical
  // attendance UX: mark exceptions, not every single present worker).
  useEffect(() => {
    const next: Record<number, AttendanceStatus> = {};
    for (const row of attendanceRows) next[row.workerId] = row.status ?? "P";
    setStatusByWorker(next);
  }, [attendanceRows]);

  const visibleRows = search
    ? attendanceRows.filter((r) => r.workerName.toLowerCase().includes(search.toLowerCase()))
    : attendanceRows;

  const existingWorkerIds = useMemo(() => new Set(attendanceRows.map((r) => r.workerId)), [attendanceRows]);

  const handleCompanyChange = (val: string) => {
    setCompanyId(val ? Number(val) : "");
    setProjectId("");
    setRungId("");
  };
  const handleProjectChange = (val: string) => {
    setProjectId(val ? Number(val) : "");
    setRungId("");
  };

  const refreshRoster = () => {
    queryClient.invalidateQueries({ queryKey: ["workerAttendanceAttendance", rungId, date] });
    queryClient.invalidateQueries({ queryKey: ["workerAttendanceActivities", projectId] });
  };

  const handleRemoveWorker = async (workerId: number) => {
    if (!rungId) return;
    try {
      await removeFromRoster(rungId, workerId);
      toast.success("Worker removed from this activity");
      refreshRoster();
    } catch (err: any) {
      toast.error(err.message || "Failed to remove worker");
    }
  };

  const handleSave = async () => {
    if (!rungId) return;
    const entries = attendanceRows.map((r) => ({ workerId: r.workerId, status: statusByWorker[r.workerId] ?? "P" }));
    if (!entries.length) return;
    setSaving(true);
    try {
      await saveAttendance({ rungId, date, entries });
      toast.success("Attendance saved");
      queryClient.invalidateQueries({ queryKey: ["workerAttendanceAttendance", rungId, date] });
    } catch (err: any) {
      toast.error(err.message || "Failed to save attendance");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Civil Work DPR", "Worker Attendance"]} />
      <CivilWorkDprShell
        title="Worker Attendance"
        subtitle="Centralized attendance history for workers across companies, projects and activities"
        icon={Users2}
      >
        {/* ── Filters ── */}
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] font-heading font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1 mb-1.5">
                <HardHat size={11} /> Company
              </label>
              <select value={companyId} onChange={(e) => handleCompanyChange(e.target.value)} className={filterInputCls}>
                <option value="">All Companies</option>
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
                onChange={(e) => handleProjectChange(e.target.value)}
                className={filterInputCls}
                disabled={projectsForCompany.length === 0}
              >
                <option value="">All Projects</option>
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
                value={rungId}
                onChange={(e) => setRungId(e.target.value ? Number(e.target.value) : "")}
                className={filterInputCls}
                disabled={!projectId}
              >
                <option value="">{loadingActivities ? "Loading…" : "All Activities"}</option>
                {activities.map((a: ActivityOption) => (
                  <option key={a.rungId} value={a.rungId}>{a.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-heading font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1 mb-1.5">
                <CalendarDays size={11} /> Date
              </label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={filterInputCls} />
            </div>
          </div>

          <div className="relative mt-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search worker…"
              className={`${filterInputCls} pl-9`}
            />
          </div>
        </div>

        {/* ── Selected activity attendance ── */}
        {!rungId ? (
          <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
            <ClipboardList size={28} className="mx-auto opacity-30 mb-2" />
            <p className="text-sm">Select a Company, Project and Activity to mark attendance.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-border bg-muted/20">
              <div className="min-w-0">
                <p className="text-sm font-heading font-semibold text-foreground truncate">{selectedActivity?.label ?? "—"}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {attendanceRows.length} Worker{attendanceRows.length === 1 ? "" : "s"} Allocated
                </p>
              </div>
              <span className="text-xs font-mono text-muted-foreground shrink-0">
                {new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
              </span>
            </div>

            {loadingAttendance ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                <Loader2 size={16} className="animate-spin" /> Loading attendance…
              </div>
            ) : attendanceRows.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground">
                <Users2 size={24} className="mx-auto opacity-30 mb-2" />
                <p className="text-sm">No workers assigned to this activity yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {visibleRows.map((row) => {
                  const status = statusByWorker[row.workerId] ?? "P";
                  return (
                    <div key={row.workerId} className="flex items-center justify-between gap-3 px-4 sm:px-5 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm text-foreground truncate">{row.workerName}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{row.contractorName || row.skillType}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <select
                          value={status}
                          onChange={(e) =>
                            setStatusByWorker((prev) => ({ ...prev, [row.workerId]: e.target.value as AttendanceStatus }))
                          }
                          className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border ${STATUS_CLS[status]} focus:outline-none`}
                        >
                          {(Object.keys(STATUS_LABEL) as AttendanceStatus[]).map((s) => (
                            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleRemoveWorker(row.workerId)}
                          title="Remove from activity"
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-500/10"
                        >
                          <UserX size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-t border-border bg-muted/10">
              <button
                onClick={() => setAddWorkerOpen(true)}
                className="flex items-center gap-1.5 text-sm text-cyan-600 hover:text-cyan-500 font-medium"
              >
                <Plus size={14} /> Add Worker
              </button>
              <button
                onClick={handleSave}
                disabled={saving || attendanceRows.length === 0 || !rights.canCreate}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium disabled:opacity-40"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Attendance
              </button>
            </div>
          </div>
        )}
      </CivilWorkDprShell>

      <AddWorkerDialog
        open={addWorkerOpen}
        onOpenChange={setAddWorkerOpen}
        rungId={rungId || null}
        existingWorkerIds={existingWorkerIds}
        onAdded={refreshRoster}
      />
    </>
  );
};

export default WorkerAttendance;
