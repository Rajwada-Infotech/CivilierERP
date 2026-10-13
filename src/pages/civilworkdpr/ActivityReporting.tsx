import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { readChainLink } from "@/lib/civilWorkDprLinks";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { usePageRights } from "@/hooks/usePageRights";
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS_META as STATUS_META,
  getReportedAssignments,
  getActivityScopeSummary,
  getScopeProjects,
  getActivityPhotos,
  startDelayInfo,
  type AssignmentStatus,
  type ScopeSummaryRoom,
} from "@/api/dependencyActivityAssignmentApi";
import { AssignmentStatusSelect } from "@/components/civilworkdpr/AssignmentStatusSelect";
import { TimelineHint } from "@/components/civilworkdpr/TimelineHint";
import { QcBadge, AttemptBadge } from "@/components/civilworkdpr/QcBadge";
import { ScopeLocationTree } from "@/components/civilworkdpr/ScopeLocationTree";
import {
  UserRound,
  CalendarDays,
  Package,
  Loader2,
  ChevronDown,
  ChevronRight,
  Camera,
  Activity,
  Search,
  X,
} from "lucide-react";
import type { ReportedAssignment } from "@/api/dependencyActivityAssignmentApi";
import ActivityDetailModal from "./ActivityDetailModal";
import { dependencyAutoName } from "@/lib/dependencyAutoName";
import { PriorityBadge } from "@/components/civilworkdpr/PriorityBadge";
import { AssignmentPrioritySelect } from "@/components/civilworkdpr/AssignmentPrioritySelect";

const FILTER_OPTIONS: Array<{ value: AssignmentStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "All" },
  ...ASSIGNMENT_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label })),
];

// Status filter key — the label and how many assigned activities currently
// sit in that status. The chosen one is inked; Cancelled keeps the one red.
function StatusTile({
  label,
  stopped,
  active,
  count,
  onClick,
}: {
  label: string;
  stopped: boolean;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  const red = stopped && count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-baseline gap-2 px-3 py-2 border shrink-0 transition-colors ${
        active
          ? red ? "bg-destructive border-destructive text-destructive-foreground" : "bg-foreground border-foreground text-card"
          : red ? "border-destructive text-destructive hover:bg-destructive/10" : "border-foreground/40 text-foreground hover:border-foreground hover:bg-primary/10"
      }`}
    >
      <span className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] whitespace-nowrap">{label}</span>
      <span className={`font-heading text-xs font-semibold tabular-nums ${active ? "" : red ? "" : "text-muted-foreground"}`}>{count}</span>
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
      className={`inline-flex items-center gap-1.5 px-2 py-1 text-[0.6875rem] font-medium border ${
        count > 0 ? "border-foreground text-foreground" : "border-dashed border-foreground/40 text-muted-foreground"
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
    <div className="overflow-hidden divide-y divide-foreground/40 border border-foreground/40">
      {groups.map((group) => {
        const collapsed = collapsedKeys.has(group.key);
        return (
          <div key={group.key}>
            <button
              type="button"
              onClick={() => toggle(group.key)}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-primary/10 transition-colors text-left"
              aria-expanded={!collapsed}
            >
              {collapsed ? (
                <ChevronRight size={14} className="text-foreground shrink-0" />
              ) : (
                <ChevronDown size={14} className="text-foreground shrink-0" />
              )}
              <span className="text-sm font-semibold text-foreground">{group.alias}</span>
              <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{group.workType}</span>
              <span className="ml-auto font-heading text-[0.625rem] tabular-nums text-muted-foreground shrink-0">
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
                        className="p-3.5 active:bg-primary/10 cursor-pointer space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium text-foreground leading-snug min-w-0">
                            {row.sequenceNo}. {row.activityName}
                          </span>
                          <div onClick={(e) => e.stopPropagation()} className="shrink-0 flex flex-col items-end gap-0.5">
                            <PriorityBadge priority={row.priority} />
                            {row.tagName && <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground" title="Tag">{row.tagName}</span>}
                            <AssignmentStatusSelect rungId={row.rungId} status={row.status} resumed={!!row.resumedAt} />
                            <TimelineHint status={row.status} startDate={row.startDate} days={row.days} endDate={row.endDate} />
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
                            {row.startDate ? new Date(row.startDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                          </span>
                        </div>

                        {delay && (
                          <span
                            className={`block text-[0.625rem] leading-tight ${delay.tone === "on-time" ? "text-muted-foreground" : "text-foreground font-semibold"}`}
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
                      <tr className="text-left">
                        <th className="px-5 py-2">Activity</th>
                        <th className="px-3 py-2">Engineer</th>
                        <th className="px-3 py-2">Tag</th>
                        <th className="px-3 py-2">Priority</th>
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
                          className="cursor-pointer"
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
                            {row.tagName ? (
                              <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap">{row.tagName}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                            <AssignmentPrioritySelect rungId={row.rungId} priority={row.priority} />
                          </td>
                          <td className="px-3 py-3">
                            <span className="flex items-center gap-1.5 text-xs text-foreground whitespace-nowrap">
                              <CalendarDays size={11} className="text-muted-foreground shrink-0" />
                              {row.startDate ? new Date(row.startDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                            </span>
                            {(() => {
                              const delay = startDelayInfo(row.startDate, row.firstReportedAt);
                              if (!delay) return null;
                              return (
                                <span
                                  className={`mt-1 block text-[0.625rem] leading-tight ${delay.tone === "on-time" ? "text-muted-foreground" : "text-foreground font-semibold"}`}
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
                            <AssignmentStatusSelect rungId={row.rungId} status={row.status} resumed={!!row.resumedAt} />
                            <TimelineHint status={row.status} startDate={row.startDate} days={row.days} endDate={row.endDate} className="mt-1" />
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

const autoNameOf = (r: ReportedAssignment) =>
  dependencyAutoName({ flatName: r.flatName, alias: r.alias, roomName: r.roomName, storey: r.storey, activityName: r.activityName });

// A separate "find one activity" box: type an Auto Name (or any words of it), pick the match, and that
// activity's details show in their own card below — without opening the location tree at all.
function AutoNameLookup({
  openDetail,
}: {
  openDetail: (row: ReportedAssignment, tab?: "overview" | "blueprint" | "photos") => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<ReportedAssignment | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const q = query.trim();
      setDebounced(q.length >= 2 ? q : "");
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const { data: matches = [], isFetching } = useQuery({
    queryKey: ["civilworkdpr-activity-reporting", "auto-name-lookup", debounced],
    queryFn: () => getReportedAssignments({ search: debounced, limit: 25 }),
    enabled: !!debounced,
    placeholderData: (prev) => prev,
  });

  // Keep what's shown fresh (status changes, new progress) by re-reading the picked activity.
  const { data: fresh } = useQuery({
    queryKey: ["civilworkdpr-activity-reporting", "auto-name-picked", picked?.rungId],
    queryFn: async () => (await getReportedAssignments({ rungId: picked!.rungId }))[0] ?? null,
    enabled: !!picked,
  });
  const shown = fresh ?? picked;

  return (
    <div className="bg-card overflow-hidden" style={{ border: "1px solid hsl(var(--foreground))" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
        <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">Find an activity by auto name</span>
        <span className="hidden sm:inline text-[0.6875rem] text-muted-foreground">flat, room and activity, in any order</span>
      </div>
      <div className="px-4 py-4 space-y-3">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) {
                setPicked(matches[0]);
                setQuery("");
              }
            }}
            placeholder="e.g. NS/n1/101, Hall Room and 2.1 Column and Beam…"
            className="w-full h-10 pl-8 pr-8 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <X size={13} />
            </button>
          )}
        </div>

        {debounced && (
          <div>
            {isFetching && matches.length === 0 ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Searching…</p>
            ) : matches.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No activity matches "{debounced}".</p>
            ) : (
              <>
                <p className="text-[0.6875rem] text-muted-foreground mb-1.5">
                  {matches.length}{matches.length === 25 ? "+" : ""} match{matches.length === 1 ? "" : "es"} — pick one to see its details
                </p>
                <ul className="divide-y divide-border/70 border border-foreground max-h-64 overflow-y-auto">
                  {matches.map((m) => (
                    <li key={m.assignmentId}>
                      <button
                        onClick={() => {
                          setPicked(m);
                          setQuery("");
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-primary/10 transition-colors"
                      >
                        <p className="text-sm font-medium text-foreground">{autoNameOf(m)}</p>
                        <p className="text-[0.6875rem] text-muted-foreground">
                          {m.projectName ? `${m.projectName} > ` : ""}{m.scopePath} · {STATUS_META[m.status]?.label ?? m.status}
                          {m.attemptNo > 1 ? ` · attempt ${m.attemptNo}` : ""}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {shown && (
          <div className="overflow-hidden" style={{ border: "1px solid hsl(var(--foreground))" }}>
            <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
              <div className="min-w-0">
                <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Auto name</p>
                <p className="text-sm font-semibold text-foreground break-words">{autoNameOf(shown)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {shown.projectName ? `${shown.projectName} > ` : ""}{shown.scopePath}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-heading text-xs font-semibold tabular-nums text-foreground">{Math.round(shown.progressPercent * 10) / 10}% done</span>
                <button onClick={() => setPicked(null)} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  <X size={12} /> Close
                </button>
              </div>
            </div>
            <ChainGroupList items={[shown]} openDetail={openDetail} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function ActivityReporting() {
  const rights = usePageRights("civilworkdpr-activity-reporting");
  const [statusFilter, setStatusFilter] = useState<AssignmentStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState("");
  const [detailRow, setDetailRow] = useState<ReportedAssignment | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "blueprint" | "photos">("overview");
  const openDetail = (row: ReportedAssignment, tab: "overview" | "blueprint" | "photos" = "overview") => {
    setDetailRow(row);
    setDetailTab(tab);
  };

  // Opened from a report row (?rung=): open that activity's detail straight away, once. When the link says where
  // it came from (router state `returnTo`, e.g. the Civil Work DPR Query page), closing the popup goes back there.
  const location = useLocation();
  const navigate = useNavigate();
  const returnToRef = useRef<string | null>((location.state as { returnTo?: string } | null)?.returnTo ?? null);
  const openedFromLinkRef = useRef(false);
  const closeDetail = () => {
    setDetailRow(null);
    if (openedFromLinkRef.current && returnToRef.current) {
      openedFromLinkRef.current = false;
      const target = returnToRef.current;
      // The popup's own history entry (see useOverlayBackClose) is removed with an asynchronous history.back() when
      // it closes — go back to the origin only after that has settled, or it would pop the page we just opened.
      let done = false;
      const go = () => {
        if (done) return;
        done = true;
        window.removeEventListener("popstate", go);
        clearTimeout(timer);
        navigate(target);
      };
      const timer = setTimeout(go, 300);
      window.addEventListener("popstate", go);
    }
  };
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedRung = readChainLink(searchParams).rungId;
  useEffect(() => {
    if (!linkedRung || !rights.canView) return;
    let cancelled = false;
    getReportedAssignments({ rungId: linkedRung })
      .then((rows) => {
        if (cancelled) return;
        if (rows[0]) {
          openedFromLinkRef.current = true;
          openDetail(rows[0]);
        } else toast.error("That activity is not in Activity Reporting (it may be outside your projects or its chain retired).");
      })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Could not open that activity.");
      })
      .finally(() => {
        if (cancelled) return;
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("rung");
            next.delete("chain");
            return next;
          },
          { replace: true },
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedRung, rights.canView]);

  // Debounced so the search box doesn't fire a fresh GROUP BY over the
  // whole (342,000+ row, in production) table on every keystroke.
  // A single letter matches nearly everything (and forces the same full scan
  // as no filter at all), so the server is only asked from 2 characters on.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      const q = search.trim();
      setDebouncedSearch(q.length >= 2 ? q : "");
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  // The tree, its per-room counts, and the status-tile counts all come from
  // one cheap server-side aggregate — the actual per-activity rows for a
  // room are only ever fetched on demand, by RoomActivities, once that
  // room's node is expanded (see its own comment above).
  const { data: summary, isLoading } = useQuery({
    queryKey: ["civilworkdpr-activity-reporting", "summary", statusFilter, debouncedSearch, projectId],
    queryFn: () =>
      getActivityScopeSummary({
        status: statusFilter !== "ALL" ? statusFilter : undefined,
        search: debouncedSearch || undefined,
        projectId: projectId ? Number(projectId) : undefined,
      }),
    enabled: rights.canView,
    // Keep showing the previous tree while the next search is fetched instead
    // of blanking to a spinner on every refinement of the query.
    placeholderData: (prev) => prev,
  });

  const rooms = summary?.rooms ?? [];
  // Auto-expanding a room fetches all of its activities. Doing that for every
  // match of a broad search ("floor" -> hundreds of rooms) fired hundreds of
  // heavy requests at once and froze both the page and the server, so only a
  // narrow result opens itself; a broad one stays collapsed for the user to open.
  const MAX_AUTO_EXPAND_ROOMS = 6;
  const autoExpand = !!debouncedSearch && rooms.length <= MAX_AUTO_EXPAND_ROOMS;
  const { data: projects = [] } = useQuery({
    queryKey: ["civilworkdpr-scope-projects"],
    queryFn: getScopeProjects,
    enabled: rights.canView,
    staleTime: 10 * 60 * 1000,
  });
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
      <SheetShell
        eyebrow="CivilierERP · Civil Work DPR"
        title="Reporting"
        subtitle="Every activity given an engineer or material in Work Allocation, followed through to completion."
      >
        {!rights.canView ? (
          <div className="bg-card p-8 text-center text-sm text-muted-foreground" style={{ border: "1px dashed hsl(var(--border))" }}>
            You don't have access to this page.
          </div>
        ) : (
          <>
          <AutoNameLookup openDetail={openDetail} />
          <div className="bg-card overflow-hidden" style={{ border: "1px solid hsl(var(--foreground))" }}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3 px-4 py-3" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
              <p className="flex items-baseline gap-2.5">
                <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">Assigned activities</span>
                <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{total.toLocaleString("en-IN")}</span>
              </p>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
              {projects.length > 0 && (
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="h-9 px-2.5 w-full sm:w-52 text-xs border border-foreground/40 focus:border-foreground bg-card text-foreground outline-none"
                >
                  <option value="">All projects</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name || `Project ${p.id}`}</option>
                  ))}
                </select>
              )}
              <div className="relative w-full sm:w-auto">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search Auto Name — flat, room or activity…"
                  className="pl-7 pr-7 h-9 w-full sm:w-64 text-xs border border-foreground/40 focus:border-foreground bg-card text-foreground placeholder:text-muted-foreground/70 outline-none"
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
            </div>

            {/* Mobile: one horizontally-scrolling row (swipe to see the rest,
                same pattern as a native app's filter chips) instead of
                letting 9 pills wrap into 3-4 full-width rows a user has to
                scroll past before reaching any actual content. Desktop keeps
                the original wrapping layout — there's room for it there. */}
            <div className="flex sm:flex-wrap items-center gap-1.5 px-4 py-3 overflow-x-auto sm:overflow-visible thin-scroll" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
              {FILTER_OPTIONS.map((opt) => {
                const count = opt.value === "ALL" ? total : (statusCounts[opt.value] ?? 0);
                return (
                  <StatusTile
                    key={opt.value}
                    label={opt.label}
                    stopped={opt.value === "CANCELLED"}
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
                    : "No activities match these filters."}
              </div>
            ) : (
              <div className="p-2 sm:p-4">
                {debouncedSearch && !autoExpand && (
                  <p className="px-1 pb-2 text-xs text-muted-foreground">
                    {rooms.length} rooms match “{debouncedSearch}” — open the ones you need, or type more to narrow it down.
                  </p>
                )}
                <ScopeLocationTree
                  rows={rooms}
                  countLabel="activity"
                  countLabelPlural="activities"
                  getCount={(r) => r.activityCount}
                  forceExpand={autoExpand}
                  renderLeaf={(items) => (
                    <RoomActivities room={items[0]} statusFilter={statusFilter} openDetail={openDetail} />
                  )}
                />
              </div>
            )}
          </div>
          </>
        )}
      </SheetShell>
      {detailRow && (
        <ActivityDetailModal row={detailRow} initialTab={detailTab} onClose={closeDetail} />
      )}
    </>
  );
}
