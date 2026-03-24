import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from "react";

export type UserRole = "super_admin" | "admin" | "user";

/* =========================
   PAGE KEYS (FIXED)
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
  createdBy?: string;
}

/* =========================
   PAGE DEFINITIONS
========================= */
export const PAGE_DEFINITIONS = [
  { key: "dashboard", label: "Dashboard", path: "/", group: "Main", availableActions: ["view", "print", "export"] },
  { key: "transactions", label: "Transactions", path: "/transactions", group: "Main", availableActions: ["view","create","edit","delete","print","export","approve","reject"] },
  { key: "reports", label: "Reports", path: "/reports", group: "Main", availableActions: ["view","print","preview","export"] },
  { key: "widgets", label: "Widgets", path: "/widgets", group: "Main", availableActions: ["view","print","export"] },
  { key: "tasks", label: "Tasks", path: "/tasks", group: "Main", availableActions: ["view","create","edit","delete","print"] },
  { key: "payments", label: "Payments", path: "/payments", group: "Main", availableActions: ["view","create","edit","delete","print","export"] },

  { key: "master_contractors", label: "Contractors", path: "/masters/contractors", group: "Masters", availableActions: ["view","create","edit","delete","print","export"] },
  { key: "master_suppliers", label: "Suppliers", path: "/masters/suppliers", group: "Masters", availableActions: ["view","create","edit","delete","print","export"] },
  { key: "master_customers", label: "Customers", path: "/masters/customers", group: "Masters", availableActions: ["view","create","edit","delete","print","export"] },
  { key: "master_banks", label: "Banks", path: "/masters/banks", group: "Masters", availableActions: ["view","create","edit","delete","print","export"] },
  { key: "master_expenses", label: "Expenses", path: "/masters/expenses", group: "Masters", availableActions: ["view","create","edit","delete","print","export"] },
  { key: "master_items", label: "Items", path: "/masters/items", group: "Masters", availableActions: ["view","create","edit","delete","print","export"] },
  { key: "master_item_groups", label: "Item Groups", path: "/masters/item-groups", group: "Masters", availableActions: ["view","create","edit","delete"] },

  { key: "admin_menu_rights", label: "Menu Rights", path: "/admin/rights/menu", group: "Admin", availableActions: ["view","create","edit","delete"] },
  { key: "admin_widgets_rights", label: "Widgets Rights", path: "/admin/rights/widgets", group: "Admin", availableActions: ["view","create","edit","delete"] },
  { key: "admin_fin_year_rights", label: "Fin Year", path: "/admin/rights/fin-year", group: "Admin", availableActions: ["view","create","edit","delete"] },
  { key: "admin_approval_setup", label: "Approval Setup", path: "/admin/approval/setup", group: "Admin", availableActions: ["view","create","edit","delete"] },
  { key: "admin_post_approval_rights", label: "Post Approval", path: "/admin/approval/post-rights", group: "Admin", availableActions: ["view","create","edit","delete","approve","reject"] },
];

/* =========================
   ACCESS HELPERS
========================= */
const FULL_ACCESS: PagePermission[] = PAGE_DEFINITIONS.map((p) => ({
  page: p.key as PageKey,
  actions: [...p.availableActions],
}));

const DEFAULT_USER_ACCESS: PagePermission[] = [
  { page: "dashboard", actions: ["view"] },
  { page: "reports", actions: ["view"] },
];

/* =========================
   DEMO USERS
========================= */
export const DEMO_USERS = [
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
];

/* =========================
   CONTEXT
========================= */
interface AuthContextType {
  currentUser: AppUser | null;
  allUsers: AppUser[];
  allAdmins: AppUser[];
  login: (email: string, password: string) => { success: boolean; error?: string };
  logout: () => void;

  addUser: (user: Omit<AppUser, "id"> & { password: string }) => void;
  deleteUser: (id: string) => void;

  canAccessPage: (page: PageKey) => boolean;
  canDoAction: (page: PageKey, action: PageAction) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside provider");
  return ctx;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [users, setUsers] = useState<any[]>(DEMO_USERS);

  const login = useCallback((email: string, password: string) => {
    const user = users.find(
      (u) =>
        u.email.toLowerCase() === email.toLowerCase() &&
        u.password === password
    );

    if (!user) return { success: false, error: "Invalid credentials" };
    if (!user.isActive) return { success: false, error: "User inactive" };

    const { password: _pw, ...safeUser } = user;
    setCurrentUser(safeUser);
    return { success: true };
  }, [users]);

  const logout = () => setCurrentUser(null);

  const canAccessPage = (page: PageKey) => {
    if (!currentUser) return false;
    if (["admin", "super_admin"].includes(currentUser.role)) return true;

    return currentUser.pagePermissions.some(
      (p) => p.page === page && p.actions.includes("view")
    );
  };

  const canDoAction = (page: PageKey, action: PageAction) => {
    if (!currentUser) return false;
    if (["admin", "super_admin"].includes(currentUser.role)) return true;

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
        canAccessPage,
        canDoAction,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};