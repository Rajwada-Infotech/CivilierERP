import {
  type ActivityActionType,
  logUserActivity,
} from "@/api/userActivityApi";

export interface FetchWithAuthOptions extends RequestInit {
  skipActivityLog?: boolean;
}

const ACTION_MAP: Record<string, ActivityActionType> = {
  GET: "read",
  POST: "create",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
};

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "{}");
  } catch {
    return {};
  }
}

function extractResource(url: string) {
  try {
    const pathname = new URL(url, window.location.origin).pathname;
    const parts = pathname.split("/").filter(Boolean);
    return parts[1] || parts[0] || "unknown";
  } catch {
    return "unknown";
  }
}

async function logAction(method: string, url: string) {
  try {
    const user = getStoredUser();
    if (!user.id) return;

    if (url.includes("/user-activity") || url.includes("/login")) return;

    await logUserActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userRole: user.role,
      event: "action",
      actionType: ACTION_MAP[method] || "read",
      resource: extractResource(url),
      requestMethod: method,
      requestUrl: url,
      sessionId: localStorage.getItem("currentSessionId") || undefined,
      deviceFingerprint: localStorage.getItem("deviceFingerprint_v1") || undefined,
    });
  } catch (error) {
    console.debug("Action logging failed:", error);
  }
}

export const fetchWithAuth = async (
  url: string,
  options: FetchWithAuthOptions = {},
) => {
  const token = localStorage.getItem("token");
  const method = (options.method || "GET").toUpperCase();
  const { skipActivityLog, ...requestOptions } = options;

  const response = await fetch(url, {
    ...requestOptions,
    headers: {
      ...(requestOptions.headers || {}),
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });

  if (!skipActivityLog && response.ok && ![401, 403].includes(response.status)) {
    void logAction(method, url);
  }

  if (response.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("currentSessionId");
    window.location.href = "/login";
  }

  return response;
};

export const logCustomAction = async (
  actionType: ActivityActionType,
  resource: string,
  details?: string,
) => {
  const user = getStoredUser();
  if (!user.id) return;

  await logUserActivity({
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    userRole: user.role,
    event: "action",
    actionType,
    resource,
    details,
    sessionId: localStorage.getItem("currentSessionId") || undefined,
    deviceFingerprint: localStorage.getItem("deviceFingerprint_v1") || undefined,
  });
};
