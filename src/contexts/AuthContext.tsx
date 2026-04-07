import React, { createContext, useContext, useState, useCallback } from "react";
import { loginUser } from "../api/userApi";

export type UserRole = "super_admin" | "admin" | "user" | "dba";

/* =========================
   PAGE KEYS
========================= */
export type PageKey =
  | "dashboard"
  | "transactions"
  | "reports"
  | "widgets"
  | "tasks"
  | "payments"
  | "master_contractors"
  | "master_suppliers"
  | "master_customers"
  | "master_banks"
  | "master_expenses"
  | "master_items"
  | "master_item_groups"
  | "master_hsn"
  | "admin_menu_rights"
  | "admin_widgets_rights"
  | "admin_fin_year_rights"
  | "admin_approval_setup"
  | "admin_post_approval_rights";

/* =========================
   ACTIONS
========================= */
export type PageAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "print"
  | "preview"
  | "export"
  | "approve"
  | "reject";

export interface PagePermission {
  page: PageKey;
  actions: PageAction[];
}

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  initials: string;
  pagePermissions: PagePermission[];
  isActive: boolean;
}

/* =========================
   PAGE DEFINITIONS
========================= */
export const PAGE_DEFINITIONS = [
  {
    key: "dashboard",
    label: "Dashboard",
    path: "/",
    group: "Main",
    availableActions: ["view", "print", "export"],
  },
  {
    key: "transactions",
    label: "Transactions",
    path: "/transactions",
    group: "Main",
    availableActions: [
      "view", "create", "edit", "delete", "print", "export", "approve", "reject",
    ],
  },
  {
    key: "reports",
    label: "Reports",
    path: "/reports",
    group: "Main",
    availableActions: ["view", "print", "preview", "export"],
  },
  {
    key: "widgets",
    label: "Widgets",
    path: "/widgets",
    group: "Main",
    availableActions: ["view", "print", "export"],
  },
  {
    key: "tasks",
    label: "Tasks",
    path: "/tasks",
    group: "Main",
    availableActions: ["view", "create", "edit", "delete", "print"],
  },
  {
    key: "payments",
    label: "Payments",
    path: "/payments",
    group: "Main",
    availableActions: ["view", "create", "edit", "delete", "print", "export"],
  },
  {
    key: "master_contractors",
    label: "Contractors",
    path: "/masters/contractors",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete", "print", "export"],
  },
  {
    key: "master_suppliers",
    label: "Suppliers",
    path: "/masters/suppliers",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete", "print", "export"],
  },
  {
    key: "master_customers",
    label: "Customers",
    path: "/masters/customers",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete", "print", "export"],
  },
  {
    key: "master_banks",
    label: "Banks",
    path: "/masters/banks",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete", "print", "export"],
  },
  {
    key: "master_expenses",
    label: "Expenses",
    path: "/masters/expenses",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete", "print", "export"],
  },
  {
    key: "master_items",
    label: "Items",
    path: "/masters/items",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete", "print", "export"],
  },
  {
    key: "master_item_groups",
    label: "Item Groups",
    path: "/masters/item-groups",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete"],
  },
  {
    key: "master_hsn",
    label: "HSN",
    path: "/masters/hsn",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete", "print", "export"],
  },
  {
    key: "admin_menu_rights",
    label: "Menu Rights",
    path: "/admin/rights/menu",
    group: "Admin",
    availableActions: ["view", "create", "edit", "delete"],
  },
  {
    key: "admin_widgets_rights",
    label: "Widgets Rights",
    path: "/admin/rights/widgets",
    group: "Admin",
    availableActions: ["view", "create", "edit", "delete"],
  },
  {
    key: "admin_fin_year_rights",
    label: "Fin Year",
    path: "/admin/rights/fin-year",
    group: "Admin",
    availableActions: ["view", "create", "edit", "delete"],
  },
  {
    key: "admin_approval_setup",
    label: "Approval Setup",
    path: "/admin/approval/setup",
    group: "Admin",
    availableActions: ["view", "create", "edit", "delete"],
  },
  {
    key: "admin_post_approval_rights",
    label: "Post Approval",
    path: "/admin/approval/post-rights",
    group: "Admin",
    availableActions: ["view", "create", "edit", "delete", "approve", "reject"],
  },
];

/* =========================
   ACCESS HELPERS
========================= */
const FULL_ACCESS: PagePermission[] = PAGE_DEFINITIONS.map((p) => ({
  page: p.key as PageKey,
  actions: [...p.availableActions] as PageAction[],
}));

const DEFAULT_USER_ACCESS: PagePermission[] = [
  { page: "dashboard", actions: ["view"] },
  { page: "reports", actions: ["view"] },
];

const getPermissionsByRole = (role: UserRole): PagePermission[] => {
  if (["super_admin", "admin", "dba"].includes(role)) return FULL_ACCESS;
  return DEFAULT_USER_ACCESS;
};

const getInitials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

/* =========================
   CONTEXT TYPE
========================= */
interface AuthContextType {
  currentUser: AppUser | null;
  allUsers: AppUser[];
  allAdmins: AppUser[];
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string; role?: UserRole }>;
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
  // Restore user from localStorage on refresh
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => {
    const stored = localStorage.getItem("user");
    return stored ? JSON.parse(stored) : null;
  });

  const [users, setUsers] = useState<AppUser[]>([]);

  // Token expiry validation
  useEffect(() => {
    const token = localStorage.getItem("token");

    if (!token) return;

    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (payload.exp * 1000 < Date.now()) {
        logout();
      }
    } catch {
      logout();
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      try {
        const data = await loginUser(email, password);

        if (!data.success) {
          return { success: false, error: "Invalid credentials" };
        }

        const { token, user } = data;

        // Save token
        localStorage.setItem("token", token);

        // Build AppUser from backend response
        const appUser: AppUser = {
          id: String(user.id),
          name: user.name,
          email: user.email,
          role: user.role as UserRole,
          initials: getInitials(user.name),
          pagePermissions: getPermissionsByRole(user.role as UserRole),
          isActive: !user.discontinue,
        };

        localStorage.setItem("user", JSON.stringify(appUser));
        setCurrentUser(appUser);
        onLoginSuccess?.(appUser);

        return { success: true, role: appUser.role };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || "Login failed. Check credentials.",
        };
      }
    },
    [onLoginSuccess]
  );

  const logout = () => {
    if (currentUser) onLogoutSuccess?.(currentUser);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setCurrentUser(null);
  };

  const ADMIN_ONLY_PAGES: PageKey[] = [
    "admin_menu_rights",
    "admin_widgets_rights",
    "admin_fin_year_rights",
    "admin_approval_setup",
    "admin_post_approval_rights",
  ];

  const isPrivilegedRole = (role: string) =>
    ["super_admin", "admin", "dba"].includes(role);

  const canAccessPage = (page: PageKey) => {
    if (!currentUser) return false;
    if (isPrivilegedRole(currentUser.role)) return true;
    if (ADMIN_ONLY_PAGES.includes(page)) return false;
    return currentUser.pagePermissions.some(
      (p) => p.page === page && p.actions.includes("view")
    );
  };

  const canDoAction = (page: PageKey, action: PageAction) => {
    if (!currentUser) return false;
    if (isPrivilegedRole(currentUser.role)) return true;
    if (ADMIN_ONLY_PAGES.includes(page)) return false;
    return currentUser.pagePermissions.some(
      (p) => p.page === page && p.actions.includes(action)
    );
  };

  const addUser = (user: any) => {
    setUsers((prev) => [
      ...prev,
      {
        ...user,
        id: `u-${Date.now()}`,
        pagePermissions: user.pagePermissions?.length
          ? user.pagePermissions
          : DEFAULT_USER_ACCESS,
      },
    ]);
  };

  const deleteUser = (id: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== id));
  };

  const toggleUserStatus = (id: string) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === id ? { ...u, isActive: !u.isActive } : u))
    );
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        allUsers: users,
        allAdmins: users.filter((u) => u.role === "admin"),
        login,
        logout,
        addUser,
        deleteUser,
        toggleUserStatus,
        canAccessPage,
        canDoAction,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};