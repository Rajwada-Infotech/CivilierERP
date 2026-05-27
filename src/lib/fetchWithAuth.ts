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

  try {
    response = await fetch(apiUrl(url), {
      ...fetchOptions,
      headers: {
        "Content-Type": "application/json",
        ...(fetchOptions.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // Forward the skip flag as a header so server middleware can honour it.
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
      toast.error("Session expired. Please login again.");
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

  return response;
}