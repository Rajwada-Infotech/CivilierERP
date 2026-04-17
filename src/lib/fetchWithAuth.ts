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
    console.error("Unauthorized");

    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      // Use pushState + popstate instead of window.location.href to avoid a
      // full page reload. A hard reload remounts every context provider, which
      // fires all queries again before auth settles → infinite 401 loop.
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
