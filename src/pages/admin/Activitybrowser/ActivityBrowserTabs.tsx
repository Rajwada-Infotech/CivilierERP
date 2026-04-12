// pages/admin/activity-browser/ActivityBrowserTabs.tsx
import React, { useMemo } from "react";
import {
  Activity,
  LogIn,
  LogOut,
  Calendar,
  Clock,
  Monitor,
  Fingerprint,
  Timer,
  User,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SessionEvent, ActivityActionType } from "@/api/userActivityApi";
import { ROLE_COLORS, ACTION_COLORS } from "./constants";

type Props = {
  activeTab: "sessions" | "actions";
  setActiveTab: (tab: "sessions" | "actions") => void;
  search: string;
  filterRole: "all" | "super_admin" | "admin" | "user";
  quickFilter: ActivityActionType | null;
  groupedSessions: any[];
  rawSessions: SessionEvent[];
};

function formatDateTime(iso?: string) {
  if (!iso) return { date: "—", time: "—" };
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    time: d.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }),
  };
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return "Active";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function roleLabel(role: string) {
  if (role === "super_admin") return "Super Admin";
  if (role === "admin") return "Admin";
  return "User";
}

function getActionLabel(event: SessionEvent) {
  if (event.event === "login") return "LOGIN";
  if (event.event === "logout") return "LOGOUT";
  return (event.actionType || "action").toUpperCase();
}

export const ActivityBrowserTabs: React.FC<Props> = ({
  activeTab,
  setActiveTab,
  search,
  filterRole,
  quickFilter,
  groupedSessions,
  rawSessions,
}) => {
  // Compute q once - this avoids the eslint warning
  const q = search.trim().toLowerCase();

  const filteredSessions = useMemo(() => {
    return groupedSessions.filter((session: any) => {
      const roleMatch = filterRole === "all" || session.userRole === filterRole;
      const actionTypeMatch =
        !quickFilter ||
        session.actions.some((a: any) => a.actionType === quickFilter);

      const searchMatch =
        !q ||
        session.userName.toLowerCase().includes(q) ||
        session.userEmail.toLowerCase().includes(q) ||
        session.deviceFingerprint.toLowerCase().includes(q) ||
        session.deviceInfo?.toLowerCase().includes(q) ||
        session.actions.some(
          (action: any) =>
            action.resource?.toLowerCase().includes(q) ||
            action.requestUrl?.toLowerCase().includes(q) ||
            action.details?.toLowerCase().includes(q) ||
            action.actionType?.toLowerCase().includes(q),
        );

      return roleMatch && searchMatch && actionTypeMatch;
    });
  }, [groupedSessions, filterRole, quickFilter, q]); // ← q is now included

  const filteredActions = useMemo(() => {
    return rawSessions.filter((event: SessionEvent) => {
      if (event.event !== "action") return false;

      const roleMatch = filterRole === "all" || event.userRole === filterRole;
      const actionTypeMatch = !quickFilter || event.actionType === quickFilter;

      const searchMatch =
        !q ||
        event.userName.toLowerCase().includes(q) ||
        event.userEmail.toLowerCase().includes(q) ||
        event.resource?.toLowerCase().includes(q) ||
        event.requestUrl?.toLowerCase().includes(q) ||
        event.details?.toLowerCase().includes(q) ||
        event.actionType?.toLowerCase().includes(q);

      return roleMatch && searchMatch && actionTypeMatch;
    });
  }, [rawSessions, filterRole, quickFilter, q]); // ← q is now included

  return (
    <>
      <div className="border-b border-border">
        <nav className="-mb-px flex space-x-8">
          <button
            className={`border-b-2 px-1 pb-2 text-sm font-heading ${
              activeTab === "sessions"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
            onClick={() => setActiveTab("sessions")}
          >
            Sessions
          </button>
          <button
            className={`border-b-2 px-1 pb-2 text-sm font-heading ${
              activeTab === "actions"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
            onClick={() => setActiveTab("actions")}
          >
            Actions
          </button>
        </nav>
      </div>

      {/* Sessions Tab Content */}
      {activeTab === "sessions" ? (
        filteredSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-border bg-muted/30 py-24 text-muted-foreground">
            <Activity size={48} className="opacity-20" />
            <p className="text-lg font-heading font-semibold">
              No sessions match your filters
            </p>
            <p className="text-sm">
              Try adjusting the date range or other filters above.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredSessions.map((session: any) => {
              const loginMeta = formatDateTime(session.loginTime);
              const logoutMeta = formatDateTime(session.logoutTime);
              const uniqueIps = new Set(
                [
                  session.loginEvent?.ipAddress,
                  session.logoutEvent?.ipAddress,
                  ...session.actions
                    .map((a: any) => a.ipAddress)
                    .filter(Boolean),
                ].filter(Boolean),
              );

              return (
                <div
                  key={session.sessionId}
                  className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                >
                  <div className="grid gap-4 border-b border-border bg-muted/30 p-5 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
                    {/* User Info */}
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <User size={16} className="text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">
                          {session.userName}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {session.userEmail}
                        </p>
                        <span
                          className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-heading uppercase tracking-wider ${ROLE_COLORS[session.userRole] || ""}`}
                        >
                          {roleLabel(session.userRole)}
                        </span>
                      </div>
                    </div>

                    {/* Device & IP */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs">
                        <Monitor
                          size={12}
                          className="shrink-0 text-muted-foreground"
                        />
                        <span className="truncate">
                          {session.ipAddress || "unknown"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <Fingerprint
                          size={12}
                          className="shrink-0 text-muted-foreground"
                        />
                        <span className="truncate font-mono text-[10px] text-muted-foreground">
                          {session.deviceFingerprint !== "Unknown"
                            ? session.deviceFingerprint.slice(0, 16) + "…"
                            : "unknown"}
                        </span>
                      </div>
                      {uniqueIps.size > 1 && (
                        <div className="flex items-center gap-1 text-amber-600 text-xs">
                          <ShieldAlert size={12} />
                          Multiple IPs detected
                        </div>
                      )}
                    </div>

                    {/* Login / Logout Time */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <LogIn
                          size={12}
                          className="shrink-0 text-emerald-500"
                        />
                        <span className="text-muted-foreground">
                          {loginMeta.date}{" "}
                          <span className="font-medium text-foreground">
                            {loginMeta.time}
                          </span>
                        </span>
                      </div>
                      {session.logoutTime ? (
                        <div className="flex items-center gap-2 text-xs">
                          <LogOut
                            size={12}
                            className="shrink-0 text-rose-400"
                          />
                          <span className="text-muted-foreground">
                            {logoutMeta.date}{" "}
                            <span className="font-medium text-foreground">
                              {logoutMeta.time}
                            </span>
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-emerald-500">
                          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                          Active session
                        </div>
                      )}
                    </div>

                    {/* Duration & Actions */}
                    <div className="flex flex-col items-end justify-between gap-2 text-right">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Timer size={12} />
                        {formatDuration(session.durationMs)}
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {session.actions.length} actions
                      </Badge>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : filteredActions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-border bg-muted/30 py-24 text-muted-foreground">
          <Activity size={48} className="opacity-20" />
          <p className="text-lg font-heading font-semibold">No actions found</p>
          <p className="text-sm">
            Try adjusting the date range or other filters above.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Resource</th>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">URL</th>
                <th className="px-4 py-3">Session</th>
              </tr>
            </thead>
            <tbody>
              {filteredActions.map((action: SessionEvent) => (
                <tr key={action.id} className="border-t border-border/70">
                  <td className="px-4 py-3">
                    <div className="font-medium">{action.userName}</div>
                    <div className="text-xs text-muted-foreground">
                      {action.userEmail}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full border px-2 py-1 text-xs font-heading ${ACTION_COLORS[action.actionType || "read"] || ""}`}
                    >
                      {getActionLabel(action)}
                    </span>
                  </td>
                  <td className="px-4 py-3 capitalize">
                    {action.resource || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar size={12} />
                      {formatDateTime(action.timestamp).date}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock size={12} />
                      {formatDateTime(action.timestamp).time}
                    </div>
                  </td>
                  <td className="max-w-[280px] px-4 py-3 text-xs text-muted-foreground">
                    <div className="truncate">{action.requestUrl || "—"}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {action.sessionId || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};
