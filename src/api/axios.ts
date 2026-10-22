import axios from "axios";
import { getToken } from "../utils/tokenStorage";
import { activityHeaders } from "@/lib/fetchWithAuth";

// Use relative /api path — the Vite dev proxy forwards to localhost:5000
// and production nginx rewrites /api → backend. Never rely on VITE_API_URL.
const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  Object.assign(config.headers, activityHeaders());
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const isLoginRoute = error.config?.url?.includes("/users/login");
    const isUsersListRoute = error.config?.url === "/users";
    // Only auto-redirect on 401 for authenticated routes — never for the login call itself — and only
    // when the token the request carried is still this tab's session and the server confirms it is
    // dead (a stray 401 from before a fresh login must not sign the new session out).
    if (error.response?.status === 401 && !isLoginRoute && !isUsersListRoute) {
      const sent = String(error.config?.headers?.Authorization || "").replace(/^Bearer /, "");
      if (sent && getToken() === sent) {
        const check = await fetch("/api/user-rights/my", { headers: { Authorization: `Bearer ${sent}` } }).catch(() => null);
        if (check?.status === 401 && getToken() === sent) {
          sessionStorage.removeItem("token");
          sessionStorage.removeItem("user");
          window.location.href = "/login";
        }
      }
    }
    return Promise.reject(error);
  },
);

export default api;