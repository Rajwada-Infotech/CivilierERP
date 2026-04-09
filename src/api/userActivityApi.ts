import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ==================== TYPES ====================

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

// ==================== HELPERS ====================

const buildQuery = (params: Record<string, any>) => {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  });

  return searchParams.toString();
};

// ==================== MAIN ====================

export const getUserActivityLogs = async (
  params: {
    page?: number;
    limit?: number;
    search?: string;
    event?: string;
    role?: string;
    sort?: string;
    order?: "asc" | "desc";
    dateFrom?: string;
    dateTo?: string;
    period?: ActivityLogFilters["period"];
  } = {},
): Promise<PaginatedActivity> => {
  const query = buildQuery(params);
  const url = `/api/user-activity${query ? `?${query}` : ""}`;

  const response = await fetchWithAuth(url);
  if (!response.ok) throw new Error("Failed to fetch activity logs");

  return response.json();
};

// ==================== LEGACY ====================

export const getUserActivityLogsLegacy = async (
  filters?: ActivityLogFilters,
): Promise<SessionEvent[]> => {
  const query = buildQuery(filters || {});
  const url = `/api/user-activity${query ? `?${query}` : ""}`;

  const response = await fetchWithAuth(url, { skipActivityLog: true });
  if (!response.ok) throw new Error("Failed to fetch activity logs");

  return response.json();
};

// ==================== SESSION ====================

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

// ==================== LOGGING ====================

export const logUserActivity = async (
  data: Omit<SessionEvent, "id">,
): Promise<{ message: string }> => {
  const response = await fetchWithAuth("/api/user-activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
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

// ==================== SSE ====================

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

  source.addEventListener("ping", () => {
    console.log("SSE ping received");
  });

  source.onerror = (err) => {
    console.error("SSE connection error:", err);
  };

  return source;
};
