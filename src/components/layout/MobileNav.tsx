import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  BarChart3,
  CheckCircle2,
  Menu,
  X,
  Scale,
  ChevronDown,
  FileText,
  Palette,
  ShieldCheck,
  Receipt,
  Truck,
  Users,
  HardHat,
  Landmark,
  Package,
  Layers,
  Puzzle,
  Settings,
  LayoutGrid,
  LogOut,
  User,
  Crown,
} from "lucide-react";

import { useModule } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme, THEME_DOTS, Theme } from "@/contexts/ThemeContext";
import { useTask } from "@/contexts/TaskContext";

interface NavItemChild {
  label: string;
  path: string;
  icon?: React.ElementType;
}

interface NavItem {
  label: string;
  icon: React.ElementType;
  path?: string;
  children?: NavItemChild[];
  count?: number;
  disabled?: boolean;
}

const masterItems: NavItemChild[] = [
  { icon: Receipt, label: "Expenses", path: "/masters/expenses" },
  { icon: Truck, label: "Suppliers", path: "/masters/suppliers" },
  { icon: Users, label: "Customers", path: "/masters/customers" },
  { icon: HardHat, label: "Contractors", path: "/masters/contractors" },
  { icon: Landmark, label: "Banks", path: "/masters/banks" },
  { icon: Package, label: "Items", path: "/masters/items" },
  { icon: Layers, label: "Item Groups", path: "/masters/item-groups" },
];

// ADMIN MODULE mobile nav
// - "Dashboard" renamed to "Transaction"
// - "Transaction" group renamed to "Finance"
const ADMIN_NAV_ITEMS: NavItem[] = [
  { label: "Transaction", icon: BarChart3, path: "/admin" },
  {
    label: "User Control",
    icon: Users,
    children: [{ label: "Manage Users", path: "/users", icon: FileText }],
  },
  {
    label: "Rights",
    icon: ShieldCheck,
    children: [
      { label: "Menu", path: "/admin/rights/menu", icon: FileText },
      { label: "Widgets", path: "/admin/rights/widgets", icon: FileText },
      { label: "Financial Year", path: "/admin/rights/fin-year", icon: FileText },
    ],
  },
  {
    label: "Approval",
    icon: CheckCircle2,
    children: [
      { label: "Approval Setup", path: "/admin/approval/setup", icon: FileText },
      { label: "Post Approval Rights", path: "/admin/approval/post-rights", icon: FileText },
    ],
  },
  {
    label: "Finance",
    icon: Landmark,
    children: [
      { label: "Expense Booking", path: "/admin/expense-booking", icon: FileText },
    ],
  },
];

export const MobileNav: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [groupStates, setGroupStates] = useState<Record<string, boolean>>({});

  const navigate = useNavigate();
  const location = useLocation();

  const { theme, setTheme } = useTheme();
  const { currentUser, logout } = useAuth();
  const { activeModule, setActiveModule } = useModule();
  const { getOverdueTasks } = useTask();

  const overdueCount = getOverdueTasks().length;
  const isAdminPage = location.pathname.startsWith("/admin") || location.pathname.startsWith("/users");

  const isSuperAdmin = currentUser?.role === "super_admin";
  const isAdmin = currentUser?.role === "admin" || isSuperAdmin;
  const isModuleActive = activeModule !== null;

  const RoleIcon = isSuperAdmin ? Crown : isAdmin ? ShieldCheck : null;
  const roleColor = isSuperAdmin ? "#7c3aed" : "#2563eb";

  // FINANCE MODULE mobile nav
  // - "Dashboard" renamed to "Amendments"
  // - "Transaction" group renamed to "Finance"
  // - "Payment" moved inside "Finance" group
  const NAV_ITEMS: NavItem[] = [
    { label: "Amendments", icon: BarChart3, path: "/" },

    { label: "Setup", icon: Settings, children: masterItems, disabled: !isModuleActive },

    { label: "Reports", icon: BarChart3, path: "/reports" },
    { label: "Widgets", icon: Puzzle, path: "/widgets" },

    { label: "Tasks", icon: CheckCircle2, path: "/tasks", count: overdueCount },

    {
      label: "Query",
      icon: Scale,
      children: [
        { label: "Trial Balance", path: "/transactions", icon: FileText },
      ],
    },

    {
      label: "Finance",
      icon: Landmark,
      children: [
        { label: "Expense Booking", path: "/transactions/expense-booking", icon: FileText },
        { label: "Payment", path: "/payments", icon: FileText },
      ],
    },
  ];

  const itemsToRender = isAdminPage ? ADMIN_NAV_ITEMS : NAV_ITEMS;

  const go = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  const toggleGroup = (label: string) => {
    setGroupStates((prev) => ({
      ...prev,
      [label]: !(prev[label] ?? false),
    }));
  };

  const isActive = (path?: string, children?: NavItemChild[]) => {
    if (path) return location.pathname === path;
    if (children) return children.some((c) => location.pathname === c.path);
    return false;
  };

  const handleModuleChange = (module: "finance" | "admin") => {
    if (module === "admin") {
      navigate("/admin");
    } else {
      setActiveModule(module);
      navigate("/");
    }
    setOpen(false);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 w-12 h-12 rounded-full gradient-accent text-primary-foreground flex items-center justify-center shadow-lg md:hidden"
      >
        <Menu size={20} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setOpen(false)} />

          <div className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-card border-t max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between px-4 py-3 border-b">
              <span className="font-semibold text-sm">Menu</span>
              <button onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>

            {/* USER */}
            <div className="p-3 border-b">
              <div className="flex gap-3">
                <div className="relative w-10 h-10 rounded-full flex items-center justify-center bg-primary text-white">
                  {currentUser?.initials || "?"}
                  {RoleIcon && (
                    <span className="absolute -bottom-1 -right-1 w-5 h-5 flex items-center justify-center rounded-full border-2 border-card" style={{ background: roleColor }}>
                      <RoleIcon size={10} />
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold">{currentUser?.name}</p>
                  <p className="text-xs">{currentUser?.email}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3">
                <button className="text-xs border p-2 rounded flex justify-center gap-2">
                  <User size={14} /> Profile
                </button>
                <button onClick={() => { logout(); setOpen(false); }} className="text-xs border p-2 rounded flex justify-center gap-2 text-red-500">
                  <LogOut size={14} /> Logout
                </button>
              </div>
            </div>

            {/* NAV */}
            <div className="p-3 space-y-1">
              {itemsToRender.map((item) => {
                const openState = groupStates[item.label];
                const active = isActive(item.path, item.children);

                if (item.children) {
                  return (
                    <div key={item.label}>
                      <button onClick={() => toggleGroup(item.label)} className={`w-full flex gap-3 px-3 py-2 rounded ${active ? "text-primary" : ""}`}>
                        <item.icon size={18} />
                        <span className="flex-1 text-left">{item.label}</span>
                        <ChevronDown size={14} className={openState ? "rotate-180" : ""} />
                      </button>

                      {openState && (
                        <div className="ml-5 space-y-1">
                          {item.children.map((child) => (
                            <button key={child.path} onClick={() => go(child.path)} className="block w-full text-left text-xs px-2 py-1">
                              {child.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <button key={item.path} onClick={() => go(item.path!)} className="w-full flex gap-3 px-3 py-2 rounded">
                    <item.icon size={18} />
                    {item.label}
                    {item.count ? <span className="ml-auto text-xs bg-red-500 text-white px-1 rounded">{item.count}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
