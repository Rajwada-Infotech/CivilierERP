import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Calendar,
  FileText,
  BarChart3,
  CheckCircle2,
  Menu,
  X,
  Scale,
  ChevronDown,
  Hash,
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
  LogOut,
  User,
  Crown,
  Palette,
  ChevronRight,
  Archive,
} from "lucide-react";

import { useModule } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme, THEME_DOTS, Theme } from "@/contexts/ThemeContext";
import { useTask } from "@/contexts/TaskContext";

interface NavItemChild {
  label: string;
  path: string;
  icon?: React.ElementType;
  count?: number;
}

interface NavItem {
  label: string;
  icon: React.ElementType;
  path?: string;
  children?: NavItemChild[];
  count?: number;
  disabled?: boolean;
  isMasters?: boolean;
}

export const MobileNav: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [groupStates, setGroupStates] = useState<Record<string, boolean>>({});

  const navigate = useNavigate();
  const location = useLocation();

  const { theme, setTheme } = useTheme();
  const { currentUser, logout, canAccessPage } = useAuth();
  const { activeModule, setActiveModule } = useModule();
  const { getOverdueTasks } = useTask();

  const overdueCount = getOverdueTasks().length;
  const isAdminPage = location.pathname.startsWith("/admin") || location.pathname.startsWith("/users");
  const isSuperAdmin = currentUser?.role === "super_admin";
  const isAdmin = currentUser?.role === "admin" || isSuperAdmin;
  const isModuleActive = activeModule !== null && activeModule !== undefined;

  // Master Items with permission check for HSN
  const masterItems: NavItemChild[] = [
    { icon: Receipt, label: "General Ledger", path: "/masters/expenses" },
    { icon: Truck, label: "Suppliers", path: "/masters/suppliers" },
    { icon: Users, label: "Customers", path: "/masters/customers" },
    { icon: HardHat, label: "Contractors", path: "/masters/contractors" },
    { icon: Landmark, label: "Banks", path: "/masters/banks" },
    { icon: Package, label: "Items", path: "/masters/items" },
    { icon: Layers, label: "Item Groups", path: "/masters/item-groups" },
    ...(canAccessPage("master_hsn")
      ? [{ icon: Hash, label: "HSN", path: "/masters/hsn" }]
      : []),
    { icon: Calendar, label: "Financial Year", path: "/masters/financial-year" },
  ];

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

  const NAV_ITEMS: NavItem[] = [
    { label: "Amendments", icon: BarChart3, path: "/" },
    {
      label: "Setup",
      icon: Settings,
      children: masterItems,
      disabled: !isModuleActive,
      isMasters: true,
    },
    {
      label: "Query",
      icon: Scale,
      children: [
        { label: "Trial Balance", path: "/transactions", icon: FileText },
        { label: "Tasks", path: "/tasks", icon: CheckCircle2, count: overdueCount },
      ],
    },
    {
      label: "Finance",
      icon: Landmark,
      children: [
        { label: "Expense Booking", path: "/transactions/expense-booking", icon: FileText },
        { label: "Payment", path: "/payments", icon: FileText },
        { label: "Received Payment", path: "/received-payments", icon: FileText },
        { label: "BRS", path: "/brs", icon: FileText },
      ],
    },
    {
      label: "Record Management",
      icon: Archive,
      children: [
        { label: "Records", path: "/records", icon: Archive },
      ],
    },
    {
      label: "More",
      icon: Layers,
      children: [
        { label: "Reports", path: "/reports", icon: BarChart3 },
        { label: "Widgets", path: "/widgets", icon: Puzzle },
      ],
    },
  ];

  const itemsToRender = isAdminPage ? ADMIN_NAV_ITEMS : NAV_ITEMS;

  const go = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  const toggleGroup = (label: string) => {
    setGroupStates((prev) => ({ ...prev, [label]: !(prev[label] ?? false) }));
  };

  const isActive = (path?: string, children?: NavItemChild[]) => {
    if (path) return location.pathname === path;
    if (children) return children.some((c) => location.pathname === c.path);
    return false;
  };

  const masterIconColors: Record<string, string> = {
    "General Ledger": "text-orange-400",
    Suppliers: "text-blue-400",
    Customers: "text-violet-400",
    Contractors: "text-yellow-500",
    Banks: "text-emerald-500",
    Items: "text-teal-400",
    "Item Groups": "text-indigo-400",
    HSN: "text-pink-500",
    "Financial Year": "text-amber-500",
  };

  const masterBgColors: Record<string, string> = {
    "General Ledger": "bg-orange-500/10",
    Suppliers: "bg-blue-500/10",
    Customers: "bg-violet-500/10",
    Contractors: "bg-yellow-500/10",
    Banks: "bg-emerald-500/10",
    Items: "bg-teal-500/10",
    "Item Groups": "bg-indigo-500/10",
    HSN: "bg-pink-500/10",
    "Financial Year": "bg-amber-500/10",
  };

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        className="fixed bottom-4 right-4 z-50 w-12 h-12 rounded-full gradient-accent text-primary-foreground flex items-center justify-center shadow-lg md:hidden"
      >
        <Menu size={20} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Drawer */}
          <div className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-card border-t border-border max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
              <span className="font-heading font-semibold text-sm text-foreground">Menu</span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="p-1 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {/* User Section */}
              <div className="p-3 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="relative w-10 h-10 rounded-full flex items-center justify-center bg-primary text-primary-foreground font-heading font-semibold text-sm flex-shrink-0">
                    {currentUser?.initials || "?"}
                    {isSuperAdmin && (
                      <span className="absolute -bottom-1 -right-1 w-5 h-5 flex items-center justify-center rounded-full border-2 border-card bg-violet-600">
                        <Crown size={10} className="text-white" />
                      </span>
                    )}
                    {!isSuperAdmin && isAdmin && (
                      <span className="absolute -bottom-1 -right-1 w-5 h-5 flex items-center justify-center rounded-full border-2 border-card bg-blue-600">
                        <ShieldCheck size={10} className="text-white" />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-heading font-semibold text-foreground truncate">
                      {currentUser?.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {currentUser?.email}
                    </p>
                  </div>

                  <div className="flex gap-2 flex-shrink-0">
                    <button aria-label="View user profile" className="p-2 border border-border rounded-xl flex items-center text-foreground hover:bg-muted transition-colors">
                      <User size={14} />
                    </button>
                    <button
                      onClick={() => {
                        logout();
                        setOpen(false);
                      }}
                      aria-label="Log out"
                      className="p-2 border border-border rounded-xl flex items-center text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <LogOut size={14} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Finance / Admin Toggle */}
              {isAdmin && (
                <div className="px-3 pt-3 pb-2 flex gap-2">
                  <button
                    onClick={() => {
                      setActiveModule("finance");
                      navigate("/");
                      setOpen(false);
                    }}
                    aria-label="Switch to Finance mode"
                    className={`flex-1 text-xs py-2 rounded-xl border font-heading font-semibold transition-all ${
                      activeModule === "finance" && !isAdminPage
                        ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Finance
                  </button>
                  <button
                    onClick={() => {
                      navigate("/admin");
                      setOpen(false);
                    }}
                    aria-label="Switch to Admin mode"
                    className={`flex-1 text-xs py-2 rounded-xl border font-heading font-semibold transition-all ${
                      isAdminPage
                        ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Admin
                  </button>
                </div>
              )}

              {/* Navigation Items */}
              <div className="p-3 space-y-0.5">
                {itemsToRender.map((item) => {
                  const openState = groupStates[item.label] ?? false;
                  const active = isActive(item.path, item.children);

                  // Special Masters Grid
                  if (item.children && item.isMasters) {
                    return (
                      <div key={item.label}>
                        <button
                          onClick={() => !item.disabled && toggleGroup(item.label)}
                          disabled={item.disabled}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-heading transition-colors ${
                            item.disabled
                              ? "opacity-40 cursor-not-allowed text-muted-foreground"
                              : active
                              ? "bg-primary/10 text-primary"
                              : "text-foreground hover:bg-muted"
                          }`}
                        >
                          <item.icon size={17} className="flex-shrink-0" />
                          <span className="flex-1 text-left">{item.label}</span>
                          {item.disabled ? (
                            <span className="text-[10px] text-muted-foreground border border-border rounded px-1">
                              No module
                            </span>
                          ) : (
                            <ChevronDown
                              size={14}
                              className={`text-muted-foreground transition-transform ${openState ? "rotate-180" : ""}`}
                            />
                          )}
                        </button>

                        {openState && !item.disabled && (
                          <div className="mt-2 mb-3 px-1">
                            <p className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground px-1 mb-2.5">
                              Masters
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                              {item.children.map((child) => {
                                const childActive = location.pathname === child.path;
                                const ChildIcon = child.icon!;
                                const colorClass = masterIconColors[child.label] ?? "text-primary";
                                const bgClass = masterBgColors[child.label] ?? "bg-primary/10";

                                return (
                                  <button
                                    key={child.path}
                                    onClick={() => go(child.path)}
                                    className={`flex flex-col items-center gap-2 py-3 px-2 rounded-2xl border transition-all ${
                                      childActive
                                        ? "border-primary bg-primary/10 shadow-sm"
                                        : "border-border bg-card/50 hover:border-primary/40 hover:bg-muted/60 active:scale-95"
                                    }`}
                                  >
                                    <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${bgClass}`}>
                                      <ChildIcon size={22} className={colorClass} />
                                    </div>
                                    <span
                                      className={`text-[11px] font-heading leading-tight text-center ${
                                        childActive ? "text-primary font-semibold" : "text-muted-foreground"
                                      }`}
                                    >
                                      {child.label}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }

                  // Regular Expandable Groups
                  if (item.children) {
                    return (
                      <div key={item.label}>
                        <button
                          onClick={() => !item.disabled && toggleGroup(item.label)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-heading transition-colors ${
                            active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
                          }`}
                        >
                          <item.icon size={17} className="flex-shrink-0" />
                          <span className="flex-1 text-left">{item.label}</span>
                          <ChevronDown
                            size={14}
                            className={`text-muted-foreground transition-transform ${openState ? "rotate-180" : ""}`}
                          />
                        </button>

                        {openState && (
                          <div className="ml-4 pl-3 border-l border-border mt-0.5 mb-1 space-y-0.5">
                            {item.children.map((child) => {
                              const childActive = location.pathname === child.path;
                              const ChildIcon = child.icon;
                              const childCount = child.count;

                              return (
                                <button
                                  key={child.path}
                                  onClick={() => go(child.path)}
                                  className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors ${
                                    childActive
                                      ? "bg-primary/10 text-primary font-semibold"
                                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                  }`}
                                >
                                  {ChildIcon && <ChildIcon size={14} className="flex-shrink-0" />}
                                  <span className="flex-1 text-left">{child.label}</span>
                                  {!!childCount && (
                                    <span className="text-[11px] bg-destructive text-destructive-foreground font-semibold px-1.5 py-0.5 rounded-full leading-none">
                                      {childCount}
                                    </span>
                                  )}
                                  {childActive && <ChevronRight size={12} />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  }

                  // Simple Navigation Items
                  return (
                    <button
                      key={item.path}
                      onClick={() => go(item.path!)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-heading transition-colors ${
                        isActive(item.path) ? "bg-primary/10 text-primary font-semibold" : "text-foreground hover:bg-muted"
                      }`}
                    >
                      <item.icon size={17} className="flex-shrink-0" />
                      <span className="flex-1 text-left">{item.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Theme Selector */}
              <div className="px-3 py-4 border-t border-border">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <Palette size={14} className="text-muted-foreground" />
                  <span className="text-[11px] uppercase tracking-widest font-heading text-muted-foreground">
                    Appearance
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {(Object.entries(THEME_DOTS) as [Theme, { bg: string; label: string }][]).map(([t, { bg, label }]) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      aria-label={`${label} theme`}
                      title={label}
                      className={`relative flex flex-col items-center gap-2 py-3 px-1 rounded-2xl border transition-all ${
                        theme === t
                          ? "bg-primary/10 border-primary shadow-sm"
                          : "border-border hover:border-primary/30 hover:bg-muted/50"
                      }`}
                    >
                      <div
                        className={`w-7 h-7 rounded-full shadow-md border-2 border-white/20 ring-2 ring-offset-1 ring-offset-card bg-[${bg}]`}
                      />
                      <span className="text-[10px] font-heading text-muted-foreground leading-none truncate w-full text-center">
                        {label}
                      </span>
                      {theme === t && (
                        <span className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-primary flex items-center justify-center">
                          <span className="text-[8px] text-primary-foreground leading-none font-bold">✓</span>
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
