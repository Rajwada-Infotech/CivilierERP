import React, { useState, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  useActivityBrowser,
  SessionEvent,
} from "@/contexts/ActivityBrowserContext";
import {
  LogIn,
  LogOut,
  Monitor,
  Search,
  Trash2,
  Wifi,
  Calendar,
  User,
  ChevronDown,
  ChevronUp,
  Clock,
} from "lucide-react";

const EVENT_COLORS = {
  login: {
    badge: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    icon: "text-emerald-500",
    dot: "bg-emerald-500",
  },
  logout: {
    badge: "bg-rose-500/10 text-rose-600 border-rose-500/20",
    icon: "text-rose-500",
    dot: "bg-rose-500",
  },
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  admin: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  user: "bg-slate-500/10 text-slate-600 border-slate-500/20",
};

function formatDateTime(iso: string) {
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
      second: "2-digit",
      hour12: true,
    }),
  };
}

function roleLabel(role: string) {
  if (role === "super_admin") return "Super Admin";
  if (role === "admin") return "Admin";
  return "User";
}

type SortKey = "timestamp" | "userName" | "event";
type SortDir = "asc" | "desc";

const ActivityBrowser: React.FC = () => {
  const { sessions, clearAll } = useActivityBrowser();

  const [search, setSearch] = useState("");
  const [filterEvent, setFilterEvent] = useState<"all" | "login" | "logout">(
    "all",
  );
  const [filterRole, setFilterRole] = useState<
    "all" | "super_admin" | "admin" | "user"
  >("all");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    let list = [...sessions];

    if (filterEvent !== "all")
      list = list.filter((s) => s.event === filterEvent);
    if (filterRole !== "all")
      list = list.filter((s) => s.userRole === filterRole);

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.userName.toLowerCase().includes(q) ||
          s.userEmail.toLowerCase().includes(q) ||
          s.ipAddress.includes(q) ||
          s.deviceInfo.toLowerCase().includes(q),
      );
    }

    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "timestamp")
        cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      else if (sortKey === "userName")
        cmp = a.userName.localeCompare(b.userName);
      else if (sortKey === "event") cmp = a.event.localeCompare(b.event);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [sessions, search, filterEvent, filterRole, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col ? (
      sortDir === "asc" ? (
        <ChevronUp size={13} className="text-primary" />
      ) : (
        <ChevronDown size={13} className="text-primary" />
      )
    ) : (
      <ChevronDown size={13} className="text-muted-foreground/40" />
    );

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Admin", path: "/admin" },
          { label: "User Control" },
          { label: "Activity Browser" },
        ]}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground">
            Activity Browser
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Session logs for all user login and logout events
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-heading px-2 py-1 rounded-md bg-muted border border-border">
            {sessions.length} total event{sessions.length !== 1 ? "s" : ""}
          </span>
          {sessions.length > 0 && (
            <>
              {confirmClear ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Sure?</span>
                  <button
                    onClick={() => {
                      clearAll();
                      setConfirmClear(false);
                    }}
                    className="text-xs px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground font-heading hover:opacity-90 transition-opacity"
                  >
                    Yes, clear
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="text-xs px-3 py-1.5 rounded-md bg-muted border border-border font-heading hover:bg-muted/80 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-muted border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors font-heading"
                >
                  <Trash2 size={13} />
                  Clear All
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, IP…"
            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-all"
          />
        </div>

        {/* Event filter */}
        <select
          value={filterEvent}
          onChange={(e) => setFilterEvent(e.target.value as typeof filterEvent)}
          className="text-sm rounded-lg border border-border bg-background px-3 py-2 focus:border-primary outline-none transition-all cursor-pointer"
        >
          <option value="all">All Events</option>
          <option value="login">Login only</option>
          <option value="logout">Logout only</option>
        </select>

        {/* Role filter */}
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value as typeof filterRole)}
          className="text-sm rounded-lg border border-border bg-background px-3 py-2 focus:border-primary outline-none transition-all cursor-pointer"
        >
          <option value="all">All Roles</option>
          <option value="super_admin">Super Admin</option>
          <option value="admin">Admin</option>
          <option value="user">User</option>
        </select>
      </div>

      {/* Empty state */}
      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-muted-foreground border border-dashed border-border rounded-2xl bg-muted/20">
          <Clock size={40} className="opacity-20" />
          <p className="text-base font-heading font-semibold">
            No sessions recorded yet
          </p>
          <p className="text-sm text-center max-w-xs">
            Activity will appear here whenever a user logs in or out of the
            application.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Search size={32} className="opacity-20" />
          <p className="text-sm">No results match your filters.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-heading text-xs uppercase tracking-wider text-muted-foreground w-8">
                    #
                  </th>
                  <th
                    className="text-left px-4 py-3 font-heading text-xs uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground select-none"
                    onClick={() => toggleSort("event")}
                  >
                    <span className="flex items-center gap-1">
                      Event <SortIcon col="event" />
                    </span>
                  </th>
                  <th
                    className="text-left px-4 py-3 font-heading text-xs uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground select-none"
                    onClick={() => toggleSort("userName")}
                  >
                    <span className="flex items-center gap-1">
                      User <SortIcon col="userName" />
                    </span>
                  </th>
                  <th className="text-left px-4 py-3 font-heading text-xs uppercase tracking-wider text-muted-foreground">
                    Role
                  </th>
                  <th
                    className="text-left px-4 py-3 font-heading text-xs uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground select-none"
                    onClick={() => toggleSort("timestamp")}
                  >
                    <span className="flex items-center gap-1">
                      Date & Time <SortIcon col="timestamp" />
                    </span>
                  </th>
                  <th className="text-left px-4 py-3 font-heading text-xs uppercase tracking-wider text-muted-foreground">
                    IP Address
                  </th>
                  <th className="text-left px-4 py-3 font-heading text-xs uppercase tracking-wider text-muted-foreground">
                    Device / Browser
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((s, idx) => {
                  const { date, time } = formatDateTime(s.timestamp);
                  const colors = EVENT_COLORS[s.event];
                  return (
                    <tr
                      key={s.id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-heading px-2.5 py-1 rounded-full border ${colors.badge}`}
                        >
                          {s.event === "login" ? (
                            <LogIn size={11} />
                          ) : (
                            <LogOut size={11} />
                          )}
                          {s.event === "login" ? "Login" : "Logout"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">
                          {s.userName}
                        </div>
                        <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                          {s.userEmail}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-heading px-2 py-0.5 rounded-full border ${ROLE_COLORS[s.userRole] || ROLE_COLORS.user}`}
                        >
                          {roleLabel(s.userRole)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-foreground">
                          <Calendar
                            size={12}
                            className="text-muted-foreground shrink-0"
                          />
                          {date}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                          <Clock size={11} className="shrink-0" />
                          {time}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-foreground font-mono text-xs">
                          <Wifi
                            size={12}
                            className="text-muted-foreground shrink-0"
                          />
                          {s.ipAddress}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Monitor size={12} className="shrink-0" />
                          {s.deviceInfo}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((s, idx) => {
              const { date, time } = formatDateTime(s.timestamp);
              const colors = EVENT_COLORS[s.event];
              return (
                <div
                  key={s.id}
                  className="rounded-xl border border-border bg-card p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-heading px-2.5 py-1 rounded-full border ${colors.badge}`}
                    >
                      {s.event === "login" ? (
                        <LogIn size={11} />
                      ) : (
                        <LogOut size={11} />
                      )}
                      {s.event === "login" ? "Login" : "Logout"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      #{idx + 1}
                    </span>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
                      <User size={16} className="text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-heading font-semibold text-sm text-foreground truncate">
                        {s.userName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {s.userEmail}
                      </p>
                      <span
                        className={`mt-1 inline-block text-[10px] font-heading px-2 py-0.5 rounded-full border ${ROLE_COLORS[s.userRole] || ROLE_COLORS.user}`}
                      >
                        {roleLabel(s.userRole)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Calendar size={12} className="shrink-0" />
                      {date}
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock size={12} className="shrink-0" />
                      {time}
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground font-mono">
                      <Wifi size={12} className="shrink-0" />
                      {s.ipAddress}
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Monitor size={12} className="shrink-0" />
                      {s.deviceInfo}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Showing {filtered.length} of {sessions.length} events
          </p>
        </>
      )}
    </div>
  );
};

export default ActivityBrowser;
