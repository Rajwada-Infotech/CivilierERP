import { apiUrl } from "./apiBase";
import { toast } from "sonner";
import { STABILISING_MESSAGE, isGatewayFailure } from "./gatewayFetch";

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
  // When true, the server leaves this request out of the Activity Browser (fetchWithAuth sends an
  // X-Skip-Activity-Log header that backend/middleware/activityAudit.js honours).
  skipActivityLog?: boolean;
}

// A 502 / 504 from the gateway during a deploy: the browser's fetch is already wrapped (see gatewayFetch.ts) so
// reads were retried and the "system is updating" banner is showing. If it is still down, fail with a plain
// sentence instead of handing back the gateway's error page.
export { STABILISING_MESSAGE };

// Dedup key in sessionStorage — survives Vite HMR module re-evaluation
// (unlike a plain `let`), is cleared when the tab closes, and is not
// shared across tabs.
const REDIRECTING_KEY = "__auth_redirecting";

// ── Activity logging ────────────────────────────────────────────────────────
// The server writes every successful write into the Activity Browser itself (backend/middleware/activityAudit.js),
// with the record it touched and the values submitted. The browser only says which page the write came from
// and which sign-in session it belongs to.
export function activityHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  let sessionId = sessionStorage.getItem("currentSessionId");
  if (!sessionId && sessionStorage.getItem("token")) {
    sessionId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem("currentSessionId", sessionId);
    sessionStorage.setItem("sessionLoginTime", String(Date.now()));
  }
  return {
    "X-Page": window.location.pathname,
    ...(sessionId ? { "X-Session-Id": sessionId } : {}),
  };
}

// True when `token` is still this tab's session and the server rejects it on a plain authenticated
// read as well. A network failure or any other answer leaves the user signed in.
async function sessionIsDead(token: string | null): Promise<boolean> {
  if (!token || sessionStorage.getItem("token") !== token) return false;
  try {
    const res = await fetch(apiUrl("/api/user-rights/my"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.status === 401 && sessionStorage.getItem("token") === token;
  } catch {
    return false;
  }
}

export async function fetchWithAuth(
  url: string,
  options: FetchWithAuthOptions = {},
): Promise<Response> {
  // Pull out our custom flag before spreading into fetch() — fetch does not
  // accept unknown options and would silently drop it, so we strip it here.
  const { skipActivityLog, ...fetchOptions } = options;

  const token =
    typeof window !== "undefined" ? sessionStorage.getItem("token") : null;

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

  const send = async (): Promise<Response> => {
  try {
    return await fetch(apiUrl(url), {
      ...fetchOptions,
      headers: {
        ...(!isFormData ? { "Content-Type": "application/json" } : {}),
        ...(fetchOptions.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...activityHeaders(),
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
  };

  response = await send();
  if (isGatewayFailure(response)) {
    throw new ApiError(STABILISING_MESSAGE, response.status);
  }

  if (response.status === 401) {
    // Sign out only when the session this request carried is the one still in use and the server
    // confirms it is dead. A 401 for a request sent before login (no token) or with a token since
    // replaced by a fresh login used to wipe the new session too, bouncing the user back to the login
    // page several times; a one-off 401 mid-entry no longer throws away their work either.
    if (
      typeof window !== "undefined" &&
      !sessionStorage.getItem(REDIRECTING_KEY) &&
      (await sessionIsDead(token))
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
      sessionStorage.removeItem("token");
      sessionStorage.removeItem("user");
      window.location.href = "/login";
    }
    throw new ApiError("Session expired. Please login again.", response.status);
  }

  if (response.status === 403) {
    console.error("Forbidden");
    // Most 403s name the reason ("You uploaded this document, so someone
    // else has to verify it", "You don't have access to this project") —
    // show it. A bare "Forbidden" / "Access denied" or no body keeps the
    // generic message.
    let reason = "";
    try {
      const body = await response.clone().json();
      if (typeof body?.error === "string") reason = body.error.trim();
      else if (typeof body?.message === "string") reason = body.message.trim();
    } catch {
      // Non-JSON or empty body — fall back to the generic message.
    }
    throw new ApiError(
      reason && !/^(forbidden|access denied)\.?$/i.test(reason)
        ? reason
        : "You do not have permission to perform this action.",
      response.status,
    );
  }

  return response;
}
