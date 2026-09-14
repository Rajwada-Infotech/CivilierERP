import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";

import {
  type ActivityActionType,
  type SessionEvent,
  getUserActivityLogs,
  logUserActivity,
  deleteActivityHistory,
  subscribeToActivityStream,
} from "@/api/userActivityApi";

import {
  getDeviceFingerprint,
  getDeviceInfo,
  generateUUID,
} from "@/utils/deviceFingerprint";

// ── ROLE GUARD ────────────────────────────────────────────────────────────────
// Only these roles may read or write activity logs. Customers and any other
// non-privileged roles must be kept entirely out of the activity API.
const PRIVILEGED_ROLES = ["super_admin", "admin", "dba"] as const;

function isPrivilegedUser(): boolean {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    return PRIVILEGED_ROLES.includes(user?.role);
  } catch {
    return false;
  }
}

// ── TYPES ─────────────────────────────────────────────────────────────────────

export interface GroupedSession {
  sessionId: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  deviceFingerprint: string;
  deviceInfo: string;
  ipAddress: string;
  loginTime: string;
  logoutTime?: string;
  durationMs?: number;
  actions: SessionEvent[];
  loginEvent: SessionEvent;
  logoutEvent?: SessionEvent;
}

export interface PaginatedActivity {
  data: SessionEvent[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

interface ActivityFilters {
  search?: string;
  role?: string;
}

interface DateFilters {
  dateFrom?: string;
  dateTo?: string;
  period?:
    | "today"
    | "yesterday"
    | "this-week"
    | "this-month"
    | "last-month"
    | "this-year";
}

export interface ActivityBrowserContextType {
  rawSessions: SessionEvent[];
  groupedSessions: GroupedSession[];
  isLoading: boolean;
  dateFilters: DateFilters;
  setDateFilters: React.Dispatch<React.SetStateAction<DateFilters>>;
  clearDateFilters: () => void;
  activity: PaginatedActivity;
  setPage: (page: number) => void;
  setFilters: (filters: ActivityFilters) => void;
  recordLogin: (user: {
    id: string;
    name: string;
    email: string;
    role: string;
  }) => Promise<void>;
  recordLogout: (user: {
    id: string;
    name: string;
    email: string;
    role: string;
  }) => Promise<void>;
  recordAction: (action: {
    method: string;
    url: string;
    actionType: ActivityActionType;
    resource: string;
    details?: string;
  }) => Promise<void>;
  clearAll: () => void;
  clearHistory: () => Promise<void>;
  refresh: () => void;
}

// ── CONTEXT ───────────────────────────────────────────────────────────────────

export const ActivityBrowserContext =
  createContext<ActivityBrowserContextType | null>(null);

const NOOP_CONTEXT: ActivityBrowserContextType = {
  rawSessions: [],
  groupedSessions: [],
  isLoading: false,
  dateFilters: {},
  setDateFilters: () => {},
  clearDateFilters: () => {},
  activity: { data: [], total: 0, page: 1, limit: 50, pages: 0 },
  setPage: () => {},
  setFilters: () => {},
  recordLogin: async () => {},
  recordLogout: async () => {},
  recordAction: async () => {},
  clearAll: () => {},
  clearHistory: async () => {},
  refresh: () => {},
};

// ── HOOK ──────────────────────────────────────────────────────────────────────

export const useActivityBrowser = (): ActivityBrowserContextType => {
  const ctx = useContext(ActivityBrowserContext);
  return ctx ?? NOOP_CONTEXT;
};

// ── HELPERS ──────────────────────────────────────────────────────────────────

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "{}");
  } catch {
    return {};
  }
}

export function normalizeEvent(
  event: SessionEvent,
  index: number,
): SessionEvent {
  return {
    ...event,
    id:
      event.id ||
      `${event.event}-${event.sessionId || "no-session"}-${event.timestamp}-${index}`,
    ipAddress: event.ipAddress || "Unavailable",
    deviceInfo: event.deviceInfo || "Unknown device",
    deviceFingerprint: event.deviceFingerprint || "Unknown",
    details: event.details || "",
    resource: event.resource || "",
    requestMethod: event.requestMethod || "",
    requestUrl: event.requestUrl || "",
  };
}

export const EMPTY_ACTIVITY: PaginatedActivity = {
  data: [],
  total: 0,
  page: 1,
  limit: 50,
  pages: 0,
};

// ── PROVIDER ──────────────────────────────────────────────────────────────────

export const ActivityBrowserProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [rawSessions, setRawSessions] = useState<SessionEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dateFilters, setDateFilters] = useState<DateFilters>({
    period: "this-week",
  });
  const [activity, setActivity] = useState<PaginatedActivity>(EMPTY_ACTIVITY);

  const currentPageRef = useRef(1);
  const currentFiltersRef = useRef<ActivityFilters>({});
  const dateFiltersRef = useRef<DateFilters>(dateFilters);
  const fetchingRef = useRef(false);

  // Per-session dedup: tracks which page paths have already been written to the
  // DB this session so we only store each unique path once per session.
  const sessionPagesSeen = useRef<Set<string>>(new Set());

  // Keep dateFiltersRef in sync
  useEffect(() => {
    dateFiltersRef.current = dateFilters;
  }, [dateFilters]);

  // ── FETCH ──────────────────────────────────────────────────────────────────

  const fetchActivityCore = useCallback(
    async (page: number, filters: ActivityFilters, df: DateFilters) => {
      const token = localStorage.getItem("token");
      if (!token || !isPrivilegedUser()) {
        setRawSessions([]);
        setIsLoading(false);
        return;
      }

      try {
        fetchingRef.current = true;
        setIsLoading(true);

        const result = await getUserActivityLogs({
          page,
          limit: 100,
          ...filters,
          dateFrom: df.dateFrom,
          dateTo: df.dateTo,
          period: df.period,
        });

        setActivity(result);
        setRawSessions(result.data.map((e, i) => normalizeEvent(e, i)));
      } catch (err) {
        console.error("Failed to fetch activity:", err);
      } finally {
        setIsLoading(false);
        fetchingRef.current = false;
      }
    },
    [],
  );

  const fetchActivity = useCallback(
    (page = 1, filters: ActivityFilters = {}) => {
      currentPageRef.current = page;
      currentFiltersRef.current = filters;
      return fetchActivityCore(page, filters, dateFiltersRef.current);
    },
    [fetchActivityCore],
  );

  // Re-fetch whenever dateFilters change
  useEffect(() => {
    void fetchActivityCore(
      currentPageRef.current,
      currentFiltersRef.current,
      dateFilters,
    );
  }, [dateFilters, fetchActivityCore]);

  const setPage = useCallback(
    (page: number) => fetchActivity(page, currentFiltersRef.current),
    [fetchActivity],
  );

  const setFilters = useCallback(
    (filters: ActivityFilters) => fetchActivity(1, filters),
    [fetchActivity],
  );

  const refresh = useCallback(() => {
    return fetchActivityCore(
      currentPageRef.current,
      currentFiltersRef.current,
      dateFiltersRef.current,
    );
  }, [fetchActivityCore]);

  const clearAll = () => {
    setRawSessions([]);
    setActivity(EMPTY_ACTIVITY);
  };

  const clearDateFilters = () => {
    setDateFilters({ period: "this-week" });
  };

  // Deletes all activity records from the DB (scoped to requesting user on the
  // backend), clears local state, and resets the per-session dedup set so
  // subsequent navigations are tracked fresh.
  const clearHistory = async () => {
    await deleteActivityHistory();
    clearAll();
    sessionPagesSeen.current.clear();
  };

  // ── SOCKET.IO REAL-TIME ────────────────────────────────────────────────────

  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | undefined;

    const handleNewActivity = (event: SessionEvent) => {
      if (!isMounted) return;

      // Optimistically prepend to the visible list
      setRawSessions((prev) => [normalizeEvent(event, -1), ...prev]);

      // Background re-fetch to keep total count & pagination accurate,
      // but only if no fetch is already in flight
      if (!fetchingRef.current) {
        void fetchActivityCore(
          currentPageRef.current,
          currentFiltersRef.current,
          dateFiltersRef.current,
        );
      }
    };

    const trySubscribe = () => {
      const token = localStorage.getItem("token");
      if (!token || !isPrivilegedUser()) return;
      if (unsubscribe) return; // already subscribed

      unsubscribe = subscribeToActivityStream(handleNewActivity);
    };

    trySubscribe();

    // Token can be set after mount (login). Poll briefly to avoid plumbing
    // auth state through this provider.
    const intervalId = window.setInterval(() => {
      if (!isMounted) return;
      trySubscribe();
    }, 500);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      if (unsubscribe) unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── PERIODIC FALLBACK REFRESH ──────────────────────────────────────────────
  // The socket push above is the primary real-time path, but if the socket
  // connection is ever down/reconnecting for any reason (proxy hiccup,
  // network blip), the Activity Browser would otherwise show stale data
  // indefinitely with no self-healing. This background re-fetch guarantees
  // the data is never more than this interval stale even then. Cheap: the
  // endpoint is version-cached server-side (60s TTL), so most ticks hit the
  // cache rather than the DB, and fetchActivityCore already no-ops instantly
  // for non-privileged users.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (fetchingRef.current) return; // avoid piling up overlapping requests
      void fetchActivityCore(
        currentPageRef.current,
        currentFiltersRef.current,
        dateFiltersRef.current,
      );
    }, 20_000);
    return () => window.clearInterval(intervalId);
  }, [fetchActivityCore]);

  // ── RECORDING ──────────────────────────────────────────────────────────────

  const recordLogin = useCallback(
    async (user: { id: string; name: string; email: string; role: string }) => {
      const fingerprint = await getDeviceFingerprint();
      const deviceInfo = getDeviceInfo();
      const sessionId = generateUUID();
      const loginTime = Date.now();

      localStorage.setItem("currentSessionId", sessionId);
      // Persist login timestamp so recordLogout can compute sessionDuration
      // precisely even across page refreshes.
      localStorage.setItem("sessionLoginTime", String(loginTime));

      // Reset per-session page dedup for the new session
      sessionPagesSeen.current.clear();

      const entry: SessionEvent = {
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        event: "login",
        timestamp: new Date(loginTime).toISOString(),
        deviceInfo,
        deviceFingerprint: fingerprint,
        sessionId,
      };

      setRawSessions((prev) => [normalizeEvent(entry, 0), ...prev]);

      try {
        await logUserActivity(entry);
      } catch (err) {
        console.error("Login log failed:", err);
      }
    },
    [],
  );

  const recordLogout = useCallback(
    async (user: { id: string; name: string; email: string; role: string }) => {
      const sessionId = localStorage.getItem("currentSessionId");
      if (!sessionId) return;

      const deviceInfo = getDeviceInfo();

      // Compute session duration from the stored login timestamp.
      // Falls back to null if sessionLoginTime is missing (e.g. pre-existing
      // sessions that logged in before this fix was deployed) — the row is
      // still written, just without a duration value.
      const loginTimeRaw = localStorage.getItem("sessionLoginTime");
      const sessionDurationSeconds = loginTimeRaw
        ? Math.round((Date.now() - parseInt(loginTimeRaw, 10)) / 1000)
        : null;

      const entry: SessionEvent = {
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        event: "logout",
        timestamp: new Date().toISOString(),
        deviceInfo,
        sessionId,
        // Stored as INT (seconds) in UserActivityLog.SessionDuration
        sessionDuration: sessionDurationSeconds ?? undefined,
      };

      setRawSessions((prev) => [normalizeEvent(entry, 0), ...prev]);

      try {
        await logUserActivity(entry);
      } catch (err) {
        console.error("Logout log failed:", err);
      } finally {
        localStorage.removeItem("currentSessionId");
        localStorage.removeItem("sessionLoginTime");
      }
    },
    [],
  );

  const recordAction = useCallback(
    async (action: {
      method: string;
      url: string;
      actionType: ActivityActionType;
      resource: string;
      details?: string;
    }) => {
      const user = getStoredUser();
      let sessionId = localStorage.getItem("currentSessionId");

      // Sessions that started before recordLogin ran (e.g. a user already
      // logged in when this tracking was deployed, or localStorage was
      // partially cleared) never get a currentSessionId, which would
      // otherwise skip every single action log for that session forever.
      // Self-heal by minting one lazily as long as the user is actually
      // authenticated, instead of just warning on every action.
      if (!sessionId && user.id) {
        sessionId = generateUUID();
        localStorage.setItem("currentSessionId", sessionId);
        localStorage.setItem("sessionLoginTime", String(Date.now()));
      }

      if (!sessionId) {
        console.warn("Skipping activity action log: missing currentSessionId", {
          action,
        });
        return;
      }
      if (!user.id) return;

      // Per-session page dedup: only write a page-view (GET read) to the DB
      // once per unique path per session. Revisiting the same page does NOT
      // create a duplicate row. Mutations (create/update/delete/export) are
      // always written regardless.
      if (action.actionType === "read" && action.method === "GET") {
        if (sessionPagesSeen.current.has(action.url)) return;
        sessionPagesSeen.current.add(action.url);
      }

      const fingerprint = await getDeviceFingerprint();
      const deviceInfo = getDeviceInfo();

      const entry: SessionEvent = {
        userId: user.id,
        userName: user.name || "",
        userEmail: user.email || "",
        userRole: user.role || "",
        event: "action",
        timestamp: new Date().toISOString(),
        deviceInfo,
        deviceFingerprint: fingerprint,
        actionType: action.actionType,
        resource: action.resource,
        details: action.details,
        requestMethod: action.method,
        requestUrl: action.url,
        sessionId,
      };

      setRawSessions((prev) => [normalizeEvent(entry, 0), ...prev]);

      try {
        await logUserActivity(entry);
      } catch (err) {
        console.error("Action log failed:", err);
      }
    },
    [],
  );

  // ── GROUPING ───────────────────────────────────────────────────────────────

  const groupedSessions = useMemo(() => {
    const groups: Record<string, GroupedSession> = {};

    rawSessions.forEach((event) => {
      const sessionId =
        event.sessionId ||
        `implicit-${event.userId}-${
          new Date(event.timestamp).toISOString().split("T")[0]
        }`;

      if (!groups[sessionId]) {
        groups[sessionId] = {
          sessionId,
          userId: event.userId,
          userName: event.userName,
          userEmail: event.userEmail || "",
          userRole: event.userRole || "",
          deviceFingerprint: event.deviceFingerprint || "Unknown",
          deviceInfo: event.deviceInfo || "Unknown device",
          ipAddress: event.ipAddress || "Unavailable",
          loginTime: event.timestamp,
          actions: [],
          loginEvent: event,
        };
      }

      const group = groups[sessionId];

      if (event.event === "login") {
        group.loginTime = event.timestamp;
        group.loginEvent = event;
        group.deviceFingerprint =
          event.deviceFingerprint || group.deviceFingerprint;
        group.deviceInfo = event.deviceInfo || group.deviceInfo;
        group.ipAddress = event.ipAddress || group.ipAddress;
      } else if (event.event === "logout") {
        group.logoutTime = event.timestamp;
        group.logoutEvent = event;
        // Prefer the DB-persisted sessionDuration (seconds) when available.
        // Fall back to computing from timestamps for rows that predate this fix.
        group.durationMs =
          event.sessionDuration != null
            ? event.sessionDuration * 1000
            : new Date(event.timestamp).getTime() -
              new Date(group.loginTime).getTime();
      } else {
        group.actions.push(event);
      }
    });

    return Object.values(groups).sort((a, b) =>
      (b.logoutTime || b.loginTime).localeCompare(a.logoutTime || a.loginTime),
    );
  }, [rawSessions]);

  return (
    <ActivityBrowserContext.Provider
      value={{
        rawSessions,
        groupedSessions,
        isLoading,
        dateFilters,
        setDateFilters,
        clearDateFilters,
        activity,
        setPage,
        setFilters,
        recordLogin,
        recordLogout,
        recordAction,
        clearAll,
        clearHistory,
        refresh,
      }}
    >
      {children}
    </ActivityBrowserContext.Provider>
  );
};
