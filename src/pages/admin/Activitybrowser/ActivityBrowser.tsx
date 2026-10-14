// Sessions & Log: every sign-in session with its actions, or the flat audit log, for a period.
// The page frame (title, view switch) is ActivityBrowserHome's; this is the view's body.
import React, { useState, useEffect, useMemo } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { useActivityBrowser } from "@/contexts/ActivityBrowserContext";
import type { ActivityActionType } from "@/api/userActivityApi";
import { RefreshCw, Trash2 } from "lucide-react";
import { BodyPortal } from "@/components/ui/body-portal";
import { Figures, KEY, KEY_LINE, LBL, RULE } from "./activityShared";
import { SessionCard } from "./SessionCard";
import { ActionRow } from "./ActionRow";
import { SessionsFilters, type RoleFilter } from "./SessionsFilters";

const ActivityBrowser: React.FC = () => {
  usePageRights("activity-browser");
  const {
    groupedSessions,
    rawSessions,
    isLoading,
    dateFilters,
    setDateFilters,
    clearDateFilters,
    activity,
    setPage,
    setFilters,
    refresh,
    clearHistory,
  } = useActivityBrowser();

  const [activeTab, setActiveTab] = useState<"sessions" | "log">("sessions");
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<RoleFilter>("all");
  const [quickFilter, setQuickFilter] = useState<ActivityActionType | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters({
        search: search.trim() || undefined,
        role: filterRole === "all" ? undefined : filterRole,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [search, filterRole, setFilters]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setTimeout(() => setRefreshing(false), 600);
  };

  const handleClearHistory = async () => {
    setClearing(true);
    try {
      await clearHistory();
    } catch {
      // error already logged in provider
    } finally {
      setClearing(false);
      setConfirmClearOpen(false);
    }
  };

  const stats = useMemo(() => {
    const actions = rawSessions.filter((e) => e.event === "action");
    // Changes are every write — create, update (which includes approvals and rejections), delete, export, settings.
    const changes = actions.filter((e) => e.actionType && e.actionType !== "read");
    const active = groupedSessions.filter((s) => !s.logoutTime);
    const uniqueIps = new Set(rawSessions.map((e) => e.ipAddress).filter(Boolean));
    const multiIpSessions = groupedSessions.filter((s) => {
      const ips = new Set([s.loginEvent?.ipAddress, s.logoutEvent?.ipAddress, ...s.actions.map((a) => a.ipAddress)].filter(Boolean));
      return ips.size > 1;
    });
    return {
      actions: actions.length,
      changes: changes.length,
      activeSessions: active.length,
      uniqueIps: uniqueIps.size,
      alerts: multiIpSessions.length,
    };
  }, [rawSessions, groupedSessions]);

  const q = search.trim().toLowerCase();
  const filteredSessions = useMemo(() => {
    return groupedSessions.filter((s) => {
      if (filterRole !== "all" && s.userRole !== filterRole) return false;
      if (quickFilter && !s.actions.some((a) => a.actionType === quickFilter)) return false;
      if (
        q &&
        !s.userName.toLowerCase().includes(q) &&
        !s.userEmail.toLowerCase().includes(q) &&
        !s.ipAddress?.toLowerCase().includes(q) &&
        !s.deviceInfo?.toLowerCase().includes(q) &&
        !s.deviceFingerprint?.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [groupedSessions, filterRole, quickFilter, q]);

  const filteredLog = useMemo(() => {
    return rawSessions.filter((e) => {
      if (filterRole !== "all" && e.userRole !== filterRole) return false;
      if (quickFilter && e.actionType !== quickFilter) return false;
      if (
        q &&
        !e.userName.toLowerCase().includes(q) &&
        !e.userEmail?.toLowerCase().includes(q) &&
        !e.ipAddress?.toLowerCase().includes(q) &&
        !e.resource?.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [rawSessions, filterRole, quickFilter, q]);

  return (
    <>
      <Figures
        loading={isLoading}
        items={[
          { label: "Sessions", value: groupedSessions.length, note: `${stats.activeSessions} still signed in` },
          { label: "Changes", value: stats.changes, note: `of ${stats.actions.toLocaleString("en-IN")} actions logged` },
          { label: "Unique IPs", value: stats.uniqueIps, note: "addresses seen" },
          { label: "IP anomalies", value: stats.alerts, note: stats.alerts > 0 ? "sessions from more than one IP" : "all clear", red: stats.alerts > 0 },
        ]}
      />

      <SessionsFilters
        period={dateFilters.period}
        setDateFilters={setDateFilters}
        clearDateFilters={clearDateFilters}
        quickFilter={quickFilter}
        setQuickFilter={setQuickFilter}
        search={search}
        setSearch={setSearch}
        filterRole={filterRole}
        setFilterRole={setFilterRole}
      />

      <div className="bg-card" style={{ border: RULE }}>
        <div className="flex flex-wrap items-stretch justify-between gap-2 px-4" style={{ borderBottom: RULE }}>
          <div className="flex">
            {(["sessions", "log"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-3 -mb-px border-b-2 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors ${
                  activeTab === tab ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "sessions" ? `Sessions · ${filteredSessions.length}` : `Audit log · ${filteredLog.length}`}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 py-2">
            <span className={LBL}>{activity.total.toLocaleString("en-IN")} records</span>
            <button onClick={handleRefresh} disabled={refreshing} className={`${KEY_LINE} h-8 px-3`}>
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
              Refresh
            </button>
            <button
              onClick={() => setConfirmClearOpen(true)}
              className={`${KEY} h-8 px-3 border border-destructive/60 text-destructive hover:border-destructive hover:bg-destructive/10`}
            >
              <Trash2 size={12} />
              Clear history
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading activity…</div>
        ) : activeTab === "sessions" ? (
          filteredSessions.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">No sessions match these filters. Try a wider period or a different search.</div>
          ) : (
            <div className="p-4 space-y-2">
              {filteredSessions.map((session) => (
                <SessionCard key={session.sessionId} session={session} />
              ))}
            </div>
          )
        ) : filteredLog.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">No events found. Try a wider period or fewer filters.</div>
        ) : (
          <>
            <div className={`grid grid-cols-[5.5rem_1fr_auto] gap-x-3 px-4 py-2.5 ${LBL}`} style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.25)" }}>
              <span>Kind</span>
              <span>Who · what</span>
              <span className="text-right">When</span>
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              {filteredLog.map((event, i) => (
                <ActionRow key={event.id ?? i} event={event} />
              ))}
            </div>
          </>
        )}

        {!isLoading && activity.pages > 1 && (
          <div className="flex flex-wrap items-center justify-center gap-1.5 px-4 py-3" style={{ borderTop: RULE }}>
            <button onClick={() => setPage(Math.max(1, activity.page - 1))} disabled={activity.page === 1} className={`${KEY_LINE} h-8 px-3`}>
              Previous
            </button>
            {Array.from({ length: Math.min(5, activity.pages) }, (_, i) => activity.page - 2 + i)
              .filter((p) => p >= 1 && p <= activity.pages)
              .map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`${KEY} h-8 min-w-8 px-2 border tabular-nums ${p === activity.page ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"}`}
                >
                  {p}
                </button>
              ))}
            <button onClick={() => setPage(Math.min(activity.pages, activity.page + 1))} disabled={activity.page === activity.pages} className={`${KEY_LINE} h-8 px-3`}>
              Next
            </button>
            <span className={`${LBL} ml-2`}>
              Page {activity.page} of {activity.pages} · {activity.total.toLocaleString("en-IN")} in all
            </span>
          </div>
        )}
      </div>

      {confirmClearOpen && (
        <BodyPortal>
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/60 backdrop-blur-sm">
            <div className="sheet-frame w-full max-w-sm bg-card p-6" style={{ margin: 0, border: RULE, boxShadow: "8px 8px 0 hsl(var(--foreground) / 0.12)" }}>
              <div className="pb-3 mb-3" style={{ borderBottom: RULE }}>
                <p className={LBL}>Activity log</p>
                <p className="font-heading text-lg font-bold tracking-tight text-foreground mt-1">Clear all history</p>
              </div>
              <p className="text-sm text-muted-foreground">This permanently deletes every activity log entry from the database. It cannot be undone.</p>
              <div className="flex justify-end gap-2 pt-3 mt-4" style={{ borderTop: RULE }}>
                <button onClick={() => setConfirmClearOpen(false)} disabled={clearing} className={`${KEY_LINE} h-9 px-4`}>
                  Cancel
                </button>
                <button onClick={handleClearHistory} disabled={clearing} className={`${KEY} h-9 px-5 bg-destructive text-destructive-foreground border border-destructive`}>
                  {clearing ? "Clearing…" : "Clear history"}
                </button>
              </div>
            </div>
          </div>
        </BodyPortal>
      )}
    </>
  );
};
export default ActivityBrowser;
