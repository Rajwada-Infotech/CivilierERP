import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from "react";

export type UserRole = "super_admin" | "admin" | "user";

// Every controllable page in the app
export type PageKey =
  | "dashboard"
  | "transactions"
  | "reports"
  | "widgets"
  | "master_contractors"
  | "master_suppliers"
  | "master_customers"
  | "master_banks"
  | "master_expenses"
  | "setup_account_groups"
  | "setup_account_heads"
  | "tasks";

// Actions available per page
export type PageAction = "view" | "create" | "edit" | "delete";

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
  createdBy?: string;
}

// Page metadata for display
export const PAGE_DEFINITIONS: {
  key: PageKey;
  label: string;
  path: string;
  group: string;
  availableActions: PageAction[];
}[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    path: "/",
    group: "Main",
    availableActions: ["view"],
  },
  {
    key: "transactions",
    label: "Transactions",
    path: "/transactions",
    group: "Main",
    availableActions: ["view", "create", "edit", "delete"],
  },
  {
    key: "reports",
    label: "Reports",
    path: "/reports",
    group: "Main",
    availableActions: ["view"],
  },
  {
    key: "widgets",
    label: "Widgets",
    path: "/widgets",
    group: "Main",
    availableActions: ["view"],
  },
  {
    key: "master_contractors",
    label: "Contractor Master",
    path: "/masters/contractors",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete"],
  },
  {
    key: "master_suppliers",
    label: "Supplier Master",
    path: "/masters/suppliers",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete"],
  },
  {
    key: "master_customers",
    label: "Customer Master",
    path: "/masters/customers",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete"],
  },
  {
    key: "master_banks",
    label: "Bank Master",
    path: "/masters/banks",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete"],
  },
  {
    key: "master_expenses",
    label: "Expenses Master",
    path: "/masters/expenses",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete"],
  },
  {
    key: "setup_account_groups",
    label: "Account Groups",
    path: "/setup/account-groups",
    group: "Setup",
    availableActions: ["view", "create", "edit", "delete"],
  },
  {
    key: "setup_account_heads",
    label: "Account Heads",
    path: "/setup/account-heads",
    group: "Setup",
    availableActions: ["view", "create", "edit", "delete"],
  },
  {
    key: "tasks",
    label: "Tasks",
    path: "/tasks",
    group: "Main",
    availableActions: ["view", "create", "edit", "delete"],
  },
];

// Full access helper
const FULL_ACCESS: PagePermission[] = PAGE_DEFINITIONS.map((p) => ({
  page: p.key,
  actions: [...p.availableActions],
}));

// Default new user gets view-only on dashboard + reports
const DEFAULT_USER_ACCESS: PagePermission[] = [
  { page: "dashboard", actions: ["view"] },
  { page: "reports", actions: ["view"] },
];

export const DEMO_USERS: (AppUser & { password: string })[] = [
  {
    id: "u-super-1",
    name: "Super Admin",
    email: "superadmin@civilier.com",
    password: "super123",
    role: "super_admin",
    initials: "SA",
    pagePermissions: FULL_ACCESS,
    isActive: true,
  },
  {
    id: "u-admin-1",
    name: "Admin User",
    email: "admin@civilier.com",
    password: "admin123",
    role: "admin",
    initials: "AU",
    pagePermissions: FULL_ACCESS,
    isActive: true,
  },
  {
    id: "u-user-1",
    name: "Rajesh Kumar",
    email: "rajesh@civilier.com",
    password: "user123",
    role: "user",
    initials: "RK",
    pagePermissions: [
      { page: "dashboard", actions: ["view"] },
      { page: "transactions", actions: ["view", "create"] },
      { page: "reports", actions: ["view"] },
      { page: "master_contractors", actions: ["view"] },
      { page: "tasks", actions: ["view", "create", "edit"] },
    ],
    isActive: true,
  },
  {
    id: "u-user-2",
    name: "Meena Patel",
    email: "meena@civilier.com",
    password: "user123",
    role: "user",
    initials: "MP",
    pagePermissions: [{ page: "dashboard", actions: ["view"] }],
    isActive: true,
  },
  {
    id: "u-user-3",
    name: "Dinesh Rao",
    email: "dinesh@civilier.com",
    password: "user123",
    role: "user",
    initials: "DR",
    pagePermissions: [],
    isActive: false,
  },
];

interface AuthContextType {
  currentUser: AppUser | null;
  allUsers: AppUser[];
  allAdmins: AppUser[];
  login: (
    email: string,
    password: string,
  ) => { success: boolean; error?: string };
  logout: () => void;
  // Super Admin
  addAdmin: (
    admin: Omit<AppUser, "id" | "createdBy"> & { password: string },
  ) => void;
  deleteAdmin: (adminId: string) => void;
  toggleAdminStatus: (adminId: string) => void;
  // Admin
  updateUserPagePermissions: (
    userId: string,
    pagePermissions: PagePermission[],
  ) => void;
  toggleUserStatus: (userId: string) => void;
  addUser: (
    user: Omit<AppUser, "id" | "createdBy"> & { password: string },
  ) => void;
  deleteUser: (userId: string) => void;
  // Helpers
  canAccessPage: (page: PageKey) => boolean;
  canDoAction: (page: PageKey, action: PageAction) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [userStore, setUserStore] =
    useState<(AppUser & { password: string })[]>(DEMO_USERS);

  const allUsers = useMemo(
    () => userStore.filter((u) => u.role === "user"),
    [userStore],
  );
  const allAdmins = useMemo(
    () => userStore.filter((u) => u.role === "admin"),
    [userStore],
  );

  const login = useCallback(
    (email: string, password: string) => {
      const found = userStore.find(
        (u) =>
          u.email.toLowerCase() === email.toLowerCase() &&
          u.password === password,
      );
      if (!found)
        return { success: false, error: "Invalid email or password." };
      if (!found.isActive)
        return {
          success: false,
          error: "Your account has been deactivated. Contact an administrator.",
        };
      const { password: _pw, ...user } = found;
      setCurrentUser(user);
      return { success: true };
    },
    [userStore],
  );

  const logout = useCallback(() => setCurrentUser(null), []);

  const canAccessPage = useCallback(
    (page: PageKey) => {
      if (!currentUser) return false;
      if (currentUser.role === "super_admin" || currentUser.role === "admin")
        return true;
      return currentUser.pagePermissions.some(
        (p) => p.page === page && p.actions.includes("view"),
      );
    },
    [currentUser],
  );

  const canDoAction = useCallback(
    (page: PageKey, action: PageAction) => {
      if (!currentUser) return false;
      if (currentUser.role === "super_admin" || currentUser.role === "admin")
        return true;
      return currentUser.pagePermissions.some(
        (p) => p.page === page && p.actions.includes(action),
      );
    },
    [currentUser],
  );

  const addAdmin = useCallback(
    (admin: Omit<AppUser, "id" | "createdBy"> & { password: string }) => {
      setUserStore((prev) => [
        ...prev,
        {
          ...admin,
          id: `u-admin-${Date.now()}`,
          role: "admin",
          createdBy: currentUser?.id,
        },
      ]);
    },
    [currentUser],
  );

  const deleteAdmin = useCallback((adminId: string) => {
    setUserStore((prev) => prev.filter((u) => u.id !== adminId));
  }, []);

  const toggleAdminStatus = useCallback((adminId: string) => {
    setUserStore((prev) =>
      prev.map((u) => (u.id === adminId ? { ...u, isActive: !u.isActive } : u)),
    );
  }, []);

  const updateUserPagePermissions = useCallback(
    (userId: string, pagePermissions: PagePermission[]) => {
      setUserStore((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, pagePermissions } : u)),
      );
    },
    [],
  );

  const toggleUserStatus = useCallback((userId: string) => {
    setUserStore((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, isActive: !u.isActive } : u)),
    );
  }, []);

  const addUser = useCallback(
    (user: Omit<AppUser, "id" | "createdBy"> & { password: string }) => {
      setUserStore((prev) => [
        ...prev,
        {
          ...user,
          id: `u-user-${Date.now()}`,
          role: "user",
          createdBy: currentUser?.id,
        },
      ]);
    },
    [currentUser],
  );

  const deleteUser = useCallback((userId: string) => {
    setUserStore((prev) => prev.filter((u) => u.id !== userId));
  }, []);

  const value = useMemo(
    () => ({
      currentUser,
      allUsers,
      allAdmins,
      login,
      logout,
      addAdmin,
      deleteAdmin,
      toggleAdminStatus,
      updateUserPagePermissions,
      toggleUserStatus,
      addUser,
      deleteUser,
      canAccessPage,
      canDoAction,
    }),
    [
      currentUser,
      allUsers,
      allAdmins,
      login,
      logout,
      addAdmin,
      deleteAdmin,
      toggleAdminStatus,
      updateUserPagePermissions,
      toggleUserStatus,
      addUser,
      deleteUser,
      canAccessPage,
      canDoAction,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
