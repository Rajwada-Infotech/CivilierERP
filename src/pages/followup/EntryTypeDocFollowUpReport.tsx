import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import {
  Printer,
  AlertCircle,
  ClipboardList,
  Building2,
  FolderOpen,
  Users,
  Activity,
  Clock,
  RotateCcw,
  ChevronRight,
  ChevronDown,
  Layers,
  FileText,
  ListTree,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { TaskDrawer } from "@/components/followup/TaskDrawer";
import { ExportMenu } from "@/components/ExportMenu";
import { GlassCard, GlassSection, GlassCardSkeleton } from "@/components/dashboard/GlassShell";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme } from "@/contexts/ThemeContext";
import type { ExportColumn } from "@/lib/export";

const REPORT_API = "/api/entry-type-doc-followup-report";
const ACCENT = "#0d9488";

const STATUSES = ["Active", "Hold", "Cancel", "Closed"] as const;
const STATUS_LABELS: Record<string, string> = {
  Active: "Ongoing",
  Hold: "Pending",
  Cancel: "Cancelled",
  Closed: "Completed",
};
const STATUS_COLORS: Record<string, string> = {
  Active: "#3b82f6",
  Hold: "#f59e0b",
  Cancel: "#64748b",
  Closed: "#22c55e",
};

interface Company {
  id: number;
  name: string;
}
interface Project {
  id: number;
  name: string;
  company_id: number | null;
}
interface FilterUser {
  id: number;
  name: string;
}
interface EntryType {
  EntryTypeId: string;
  EntryType: string;
}
interface DocType {
  TypeOfDocId: number;
  Prefix: string;
  Description: string | null;
  EntryTypeId: string | null;
}

interface ReportRow {
  FollowUpId: number;
  FollowUpDate: string;
  FollowUpIsDone: boolean;
  FollowUpUserId: number | null;
  FollowUpUserName: string | null;
  TaskId: number;
  DocumentId: string | null;
  Subject: string;
  TaskStatus: string;
  TaskDueDate: string | null;
  Priority: string;
  EntryTypeId: string | null;
  EntryTypeLabel: string | null;
  TypeOfDocId: number | null;
  DocumentLabel: string;
  CompanyName: string | null;
  ProjectName: string | null;
  FollowUpAttendCount: number;
}

interface Filters {
  entryTypeId: string;
  typeOfDocId: string;
  companyId: string;
  projectId: string;
  userId: string;
  status: string;
  startDate: string;
  endDate: string;
}

const EMPTY_FILTERS: Filters = {
  entryTypeId: "",
  typeOfDocId: "",
  companyId: "",
  projectId: "",
  userId: "",
  status: "",
  startDate: "",
  endDate: "",
};

async function fetchDropdowns(): Promise<{ companies: Company[]; projects: Project[] }> {
  const res = await fetchWithAuth("/api/business/dropdown");
  if (!res.ok) throw new Error("Failed to fetch company/project list");
  return res.json().catch(() => ({ companies: [], projects: [] }));
}
async function fetchUsers(): Promise<FilterUser[]> {
  const res = await fetchWithAuth("/api/task-master/assignable-users");
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json().catch(() => []);
}
async function fetchEntryTypes(): Promise<EntryType[]> {
  const res = await fetchWithAuth("/api/document-type/entrytypes");
  if (!res.ok) return [];
  return res.json().catch(() => []);
}
async function fetchDocTypes(): Promise<DocType[]> {
  const res = await fetchWithAuth("/api/document-type");
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

async function fetchReport(filters: Filters): Promise<ReportRow[]> {
  const params = new URLSearchParams();
  if (filters.entryTypeId) params.set("entryTypeId", filters.entryTypeId);
  if (filters.typeOfDocId) params.set("typeOfDocId", filters.typeOfDocId);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.status) params.set("status", filters.status);
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);

  const res = await fetchWithAuth(`${REPORT_API}?${params.toString()}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to fetch report data");
  return Array.isArray(data) ? data : [];
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function useGlass() {
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const cardStyle = {
    background: isDark ? "rgba(15,17,26,0.5)" : "rgba(255,255,255,0.72)",
    border: `1px solid ${ACCENT}26`,
    backdropFilter: "blur(16px) saturate(150%)",
    WebkitBackdropFilter: "blur(16px) saturate(150%)",
    boxShadow: isDark
      ? "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)"
      : `0 4px 24px ${ACCENT}0f, inset 0 1px 0 rgba(255,255,255,0.9)`,
  };
  return { isDark, cardStyle };
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md border whitespace-nowrap"
      style={{ borderColor: `${color}4d`, color, background: `${color}1A` }}
    >
      {label}
    </span>
  );
}

// ── Grouping: Entry Type -> Document -> rows ────────────────────────────────
interface DocGroup {
  key: string;
  label: string;
  rows: ReportRow[];
}
interface EntryTypeGroup {
  key: string;
  label: string;
  rows: ReportRow[];
  docs: DocGroup[];
}

function groupRows(rows: ReportRow[]): EntryTypeGroup[] {
  const byEntryType = new Map<string, { label: string; rows: ReportRow[]; docs: Map<string, DocGroup> }>();
  for (const r of rows) {
    const etKey = r.EntryTypeId || "unassigned";
    const etLabel = r.EntryTypeLabel || "Unassigned Entry Type";
    if (!byEntryType.has(etKey)) byEntryType.set(etKey, { label: etLabel, rows: [], docs: new Map() });
    const et = byEntryType.get(etKey)!;
    et.rows.push(r);

    const docKey = r.TypeOfDocId != null ? String(r.TypeOfDocId) : "unassigned";
    if (!et.docs.has(docKey)) et.docs.set(docKey, { key: docKey, label: r.DocumentLabel, rows: [] });
    et.docs.get(docKey)!.rows.push(r);
  }
  return Array.from(byEntryType.entries())
    .map(([key, v]) => ({ key, label: v.label, rows: v.rows, docs: Array.from(v.docs.values()).sort((a, b) => b.rows.length - a.rows.length) }))
    .sort((a, b) => b.rows.length - a.rows.length);
}

const selectCls =
  "w-full appearance-none pl-7 pr-2 py-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all";
const inputCls =
  "w-full pl-2 pr-2 py-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all";

function FilterField({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="block text-[10px] font-heading uppercase tracking-wider text-muted-foreground mb-1">{label}</label>
      <div className="relative">
        <Icon size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
        {children}
      </div>
    </div>
  );
}

const detailExportColumns: ExportColumn[] = [
  { header: "Document ID", accessor: (r) => r.DocumentId || "—" },
  { header: "Task ID", accessor: "TaskId" },
  { header: "Company", accessor: (r) => r.CompanyName || "—" },
  { header: "Project", accessor: (r) => r.ProjectName || "—" },
  { header: "Follow-Up Date", accessor: (r) => formatDateTime(r.FollowUpDate as string) },
  { header: "Follow-Up User", accessor: (r) => r.FollowUpUserName || "—" },
  { header: "Status", accessor: (r) => STATUS_LABELS[r.TaskStatus as string] || (r.TaskStatus as string) },
  { header: "Follow-Up Attend Count", accessor: "FollowUpAttendCount" },
];

const EntryTypeDocFollowUpReport: React.FC = () => {
  usePageRights("entry-type-doc-followup-report");
  const { isDark, cardStyle } = useGlass();
  const queryClient = useQueryClient();
  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS);
  const [dateError, setDateError] = React.useState<string | null>(null);
  const [expandedEntryTypes, setExpandedEntryTypes] = React.useState<Set<string>>(new Set());
  const [detailGroup, setDetailGroup] = React.useState<{ title: string; rows: ReportRow[] } | null>(null);
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);

  const { data: dropdowns } = useQuery({ queryKey: ["etdf-report-dropdowns"], queryFn: fetchDropdowns, staleTime: 5 * 60_000 });
  const companies = dropdowns?.companies ?? [];
  const projects = dropdowns?.projects ?? [];
  const visibleProjects = filters.companyId ? projects.filter((p) => String(p.company_id) === filters.companyId) : projects;

  const { data: users = [] } = useQuery({ queryKey: ["etdf-report-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });
  const { data: entryTypes = [] } = useQuery({ queryKey: ["etdf-report-entrytypes"], queryFn: fetchEntryTypes, staleTime: 5 * 60_000 });
  const { data: docTypes = [] } = useQuery({ queryKey: ["etdf-report-doctypes"], queryFn: fetchDocTypes, staleTime: 5 * 60_000 });
  const visibleDocTypes = filters.entryTypeId ? docTypes.filter((d) => d.EntryTypeId === filters.entryTypeId) : docTypes;

  const { data: rows = [], isLoading, isFetching } = useQuery({
    queryKey: ["entry-type-doc-followup-report", filters],
    queryFn: () => fetchReport(filters),
  });

  const updateFilter = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    if (next.startDate && next.endDate && next.startDate > next.endDate) {
      setDateError("Start Date must be on or before End Date.");
    } else {
      setDateError(null);
      setFilters(next);
    }
  };
  const resetFilters = () => {
    setDateError(null);
    setFilters(EMPTY_FILTERS);
  };

  const groups = React.useMemo(() => groupRows(rows), [rows]);

  const toggleEntryType = (key: string) => {
    setExpandedEntryTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const summary = React.useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pending = rows.filter((r) => r.TaskStatus === "Hold").length;
    const completed = rows.filter((r) => r.TaskStatus === "Closed").length;
    const cancelled = rows.filter((r) => r.TaskStatus === "Cancel").length;
    const overdue = rows.filter(
      (r) => (r.TaskStatus === "Active" || r.TaskStatus === "Hold") && r.TaskDueDate && new Date(r.TaskDueDate) < today,
    ).length;
    return {
      totalEntryTypes: groups.length,
      totalDocuments: groups.reduce((s, g) => s + g.docs.length, 0),
      totalFollowUps: rows.length,
      pending,
      completed,
      overdue,
      cancelled,
    };
  }, [groups, rows]);

  const handleTaskStatusChange = async (id: string, status: string, cancelReasonId?: string) => {
    const res = await fetchWithAuth(`/api/task-master/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Status: status, CancelReasonId: cancelReasonId }),
    });
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error || "Failed to update status");
      return;
    }
    toast.success(status === "Cancel" ? "Task cancelled" : `Task marked ${status}`);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["entry-type-doc-followup-report"] }),
      queryClient.invalidateQueries({ queryKey: ["followup-task", id] }),
    ]);
  };

  const handlePrint = () => {
    if (rows.length === 0) {
      toast.error("No data to print for the current filters");
      return;
    }
    window.print();
  };

  const allExportColumns: ExportColumn[] = [
    { header: "Entry Type", accessor: (r) => r.EntryTypeLabel || "Unassigned" },
    { header: "Document", accessor: "DocumentLabel" },
    ...detailExportColumns,
  ];

  return (
    <FollowupShell
      title="Entry Type & Document Follow-Up Report"
      subtitle="Follow-up activity broken down by Entry Type and Document, drillable to the exact records"
      icon={ListTree}
      action={
        <div className="no-print flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium border border-border bg-background hover:bg-muted text-foreground transition-colors"
          >
            <Printer size={12} /> Print
          </button>
          <ExportMenu
            data={rows as unknown as Record<string, unknown>[]}
            columns={allExportColumns}
            title="Entry Type & Document Follow-Up Report"
            filename="entry-type-doc-followup-report"
            disabled={rows.length === 0}
          />
        </div>
      }
    >
      <style>{`
        @media print {
          body > *:not(#etdf-printable) { display: none !important; }
          #etdf-printable { display: block !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div id="etdf-printable">
        {!isLoading && rows.length === 0 && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 flex items-center gap-2 text-sm text-amber-600 mb-5">
            <AlertCircle size={16} className="shrink-0" />
            <span>No follow-up records match the selected filters.</span>
          </div>
        )}

        {/* ── Summary ──────────────────────────────────────────────────── */}
        <GlassSection title="Overview" icon={ClipboardList} accentColor={ACCENT}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            {isLoading
              ? Array.from({ length: 7 }).map((_, i) => <GlassCardSkeleton key={i} />)
              : [
                  { label: "Entry Types", value: summary.totalEntryTypes, icon: Layers, accentColor: ACCENT },
                  { label: "Documents", value: summary.totalDocuments, icon: FileText, accentColor: "#3b82f6" },
                  { label: "Follow-Up Records", value: summary.totalFollowUps, icon: ClipboardList, accentColor: "#8b5cf6" },
                  { label: "Pending", value: summary.pending, icon: Clock, accentColor: "#f59e0b" },
                  { label: "Completed", value: summary.completed, icon: CheckCircle2, accentColor: "#22c55e" },
                  { label: "Overdue", value: summary.overdue, icon: AlertTriangle, accentColor: "#ef4444" },
                  { label: "Cancelled", value: summary.cancelled, icon: XCircle, accentColor: "#64748b" },
                ].map((s) => <GlassCard key={s.label} {...s} />)}
          </div>
        </GlassSection>

        {/* ── Filters ──────────────────────────────────────────────────── */}
        <div className="no-print rounded-xl p-4 my-5" style={cardStyle}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-heading font-semibold uppercase tracking-widest" style={{ color: ACCENT }}>Filters</p>
            <button onClick={resetFilters} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              <RotateCcw size={11} /> Reset
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            <FilterField icon={Layers} label="Entry Type">
              <select className={selectCls} value={filters.entryTypeId} onChange={(e) => updateFilter({ entryTypeId: e.target.value, typeOfDocId: "" })}>
                <option value="">All Entry Types</option>
                {entryTypes.map((e) => <option key={e.EntryTypeId} value={e.EntryTypeId}>{e.EntryType}</option>)}
              </select>
            </FilterField>
            <FilterField icon={FileText} label="Document">
              <select className={selectCls} value={filters.typeOfDocId} onChange={(e) => updateFilter({ typeOfDocId: e.target.value })}>
                <option value="">All Documents</option>
                {visibleDocTypes.map((d) => <option key={d.TypeOfDocId} value={String(d.TypeOfDocId)}>{d.Prefix} — {d.Description || "Untitled"}</option>)}
              </select>
            </FilterField>
            <FilterField icon={Building2} label="Company">
              <select className={selectCls} value={filters.companyId} onChange={(e) => updateFilter({ companyId: e.target.value, projectId: "" })}>
                <option value="">All Companies</option>
                {companies.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
            </FilterField>
            <FilterField icon={FolderOpen} label="Project">
              <select className={selectCls} value={filters.projectId} onChange={(e) => updateFilter({ projectId: e.target.value })}>
                <option value="">All Projects</option>
                {visibleProjects.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
              </select>
            </FilterField>
            <FilterField icon={Users} label="User">
              <select className={selectCls} value={filters.userId} onChange={(e) => updateFilter({ userId: e.target.value })}>
                <option value="">All Users</option>
                {users.map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
              </select>
            </FilterField>
            <FilterField icon={Activity} label="Status">
              <select className={selectCls} value={filters.status} onChange={(e) => updateFilter({ status: e.target.value })}>
                <option value="">All Statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </FilterField>
            <FilterField icon={Clock} label="Date Range">
              <div className="flex gap-1">
                <input type="date" className={inputCls} value={filters.startDate} onChange={(e) => updateFilter({ startDate: e.target.value })} />
                <input type="date" className={inputCls} value={filters.endDate} onChange={(e) => updateFilter({ endDate: e.target.value })} />
              </div>
            </FilterField>
          </div>
          {dateError && <p className="text-xs mt-2" style={{ color: "#ef4444" }}>{dateError}</p>}
        </div>

        {/* ── Drill-down tree ──────────────────────────────────────────── */}
        <div className="rounded-xl overflow-hidden" style={cardStyle}>
          <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: isDark ? `${ACCENT}26` : `${ACCENT}1f` }}>
            <ListTree size={14} style={{ color: ACCENT }} />
            <span className="text-xs font-heading font-semibold text-foreground">Entry Type → Document → Follow-Ups</span>
          </div>
          <div className="p-2">
            {isLoading || isFetching ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
            ) : groups.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No data to show.</div>
            ) : (
              groups.map((g) => {
                const expanded = expandedEntryTypes.has(g.key);
                return (
                  <div key={g.key} className="border-b border-border/40 last:border-0">
                    <div className="flex items-center gap-2 px-2 py-2.5">
                      <button type="button" onClick={() => toggleEntryType(g.key)} className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <Layers size={13} style={{ color: ACCENT }} className="shrink-0" />
                      <span className="text-sm font-semibold text-foreground flex-1 truncate">{g.label}</span>
                      <span className="text-[11px] text-muted-foreground">{g.docs.length} doc{g.docs.length === 1 ? "" : "s"}</span>
                      <button
                        type="button"
                        onClick={() => setDetailGroup({ title: g.label, rows: g.rows })}
                        className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md hover:underline"
                        style={{ color: ACCENT, background: `${ACCENT}1A` }}
                      >
                        {g.rows.length}
                      </button>
                    </div>
                    {expanded && (
                      <div className="pl-8 pb-2 space-y-1">
                        {g.docs.map((d) => (
                          <div key={d.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/40">
                            <FileText size={12} className="text-muted-foreground shrink-0" />
                            <span className="text-xs text-foreground flex-1 truncate">{d.label}</span>
                            <button
                              type="button"
                              onClick={() => setDetailGroup({ title: `${g.label} — ${d.label}`, rows: d.rows })}
                              className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md hover:underline"
                              style={{ color: ACCENT, background: `${ACCENT}14` }}
                            >
                              {d.rows.length}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Drilled-down follow-up records dialog ───────────────────────── */}
      <Dialog open={!!detailGroup} onOpenChange={(open) => !open && setDetailGroup(null)} modal={false}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList size={15} style={{ color: ACCENT }} /> {detailGroup?.title}
            </DialogTitle>
            <DialogDescription>{detailGroup?.rows.length ?? 0} follow-up record{(detailGroup?.rows.length ?? 0) === 1 ? "" : "s"}</DialogDescription>
          </DialogHeader>

          <div className="flex justify-end">
            <ExportMenu
              data={(detailGroup?.rows ?? []) as unknown as Record<string, unknown>[]}
              columns={detailExportColumns}
              title={detailGroup?.title || "Follow-Up Records"}
              filename={`followup-records-${(detailGroup?.title || "export").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              disabled={!detailGroup?.rows.length}
            />
          </div>

          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border/40">
                  <th className="py-2 pr-3 font-medium">Document ID</th>
                  <th className="py-2 pr-3 font-medium">Task ID</th>
                  <th className="py-2 pr-3 font-medium">Company</th>
                  <th className="py-2 pr-3 font-medium">Project</th>
                  <th className="py-2 pr-3 font-medium">Follow-Up Date</th>
                  <th className="py-2 pr-3 font-medium">Follow-Up User</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Attend Count</th>
                </tr>
              </thead>
              <tbody>
                {detailGroup?.rows.map((r) => (
                  <tr key={r.FollowUpId} className="border-b border-border/20 last:border-0 hover:bg-muted/30">
                    <td className="py-2 pr-3">
                      <button type="button" onClick={() => setSelectedTaskId(String(r.TaskId))} className="font-mono hover:underline" style={{ color: ACCENT }} title="Open task">
                        {r.DocumentId || `#${r.TaskId}`}
                      </button>
                    </td>
                    <td className="py-2 pr-3 font-mono text-muted-foreground">{r.TaskId}</td>
                    <td className="py-2 pr-3">{r.CompanyName || "—"}</td>
                    <td className="py-2 pr-3">{r.ProjectName || "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(r.FollowUpDate)}</td>
                    <td className="py-2 pr-3">{r.FollowUpUserName || "—"}</td>
                    <td className="py-2 pr-3"><Badge label={STATUS_LABELS[r.TaskStatus] || r.TaskStatus} color={STATUS_COLORS[r.TaskStatus] || "#64748b"} /></td>
                    <td className="py-2 pr-3 font-mono">{r.FollowUpAttendCount}</td>
                  </tr>
                ))}
                {!detailGroup?.rows.length && (
                  <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">No records.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      <TaskDrawer
        taskId={selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
        onStatusChange={handleTaskStatusChange}
      />
    </FollowupShell>
  );
};

export default EntryTypeDocFollowUpReport;
