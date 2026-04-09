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
  userEmail?: string;
  userRole?: string;
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
  actionType?: ActivityActionType;
  resource?: string;
  sessionId?: string;
  userId?: string;
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

export interface PaginatedActivity {
  data: SessionEvent[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

// ==================== MAIN API FUNCTIONS ====================

// Recommended - Paginated logs
export const getUserActivityLogs = async (
  params: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    dateFrom?: string;
    dateTo?: string;
    period?: ActivityLogFilters["period"];
  } = {},
): Promise<PaginatedActivity> => {
  const url = new URL("/api/user-activity", window.location.origin);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetchWithAuth(url.toString());
  if (!response.ok) throw new Error("Failed to fetch activity logs");
  return response.json();
};

// Legacy version (kept for compatibility)
export const getUserActivityLogsLegacy = async (
  filters?: ActivityLogFilters,
): Promise<SessionEvent[]> => {
  const params = new URLSearchParams();

  if (filters?.limit !== undefined)
    params.append("limit", String(filters.limit));
  if (filters?.offset !== undefined)
    params.append("offset", String(filters.offset));
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
  const response = await fetchWithAuth(
    `/api/user-activity/session/${sessionId}`,
    { skipActivityLog: true },
  );
  if (!response.ok) throw new Error("Failed to fetch session activity");
  return response.json();
};

// FIXED: logUserActivity - Prevents identity column error
export const logUserActivity = async (
  data: Omit<SessionEvent, "id">,
): Promise<{ message: string }> => {
  const response = await fetchWithAuth("/api/user-activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data), // Never send 'id'
    skipActivityLog: true,
  });

  if (!response.ok) {
    const errorText = await response
      .text()
      .catch(() => "Failed to log activity");
    throw new Error(errorText);
  }

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

  source.addEventListener("ping", () => console.log("SSE ping received"));

  source.onerror = (err) => {
    console.error("SSE connection error:", err);
  };

  return source;
};
