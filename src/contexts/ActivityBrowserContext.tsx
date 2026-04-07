import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";

import {
  getUserActivityLogs,
  logUserActivity,
  subscribeToActivityStream,
} from "@/api/userActivityApi";

export type SessionEventType = "login" | "logout";

export interface SessionEvent {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  event: SessionEventType;
  timestamp: string;
  ipAddress: string;
  deviceInfo: string;
}

interface ActivityBrowserContextType {
  sessions: SessionEvent[];
  isLoading: boolean;
  recordLogin: (user: {
    id: string;
    name: string;
    email: string;
    role: string;
  }) => void;
  recordLogout: (user: {
    id: string;
    name: string;
    email: string;
    role: string;
  }) => void;
  clearAll: () => void;
}

const ActivityBrowserContext = createContext<ActivityBrowserContextType | null>(
  null,
);

export const useActivityBrowser = () => {
  const ctx = useContext(ActivityBrowserContext);
  if (!ctx)
    throw new Error(
      "useActivityBrowser must be inside ActivityBrowserProvider",
    );
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

function getDeviceInfo(): string {
  const ua = navigator.userAgent;
  let browser = "Unknown Browser";
  let os = "Unknown OS";

  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = "Safari";
  else if (/OPR\/|Opera\//.test(ua)) browser = "Opera";

  if (/Windows NT 10/.test(ua)) os = "Windows 10/11";
  else if (/Windows NT 6\.1/.test(ua)) os = "Windows 7";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";

  return `${browser} · ${os}`;
}

export const ActivityBrowserProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [sessions, setSessions] = useState<SessionEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const sseSourceRef = useRef<EventSource | null>(null);
  const cachedIp = useRef<string | null>(null);

  // FIX: getIp was never defined — caused a ReferenceError at runtime
  const getIp = useCallback(async (): Promise<string> => {
    if (cachedIp.current) return cachedIp.current;
    const ip = await fetchIp();
    cachedIp.current = ip;
    return ip;
  }, []);

  // FIX: was calling API unconditionally — fires 401s when user is not logged in
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setIsLoading(false);
      return;
    }
    const loadLogs = async () => {
      try {
        setIsLoading(true);
        const logs = await getUserActivityLogs();
        setSessions(logs);
      } catch (err) {
        console.error("Failed to load activity logs:", err);
      } finally {
        setIsLoading(false);
      }
    };
    loadLogs();
  }, []);

  // FIX: SSE was connecting unconditionally — fires 401s when user is not logged in
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    sseSourceRef.current = subscribeToActivityStream((data) => {
      if (data.type === "initial") {
        setSessions(data.sessions);
      } else {
        setSessions((prev) => {
          if (prev.some((s) => s.id === data.id)) return prev;
          return [data, ...prev];
        });
      }
    });

    return () => {
      if (sseSourceRef.current) {
        sseSourceRef.current.close();
        sseSourceRef.current = null;
      }
    };
  }, []);

  const recordLogin = useCallback(
    async (user: { id: string; name: string; email: string; role: string }) => {
      const ip = await getIp();
      const entry: SessionEvent = {
        id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        event: "login" as const,
        timestamp: new Date().toISOString(),
        ipAddress: ip,
        deviceInfo: getDeviceInfo(),
      };
      setSessions((prev) => [entry, ...prev]);
      try {
        await logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          userRole: user.role,
          event: "login",
          ipAddress: ip,
          deviceInfo: getDeviceInfo(),
        });
      } catch (err) {
        console.error("Failed to log login:", err);
        setSessions((prev) => prev.slice(1));
      }
    },
    [getIp],
  );

  const recordLogout = useCallback(
    async (user: { id: string; name: string; email: string; role: string }) => {
      const ip = await getIp();
      const entry: SessionEvent = {
        id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        event: "logout" as const,
        timestamp: new Date().toISOString(),
        ipAddress: ip,
        deviceInfo: getDeviceInfo(),
      };
      setSessions((prev) => [entry, ...prev]);
      try {
        // FIX: was sending wrong field names — role/event_type/ip_address/device_info
        // API expects: userRole/event/ipAddress/deviceInfo
        await logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          userRole: user.role,
          event: "logout",
          ipAddress: ip,
          deviceInfo: getDeviceInfo(),
        });
      } catch (err) {
        console.error("Failed to log logout:", err);
        setSessions((prev) => prev.slice(1));
      }
    },
    [getIp],
  );

  const clearAll = useCallback(() => setSessions([]), []);

  return (
    // FIX: isLoading was missing from provider value — context consumers couldn't read loading state
    <ActivityBrowserContext.Provider
      value={{ sessions, isLoading, recordLogin, recordLogout, clearAll }}
    >
      {children}
    </ActivityBrowserContext.Provider>
  );
};
