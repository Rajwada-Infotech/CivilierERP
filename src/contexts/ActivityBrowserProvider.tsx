import { generateUUID } from '../utils/cryptoPolyfill';
// ActivityBrowserProvider.tsx — only exports a component (React Fast Refresh safe)
import React, {
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
} from "@/utils/deviceFingerprint";

import {
  ActivityBrowserContext,
  type ActivityBrowserContextType,
  type GroupedSession,
  type PaginatedActivity,
  getStoredUser,
  normalizeEvent,
  EMPTY_ACTIVITY,
} from "./ActivityBrowserContext";

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

  useEffect(() => {
    dateFiltersRef.current = dateFilters;
  }, [dateFilters]);

  const fetchActivityCore = useCallback(
    async (page: number, filters: ActivityFilters, df: DateFilters) => {
      const token = localStorage.getItem("token");
      if (!token) {
        setRawSessions([]);
        setIsLoading(false);
        return;
      }

      const storedUser = getStoredUser();
      if (storedUser?.role === "customer") {
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

  const refresh = useCallback(
    () =>
      fetchActivityCore(
        currentPageRef.current,
        currentFiltersRef.current,
        dateFiltersRef.current,
      ),
    [fetchActivityCore],
  );

  const clearAll = () => {
    setRawSessions([]);
    setActivity(EMPTY_ACTIVITY);
  };

  const clearHistory = async () => {
    await deleteActivityHistory();
    clearAll();
  };

  const clearDateFilters = () => {
    setDateFilters({ period: "this-week" });
  };

  // ── SOCKET.IO REAL-TIME ────────────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;

    const handleNewActivity = (event: SessionEvent) => {
      if (!isMounted) return;
      setRawSessions((prev) => [normalizeEvent(event, -1), ...prev]);
      if (!fetchingRef.current) {
        void fetchActivityCore(
          currentPageRef.current,
          currentFiltersRef.current,
          dateFiltersRef.current,
        );
      }
    };

    const unsubscribe = subscribeToActivityStream(handleNewActivity);
    return () => {
      isMounted = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── RECORDING ──────────────────────────────────────────────────────────────

  const recordLogin = useCallback(
    async (user: { id: string; name: string; email: string; role: string }) => {
      const fingerprint = await getDeviceFingerprint();
      const deviceInfo = getDeviceInfo();
      const sessionId = generateUUID();
      const loginTime = Date.now();

      localStorage.setItem("currentSessionId", sessionId);
      // Store login timestamp so logout can compute sessionDuration precisely
      localStorage.setItem("sessionLoginTime", String(loginTime));

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

      // ── Compute session duration ───────────────────────────────────────────
      // loginTime is stored (ms) by recordLogin. If missing, fall back to 0
      // so we still log the logout row rather than silently dropping it.
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
        // Persist to UserActivityLog.SessionDuration (INT, seconds)
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
      const sessionId = localStorage.getItem("currentSessionId");
      const user = getStoredUser();
      if (!sessionId) {
        console.warn("Skipping activity action log: missing currentSessionId", {
          action,
        });
        return;
      }
      if (!user.id) return;

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
        // Use the DB-persisted sessionDuration (seconds) when available;
        // fall back to computing from timestamps for legacy rows.
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
