import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { usePageRights } from "@/hooks/usePageRights";
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS_META as STATUS_META,
  getReportedAssignments,
  getActivityPhotos,
  startDelayInfo,
  type AssignmentStatus,
} from "@/api/dependencyActivityAssignmentApi";
import { AssignmentStatusSelect } from "@/components/civilworkdpr/AssignmentStatusSelect";
import { QcBadge, AttemptBadge } from "@/components/civilworkdpr/QcBadge";
import {
  ClipboardList,
  UserRound,
  CalendarDays,
  Package,
  Loader2,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Camera,
  Clock,
  Activity,
  PauseCircle,
  XCircle,
  ShieldCheck,
  RotateCcw,
  CheckCircle2,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ReportedAssignment } from "@/api/dependencyActivityAssignmentApi";
import ActivityDetailModal from "./ActivityDetailModal";

// Purely presentational — icon + accent color per status, same colors as
// ASSIGNMENT_STATUS_META's Tailwind classes just as hex for GlassCard's
// inline styling. "ALL" isn't in that enum so it gets its own entry.
const STATUS_TILE_META: Record<AssignmentStatus | "ALL", { icon: LucideIcon; accentColor: string }> = {
  ALL: { icon: ClipboardList, accentColor: "#06b6d4" },
  PENDING: { icon: Clock, accentColor: "#64748b" },
  ALLOCATED: { icon: GitBranch, accentColor: "#6366f1" },
  IN_PROGRESS: { icon: Activity, accentColor: "#3b82f6" },
  HOLD: { icon: PauseCircle, accentColor: "#f59e0b" },
  CANCELLED: { icon: XCircle, accentColor: "#ef4444" },
  APPROVED: { icon: ShieldCheck, accentColor: "#14b8a6" },
  REWORK: { icon: RotateCcw, accentColor: "#d946ef" },
  COMPLETED: { icon: CheckCircle2, accentColor: "#10b981" },
};

const FILTER_OPTIONS: Array<{ value: AssignmentStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "All" },
  ...ASSIGNMENT_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label })),
];

// Status filter chip — icon, label, and a count badge for how many
// assigned activities currently sit in that status.
function StatusTile({
  label,
  icon: Icon,
  accentColor,
  active,
  count,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  accentColor: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-heading font-medium transition-colors border"
      style={
        active
          ? { background: `${accentColor}18`, borderColor: `${accentColor}59`, color: accentColor }
          : { background: "transparent", borderColor: "var(--border)", color: "var(--muted-foreground)" }
      }
    >
      <Icon size={12} />
      {label}
      <span
        className="px-1.5 rounded-full text-[10px] font-heading font-semibold leading-4"
        style={
          active
            ? { background: `${accentColor}2e`, color: accentColor }
            : { background: "var(--muted)", color: "var(--muted-foreground)" }
        }
      >
        {count}
      </span>
    </button>
  );
}

// Purely informational — clicking anywhere on the row (including this
// badge) opens the Activity Detail modal; clicking the badge specifically
// jumps straight to its Photos tab instead of landing on Overview.
function ActivityPhotosBadge({ rungId }: { rungId: number }) {
  const { data: photos } = useQuery({
    queryKey: ["activity-photos", rungId],
    queryFn: () => getActivityPhotos(rungId),
  });
  const count = (photos?.before.length ?? 0) + (photos?.after.length ?? 0);

  return (
    <span
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium ${
        count > 0 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
      }`}
    >
      <Camera size={12} />
      {count > 0 ? `${count} photo${count === 1 ? "" : "s"}` : "Add photos"}
    </span>
  );
}

export default function ActivityReporting() {
  const rights = usePageRights("civilworkdpr-activity-reporting");
  const [statusFilter, setStatusFilter] = useState<AssignmentStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [detailRow, setDetailRow] = useState<ReportedAssignment | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "blueprint" | "photos">("overview");
  const openDetail = (row: ReportedAssignment, tab: "overview" | "blueprint" | "photos" = "overview") => {
    setDetailRow(row);
    setDetailTab(tab);
  };

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["civilworkdpr-activity-reporting"],
    queryFn: () => getReportedAssignments(),
    enabled: rights.canView,
  });

  const filteredRows = useMemo(() => {
    let out = statusFilter === "ALL" ? rows : rows.filter((r) => r.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        [r.activityName, r.flatName, r.alias, r.scopePath, r.projectName, r.towerName, r.roomName]
          .some((v) => (v || "").toLowerCase().includes(q)),
      );
    }
    return out;
  }, [rows, statusFilter, search]);

  // Per-status counts for the filter row's badges — always computed off
  // the full, unfiltered set so a tab shows how many activities are in
  // that status regardless of which one is currently selected.
  const statusCounts = useMemo(() => {
    const counts: Partial<Record<AssignmentStatus, number>> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }, [rows]);

  // Group by dependency chain — every activity raised against the same
  // chain now shows together instead of scattered across the flat list,
  // same grouping GRN.tsx uses for PO. Group order follows first-appearance
  // in the (already recency-sorted) rows.
  const groupedRows = useMemo(() => {
    const groups = new Map<
      number,
      { key: number; alias: string; workType: ReportedAssignment["workType"]; scopePath: string; projectName: string | null; rows: ReportedAssignment[] }
    >();
    for (const row of filteredRows) {
      if (!groups.has(row.dependencyMasterId)) {
        groups.set(row.dependencyMasterId, {
          key: row.dependencyMasterId,
          alias: row.alias,
          workType: row.workType,
          scopePath: row.scopePath,
          projectName: row.projectName,
          rows: [],
        });
      }
      groups.get(row.dependencyMasterId)!.rows.push(row);
    }
    return Array.from(groups.values());
  }, [filteredRows]);

  // Tracked as "expanded" (not "collapsed") specifically so the empty-object
  // default means every group starts collapsed — every activity chain open
  // by default turned into a very long, clumsy page the moment there were
  // more than a couple.
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({});
  const toggleGroup = (key: number) => setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  const allGroupsExpanded =
    groupedRows.length > 0 && groupedRows.every((g) => expandedGroups[g.key]);
  const toggleAllGroups = () =>
    setExpandedGroups(Object.fromEntries(groupedRows.map((g) => [g.key, !allGroupsExpanded])));

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Civil Work DPR", path: "/civilworkdpr" },
          { label: "Reporting" },
        ]}
      />
      <CivilWorkDprShell
        title="Reporting"
        subtitle="Every activity assigned an engineer or material from Work Allocation, tracked through to completion"
        icon={ClipboardList}
      >
        {!rights.canView ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            You don't have access to this page.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-border bg-muted/30">
              <span className="text-sm font-heading font-semibold text-foreground">Assigned Activities</span>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search flat or activity…"
                    className="pl-7 pr-7 py-1.5 w-56 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-cyan-500/30"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                {groupedRows.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleAllGroups}
                    className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-lg border border-border hover:bg-muted/60 transition-colors shrink-0"
                  >
                    {allGroupsExpanded ? (
                      <>
                        <ChevronRight size={12} /> Collapse all
                      </>
                    ) : (
                      <>
                        <ChevronDown size={12} /> Expand all
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 px-5 py-3 border-b border-border bg-muted/10">
              {FILTER_OPTIONS.map((opt) => {
                const meta = STATUS_TILE_META[opt.value];
                const count = opt.value === "ALL" ? rows.length : (statusCounts[opt.value] ?? 0);
                return (
                  <StatusTile
                    key={opt.value}
                    label={opt.label}
                    icon={meta.icon}
                    accentColor={meta.accentColor}
                    active={statusFilter === opt.value}
                    count={count}
                    onClick={() => setStatusFilter(opt.value)}
                  />
                );
              })}
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-14">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {rows.length === 0
                  ? "No activities have been assigned yet — click an activity chip in Work Allocation's Link Dependency chain to assign one."
                  : search.trim()
                    ? `No activities match "${search.trim()}".`
                    : "No activities match this status."}
              </div>
            ) : (
              groupedRows.map((group) => {
                const collapsed = !expandedGroups[group.key];
                return (
                  <div key={group.key} className="border-b border-border last:border-0">
                    {/* Group header — one dependency chain's activities grouped together */}
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      className="w-full flex items-center gap-2.5 px-4 py-3 bg-muted/20 hover:bg-muted/30 transition-colors text-left"
                    >
                      {collapsed ? (
                        <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                      )}
                      <GitBranch size={13} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
                      <span className="text-sm font-heading font-semibold text-foreground">{group.alias}</span>
                      <span
                        className={`text-[10px] font-heading font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                          group.workType === "INTERNAL"
                            ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                            : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                        }`}
                      >
                        {group.workType}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        · {group.projectName ? `${group.projectName} — ` : ""}
                        {group.scopePath}
                      </span>
                      <span className="ml-auto text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
                        {group.rows.length} activit{group.rows.length !== 1 ? "ies" : "y"}
                      </span>
                    </button>

                    {!collapsed && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-left text-[11px] font-heading font-semibold text-muted-foreground uppercase tracking-wide">
                              <th className="px-5 py-2">Activity</th>
                              <th className="px-3 py-2">Engineer</th>
                              <th className="px-3 py-2">Start Date</th>
                              <th className="px-3 py-2">Material</th>
                              <th className="px-3 py-2">Photos</th>
                              <th className="px-5 py-2">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.rows.map((row) => (
                              <tr
                                key={row.assignmentId}
                                onClick={() => openDetail(row, "overview")}
                                className="border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer"
                              >
                                <td className="px-5 py-3">
                                  <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                                    {row.sequenceNo}. {row.activityName}
                                    <QcBadge qcStatus={row.qcStatus} />
                                    <AttemptBadge attemptNo={row.attemptNo} />
                                  </span>
                                </td>
                                <td className="px-3 py-3">
                                  <span className="flex items-center gap-1.5 text-xs text-foreground">
                                    <UserRound size={11} className="text-muted-foreground shrink-0" />
                                    {row.engineerNames || <span className="text-muted-foreground italic">Unassigned</span>}
                                  </span>
                                </td>
                                <td className="px-3 py-3">
                                  <span className="flex items-center gap-1.5 text-xs text-foreground whitespace-nowrap">
                                    <CalendarDays size={11} className="text-muted-foreground shrink-0" />
                                    {row.startDate ? new Date(row.startDate).toLocaleDateString() : "—"}
                                  </span>
                                  {(() => {
                                    const delay = startDelayInfo(row.startDate, row.firstReportedAt);
                                    if (!delay) return null;
                                    return (
                                      <span
                                        className={`mt-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                                          delay.tone === "on-time"
                                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                        }`}
                                      >
                                        {delay.label}
                                      </span>
                                    );
                                  })()}
                                </td>
                                <td className="px-3 py-3">
                                  {row.materials.length === 0 ? (
                                    <span className="text-xs text-muted-foreground italic">—</span>
                                  ) : (
                                    <div className="flex flex-col gap-0.5">
                                      {row.materials.map((m, i) => (
                                        <span key={i} className="flex items-center gap-1.5 text-xs text-foreground whitespace-nowrap">
                                          <Package size={11} className="text-muted-foreground shrink-0" />
                                          {m.name}
                                          <span className="text-muted-foreground">
                                            · {m.quantity}
                                            {m.uom ? ` ${m.uom}` : ""}
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </td>
                                <td
                                  className="px-3 py-3"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openDetail(row, "photos");
                                  }}
                                >
                                  <ActivityPhotosBadge rungId={row.rungId} />
                                </td>
                                <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                                  <AssignmentStatusSelect rungId={row.rungId} status={row.status} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </CivilWorkDprShell>
      {detailRow && (
        <ActivityDetailModal row={detailRow} initialTab={detailTab} onClose={() => setDetailRow(null)} />
      )}
    </>
  );
}
