// Civilier Home is for customers only: they sign in with their registered mobile number (backend/routes/crmPortal.js
// POST /login, its own accounts and token). Staff use the Civilier CRM app.
import { unregisterPushAsync } from "@/notifications/pushNotifications";
import { CUSTOMER_PUSH } from "@/api/customerPortalApi";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import { fetchWithAuth, ApiError } from "@/services/fetchWithAuth";
import { endAppSession } from "@/services/appSession";
import { queryClient } from "@/services/queryClient";
import { onSessionExpired } from "@/services/sessionEvents";
import {
  getToken,
  setToken as persistToken,
  getStoredUser,
  setStoredUser,
  clearAuthStorage,
} from "@/services/authStorage";
import type { AppUser } from "@/types/auth";

interface AuthContextValue {
  currentUser: AppUser | null;
  isLoading: boolean;
  // onAuthenticated fires the instant the credentials are verified — before currentUser is set — so LoginScreen can
  // show its own "welcome" moment while RootNavigator is still on the sign-in screen; the sign-in itself completes
  // navHoldMs later.
  loginCustomer: (
    mobile: string,
    password: string,
    onAuthenticated?: (user: AppUser) => void,
    navHoldMs?: number,
  ) => Promise<void>;
  /** After a customer sets their own password: the server ended every session, so they sign in again. */
  passwordChanged: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Up to two initials from a name ("Rahul Adhikari" → "RA"). */
export function getInitials(name: string): string {
  return name.split(" ").filter(Boolean).map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore the session on a cold start. A session that isn't a customer's (a staff sign-in from before Civilier
  // Home became customer-only) is cleared, so the app opens on the customer sign-in instead of a stranded session.
  useEffect(() => {
    (async () => {
      const [token, user] = await Promise.all([getToken(), getStoredUser<AppUser>()]);
      if (token && user?.kind === "customer") setCurrentUser(user);
      else if (token || user) await clearAuthStorage();
      setIsLoading(false);
    })();
  }, []);

  // fetchWithAuth emits this on any 401 — log the local session out so the navigator falls back to the sign-in.
  useEffect(() => onSessionExpired(() => setCurrentUser(null)), []);

  // Customers sign in with their registered mobile number (crmPortal.js POST /login).
  const loginCustomer = useCallback(
    async (
      mobile: string,
      password: string,
      onAuthenticated?: (user: AppUser) => void,
      navHoldMs = 0,
    ) => {
      const res = await fetchWithAuth("/api/crm-portal/login", {
        method: "POST",
        body: JSON.stringify({ mobile, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Login failed. Please check your mobile number and password.");
      queryClient.clear();
      await persistToken(body.token);
      // The customer's name and number come from their own record. Setting their own password is their choice
      // (Settings → Change password), never asked for here.
      let me: { Id?: number; Name?: string; Email?: string } = {};
      try {
        const meRes = await fetchWithAuth("/api/crm-portal/me");
        if (meRes.ok) me = await meRes.json();
      } catch { /* the name is shown from the mobile number until the next sign-in */ }
      const user: AppUser = {
        kind: "customer",
        id: String(me.Id ?? ""),
        name: me.Name || mobile,
        email: me.Email || "",
        initials: getInitials(me.Name || mobile),
      };
      await setStoredUser(user);
      onAuthenticated?.(user);
      if (navHoldMs > 0) await new Promise((r) => setTimeout(r, navHoldMs));
      setCurrentUser(user);
    },
    [],
  );

  const passwordChanged = useCallback(async () => {
    await clearAuthStorage();
    queryClient.clear();
    setCurrentUser(null);
  }, []);

  const logout = useCallback(async () => {
    // This phone stops getting their notifications, then the token ends on the server too (while it still works);
    // signing out on the phone always succeeds.
    await unregisterPushAsync(CUSTOMER_PUSH);
    await fetchWithAuth("/api/crm-portal/logout", { method: "POST" }).catch(() => {});
    await clearAuthStorage();
    endAppSession();
    queryClient.clear();
    setCurrentUser(null);
  }, []);

  const value: AuthContextValue = { currentUser, isLoading, loginCustomer, passwordChanged, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { ApiError };
