import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ==================== TYPES ====================

export type ActivityEventType = "login" | "logout" | "action";

export type ActivityActionType =
  | "read"
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
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorText = await response
      .text()
      .catch(() => "Failed to log activity");
    throw new Error(errorText);
  }

  return response.json();
};

// ==================== DELETE / CLEAR ====================

export const deleteActivityHistory = async (): Promise<{ message: string }> => {
  const response = await fetchWithAuth("/api/user-activity", {
    method: "DELETE",
  });

  if (!response.ok) {
    const errorText = await response
      .text()
      .catch(() => "Failed to clear activity history");
    throw new Error(errorText);
  }

  return response.json();
};

// ==================== SOCKET.IO REAL-TIME =====================
//
// Replaces the old SSE subscribeToActivityStream.
// The Activity Browser context uses this to receive live activity:new events.
//
// Returns an unsubscribe function — call it in useEffect cleanup.
//
// Design note: we import socket.ts synchronously at the top of the module
// (via a top-level import below) so the socket ref captured inside
// subscribeToActivityStream is available immediately and the cleanup
// function can call socket.off() without a second dynamic import whose
// Promise might resolve after the component has already unmounted.

import {
  connectSocket,
  getSocket,
  disconnectSocket as _disconnectSocket,
} from "@/lib/socket";

export { _disconnectSocket as disconnectSocket };

export function subscribeToActivityStream(
  onEvent: (event: SessionEvent) => void,
  onConnect?: () => void,
  onDisconnect?: (reason: string) => void,
): () => void {
  // connectSocket() is idempotent — returns the existing socket if already
  // connected, so calling it here is safe even when called multiple times.
  const socket = connectSocket();

  if (!socket) {
    // No JWT/token yet; skip subscription safely.
    return () => {};
  }

  socket.on("activity:new", onEvent);
  if (onConnect) socket.on("connect", onConnect);
  if (onDisconnect) socket.on("disconnect", onDisconnect);

  // Capture the exact socket instance so the cleanup always targets the right
  // object — even if connectSocket() later returns a different instance after
  // a logout/reconnect cycle.
  return () => {
    socket.off("activity:new", onEvent);
    if (onConnect) socket.off("connect", onConnect);
    if (onDisconnect) socket.off("disconnect", onDisconnect);
  };
}
