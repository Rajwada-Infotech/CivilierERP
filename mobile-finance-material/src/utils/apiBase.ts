// Mirrors src/lib/apiBase.ts on the web app, but RN has no dev-server proxy
// for "/api" — every request needs a fully-qualified backend URL. Set
// EXPO_PUBLIC_API_URL in .env (Expo inlines EXPO_PUBLIC_* vars at build time,
// no extra package needed) — e.g. http://192.168.0.x:5000 for a phone on the
// same LAN as your dev machine, or the deployed backend URL for other builds.
const rawApiBase = process.env.EXPO_PUBLIC_API_URL || "http://localhost:5000";

export const API_BASE_URL = rawApiBase.replace(/\/+$/, "");

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/")) return `${API_BASE_URL}${path}`;
  return `${API_BASE_URL}/${path}`;
}
