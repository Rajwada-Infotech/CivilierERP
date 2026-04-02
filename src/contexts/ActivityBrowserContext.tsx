import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from "react";

export type SessionEventType = "login" | "logout";

export interface SessionEvent {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  event: SessionEventType;
  timestamp: string; // ISO string
  ipAddress: string;
  deviceInfo: string;
}

interface ActivityBrowserContextType {
  sessions: SessionEvent[];
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

// Best-effort IP fetch — falls back to "Unavailable" if the network request fails
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
  // Cache IP so we only fetch once per page load
  const cachedIp = useRef<string | null>(null);

  const getIp = async (): Promise<string> => {
    if (cachedIp.current !== null) return cachedIp.current;
    const ip = await fetchIp();
    cachedIp.current = ip;
    return ip;
  };

  const recordLogin = useCallback(
    async (user: { id: string; name: string; email: string; role: string }) => {
      const ip = await getIp();
      const entry: SessionEvent = {
        id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        event: "login",
        timestamp: new Date().toISOString(),
        ipAddress: ip,
        deviceInfo: getDeviceInfo(),
      };
      setSessions((prev) => [entry, ...prev]);
    },
    [],
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
        event: "logout",
        timestamp: new Date().toISOString(),
        ipAddress: ip,
        deviceInfo: getDeviceInfo(),
      };
      setSessions((prev) => [entry, ...prev]);
    },
    [],
  );

  const clearAll = useCallback(() => setSessions([]), []);

  return (
    <ActivityBrowserContext.Provider
      value={{ sessions, recordLogin, recordLogout, clearAll }}
    >
      {children}
    </ActivityBrowserContext.Provider>
  );
};
