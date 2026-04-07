import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { loginUser } from "../api/userApi";

import type {
  UserRole,
  PageKey,
  PageAction,
  PagePermission,
  AppUser,
} from "./types";
import * as AuthUtils from "./auth.utils";

// NOTE: useActivityBrowser is NOT imported here.
// Activity logging is handled by AuthSessionBridge in App.tsx which passes
// recordLogin/recordLogout as onLoginSuccess/onLogoutSuccess props — keeping
// the hook call at the correct component level.

/* =========================
   CONTEXT TYPE
========================= */
interface AuthContextType {
  currentUser: AppUser | null;
  allUsers: AppUser[];
  allAdmins: AppUser[];
  login: (
    email: string,
    password: string,
  ) => Promise<{ success: boolean; error?: string; role?: UserRole }>;
  logout: () => void;
  addUser: (user: Omit<AppUser, "id"> & { password: string }) => void;
  deleteUser: (id: string) => void;
  toggleUserStatus: (id: string) => void;
  canAccessPage: (page: PageKey) => boolean;
  canDoAction: (page: PageKey, action: PageAction) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside provider");
  return ctx;
};

/* =========================
   PROVIDER
========================= */
export const AuthProvider = ({
  children,
  onLoginSuccess,
  onLogoutSuccess,
}: {
  children: React.ReactNode;
  onLoginSuccess?: (user: AppUser) => void;
  onLogoutSuccess?: (user: AppUser) => void;
}) => {
  console.log("AuthProvider mounted");

  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => {
    try {
      const stored = localStorage.getItem("user");
      return stored ? JSON.parse(stored) : null;
    } catch (err) {
      console.error("User parse error:", err);
      localStorage.removeItem("user");
      return null;
    }
  });

  const [users, setUsers] = useState<AppUser[]>([]);

  useEffect(() => {
    const validateToken = () => {
      try {
        const token = localStorage.getItem("token");
        if (!token) return;
        const parts = token.split(".");
        if (parts.length !== 3) {
          localStorage.clear();
          return;
        }
        const payload = JSON.parse(atob(parts[1]));
        if (!payload?.exp || payload.exp * 1000 < Date.now()) {
          localStorage.clear();
        }
      } catch (err) {
        console.error("Safe token check failed:", err);
        localStorage.clear();
      }
    };
    validateToken();
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      try {
        const data = await loginUser(email, password);
        if (!data.success)
          return { success: false, error: "Invalid credentials" };

        const { token, user } = data;
        localStorage.setItem("token", token);

        const appUser: AppUser = {
          id: String(user.id),
          name: user.name,
          email: user.email,
          role: user.role as UserRole,
          initials: AuthUtils.getInitials(user.name),
          pagePermissions: AuthUtils.getPermissionsByRole(
            user.role as UserRole,
          ),
          isActive: !user.discontinue,
        };

        localStorage.setItem("user", JSON.stringify(appUser));
        setCurrentUser(appUser);

        // FIX: removed illegal hook call `useActivityBrowser()` that was here.
        // Activity logging is delegated to onLoginSuccess (called by AuthSessionBridge).
        onLoginSuccess?.(appUser);
        return { success: true, role: appUser.role };
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Login failed. Check credentials.";
        return { success: false, error: errorMessage };
      }
    },
    [onLoginSuccess],
  );

  const logout = useCallback(() => {
    if (currentUser) onLogoutSuccess?.(currentUser);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setCurrentUser(null);
  }, [currentUser, onLogoutSuccess]);

  const { canAccessPage: rawCanAccessPage, canDoAction: rawCanDoAction } =
    AuthUtils.createPermissionCheckers(currentUser);

  const canAccessPage = useCallback(
    (page: PageKey) => rawCanAccessPage(page),
    [rawCanAccessPage],
  );
  const canDoAction = useCallback(
    (page: PageKey, action: PageAction) => rawCanDoAction(page, action),
    [rawCanDoAction],
  );

  const addUser = useCallback(
    () => console.warn("addUser: Use backend API"),
    [],
  );
  const deleteUser = useCallback(
    () => console.warn("deleteUser: Use backend API"),
    [],
  );
  const toggleUserStatus = useCallback(
    () => console.warn("toggleUserStatus: Use backend API"),
    [],
  );

  const value = useMemo(
    () => ({
      currentUser,
      allUsers: users,
      allAdmins: users.filter((u) => AuthUtils.isPrivilegedRole(u.role)),
      login,
      logout,
      addUser,
      deleteUser,
      toggleUserStatus,
      canAccessPage,
      canDoAction,
    }),
    [
      currentUser,
      users,
      login,
      logout,
      addUser,
      deleteUser,
      toggleUserStatus,
      canAccessPage,
      canDoAction,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
