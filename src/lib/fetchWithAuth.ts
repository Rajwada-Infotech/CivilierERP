import { apiUrl } from "./apiBase";
import { toast } from "sonner";

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
    console.error("Unauthorized", url);

    // Always force re-auth on 401.
    // This avoids “silent broken UI” when callers don't catch the thrown error.
    if (typeof window !== "undefined") {
      // Anti-spam: avoid repeating the toast multiple times during the same re-auth flow.
      const flagKey = "__reauth_toast_until";
      const now = Date.now();
      const until = Number(sessionStorage.getItem(flagKey) || 0);
      const shouldToast = now >= until;

      if (shouldToast) {
        sessionStorage.setItem(flagKey, String(now + 5000));
        toast.error("Session expired. Please login again.");
      }

      localStorage.removeItem("token");
      localStorage.removeItem("user");

      // Prefer a hard navigation so React Router + guards re-run reliably.
      window.location.href = "/login";
    }

    throw new Error("Unauthorized. Please login again.");
  }

  if (response.status === 403) {
    console.error("Forbidden");
    throw new Error("You do not have permission to perform this action.");
  }

  return response;
}

