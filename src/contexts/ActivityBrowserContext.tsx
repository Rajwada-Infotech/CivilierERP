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

interface ActivityBrowserContextType {
  rawSessions: SessionEvent[];
  groupedSessions: GroupedSession[];
  isLoading: boolean;
  dateFilters: {
    dateFrom?: string;
    dateTo?: string;
    period?:
      | "today"
      | "yesterday"
      | "this-week"
      | "this-month"
      | "last-month"
      | "this-year";
  };
  setDateFilters: React.Dispatch<
    React.SetStateAction<ActivityBrowserContextType["dateFilters"]>
  >;
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

export const useActivityBrowser = () => {
  const ctx = useContext(ActivityBrowserContext);
  if (!ctx) {
    throw new Error(
      "useActivityBrowser must be inside ActivityBrowserProvider",
    );
  }
  return ctx;
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
  limit: 20,
  pages: 0,
};

// ── PROVIDER ──────────────────────────────────────────────────────────────────

export const ActivityBrowserProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [rawSessions, setRawSessions] = useState<SessionEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dateFilters, setDateFilters] = useState({
    period: "last-month" as const,
  });
  const [activity, setActivity] = useState<PaginatedActivity>(EMPTY_ACTIVITY);

  const currentPageRef = useRef(1);
  const currentFiltersRef = useRef<ActivityFilters>({});
  const sseSourceRef = useRef<EventSource | null>(null);
  const cachedIp = useRef<string | null>(null);

  const getIp = useCallback(async () => {
    if (cachedIp.current) return cachedIp.current;
    const ip = await fetchIp();
    cachedIp.current = ip;
    return ip;
  }, []);

  // ── FETCH ──────────────────────────────────────────────────────────────────

  const fetchActivity = useCallback(
    async (page = 1, filters: ActivityFilters = {}) => {
      const token = localStorage.getItem("token");
      if (!token) {
        setRawSessions([]);
        setIsLoading(false);
        return;
      }

<<<<<<< HEAD
      // Only admin/super_admin/dba can view activity logs
      const user = getStoredUser();
      if (!["admin", "super_admin", "dba"].includes(user.role)) {
        setRawSessions([]);
        setIsLoading(false);
=======
      // Only privileged roles have UserActivity CanView — skip silently for user role
      try {
        const stored = localStorage.getItem("user");
        const role = stored ? JSON.parse(stored)?.role : null;
        if (!["super_admin", "admin", "dba"].includes(role)) return;
      } catch {
>>>>>>> 67320e18799755a4dfbf3c08f2e0d0513327a309
        return;
      }

      try {
        setIsLoading(true);

        currentPageRef.current = page;
        currentFiltersRef.current = filters;

        const result = await getUserActivityLogs({
          page,
          limit: 20,
          ...filters,
          dateFrom: dateFilters.dateFrom,
          dateTo: dateFilters.dateTo,
          period: dateFilters.period,
        });

        setActivity(result);
        setRawSessions(result.data.map((e, i) => normalizeEvent(e, i)));
      } catch (err) {
        console.error("Failed to fetch activity:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [dateFilters],
  );

  const setPage = useCallback(
    (page: number) => fetchActivity(page, currentFiltersRef.current),
    [fetchActivity],
  );

  const setFilters = useCallback(
    (filters: ActivityFilters) => fetchActivity(1, filters),
    [fetchActivity],
  );

  const refresh = useCallback(
    () => fetchActivity(currentPageRef.current, currentFiltersRef.current),
    [fetchActivity],
  );

  const clearAll = () => {
    setRawSessions([]);
    setActivity(EMPTY_ACTIVITY);
  };

  const clearDateFilters = () => {
    setDateFilters({ period: "last-month" });
  };

  useEffect(() => {
    void fetchActivity();
  }, [fetchActivity]);

  // ── SSE ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

<<<<<<< HEAD
    const user = getStoredUser();
    if (!["admin", "super_admin", "dba"].includes(user.role)) return;
=======
    // Only open SSE for privileged roles that have UserActivity CanView rights
    try {
      const stored = localStorage.getItem("user");
      const role = stored ? JSON.parse(stored)?.role : null;
      if (!["super_admin", "admin", "dba"].includes(role)) return;
    } catch {
      return;
    }
>>>>>>> 67320e18799755a4dfbf3c08f2e0d0513327a309

    sseSourceRef.current = subscribeToActivityStream((events) => {
      setRawSessions(events.map((e, i) => normalizeEvent(e, i)));
      refresh();
    });

    return () => {
      sseSourceRef.current?.close();
    };
  }, [refresh]);

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