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
  subscribeToActivityStream,
} from "@/api/userActivityApi";

import { getDeviceFingerprint, getDeviceInfo } from "@/utils/deviceFingerprint";

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

interface ActivityBrowserContextType {
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
  refresh: () => void;
}

// ── CONTEXT ───────────────────────────────────────────────────────────────────

const ActivityBrowserContext = createContext<ActivityBrowserContextType | null>(
  null,
);

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
  refresh: () => {},
};

export const useActivityBrowser = () => {
  const ctx = useContext(ActivityBrowserContext);
  return ctx ?? NOOP_CONTEXT;
};

// ── HELPERS ───────────────────────────────────────────────────────────────────

async function fetchIp(): Promise<string> {
  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    return data.ip ?? "Unavailable";
  } catch {
    return "Unavailable";
  }
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "{}");
  } catch {
    return {};
  }
}

function normalizeEvent(event: SessionEvent, index: number): SessionEvent {
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

const EMPTY_ACTIVITY: PaginatedActivity = {
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
  // Default to "this-week" so actions are visible without needing to change filters
  const [dateFilters, setDateFilters] = useState<DateFilters>({
    period: "this-week",
  });
  const [activity, setActivity] = useState<PaginatedActivity>(EMPTY_ACTIVITY);

  const currentPageRef = useRef(1);
  const currentFiltersRef = useRef<ActivityFilters>({});
  // Store dateFilters in a ref so SSE callback always reads current value
  const dateFiltersRef = useRef<DateFilters>(dateFilters);
  const sseSourceRef = useRef<EventSource | null>(null);
  const sseReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const sseRetryRef = useRef(0);
  const cachedIp = useRef<string | null>(null);
  // Track if a fetch is in-flight to avoid SSE overwriting it
  const fetchingRef = useRef(false);

  // Keep dateFiltersRef in sync
  useEffect(() => {
    dateFiltersRef.current = dateFilters;
  }, [dateFilters]);

  const getIp = useCallback(async () => {
    if (cachedIp.current) return cachedIp.current;
    const ip = await fetchIp();
    cachedIp.current = ip;
    return ip;
  }, []);

  // ── FETCH ──────────────────────────────────────────────────────────────────
  // Use a ref-based fetch so SSE callback can call it without stale closures
  const fetchActivityCore = useCallback(
    async (page: number, filters: ActivityFilters, df: DateFilters) => {
      const token = localStorage.getItem("token");
      if (!token) {
        setRawSessions([]);
        setIsLoading(false);
        return;
      }

      try {
        fetchingRef.current = true;
        setIsLoading(true);

        // Fetch a larger page so both sessions and actions are well-populated
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

  // ── SSE ────────────────────────────────────────────────────────────────────
  // SSE only triggers a refresh — it never directly sets rawSessions
  // (which was overwriting the filtered fetch with unfiltered latest-25 rows)
  useEffect(() => {
    let isMounted = true;

    const connect = () => {
      const token = localStorage.getItem("token");
      if (!token || sseSourceRef.current || !isMounted) return;

      sseSourceRef.current = subscribeToActivityStream(
        () => {
          sseRetryRef.current = 0;
          if (!fetchingRef.current) {
            void fetchActivityCore(
              currentPageRef.current,
              currentFiltersRef.current,
              dateFiltersRef.current,
            );
          }
        },
        () => {
          sseSourceRef.current?.close();
          sseSourceRef.current = null;

          if (sseReconnectTimerRef.current || !isMounted) return;

          const delay = Math.min(30_000, 3_000 * 2 ** sseRetryRef.current);
          sseRetryRef.current += 1;

          sseReconnectTimerRef.current = setTimeout(() => {
            sseReconnectTimerRef.current = null;
            if (document.visibilityState === "visible") {
              connect();
            }
          }, delay);
        },
      );
    };

    connect();
    document.addEventListener("visibilitychange", connect);

    return () => {
      isMounted = false;
      document.removeEventListener("visibilitychange", connect);
      if (sseReconnectTimerRef.current) {
        clearTimeout(sseReconnectTimerRef.current);
      }
      sseSourceRef.current?.close();
    };
    // fetchActivityCore is stable (no deps) — safe to use here without re-running
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── RECORDING ──────────────────────────────────────────────────────────────

  const recordLogin = useCallback(
    async (user: { id: string; name: string; email: string; role: string }) => {
      const ip = await getIp();
      const fingerprint = await getDeviceFingerprint();
      const deviceInfo = getDeviceInfo();
      const sessionId = crypto.randomUUID();

      localStorage.setItem("currentSessionId", sessionId);

      const entry: SessionEvent = {
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        event: "login",
        timestamp: new Date().toISOString(),
        ipAddress: ip,
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
    [getIp],
  );

  const recordLogout = useCallback(
    async (user: { id: string; name: string; email: string; role: string }) => {
      const sessionId = localStorage.getItem("currentSessionId");
      if (!sessionId) return;

      const ip = await getIp();
      const deviceInfo = getDeviceInfo();

      const entry: SessionEvent = {
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        event: "logout",
        timestamp: new Date().toISOString(),
        ipAddress: ip,
        deviceInfo,
        sessionId,
      };

      setRawSessions((prev) => [normalizeEvent(entry, 0), ...prev]);

      try {
        await logUserActivity(entry);
      } catch (err) {
        console.error("Logout log failed:", err);
      } finally {
        localStorage.removeItem("currentSessionId");
      }
    },
    [getIp],
  );

  const recordAction = useCallback(
    async (action: {
      method: string;
      url: string;
      actionType: ActivityActionType;
      resource: string;
      details?: string;
    }) => {
      const sessionId = localStorage.getItem("currentSessionId");
      const user = getStoredUser();
      if (!sessionId || !user.id) return;

      const ip = await getIp();
      const fingerprint = await getDeviceFingerprint();
      const deviceInfo = getDeviceInfo();

      const entry: SessionEvent = {
        userId: user.id,
        userName: user.name || "",
        userEmail: user.email || "",
        userRole: user.role || "",
        event: "action",
        timestamp: new Date().toISOString(),
        ipAddress: ip,
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
    [getIp],
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
        group.durationMs =
          new Date(event.timestamp).getTime() -
          new Date(group.loginTime).getTime();
      } else {
        // event === "action"
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
        refresh,
      }}
    >
      {children}
    </ActivityBrowserContext.Provider>
  );
};
