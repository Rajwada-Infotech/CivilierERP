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

// Re-export everything needed by WidgetsRights component
export { PAGE_DEFINITIONS } from "@/constants/pageDefinitions";
export type { PageKey, PageAction, PagePermission, AppUser };

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
  updateUserPagePermissions: (
    userId: string,
    permissions: PagePermission[],
  ) => void;
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
  recordLogin,
  recordLogout,
}: {
  children: React.ReactNode;
  onLoginSuccess?: (user: AppUser) => void;
  onLogoutSuccess?: (user: AppUser) => void;
  recordLogin?: (user: {
    id: string;
    name: string;
    email: string;
    role: string;
  }) => Promise<void>;
  recordLogout?: (user: {
    id: string;
    name: string;
    email: string;
    role: string;
  }) => Promise<void>;
}) => {
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
    // TODO: Replace with real API call later
    const dummyUsers: AppUser[] = [];
    setUsers(dummyUsers);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      try {
        const data = await loginUser(email, password);
        if (!data.success) {
          return { success: false, error: "Invalid credentials" };
        }

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

        try {
          await recordLogin?.({
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
        const errorMessage =
          err instanceof Error ? err.message : "Login failed";
        return { success: false, error: errorMessage };
      }
    },
    [onLoginSuccess, recordLogin],
  );

  const logout = useCallback(async () => {
    if (currentUser) {
      try {
        await recordLogout?.({
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

  const updateUserPagePermissions = useCallback(
    (userId: string, permissions: PagePermission[]) => {
      setUsers((prevUsers) =>
        prevUsers.map((user) =>
          user.id === userId ? { ...user, pagePermissions: permissions } : user,
        ),
      );

      if (currentUser && currentUser.id === userId) {
        const updatedUser = { ...currentUser, pagePermissions: permissions };
        setCurrentUser(updatedUser);
        localStorage.setItem("user", JSON.stringify(updatedUser));
      }
    },
    [currentUser],
  );

  const toggleUserStatus = useCallback((id: string) => {
    setUsers((prev) =>
      prev.map((user) =>
        user.id === id ? { ...user, isActive: !user.isActive } : user,
      ),
    );
  }, []);

  const deleteUser = useCallback((id: string) => {
    setUsers((prev) => prev.filter((user) => user.id !== id));
  }, []);

  const addUser = useCallback(() => {
    console.warn("addUser: Implement API call");
  }, []);

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
      updateUserPagePermissions,
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
      updateUserPagePermissions,
      canAccessPage,
      canDoAction,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
