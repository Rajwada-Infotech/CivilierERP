import { apiUrl } from "./apiBase";
import { toast } from "sonner";

// Module-level flag: once we have decided to redirect to /login, every
// subsequent 401 from concurrent in-flight requests is a no-op.
// A plain module boolean is simpler than sessionStorage and cannot be
// accidentally cleared by other code during this page-load.
let _redirectingToLogin = false;

export async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

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
    // Only the first 401 in a given session triggers cleanup + redirect.
    // Every concurrent request that also gets a 401 (the "storm" in the logs)
    // simply returns a never-resolving promise so the caller is silently
    // abandoned — no toast spam, no extra navigation pushes, no React
    // remount loops.
    if (_redirectingToLogin) {
      return new Promise<Response>(() => {}); // intentionally never resolves
    }

    _redirectingToLogin = true;

    if (typeof window !== "undefined") {
      toast.error("Session expired. Please login again.");
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      // Hard navigation so React Router guards re-run from scratch.
      window.location.href = "/login";
    }

    return new Promise<Response>(() => {}); // caller abandoned; navigation takes over
  }

  if (response.status === 403) {
    console.error("Forbidden");
    throw new Error("You do not have permission to perform this action.");
  }

  return response;
}
