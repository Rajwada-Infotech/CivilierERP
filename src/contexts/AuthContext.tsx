import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import { loginUser } from "../api/authApi";
import { getUsers } from "../api/userApi";

import type {
  UserRole,
  PageKey,
  PageAction,
  PagePermission,
  AppUser,
} from "./types";

import * as AuthUtils from "./auth.utils";
import { connectSocket, disconnectSocket, getSocket } from "@/lib/socket";

// Re-exports
export { PAGE_DEFINITIONS } from "@/contexts/auth.utils";
export type { PageKey, PageAction, PagePermission, AppUser };

// ── TYPES ─────────────────────────────────────────────────────────────────────
interface AuthContextType {
  currentUser: AppUser | null;
  allUsers: AppUser[];
  allAdmins: AppUser[];
  login: (
    email: string,
    password: string,
  ) => Promise<{
    success: boolean;
    error?: string;
    role?: UserRole;
    userId?: string;
    name?: string;
  }>;
  logout: () => void;
  addUser: (user: Omit<AppUser, "id"> & { password: string }) => void;
  deleteUser: (id: string) => Promise<void>;
  toggleUserStatus: (id: string) => Promise<void>;
  updateUserPagePermissions: (
    userId: string,
    permissions: PagePermission[],
  ) => Promise<void>;
  canAccessPage: (page: PageKey) => boolean;
  canDoAction: (page: PageKey, action: PageAction) => boolean;
  updateCurrentUserName: (name: string) => void;
  updateCurrentUserAvatar: (avatarUrl: string | null) => void;
  updateCurrentUserShowLoginReminders: (showLoginReminders: boolean) => void;
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
      parsed.can_accept_tickets = !!parsed.can_accept_tickets;
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

    // Use currentUser.id as the dep so a new object reference from an avatar
    // patch doesn't re-fetch the full user list unnecessarily.
    getUsers()
      .then((rawUsers) => {
        const mapped: AppUser[] = rawUsers.map((u: any) => ({
          id: String(u.id),
          name: u.name,
          email: u.email,
          role: u.role as UserRole,
          initials: AuthUtils.getInitials(u.name),
          can_accept_tickets: !!u.can_accept_tickets,
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
  }, [currentUser?.id, currentUser?.role]);

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
      .then((r) => (r.ok ? r.json().catch(() => ({})) : null))
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

  // ── KEEP RIGHTS IN SYNC (instant push + periodic fallback) ────────────────
  // When an admin changes a user's rights via MenuRights (or a role's rights
  // via Role Master), the backend permission cache is busted immediately, but
  // the user's active browser session still holds the old pagePermissions in
  // state/localStorage until this refetches them. The backend emits a
  // "permissions:updated" socket event to the affected user's room (and to
  // every user sharing an edited role's room) the instant a save happens —
  // see routes/roles.js, routes/userRights.js, routes/users.js — so this
  // normally fires within a second of the admin clicking Save. The 5-minute
  // poll is kept as a fallback for the rare case the socket connection is
  // down, so rights sync eventually even then, without ever requiring a
  // forced re-login.
  useEffect(() => {
    const PRIVILEGED = ["super_admin", "admin", "dba"];
    if (!currentUser?.id || PRIVILEGED.includes(currentUser.role)) return;

    const fetchRights = () => {
      const token = localStorage.getItem("token");
      if (!token) return;
      fetch("/api/user-rights/my", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json().catch(() => ({})) : null))
        .then((result) => {
          if (!result?.rightsJson || !Array.isArray(result.rightsJson)) return;
          setCurrentUser((prev) => {
            if (!prev) return prev;
            const updated = { ...prev, pagePermissions: result.rightsJson };
            localStorage.setItem("user", JSON.stringify(updated));
            return updated;
          });
        })
        .catch(() => {});
    };

    const socket = connectSocket() ?? getSocket();
    socket?.on("permissions:updated", fetchRights);

    const interval = setInterval(fetchRights, 5 * 60 * 1000);
    return () => {
      clearInterval(interval);
      socket?.off("permissions:updated", fetchRights);
    };
  }, [currentUser?.id, currentUser?.role]);

  const queryClient = useQueryClient();

  const login = useCallback(async (email: string, password: string) => {
    try {
      const data = await loginUser(email, password);

      // A new identity is signing in — any react-query cache from a
      // previous session (e.g. a different supplier/customer on a shared
      // browser tab) must not leak into this one. Query keys like
      // "supplier-profile" aren't scoped by user id, so without this a
      // second supplier logging in on the same tab would see the first
      // supplier's cached name/data until every query happened to refetch.
      queryClient.clear();

      const userWithInitials = {
        ...data.user,
        id: String(data.user.id),
        initials: AuthUtils.getInitials(data.user.name),
        can_accept_tickets: !!data.user.can_accept_tickets,
        // Use DB-stored permissions for 'user' role; fall back to role-based defaults
        // for privileged roles (super_admin / admin / dba) which always get FULL_ACCESS.
        pagePermissions:
          !["super_admin", "admin", "dba"].includes(data.user.role) &&
          Array.isArray(data.user.pagePermissions) &&
          data.user.pagePermissions.length > 0
            ? data.user.pagePermissions
            : AuthUtils.getPermissionsByRole(data.user.role),
        isActive: true,
      };

      sessionStorage.removeItem("__auth_redirecting");
      // One-shot flag consumed by LoginRemindersPopup — marks that this is a
      // fresh login (not a page refresh within an existing session), so the
      // reminders popup shows once per login rather than once per page load.
      sessionStorage.setItem("__just_logged_in", "1");
      // JWT is stored in localStorage, so it is XSS-accessible. This is an
      // accepted SPA tradeoff here, mitigated by short token TTL, Redis
      // blacklist on logout, and brute-force lockout on auth routes. Revisit if
      // httpOnly cookies or SSR become viable for this app.
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(userWithInitials));

      // Connect the socket with the freshly-issued token so it authenticates
      // immediately rather than waiting for the lazy connectSocket() call inside
      // subscribeToActivityStream (which would use the token from mount time).
      connectSocket();

      // Fetch fresh permissions from DB for non-privileged roles.
      // Awaited so the user session has correct rights before the redirect.
      if (!["super_admin", "admin", "dba"].includes(data.user.role)) {
        try {
          const rightsRes = await fetch("/api/user-rights/my", {
            headers: { Authorization: `Bearer ${data.token}` },
          });
          const rightsData = rightsRes.ok ? await rightsRes.json() : null;
          if (
            rightsData?.rightsJson &&
            Array.isArray(rightsData.rightsJson) &&
            rightsData.rightsJson.length > 0
          ) {
            const updated = {
              ...userWithInitials,
              pagePermissions: rightsData.rightsJson,
            };
            localStorage.setItem("user", JSON.stringify(updated));
            setCurrentUser(updated);
          } else {
            setCurrentUser(userWithInitials);
          }
        } catch {
          // Network error — fall back to JWT-embedded permissions
          setCurrentUser(userWithInitials);
        }
      } else {
        setCurrentUser(userWithInitials);
      }

      // Fire-and-forget: log the login event to UserActivityLog.
      // Must run after setCurrentUser so the token is in localStorage.
      Promise.resolve(
        recordLogin?.({
          id: String(data.user.id),
          name: data.user.name,
          email: data.user.email,
          role: data.user.role,
        }),
      ).catch(() => {});

      return {
        success: true,
        role: data.user.role,
        userId: String(data.user.id),
        name: data.user.name,
      };
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
  }, [queryClient]);

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
    sessionStorage.removeItem("__auth_redirecting");
    // Tear down the socket *after* clearing the token so no further
    // authenticated requests can be made over the old connection.
    disconnectSocket();
    setCurrentUser(null);
    setUsers([]);
    queryClient.clear();
  }, [currentUser, onLogoutSuccess, recordLogout, queryClient]);

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

  const deleteUser = useCallback(async (id: string) => {
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete user");
      }
    } catch (err) {
      console.error("deleteUser:", err);
      throw err;
    }
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }, []);

  const toggleUserStatus = useCallback(
    async (id: string) => {
      const token = localStorage.getItem("token");
      // Find current state first so we can send the correct value
      const user = users.find((u) => u.id === id);
      if (!user) return;
      const newDiscontinue = user.isActive ? 1 : 0; // isActive true → discontinue=1 (deactivate)
      try {
        const res = await fetch(`/api/users/${id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token ?? ""}`,
          },
          body: JSON.stringify({ discontinue: newDiscontinue }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to toggle user status");
        }
      } catch (err) {
        console.error("toggleUserStatus:", err);
        throw err;
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === id ? { ...u, isActive: !u.isActive } : u)),
      );
    },
    [users],
  );

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

  const updateCurrentUserShowLoginReminders = useCallback((showLoginReminders: boolean) => {
    setCurrentUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, showLoginReminders };
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
      updateCurrentUserShowLoginReminders,
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
      updateCurrentUserShowLoginReminders,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
