// pages/admin/activity-browser/ActivityBrowserTabs.tsx
import React, { useMemo } from "react";
import {
  Activity,
  LogIn,
  LogOut,
  Monitor,
  Fingerprint,
  Timer,
  User,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
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

const ACTION_LOG_COLUMNS: ColumnDef<SessionEvent, unknown>[] = [
  {
    id: "user",
    header: "User",
    cell: ({ row }) => (
      <div>
        <p className="font-medium text-sm text-foreground leading-tight">{row.original.userName}</p>
        <p className="text-[11px] text-muted-foreground">{row.original.userEmail}</p>
      </div>
    ),
  },
  {
    id: "action",
    header: "Action",
    cell: ({ row }) => {
      const label = getActionLabel(row.original);
      const color = ACTION_COLORS[row.original.actionType as keyof typeof ACTION_COLORS] ?? "bg-muted text-muted-foreground";
      return (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-heading font-semibold tracking-wide ${color}`}>
          {label}
        </span>
      );
    },
  },
  {
    accessorKey: "resource",
    header: "Resource",
    cell: ({ getValue }) => (
      <span className="font-mono text-xs text-muted-foreground truncate max-w-[180px] block">
        {(getValue() as string) || "—"}
      </span>
    ),
  },
  {
    accessorKey: "details",
    header: "Details",
    cell: ({ getValue }) => (
      <span className="text-xs text-muted-foreground truncate max-w-[200px] block">
        {(getValue() as string) || "—"}
      </span>
    ),
  },
  {
    id: "timestamp",
    header: "Time",
    cell: ({ row }) => {
      const { date, time } = (() => {
        const iso = row.original.timestamp;
        if (!iso) return { date: "—", time: "—" };
        const d = new Date(iso);
        return {
          date: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
          time: d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
        };
      })();
      return (
        <div>
          <p className="text-xs text-foreground">{date}</p>
          <p className="text-[11px] text-muted-foreground">{time}</p>
        </div>
      );
    },
  },
];

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
              <DataTable
                data={filteredActions}
                columns={ACTION_LOG_COLUMNS}
                searchable={false}
                paginated={true}
                defaultPageSize={25}
                emptyMessage="No actions found."
              />
        </div>
      )}
    </>
  );
};
