// Sign-in for the Employee Portal App. Uses the existing CivilierERP login (POST /api/users/login) with
// portal "employee": the backend refuses staff, supplier and customer accounts on this page, so only an
// Employee Portal login gets a token. The token and the user are kept in SecureStore; a 401 anywhere signs out.
import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from "react";
import { fetchWithAuth, ApiError } from "@/services/fetchWithAuth";
import { endAppSession, startAppSession } from "@/services/appSession";
import { queryClient } from "@/services/queryClient";
import { onSessionExpired } from "@/services/sessionEvents";
import { stopMovementTracking } from "@/services/movementTracker";
import { getToken, setToken, getStoredUser, setStoredUser, clearAuthStorage } from "@/services/authStorage";
import type { AppUser, LoginResponse } from "@/types/auth";

interface AuthContextValue {
  currentUser: AppUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const getInitials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

export function AuthProvider({ children }: PropsWithChildren) {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [token, user] = await Promise.all([getToken(), getStoredUser<AppUser>()]);
      if (token && user) setCurrentUser(user);
      setIsLoading(false);
    })();
  }, []);

  useEffect(() => onSessionExpired(() => setCurrentUser(null)), []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetchWithAuth("/api/users/login", {
      method: "POST",
      body: JSON.stringify({ email, password, portal: "employee" }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || body.message || "Login failed. Please check your credentials.");
    const data = body as LoginResponse;
    queryClient.clear();
    const user: AppUser = {
      id: String(data.user.id),
      name: data.user.name,
      email: data.user.email,
      role: data.user.role,
      initials: getInitials(data.user.name),
    };
    await Promise.all([setToken(data.token), setStoredUser(user)]);
    const sessionId = startAppSession();
    void fetchWithAuth("/api/user-activity", {
      method: "POST",
      body: JSON.stringify({ event: "login", sessionId, userId: user.id, userName: user.name, userEmail: user.email, userRole: user.role }),
      skipActivityLog: true,
    }).catch(() => {});
    setCurrentUser(user);
  }, []);

  const logout = useCallback(async () => {
    await stopMovementTracking();
    await clearAuthStorage();
    endAppSession();
    queryClient.clear();
    setCurrentUser(null);
  }, []);

  return <AuthContext.Provider value={{ currentUser, isLoading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { ApiError };
