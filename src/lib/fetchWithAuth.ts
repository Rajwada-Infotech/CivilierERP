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

// Dedup key in sessionStorage — survives Vite HMR module re-evaluation
// (unlike a plain `let`), is cleared when the tab closes, and is not
// shared across tabs.
const REDIRECTING_KEY = "__auth_redirecting";

export async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  // Short-circuit immediately if a redirect is already in flight.
  if (
    typeof window !== "undefined" &&
    sessionStorage.getItem(REDIRECTING_KEY)
  ) {
    return new Promise<Response>(() => {}); // intentionally never resolves
  }

  let response: Response;

  try {
    response = await fetch(apiUrl(url), {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (err: unknown) {
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
    // Never throw — return a hanging promise so every concurrent caller is
    // silently abandoned. Throwing here causes the 401 storm: callers catch,
    // set state, React re-renders, contexts remount, new requests fire.
    return new Promise<Response>(() => {}); // caller abandoned; navigation takes over
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
