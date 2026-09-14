import { apiUrl } from "./apiBase";
import { toast } from "sonner";

// Exported so callers can distinguish auth/permission errors from network errors.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Extended options understood by fetchWithAuth itself.
// All standard RequestInit fields are still forwarded to fetch().
export interface FetchWithAuthOptions extends RequestInit {
  // When true, the request must not trigger activity logging on the server
  // or the client. Used by the activity-log read routes to prevent infinite
  // self-logging loops. fetchWithAuth forwards an X-Skip-Activity-Log header
  // so future server-side middleware can also honour the flag.
  skipActivityLog?: boolean;
}

// Dedup key in sessionStorage — survives Vite HMR module re-evaluation
// (unlike a plain `let`), is cleared when the tab closes, and is not
// shared across tabs.
const REDIRECTING_KEY = "__auth_redirecting";

// ── Mutation activity logging ───────────────────────────────────────────────
// The Activity Browser previously only ever logged page navigations (GET,
// actionType "read" — see AppLayout.tsx's useModuleActivityLogger), because
// nothing hooked into actual data-changing requests. Every write in the app
// already flows through this one function, so logging it here covers every
// page automatically instead of needing a manual call added to each of the
// ~150 mutating call sites individually.
const MUTATION_ACTION_TYPE: Record<string, "create" | "update" | "delete"> = {
  POST: "create",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
};

function getStoredUserForLogging(): { id?: string; name?: string; email?: string; role?: string } {
  try {
    return JSON.parse(localStorage.getItem("user") || "{}");
  } catch {
    return {};
  }
}

// Fire-and-forget — a logging failure must never affect the actual request.
// Uses a raw fetch() rather than calling fetchWithAuth recursively.
function logMutationActivity(method: string, url: string) {
  if (typeof window === "undefined") return;
  const actionType = MUTATION_ACTION_TYPE[method.toUpperCase()];
  if (!actionType) return;

  const user = getStoredUserForLogging();
  if (!user?.id) return;

  let sessionId = localStorage.getItem("currentSessionId");
  if (!sessionId) {
    sessionId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("currentSessionId", sessionId);
    localStorage.setItem("sessionLoginTime", String(Date.now()));
  }

  const token = localStorage.getItem("token");
  fetch(apiUrl("/api/user-activity"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Skip-Activity-Log": "1",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      userId: user.id,
      userName: user.name || "",
      userEmail: user.email || "",
      userRole: user.role || "",
      event: "action",
      timestamp: new Date().toISOString(),
      actionType,
      resource: url,
      details: `${method.toUpperCase()} ${url} (from ${window.location.pathname})`,
      requestMethod: method.toUpperCase(),
      requestUrl: url,
      sessionId,
    }),
  }).catch(() => {});
}

export async function fetchWithAuth(
  url: string,
  options: FetchWithAuthOptions = {},
): Promise<Response> {
  // Pull out our custom flag before spreading into fetch() — fetch does not
  // accept unknown options and would silently drop it, so we strip it here.
  const { skipActivityLog, ...fetchOptions } = options;

  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  // Short-circuit immediately if a redirect is already in flight.
  if (
    typeof window !== "undefined" &&
    sessionStorage.getItem(REDIRECTING_KEY)
  ) {
    if (token) {
      sessionStorage.removeItem(REDIRECTING_KEY);
    } else {
      throw new ApiError("Authentication redirect in progress.", 401);
    }
  }

  let response: Response;

  // Do not force Content-Type when the body is FormData — the browser must set
  // it automatically so it can include the correct multipart boundary string.
  const isFormData = fetchOptions.body instanceof FormData;

  try {
    response = await fetch(apiUrl(url), {
      ...fetchOptions,
      headers: {
        ...(!isFormData ? { "Content-Type": "application/json" } : {}),
        ...(fetchOptions.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(skipActivityLog ? { "X-Skip-Activity-Log": "1" } : {}),
      },
    });
  } catch (err: unknown) {
    // Re-throw AbortError unchanged so callers that check err.name === "AbortError"
    // (e.g. useEffect cleanup) can detect it and skip error handling silently.
    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }
    // Suppress console spam for connection refused / backend not running.
    // The hook / component that calls fetchWithAuth is responsible for
    // showing the user a meaningful error if needed.
    const msg = err instanceof Error ? err.message : "";
    const isConnRefused =
      msg.includes("Failed to fetch") ||
      msg.includes("ERR_CONNECTION_REFUSED") ||
      msg.includes("Network request failed");
    if (!isConnRefused) {
      console.error("Network error:", err);
    }
    throw new Error("Network error. Please check your connection.");
  }

  if (response.status === 401) {
    if (
      typeof window !== "undefined" &&
      !sessionStorage.getItem(REDIRECTING_KEY)
    ) {
      sessionStorage.setItem(REDIRECTING_KEY, "1");
      // The account may have been deleted/discontinued while the user was
      // still signed in (see backend/middleware/auth.js's USER_REVOKED
      // check) — distinguish that from a plain expired token so the person
      // isn't left thinking they just need to log back in as normal.
      let message = "Session expired. Please login again.";
      try {
        const body = await response.clone().json();
        if (body?.code === "USER_REVOKED") {
          message = "Your access has been revoked. Please log in again.";
        }
      } catch {
        // Non-JSON or empty body — fall back to the generic message.
      }
      toast.error(message);
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    throw new ApiError("Session expired. Please login again.", response.status);
  }

  if (response.status === 403) {
    console.error("Forbidden");
    throw new ApiError(
      "You do not have permission to perform this action.",
      response.status,
    );
  }

  if (
    !skipActivityLog &&
    response.ok &&
    url !== "/api/user-activity"
  ) {
    logMutationActivity(fetchOptions.method || "GET", url);
  }

  return response;
}
