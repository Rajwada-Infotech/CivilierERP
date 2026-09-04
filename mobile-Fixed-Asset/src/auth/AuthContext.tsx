// RN port of src/contexts/AuthContext.tsx (web), trimmed to what a mobile
// client actually needs: login, logout, currentUser, permission checks.
// Profile-editing / avatar / admin-user-management pieces stay on web only.
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
  // onAuthenticated fires the instant credentials are verified — before
  // currentUser is set — so a caller (LoginScreen) can show its own
  // "welcome" moment while RootNavigator is still on the auth stack.
  // login() itself doesn't resolve (and RootNavigator doesn't swap to
  // MainStack) until navHoldMs later, matching the web app's own
  // setTimeout(..., 1800) between a successful SupplierLogin and its
  // navigate() call — here the "navigate" is just React state.
  login: (
    email: string,
    password: string,
    onAuthenticated?: (user: AppUser) => void,
    navHoldMs?: number,
  ) => Promise<void>;
  logout: () => Promise<void>;
  canAccessPage: (page: PageKey) => boolean;
  canDoAction: (page: PageKey, action: PageAction) => boolean;
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

  const login = useCallback(
    async (
      email: string,
      password: string,
      onAuthenticated?: (user: AppUser) => void,
      navHoldMs = 0,
    ) => {
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
      onAuthenticated?.(user);
      if (navHoldMs > 0) await new Promise((r) => setTimeout(r, navHoldMs));
      setCurrentUser(user);
    },
    [],
  );

  const logout = useCallback(async () => {
    await clearAuthStorage();
    queryClient.clear();
    setCurrentUser(null);
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { ApiError };
