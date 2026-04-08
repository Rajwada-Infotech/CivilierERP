import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { loginUser } from "../api/userApi";
import { useActivityBrowser } from "../contexts/ActivityBrowserContext";
import type { UserRole, PageKey, PageAction, PagePermission, AppUser } from "./types";
import * as AuthUtils from "./auth.utils";

export { PAGE_DEFINITIONS } from "@/constants/pageDefinitions";
export type { PageKey, PageAction };

interface AuthContextType {
  currentUser: AppUser | null;
  allUsers: AppUser[];
  allAdmins: AppUser[];
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string; role?: UserRole }>;
  logout: () => Promise<void>;
  addUser: (user: Omit<AppUser, "id"> & { password: string }) => void;
  deleteUser: (id: string) => void;
  toggleUserStatus: (id: string) => void;
  updateUserPagePermissions: (userId: string, permissions: PagePermission[]) => void;
  canAccessPage: (page: PageKey) => boolean;
  canDoAction: (page: PageKey, action: PageAction) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};

export const AuthProvider = ({
  children,
  onLoginSuccess,
  onLogoutSuccess,
}: {
  children: React.ReactNode;
  onLoginSuccess?: (user: AppUser) => void;
  onLogoutSuccess?: (user: AppUser) => void;
}) => {
  const { recordLogin, recordLogout } = useActivityBrowser();

  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => {
    try {
      const stored = localStorage.getItem("user");
      return stored ? JSON.parse(stored) : null;
    } catch {
      localStorage.removeItem("user");
      return null;
    }
  });

  const [users, setUsers] = useState<AppUser[]>([]);

  useEffect(() => {
    // TODO: Replace with real API later
    setUsers([]);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const data = await loginUser(email, password);
      if (!data.success) return { success: false, error: "Invalid credentials" };

      const { token, user } = data;
      localStorage.setItem("token", token);

      const appUser: AppUser = {
        id: String(user.id),
        name: user.name,
        email: user.email,
        role: user.role as UserRole,
        initials: AuthUtils.getInitials(user.name),
        pagePermissions: AuthUtils.getPermissionsByRole(user.role as UserRole),
        isActive: !user.discontinue,
      };

      localStorage.setItem("user", JSON.stringify(appUser));
      setCurrentUser(appUser);

      // Record login activity
      try {
        await recordLogin({
          id: appUser.id,
          name: appUser.name,
          email: appUser.email,
          role: appUser.role,
        });
      } catch (logErr) {
        console.warn("Login tracking failed:", logErr);
      }

      onLoginSuccess?.(appUser);
      return { success: true, role: appUser.role };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : "Login failed" };
    }
  }, [onLoginSuccess, recordLogin]);

  const logout = useCallback(async () => {
    if (currentUser) {
      try {
        await recordLogout({
          id: currentUser.id,
          name: currentUser.name,
          email: currentUser.email,
          role: currentUser.role,
        });
      } catch (logErr) {
        console.warn("Logout tracking failed:", logErr);
      }
      onLogoutSuccess?.(currentUser);
    }

    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("currentSessionId");
    setCurrentUser(null);
  }, [currentUser, onLogoutSuccess, recordLogout]);

  const updateUserPagePermissions = useCallback((userId: string, permissions: PagePermission[]) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, pagePermissions: permissions } : u));
    if (currentUser && currentUser.id === userId) {
      const updated = { ...currentUser, pagePermissions: permissions };
      setCurrentUser(updated);
      localStorage.setItem("user", JSON.stringify(updated));
    }
  }, [currentUser]);

  const toggleUserStatus = useCallback((id: string) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, isActive: !u.isActive } : u));
  }, []);

  const deleteUser = useCallback((id: string) => {
    setUsers(prev => prev.filter(u => u.id !== id));
  }, []);

  const addUser = useCallback(() => {
    console.warn("addUser: Implement API call");
  }, []);

  const { canAccessPage: rawCanAccessPage, canDoAction: rawCanDoAction } = AuthUtils.createPermissionCheckers(currentUser);

  const value = useMemo(() => ({
    currentUser,
    allUsers: users,
    allAdmins: users.filter(u => AuthUtils.isPrivilegedRole(u.role)),
    login,
    logout,
    addUser,
    deleteUser,
    toggleUserStatus,
    updateUserPagePermissions,
    canAccessPage: (page: PageKey) => rawCanAccessPage(page),
    canDoAction: (page: PageKey, action: PageAction) => rawCanDoAction(page, action),
  }), [currentUser, users, login, logout, addUser, deleteUser, toggleUserStatus, updateUserPagePermissions, rawCanAccessPage, rawCanDoAction]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};