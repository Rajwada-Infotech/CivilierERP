const rawApiBase = import.meta.env.VITE_API_URL || "/api";

export const API_BASE_URL = rawApiBase.replace(/\/+$/, "") || "/api";

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;

  if (path === "/api") return API_BASE_URL;
  if (path.startsWith("/api/")) return `${API_BASE_URL}${path.slice(4)}`;
  if (path.startsWith("/")) return `${API_BASE_URL}${path}`;

  return `${API_BASE_URL}/${path}`;
}
