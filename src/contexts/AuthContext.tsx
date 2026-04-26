import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";

import { loginUser } from "../api/auth";
import { getUsers } from "../api/userApi";

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
  updateCurrentUserName: (name: string) => void;
  updateCurrentUserAvatar: (avatarUrl: string | null) => void;
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
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      // Patch stale sessions missing required fields (pre-fix logins)
      if (!parsed.pagePermissions || !Array.isArray(parsed.pagePermissions)) {
        parsed.pagePermissions = AuthUtils.getPermissionsByRole(
          parsed.role as UserRole,
        );
      }
      if (!parsed.initials)
        parsed.initials = AuthUtils.getInitials(parsed.name ?? "");
      if (typeof parsed.isActive === "undefined") parsed.isActive = true;
      parsed.id = String(parsed.id);
      return parsed;
    } catch {
      localStorage.removeItem("user");
      return null;
    }
  });

  const [users, setUsers] = useState<AppUser[]>([]);

  // Fetch users from backend — only for privileged roles that have CanView on Users
  useEffect(() => {
    if (!currentUser) return;
    const privilegedRoles = ["super_admin", "admin", "dba"];
    if (!privilegedRoles.includes(currentUser.role)) return;

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

  // ── HYDRATE AVATAR ─────────────────────────────────────────────────────────
  // After login or page reload, fetch avatar_url from the profile API and
  // patch it into currentUser so the navbar shows it immediately.
  useEffect(() => {
    if (!currentUser?.id) return;
    // Skip if we already have it (e.g. after updateCurrentUserAvatar was called)
    if (currentUser.avatarUrl !== undefined) return;

    const token = localStorage.getItem("token");
    if (!token) return;

    fetch(`/api/user-profile/${currentUser.id}/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const avatarUrl = data.avatar_url ?? null;
        setCurrentUser((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, avatarUrl };
          localStorage.setItem("user", JSON.stringify(updated));
          return updated;
        });
      })
      .catch(() => {
        /* silently ignore — avatar is cosmetic */
      });
  }, [currentUser?.id]);
  const login = useCallback(async (email: string, password: string) => {
    try {
      const data = await loginUser(email, password);

      const userWithInitials = {
        ...data.user,
        id: String(data.user.id),
        initials: AuthUtils.getInitials(data.user.name),
        // Use DB-stored permissions for 'user' role; fall back to role-based defaults
        // for privileged roles (super_admin / admin / dba) which always get FULL_ACCESS.
        pagePermissions:
          data.user.role === "user" &&
          Array.isArray(data.user.pagePermissions) &&
          data.user.pagePermissions.length > 0
            ? data.user.pagePermissions
            : AuthUtils.getPermissionsByRole(data.user.role),
        isActive: true,
      };

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(userWithInitials));

      setCurrentUser(userWithInitials);

      return { success: true, role: data.user.role };
    } catch (err: any) {
      return {
        success: false,
        error:
          err.response?.data?.error ||
          err.response?.data?.message ||
          err.message ||
          "Login failed. Please check your credentials.",
      };
    }
  }, []);

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
    localStorage.removeItem("activeModule");
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

  // Update user page permissions - persist to DB then local state
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
        throw err;
      }

      // Update local state
      setUsers((prev) =>
        prev.map((user) =>
          user.id === userId ? { ...user, pagePermissions: permissions } : user,
        ),
      );

      // Update current session if self
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

  const updateCurrentUserName = useCallback((name: string) => {
    setCurrentUser((prev) => {
      if (!prev) return prev;
      const updated = {
        ...prev,
        name,
        initials: AuthUtils.getInitials(name),
      };
      localStorage.setItem("user", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateCurrentUserAvatar = useCallback((avatarUrl: string | null) => {
    setCurrentUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, avatarUrl };
      localStorage.setItem("user", JSON.stringify(updated));
      return updated;
    });
  }, []);

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
      updateCurrentUserName,
      updateCurrentUserAvatar,
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
      updateCurrentUserName,
      updateCurrentUserAvatar,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
