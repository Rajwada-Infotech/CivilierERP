// src/lib/fetchWithAuth.ts

export async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  let response: Response;

  try {
    response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (err: any) {
    console.error("Network error:", err);
    throw new Error("Network error. Please check your connection.");
  }

  if (response.status === 401) {
    console.error("Unauthorized", url);

    // Only redirect to /login when there is genuinely no token (true session
    // expiry). A 401 with a token present means the endpoint has a permission
    // restriction for this role — redirect would silently log the user out.
    // Callers handle permission-401s via their own error handling.
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
