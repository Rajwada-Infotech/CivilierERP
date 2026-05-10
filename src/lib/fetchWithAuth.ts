import { apiUrl } from "./apiBase";
import { toast } from "sonner";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let isRedirectingToLogin = false;

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
      localStorage.removeItem("token");
      localStorage.removeItem("user");

      if (!isRedirectingToLogin) {
        isRedirectingToLogin = true;
        toast.error("Session expired. Please login again.");
        window.location.href = "/login";
      }
    }

    throw new ApiError("Unauthorized. Please login again.", response.status);
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

