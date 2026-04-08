import { fetchWithAuth } from '@/lib/fetchWithAuth'
import type { SessionEvent, PaginatedActivity } from '@/contexts/ActivityBrowserContext';

export type ActivityEventType = "login" | "logout" | "action";

export type ActivityActionType =
  | "read"
  | "write"
  | "create"
  | "update"
  | "delete"
  | "export"
  | "settings_change";

export interface ActivityLogFilters {
  limit?: number;
  offset?: number;
  event?: ActivityEventType;
  actionType?: ActivityActionType;
  resource?: string;
  sessionId?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  period?: 'today' | 'yesterday' | 'this-week' | 'this-month' | 'last-month' | 'this-year';
}

// Main paginated fetch (from dev + backend compatibility)
export const getUserActivityLogs = async (params: {
  page?: number;
  limit?: number;
  search?: string;
  event?: string;
  role?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  dateFrom?: string;
  dateTo?: string;
  period?: ActivityLogFilters['period'];
} = {}): Promise<PaginatedActivity> => {
  const url = new URL('/api/user-activity', window.location.origin);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetchWithAuth(url.pathname + url.search);
  if (!response.ok) throw new Error('Failed to fetch activity logs');
  return response.json();
};

// Legacy support (keeps old code working)
export const getUserActivityLogsLegacy = async (
  filters?: ActivityLogFilters,
): Promise<SessionEvent[]> => {
  const result = await getUserActivityLogs({
    page: 1,
    limit: filters?.limit || 100,
    event: filters?.event,
    dateFrom: filters?.dateFrom,
    dateTo: filters?.dateTo,
    period: filters?.period,
  });
  return result.data;
};

export const getSessionActivity = async (
  sessionId: string,
): Promise<SessionEvent[]> => {
  const response = await fetchWithAuth(`/api/user-activity/session/${sessionId}`, {
    skipActivityLog: true,
  });
  if (!response.ok) throw new Error("Failed to fetch session activity");
  return response.json();
};

export const logUserActivity = async (
  data: {
    userId: string;
    userName: string;
    userEmail?: string;
    userRole?: string;
    event: ActivityEventType;
    ipAddress?: string;
    deviceInfo?: string;
    deviceFingerprint?: string;
    actionType?: ActivityActionType;
    resource?: string;
    details?: string;
    sessionId?: string;
    sessionDuration?: number;
    requestMethod?: string;
    requestUrl?: string;
  }
): Promise<{ message: string }> => {
  const response = await fetchWithAuth("/api/user-activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    skipActivityLog: true,
  });
  if (!response.ok) throw new Error("Failed to log activity");
  return response.json();
};

export const subscribeToActivityStream = (
  onMessage: (data: SessionEvent[]) => void,
): EventSource => {
  const token = localStorage.getItem("token");
  const url = token
    ? `/api/user-activity/stream?token=${encodeURIComponent(token)}`
    : "/api/user-activity/stream";

  const source = new EventSource(url);

  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as SessionEvent[];
      onMessage(data);
    } catch (err) {
      console.error("Failed to parse SSE data:", err);
    }
  };

  source.addEventListener('ping', () => console.log('SSE ping received'));

  source.onerror = (err) => console.error("SSE error:", err);

  return source;
};