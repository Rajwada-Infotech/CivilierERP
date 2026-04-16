import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";

import { loginUser, getUsers } from "../api/userApi";

import type {
  UserRole,
  PageKey,
  PageAction,
  PagePermission,
  AppUser,
} from "./types";

import * as AuthUtils from "./auth.utils";

// Re-exports
export { PAGE_DEFINITIONS } from "@/constants/pageDefinitions";
export type { PageKey, PageAction, PagePermission, AppUser };

// ── TYPES ─────────────────────────────────────────────────────────────────────
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
  ) => Promise<void>;
  canAccessPage: (page: PageKey) => boolean;
  canDoAction: (page: PageKey, action: PageAction) => boolean;
}

// ── CONTEXT ───────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
};

// ── PROVIDER ──────────────────────────────────────────────────────────────────
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

  // FIX: actually fetch users from the backend instead of setUsers([])
  useEffect(() => {
    if (!currentUser) return;

    const token = localStorage.getItem("token");
    if (!token) return;

    getUsers()
      .then((rawUsers) => {
        const mapped: AppUser[] = rawUsers.map((u: any) => ({
          id: String(u.id),
          name: u.name,
          email: u.email,
          role: u.role as UserRole,
          initials: AuthUtils.getInitials(u.name),
          // FIX: use persisted permissions from DB, fall back to role defaults
          pagePermissions:
            Array.isArray(u.pagePermissions) && u.pagePermissions.length > 0
              ? u.pagePermissions
              : AuthUtils.getPermissionsByRole(u.role as UserRole),
          isActive: !u.discontinue,
        }));
        setUsers(mapped);
      })
      .catch((err) => {
        console.warn("Failed to load users:", err);
      });
  }, [currentUser]);

  // ── LOGIN ──────────────────────────────────────────────────────────────────
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
          role: (user.roleName || user.role || user.Role || user.role_id || 'user')?.toString().trim().toLowerCase() || 'user',
          initials: AuthUtils.getInitials(user.name),
          // FIX: use pagePermissions from login response (now sent by backend)
          pagePermissions:
            Array.isArray(user.pagePermissions) &&
            user.pagePermissions.length > 0
              ? user.pagePermissions
              : AuthUtils.getPermissionsByRole(user.role as UserRole),
          isActive: !user.discontinue,
        };
        console.log('🔍 AUTH DEBUG - Backend role:', user.roleName || user.role, '→ Frontend role:', appUser.role);

        localStorage.setItem("user", JSON.stringify(appUser));
        setCurrentUser(appUser);

        try {
          await recordLogin?.({
            id: appUser.id,
            name: appUser.name,
            email: appUser.email,
            role: appUser.role,
          });
        } catch (err) {
          console.warn("Login tracking failed:", err);
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

  // ── LOGOUT ─────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    if (currentUser) {
      try {
        await recordLogout?.({
          id: currentUser.id,
          name: currentUser.name,
          email: currentUser.email,
          role: currentUser.role,
        });
      } catch (err) {
        console.warn("Logout tracking failed:", err);
      }
      onLogoutSuccess?.(currentUser);
    }

    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("currentSessionId");
    setCurrentUser(null);
    setUsers([]);
  }, [currentUser, onLogoutSuccess, recordLogout]);

  // ── USER MANAGEMENT ────────────────────────────────────────────────────────
  const addUser = useCallback(
    (newUser: Omit<AppUser, "id"> & { password: string }) => {
      const userToAdd: AppUser = {
        ...newUser,
        id: `user_${Date.now()}`,
        initials: AuthUtils.getInitials(newUser.name),
        pagePermissions:
          newUser.pagePermissions ||
          AuthUtils.getPermissionsByRole(newUser.role),
        isActive: true,
      };
      setUsers((prev) => [...prev, userToAdd]);
    },
    [],
  );

  const deleteUser = useCallback((id: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }, []);

  const toggleUserStatus = useCallback((id: string) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === id ? { ...u, isActive: !u.isActive } : u)),
    );
  }, []);

  // FIX: now async — calls PATCH /api/users/:id/permissions to persist to DB
  // then updates local state so the UI reflects immediately without a refetch
  const updateUserPagePermissions = useCallback(
    async (userId: string, permissions: PagePermission[]) => {
      const token = localStorage.getItem("token");

      try {
        const res = await fetch(`/api/users/${userId}/permissions`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token ?? ""}`,
          },
          body: JSON.stringify({ pagePermissions: permissions }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to update permissions");
        }
      } catch (err) {
        console.error("updateUserPagePermissions:", err);
        throw err; // re-throw so the calling component can show a toast.error
      }

      // Update local state optimistically (after confirmed server success)
      setUsers((prev) =>
        prev.map((user) =>
          user.id === userId ? { ...user, pagePermissions: permissions } : user,
        ),
      );

      // If the currently logged-in user's own permissions were changed,
      // update their session too
      if (currentUser?.id === userId) {
        const updatedUser = { ...currentUser, pagePermissions: permissions };
        setCurrentUser(updatedUser);
        localStorage.setItem("user", JSON.stringify(updatedUser));
      }
    },
    [currentUser],
  );

  // ── PERMISSIONS ────────────────────────────────────────────────────────────
  const { canAccessPage: rawAccess, canDoAction: rawAction } =
    AuthUtils.createPermissionCheckers(currentUser);

  const canAccessPage = useCallback(
    (page: PageKey) => rawAccess(page),
    [rawAccess],
  );

  const canDoAction = useCallback(
    (page: PageKey, action: PageAction) => rawAction(page, action),
    [rawAction],
  );

  // ── CONTEXT VALUE ──────────────────────────────────────────────────────────
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
