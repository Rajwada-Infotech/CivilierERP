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

    // Skip 'api' prefix if present
    const startIndex = parts[0] === "api" ? 1 : 0;

    // Get the main resource (e.g., 'employees', 'expenses', 'masters')
    let resource = parts[startIndex] || "general";

    // Handle hyphenated resources by converting to readable format
    // e.g., "tds-masters" -> "TDS Masters", "user-activity" -> "User Activity"
    resource = resource
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");

    return resource;
  } catch {
    return "General";
  }
}

async function logAction(method: string, url: string) {
  try {
    const user = getStoredUser();
    if (!user.id) {
      console.debug("No user ID found, skipping activity log");
      return;
    }

    // Don't log activity for user-activity or login endpoints to avoid recursion
    if (url.includes("/user-activity") || url.includes("/login")) {
      return;
    }

    await logUserActivity({
      userId: user.id,
      userName: user.name || "",
      userEmail: user.email || "",
      userRole: user.role || "",
      event: "action",
      timestamp: new Date().toISOString(),
      actionType: ACTION_MAP[method] || "read",
      resource: extractResource(url),
      requestMethod: method,
      requestUrl: url,
      sessionId: localStorage.getItem("currentSessionId") || undefined,
      deviceFingerprint:
        localStorage.getItem("deviceFingerprint_v1") || undefined,
    });
  } catch (error) {
    // Don't throw - activity logging is non-critical
    // Failures here shouldn't break the user's actual request
    console.debug("Activity logging failed (non-critical):", error);
  }
}

export const fetchWithAuth = async (
  url: string,
  options: FetchWithAuthOptions = {},
): Promise<Response> => {
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

  // Original logging logic kept
  if (!skipActivityLog && response.ok) {
    void logAction(method, url);
  }

  // Added rate limit handling from dev (no breaking)
  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) {
      const delay = parseInt(retryAfter, 10) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Original 401 handling kept
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

  try {
    await logUserActivity({
      userId: user.id,
      userName: user.name || "",
      userEmail: user.email || "",
      userRole: user.role || "",
      event: "action",
      actionType,
      resource,
      details,
      sessionId: localStorage.getItem("currentSessionId") || undefined,
      deviceFingerprint:
        localStorage.getItem("deviceFingerprint_v1") || undefined,
    });
  } catch (error) {
    console.debug("Custom action logging failed:", error);
  }
};
