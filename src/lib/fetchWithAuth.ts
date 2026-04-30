import { apiUrl } from "./apiBase";

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

    const hasToken =
      typeof window !== "undefined" && !!localStorage.getItem("token");

    if (!hasToken && typeof window !== "undefined") {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.history.pushState(null, "", "/login");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }

    throw new Error("Unauthorized. Please login again.");
  }

  if (response.status === 403) {
    console.error("Forbidden");
    throw new Error("You do not have permission to perform this action.");
  }

  return response;
}
