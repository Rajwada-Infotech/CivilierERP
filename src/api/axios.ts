import axios from "axios";
import { getToken } from "../utils/auth";

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
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginRoute = error.config?.url?.includes("/users/login");
    // Only auto-redirect on 401 for authenticated routes — never for the login call itself
    if (error.response?.status === 401 && !isLoginRoute) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default api;
