import { fetchWithAuth } from "@/lib/fetchWithAuth";

export type ActivityEventType = "login" | "logout" | "action";
export type ActivityActionType =
  | "read"
  | "write"
  | "create"
  | "update"
  | "delete"
  | "export"
  | "settings_change";

export interface SessionEvent {
  id?: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  event: ActivityEventType;
  timestamp: string;
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

export interface ActivityLogFilters {
  limit?: number;
  offset?: number;
  event?: ActivityEventType;
  actionType?: string;
  resource?: string;
  sessionId?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  period?: 'today' | 'yesterday' | 'this-week' | 'this-month' | 'last-month' | 'this-year';
}

export interface LogUserActivityPayload {
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
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

export const getUserActivityLogs = async (
  filters?: ActivityLogFilters,
): Promise<SessionEvent[]> => {
  const params = new URLSearchParams();
  if (filters?.limit !== undefined) params.append("limit", String(filters.limit));
  if (filters?.offset !== undefined) params.append("offset", String(filters.offset));
  if (filters?.event) params.append("event", filters.event);
  if (filters?.actionType) params.append("actionType", filters.actionType);
  if (filters?.resource) params.append("resource", filters.resource);
  if (filters?.sessionId) params.append("sessionId", filters.sessionId);
  if (filters?.userId) params.append("userId", filters.userId);
  if (filters?.dateFrom) params.append("dateFrom", filters.dateFrom);
  if (filters?.dateTo) params.append("dateTo", filters.dateTo);
  if (filters?.period) params.append("period", filters.period);

  const url = `/api/user-activity${params.toString() ? `?${params.toString()}` : ""}`;
  const response = await fetchWithAuth(url, { skipActivityLog: true });

  if (!response.ok) throw new Error("Failed to fetch activity logs");
  return response.json();
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
  data: LogUserActivityPayload,
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
    const data = JSON.parse(event.data) as SessionEvent[];
    onMessage(data);
  };

  source.onerror = (err) => {
    console.error("SSE error:", err);
  };

  return source;
};

