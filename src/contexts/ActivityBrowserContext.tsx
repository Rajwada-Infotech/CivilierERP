import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityLogFilters,
  type ActivityActionType,
  type SessionEvent,
  getUserActivityLogs,
  logUserActivity,
  subscribeToActivityStream,
} from "@/api/userActivityApi";
import {
  getDeviceFingerprint,
  getDeviceInfo,
} from "@/utils/deviceFingerprint";

export interface GroupedSession {
  sessionId: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  deviceFingerprint: string;
  deviceInfo: string;
  loginTime: string;
  logoutTime?: string;
  durationMs?: number;
  actions: SessionEvent[];
  loginEvent: SessionEvent;
  logoutEvent?: SessionEvent;
}

interface ActivityBrowserContextType {
  rawSessions: SessionEvent[];
  groupedSessions: GroupedSession[];
  isLoading: boolean;
  dateFilters: {
    dateFrom?: string;
    dateTo?: string;
    period?: 'today' | 'yesterday' | 'this-week' | 'this-month' | 'last-month' | 'this-year';
  };
  setDateFilters: React.Dispatch<React.SetStateAction<ActivityBrowserContextType['dateFilters']>>;
  clearDateFilters: () => void;
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
}

const ActivityBrowserContext =
  createContext<ActivityBrowserContextType | null>(null);

const CURRENT_SESSION_KEY = "currentSessionId";

export const useActivityBrowser = () => {
  const ctx = useContext(ActivityBrowserContext);
  if (!ctx) {
    throw new Error(
      "useActivityBrowser must be inside ActivityBrowserProvider",
    );
  }
  return ctx;
};

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

function ensureEventId(event: SessionEvent, index: number) {
  if (event.id) return String(event.id);
  return `${event.event}-${event.sessionId || "no-session"}-${event.timestamp}-${index}`;
}

function normalizeEvent(event: SessionEvent, index: number): SessionEvent {
  return {
    ...event,
    id: ensureEventId(event, index),
    ipAddress: event.ipAddress || "Unavailable",
    deviceInfo: event.deviceInfo || "Unknown device",
    deviceFingerprint: event.deviceFingerprint || "Unknown",
    details: event.details || "",
    resource: event.resource || "",
    requestMethod: event.requestMethod || "",
    requestUrl: event.requestUrl || "",
  };
}

export const ActivityBrowserProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [rawSessions, setRawSessions] = useState<SessionEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dateFilters, setDateFilters] = useState<ActivityBrowserContextType['dateFilters']>({
    period: 'last-month' // Default last 30 days
  });
  const sseSourceRef = useRef<EventSource | null>(null);
  const cachedIp = useRef<string | null>(null);

  const getIp = useCallback(async (): Promise<string> => {
    if (cachedIp.current) return cachedIp.current;
    const ip = await fetchIp();
    cachedIp.current = ip;
    return ip;
  }, []);

  const refreshLogs = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setRawSessions([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const filters: ActivityLogFilters = { ...dateFilters };
      const logs = await getUserActivityLogs(filters);
      setRawSessions(logs.map(normalizeEvent));
    } catch (err) {
      console.error("Failed to load activity logs:", err);
      setRawSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, [dateFilters]);

  useEffect(() => {
    void refreshLogs();
  }, [refreshLogs]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    sseSourceRef.current = subscribeToActivityStream((events) => {
      setRawSessions(events.map(normalizeEvent));
    });

    return () => {
      sseSourceRef.current?.close();
      sseSourceRef.current = null;
    };
  }, []);

  const recordLogin = useCallback(
    async (user: { id: string; name: string; email: string; role: string }) => {
      const ip = await getIp();
      const fingerprint = await getDeviceFingerprint();
      const deviceInfo = getDeviceInfo();
      const sessionId = crypto.randomUUID();
      localStorage.setItem(CURRENT_SESSION_KEY, sessionId);

      const entry: SessionEvent = normalizeEvent(
        {
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
        },
        0,
      );

      setRawSessions((prev) => [entry, ...prev]);

      try {
        await logUserActivity(entry);
      } catch (err) {
        console.error("Failed to log login:", err);
      }
    },
    [getIp],
  );

  const recordLogout = useCallback(
    async (user: { id: string; name: string; email: string; role: string }) => {
      const sessionId = localStorage.getItem(CURRENT_SESSION_KEY);
      if (!sessionId) return;

      const ip = await getIp();
      const fingerprint = await getDeviceFingerprint();
      const deviceInfo = getDeviceInfo();

      const existingLogin = rawSessions.find(
        (item) => item.sessionId === sessionId && item.event === "login",
      );

      const logoutTime = new Date().toISOString();
      const sessionDuration = existingLogin
        ? Math.max(
            0,
            Math.round(
              (new Date(logoutTime).getTime() -
                new Date(existingLogin.timestamp).getTime()) /
                1000,
            ),
          )
        : undefined;

      const entry: SessionEvent = normalizeEvent(
        {
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          userRole: user.role,
          event: "logout",
          timestamp: logoutTime,
          ipAddress: ip,
          deviceInfo,
          deviceFingerprint: fingerprint,
          sessionId,
          sessionDuration,
        },
        0,
      );

      setRawSessions((prev) => [entry, ...prev]);

      try {
        await logUserActivity(entry);
      } catch (err) {
        console.error("Failed to log logout:", err);
      } finally {
        localStorage.removeItem(CURRENT_SESSION_KEY);
      }
    },
    [getIp, rawSessions],
  );

  const recordAction = useCallback(
    async (action: {
      method: string;
      url: string;
      actionType: ActivityActionType;
      resource: string;
      details?: string;
    }) => {
      const sessionId = localStorage.getItem(CURRENT_SESSION_KEY);
      const user = getStoredUser();

      if (!sessionId || !user.id) return;

      const entry: SessionEvent = normalizeEvent(
        {
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          userRole: user.role,
          event: "action",
          timestamp: new Date().toISOString(),
          ipAddress: await getIp(),
          deviceInfo: getDeviceInfo(),
          deviceFingerprint: await getDeviceFingerprint(),
          sessionId,
          actionType: action.actionType,
          resource: action.resource,
          details: action.details,
          requestMethod: action.method,
          requestUrl: action.url,
        },
        0,
      );

      setRawSessions((prev) => [entry, ...prev]);

      try {
        await logUserActivity(entry);
      } catch (err) {
        console.error("Action logging failed:", err);
      }
    },
    [getIp],
  );

  const groupedSessions = useMemo(() => {
    const groups: Record<string, GroupedSession> = {};

    rawSessions.forEach((event) => {
      if (!event.sessionId) return;

      if (!groups[event.sessionId]) {
        groups[event.sessionId] = {
          sessionId: event.sessionId,
          userId: event.userId,
          userName: event.userName,
          userEmail: event.userEmail,
          userRole: event.userRole,
          deviceFingerprint: event.deviceFingerprint || "Unknown",
          deviceInfo: event.deviceInfo || "Unknown device",
          loginTime: event.timestamp,
          actions: [],
          loginEvent: event,
        };
      }

      const group = groups[event.sessionId];

      if (event.event === "login") {
        group.loginTime = event.timestamp;
        group.loginEvent = event;
      } else if (event.event === "logout") {
        group.logoutTime = event.timestamp;
        group.logoutEvent = event;
        if (typeof event.sessionDuration === "number") {
          group.durationMs = event.sessionDuration * 1000;
        } else if (group.loginTime) {
          group.durationMs =
            new Date(event.timestamp).getTime() -
            new Date(group.loginTime).getTime();
        }
      } else if (event.event === "action") {
        group.actions.push(event);
      }
    });

    return Object.values(groups).sort((a, b) =>
      (b.logoutTime || b.loginTime).localeCompare(a.logoutTime || a.loginTime),
    );
  }, [rawSessions]);

  const clearAll = useCallback(() => setRawSessions([]), []);

  const clearDateFilters = useCallback(() => {
    setDateFilters({ period: 'last-month' });
  }, []);

  return (
    <ActivityBrowserContext.Provider
      value={{
        rawSessions,
        groupedSessions,
        isLoading,
        dateFilters,
        setDateFilters,
        clearDateFilters,
        recordLogin,
        recordLogout,
        recordAction,
        clearAll,
      }}
    >
      {children}
    </ActivityBrowserContext.Provider>
  );
};
