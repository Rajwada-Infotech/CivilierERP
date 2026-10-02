import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { usePageRights } from "@/hooks/usePageRights";
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS_META as STATUS_META,
  getReportedAssignments,
  getActivityScopeSummary,
  getActivityPhotos,
  startDelayInfo,
  type AssignmentStatus,
  type ScopeSummaryRoom,
} from "@/api/dependencyActivityAssignmentApi";
import { AssignmentStatusSelect } from "@/components/civilworkdpr/AssignmentStatusSelect";
import { QcBadge, AttemptBadge } from "@/components/civilworkdpr/QcBadge";
import { ScopeLocationTree } from "@/components/civilworkdpr/ScopeLocationTree";
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
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-heading font-medium transition-colors border shrink-0"
      style={
        active
          ? { background: `${accentColor}18`, borderColor: `${accentColor}59`, color: accentColor }
          : { background: "transparent", borderColor: "var(--border)", color: "var(--muted-foreground)" }
      }
    >
      <Icon size={12} />
      {label}
      <span
        className="px-1.5 rounded-full text-[0.625rem] font-heading font-semibold leading-4"
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
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[0.6875rem] font-medium ${
        count > 0 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
      }`}
    >
      <Camera size={12} />
      {count > 0 ? `${count} photo${count === 1 ? "" : "s"}` : "Add photos"}
    </span>
  );
}

// Groups one room's activity rows by dependency chain — a room can carry
// more than one chain (e.g. a Flooring Sequence and a Snag Rectification
// chain both scoped to the same room), so each still gets its own
// collapsible header + table, just nested under the room ScopeLocationTree
// already narrowed to instead of the page's old flat top-level grouping.
function ChainGroupList({
  items,
  openDetail,
}: {
  items: ReportedAssignment[];
  openDetail: (row: ReportedAssignment, tab?: "overview" | "blueprint" | "photos") => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<number, { key: number; alias: string; workType: ReportedAssignment["workType"]; rows: ReportedAssignment[] }>();
    for (const row of items) {
      if (!map.has(row.dependencyMasterId)) {
        map.set(row.dependencyMasterId, { key: row.dependencyMasterId, alias: row.alias, workType: row.workType, rows: [] });
      }
      map.get(row.dependencyMasterId)!.rows.push(row);
    }
    // Inside a chain, show activities in dependency order (rung sequence,
    // then rework attempt) — recency only decides which chain comes first.
    for (const g of map.values()) {
      g.rows.sort((a, b) => a.sequenceNo - b.sequenceNo || (a.attemptNo ?? 1) - (b.attemptNo ?? 1));
    }
    return Array.from(map.values());
  }, [items]);

  // Rooms are already a narrow scope by the time this renders, so chain
  // groups default open — no extra click needed for the common one-or-two
  // chain case.
  const [collapsedKeys, setCollapsedKeys] = useState<Set<number>>(new Set());
  const toggle = (key: number) =>
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  return (
    <div className="rounded-lg border border-border/60 overflow-hidden divide-y divide-border">
      {groups.map((group) => {
        const collapsed = collapsedKeys.has(group.key);
        return (
          <div key={group.key}>
            <button
              type="button"
              onClick={() => toggle(group.key)}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 bg-muted/20 hover:bg-muted/30 transition-colors text-left"
            >
              {collapsed ? (
                <ChevronRight size={14} className="text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown size={14} className="text-muted-foreground shrink-0" />
              )}
              <GitBranch size={13} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
              <span className="text-sm font-heading font-semibold text-foreground">{group.alias}</span>
              <span
                className={`text-[0.625rem] font-heading font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                  group.workType === "INTERNAL"
                    ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                    : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                }`}
              >
                {group.workType}
              </span>
              <span className="ml-auto text-[0.625rem] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
                {group.rows.length} activit{group.rows.length !== 1 ? "ies" : "y"}
              </span>
            </button>

            {!collapsed && (
              <>
                {/* Mobile: one stacked card per rung — the 6-column table below
                    is unreadable below ~640px (every cell squeezed to the
                    point of wrapping single words), so phones get their own
                    layout instead of a horizontally-scrolling table. */}
                <div className="sm:hidden divide-y divide-border">
                  {group.rows.map((row) => {
                    const delay = startDelayInfo(row.startDate, row.firstReportedAt);
                    return (
                      <div
                        key={row.assignmentId}
                        onClick={() => openDetail(row, "overview")}
                        className="p-3.5 active:bg-muted/30 cursor-pointer space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium text-foreground leading-snug min-w-0">
                            {row.sequenceNo}. {row.activityName}
                          </span>
                          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                            <AssignmentStatusSelect rungId={row.rungId} status={row.status} />
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <QcBadge qcStatus={row.qcStatus} />
                          <AttemptBadge attemptNo={row.attemptNo} />
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <UserRound size={12} className="shrink-0" />
                            {row.engineerNames || <span className="italic">Unassigned</span>}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <CalendarDays size={12} className="shrink-0" />
                            {row.startDate ? new Date(row.startDate).toLocaleDateString() : "—"}
                          </span>
                        </div>

                        {delay && (
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                              delay.tone === "on-time"
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            }`}
                          >
                            {delay.label}
                          </span>
                        )}

                        {row.materials.length > 0 && (
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {row.materials.map((m, i) => (
                              <span key={i} className="flex items-center gap-1.5 text-xs text-foreground">
                                <Package size={12} className="text-muted-foreground shrink-0" />
                                {m.name}
                                <span className="text-muted-foreground">
                                  · {m.quantity}
                                  {m.uom ? ` ${m.uom}` : ""}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}

                        {/* inline-flex so this click target hugs the small
                            pill's own footprint — a plain block
                            <div> here stretched full card width (divs are
                            block-level by default), so tapping ANYWHERE in
                            the blank space to the right of the pill, not
                            just the pill itself, opened Photos instead of
                            bubbling up to the card's own "open Overview"
                            handler. That dead zone is exactly what made
                            "opening an activity" look like it always landed
                            on Photos. */}
                        <div onClick={(e) => { e.stopPropagation(); openDetail(row, "photos"); }} className="inline-flex">
                          <ActivityPhotosBadge rungId={row.rungId} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Tablet/desktop: the original dense table. */}
                <div className="hidden sm:block overflow-x-auto">
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
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ScopeLocationTree only calls renderLeaf for an expanded room node, so this
// fetch — scoped to that one room's rungs via GET /?roomId= — only ever
// fires once the user actually opens that node, instead of the page
// loading every IsCurrent activity in the system up front (the production
// bottleneck at 342,000+ rows this whole tree rework exists to fix).
function RoomActivities({
  room,
  statusFilter,
  openDetail,
}: {
  room: ScopeSummaryRoom;
  statusFilter: AssignmentStatus | "ALL";
  openDetail: (row: ReportedAssignment, tab?: "overview" | "blueprint" | "photos") => void;
}) {
  const { data: items = [], isLoading } = useQuery({
    // Shares the "civilworkdpr-activity-reporting" key prefix with the
    // summary query below so AssignmentStatusSelect/ActivityDetailModal/
    // QualityCheck's existing invalidateQueries({queryKey:
    // ["civilworkdpr-activity-reporting"]}) calls (a prefix match, not a
    // string-prefix match — the old single-array-element key wouldn't
    // match a differently-named key) still refresh this room's rows too.
    queryKey: ["civilworkdpr-activity-reporting", "room", room.roomId, statusFilter],
    queryFn: () =>
      getReportedAssignments({
        roomId: room.roomId,
        status: statusFilter !== "ALL" ? statusFilter : undefined,
      }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
        <Loader2 size={12} className="animate-spin" /> Loading…
      </div>
    );
  }
  return <ChainGroupList items={items} openDetail={openDetail} />;
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

  // Debounced so the search box doesn't fire a fresh GROUP BY over the
  // whole (342,000+ row, in production) table on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // The tree, its per-room counts, and the status-tile counts all come from
  // one cheap server-side aggregate — the actual per-activity rows for a
  // room are only ever fetched on demand, by RoomActivities, once that
  // room's node is expanded (see its own comment above).
  const { data: summary, isLoading } = useQuery({
    queryKey: ["civilworkdpr-activity-reporting", "summary", statusFilter, debouncedSearch],
    queryFn: () =>
      getActivityScopeSummary({
        status: statusFilter !== "ALL" ? statusFilter : undefined,
        search: debouncedSearch || undefined,
      }),
    enabled: rights.canView,
  });

  const rooms = summary?.rooms ?? [];
  const statusCounts = summary?.statusCounts ?? {};
  const total = summary?.total ?? 0;

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
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3 px-3.5 sm:px-5 py-3 sm:py-3.5 border-b border-border bg-muted/30">
              <span className="text-sm font-heading font-semibold text-foreground">Assigned Activities</span>
              <div className="relative w-full sm:w-auto">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search flat or activity…"
                  className="pl-7 pr-7 py-1.5 w-full sm:w-56 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-cyan-500/30"
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
            </div>

            {/* Mobile: one horizontally-scrolling row (swipe to see the rest,
                same pattern as a native app's filter chips) instead of
                letting 9 pills wrap into 3-4 full-width rows a user has to
                scroll past before reaching any actual content. Desktop keeps
                the original wrapping layout — there's room for it there. */}
            <div className="flex sm:flex-wrap items-center gap-1.5 px-3.5 sm:px-5 py-2.5 sm:py-3 border-b border-border bg-muted/10 overflow-x-auto sm:overflow-visible thin-scroll">
              {FILTER_OPTIONS.map((opt) => {
                const meta = STATUS_TILE_META[opt.value];
                const count = opt.value === "ALL" ? total : (statusCounts[opt.value] ?? 0);
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
            ) : rooms.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {total === 0
                  ? "No activities have been assigned yet — click an activity chip in Work Allocation's Link Dependency chain to assign one."
                  : debouncedSearch
                    ? `No activities match "${debouncedSearch}".`
                    : "No activities match this status."}
              </div>
            ) : (
              <div className="p-2 sm:p-4">
                <ScopeLocationTree
                  rows={rooms}
                  countLabel="activity"
                  countLabelPlural="activities"
                  getCount={(r) => r.activityCount}
                  forceExpand={!!debouncedSearch}
                  renderLeaf={(items) => (
                    <RoomActivities room={items[0]} statusFilter={statusFilter} openDetail={openDetail} />
                  )}
                />
              </div>
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
