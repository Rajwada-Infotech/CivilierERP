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

export interface PaginatedActivity {
  data: SessionEvent[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

interface ActivityFilters {
  search?: string;
  event?: string;
  role?: string;
  sort?: string;
  order?: "asc" | "desc";
}

interface ActivityBrowserContextType {
  activity: PaginatedActivity;
  isLoading: boolean;
  setPage: (page: number) => void;
  setFilters: (filters: ActivityFilters) => void;
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
  refresh: () => void;
}

const ActivityBrowserContext = createContext<ActivityBrowserContextType | null>(
  null
);

export const useActivityBrowser = () => {
  const ctx = useContext(ActivityBrowserContext);
  if (!ctx)
    throw new Error("useActivityBrowser must be inside ActivityBrowserProvider");
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

const EMPTY_ACTIVITY: PaginatedActivity = {
  data: [],
  total: 0,
  page: 1,
  limit: 20,
  pages: 0,
};

export const ActivityBrowserProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [activity, setActivity] = useState<PaginatedActivity>(EMPTY_ACTIVITY);
  const [isLoading, setIsLoading] = useState(true);

  // Track current page + filters so SSE refresh re-uses them
  const currentPageRef = useRef(1);
  const currentFiltersRef = useRef<ActivityFilters>({});

  const sseSourceRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cachedIp = useRef<string | null>(null);

  const getIp = useCallback(async (): Promise<string> => {
    if (cachedIp.current) return cachedIp.current;
    const ip = await fetchIp();
    cachedIp.current = ip;
    return ip;
  }, []);

  const fetchActivity = useCallback(
    async (page = 1, filters: ActivityFilters = {}) => {
      // Conditional: skip if no token (avoid 401s)
      const token = localStorage.getItem("token");
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();

        currentPageRef.current = page;
        currentFiltersRef.current = filters;

        setIsLoading(true);
        const result = await getUserActivityLogs({
          page,
          limit: 20,
          ...filters,
          sort: filters.sort ?? "timestamp",
          order: filters.order ?? "desc",
        });

        setActivity(result);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("Failed to load activity logs:", err);
        }
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const setPage = useCallback(
    (page: number) => {
      fetchActivity(page, currentFiltersRef.current);
    },
    [fetchActivity]
  );

  const setFilters = useCallback(
    (filters: ActivityFilters) => {
      fetchActivity(1, filters);
    },
    [fetchActivity]
  );

  const refresh = useCallback(() => {
    fetchActivity(currentPageRef.current, currentFiltersRef.current);
  }, [fetchActivity]);

  const clearAll = useCallback(() => {
    setActivity(EMPTY_ACTIVITY);
  }, []);

  // Initial load (conditional)
  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  // SSE — refresh current page on new data (conditional)
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token || sseSourceRef.current) return;

    sseSourceRef.current = subscribeToActivityStream(() => {
      fetchActivity(currentPageRef.current, currentFiltersRef.current);
    });

    return () => {
      sseSourceRef.current?.close();
      sseSourceRef.current = null;
    };
  }, [fetchActivity]);

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

      // Optimistic: prepend to current page data
      setActivity((prev) => ({
        ...prev,
        data: [entry, ...prev.data.slice(0, prev.limit - 1)],
        total: prev.total + 1,
      }));

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
        // No refresh needed on success (optimistic stays)
      } catch (err) {
        console.error("Failed to log login:", err);
        refresh(); // rollback via refresh
      }
    },
    [getIp, refresh]
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

      // Optimistic: prepend to current page data
      setActivity((prev) => ({
        ...prev,
        data: [entry, ...prev.data.slice(0, prev.limit - 1)],
        total: prev.total + 1,
      }));

      try {
        await logUserActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          userRole: user.role,
          event: "logout",
          ipAddress: ip,
          deviceInfo: getDeviceInfo(),
        });
        // No refresh needed on success
      } catch (err) {
        console.error("Failed to log logout:", err);
        refresh(); // rollback via refresh
      }
    },
    [getIp, refresh]
  );

  return (
    <ActivityBrowserContext.Provider
      value={{
        activity,
        isLoading,
        setPage,
        setFilters,
        recordLogin,
        recordLogout,
        clearAll,
        refresh,
      }}
    >
      {children}
    </ActivityBrowserContext.Provider>
  );
};
