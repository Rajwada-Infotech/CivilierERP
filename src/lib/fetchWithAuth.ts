export const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem("token");

  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });

  // Rate limit handling (respect Retry-After if present)
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    if (retryAfter) {
      const delay = parseInt(retryAfter) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    // Re-throw for React Query to handle (no retry due to global config)
  }

  if (res.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/login";
    return res;
  }

  return res;
};
