// RN port of src/contexts/AuthContext.tsx (web), trimmed to what a mobile
// client actually needs: login, logout, currentUser, permission checks.
// Profile-editing / avatar / admin-user-management pieces stay on web only.
import { unregisterPushAsync } from "@/notifications/pushNotifications";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { fetchWithAuth, ApiError } from "@/services/fetchWithAuth";
import { endAppSession, startAppSession } from "@/services/appSession";
import { queryClient } from "@/services/queryClient";
import { onSessionExpired } from "@/services/sessionEvents";
import {
  getToken,
  setToken as persistToken,
  getStoredUser,
  setStoredUser,
  clearAuthStorage,
} from "@/services/authStorage";
import { createPermissionCheckers, getInitials } from "./permissions";
import type { AppUser, LoginResponse, PageAction, PageKey } from "@/types/auth";

interface AuthContextValue {
  currentUser: AppUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  canAccessPage: (page: PageKey) => boolean;
  canDoAction: (page: PageKey, action: PageAction) => boolean;
  /** Changes the signed-in user here and in storage (e.g. a name edited on the profile), without signing in again. */
  updateCurrentUser: (patch: Partial<AppUser>) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session on cold start.
  useEffect(() => {
    (async () => {
      const [token, user] = await Promise.all([getToken(), getStoredUser<AppUser>()]);
      if (token && user) setCurrentUser(user);
      setIsLoading(false);
    })();
  }, []);

  // fetchWithAuth emits this on any 401 — log the local session out so the
  // navigator falls back to the auth stack (see RootNavigator.tsx).
  useEffect(() => onSessionExpired(() => setCurrentUser(null)), []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetchWithAuth("/api/users/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || body.message || "Login failed. Please check your credentials.");
    }
    const data: LoginResponse = await res.json();

    queryClient.clear();

    const user: AppUser = {
      id: String(data.user.id),
      name: data.user.name,
      email: data.user.email,
      role: data.user.role,
      initials: getInitials(data.user.name),
      can_accept_tickets: !!data.user.can_accept_tickets,
      pagePermissions: data.user.pagePermissions ?? [],
      isActive: true,
    };

    await Promise.all([persistToken(data.token), setStoredUser(user)]);
    // A new session, and its sign-in on the Activity Browser — the web app logs the same from its login.
    const sessionId = startAppSession();
    void fetchWithAuth("/api/user-activity", {
      method: "POST",
      body: JSON.stringify({ event: "login", sessionId, userId: user.id, userName: user.name, userEmail: user.email, userRole: user.role }),
      skipActivityLog: true,
    }).catch(() => {});
    setCurrentUser(user);
  }, []);

  const logout = useCallback(async () => {
    await unregisterPushAsync(); // while the session token still exists
    await clearAuthStorage();
    endAppSession();
    queryClient.clear();
    setCurrentUser(null);
  }, []);

  const updateCurrentUser = useCallback((patch: Partial<AppUser>) => {
    setCurrentUser((u) => {
      if (!u) return u;
      const next = { ...u, ...patch, ...(patch.name ? { initials: getInitials(patch.name) } : {}) };
      void setStoredUser(next);
      return next;
    });
  }, []);

  const { canAccessPage: rawAccess, canDoAction: rawAction } = useMemo(
    () => createPermissionCheckers(currentUser),
    [currentUser],
  );

  const value: AuthContextValue = {
    currentUser,
    isLoading,
    login,
    logout,
    canAccessPage: rawAccess,
    canDoAction: rawAction,
    updateCurrentUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { ApiError };
