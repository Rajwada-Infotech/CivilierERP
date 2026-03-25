import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Hash,
  BarChart3,
  CheckCircle2,
  Menu,
  X,
  Scale,
  ChevronDown,
  FileText,
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

export const MobileNav: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [groupStates, setGroupStates] = useState<Record<string, boolean>>({});
  const [showModulePicker, setShowModulePicker] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  const { theme, setTheme } = useTheme();
  const { currentUser, logout, canAccessPage } = useAuth();
  const { activeModule, setActiveModule, moduleLabel } = useModule();
  const { getOverdueTasks } = useTask();

  const overdueCount = getOverdueTasks().length;

  const isAdminPage =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/users");

  const isSuperAdmin = currentUser?.role === "super_admin";
  const isAdmin = currentUser?.role === "admin" || isSuperAdmin;
  const isModuleActive = activeModule !== null;

  const masterItems: NavItemChild[] = [
    { icon: Receipt,  label: "Expenses",    path: "/masters/expenses" },
    { icon: Truck,    label: "Suppliers",   path: "/masters/suppliers" },
    { icon: Users,    label: "Customers",   path: "/masters/customers" },
    { icon: HardHat,  label: "Contractors", path: "/masters/contractors" },
    { icon: Landmark, label: "Banks",       path: "/masters/banks" },
    { icon: Package,  label: "Items",       path: "/masters/items" },
    { icon: Layers,   label: "Item Groups", path: "/masters/item-groups" },
    ...(canAccessPage("master_hsn")
      ? [{ icon: Hash, label: "HSN", path: "/masters/hsn" }]
      : []),
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
        { label: "Menu",           path: "/admin/rights/menu",     icon: FileText },
        { label: "Widgets",        path: "/admin/rights/widgets",  icon: FileText },
        { label: "Financial Year", path: "/admin/rights/fin-year", icon: FileText },
      ],
    },
    {
      label: "Approval",
      icon: CheckCircle2,
      children: [
        { label: "Approval Setup",       path: "/admin/approval/setup",       icon: FileText },
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
    { label: "Amendments", icon: BarChart3,    path: "/" },
    { label: "Setup",      icon: Settings,     children: masterItems, disabled: !isModuleActive },
    { label: "Reports",    icon: BarChart3,    path: "/reports" },
    { label: "Widgets",    icon: Puzzle,       path: "/widgets" },
    { label: "Tasks",      icon: CheckCircle2, path: "/tasks", count: overdueCount },
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
        { label: "Payment",         path: "/payments",                     icon: FileText },
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

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(true)}
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
          <div className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-card border-t border-border max-h-[85vh] overflow-y-auto">

            {/* HEADER */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="font-heading font-semibold text-sm text-foreground">Menu</span>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
              >
                <X size={18} />
              </button>
            </div>

            {/* USER */}
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
                <div className="min-w-0">
                  <p className="text-sm font-heading font-semibold text-foreground truncate">{currentUser?.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{currentUser?.email}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3">
                <button className="text-xs border border-border p-2 rounded-lg flex items-center justify-center gap-2 text-foreground hover:bg-muted transition-colors">
                  <User size={14} /> Profile
                </button>
                <button
                  onClick={() => { logout(); setOpen(false); }}
                  className="text-xs border border-border p-2 rounded-lg flex items-center justify-center gap-2 text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <LogOut size={14} /> Logout
                </button>
              </div>
            </div>

            {/* MODULE SWITCHER */}
            <div className="p-3 border-b border-border">
              <button
                onClick={() => setShowModulePicker((v) => !v)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted hover:bg-muted/70 transition-colors text-sm font-heading"
              >
                <LayoutGrid size={15} className="text-primary flex-shrink-0" />
                <span className="flex-1 text-left text-foreground truncate">{moduleLabel}</span>
                <ChevronDown size={14} className={`text-muted-foreground transition-transform ${showModulePicker ? "rotate-180" : ""}`} />
              </button>

              {showModulePicker && (
                <div className="mt-2 rounded-lg border border-border bg-card overflow-hidden">
                  <button
                    onClick={() => { setActiveModule("finance"); setShowModulePicker(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left hover:bg-muted transition-colors ${activeModule === "finance" ? "text-primary font-semibold" : "text-foreground"}`}
                  >
                    <Landmark size={15} className="text-green-400 flex-shrink-0" />
                    Finance Module
                    {activeModule === "finance" && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
                  </button>
                </div>
              )}
            </div>

            {/* ADMIN TOGGLE */}
            {isAdmin && (
              <div className="px-3 pt-3 pb-1 flex gap-2">
                <button
                  onClick={() => { navigate("/"); setOpen(false); }}
                  className={`flex-1 text-xs py-1.5 rounded-lg border font-heading transition-colors ${!isAdminPage ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                >
                  Finance
                </button>
                <button
                  onClick={() => { navigate("/admin"); setOpen(false); }}
                  className={`flex-1 text-xs py-1.5 rounded-lg border font-heading transition-colors ${isAdminPage ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                >
                  Admin
                </button>
              </div>
            )}

            {/* NAV ITEMS */}
            <div className="p-3 space-y-0.5">
              {itemsToRender.map((item) => {
                const openState = groupStates[item.label] ?? false;
                const active = isActive(item.path, item.children);

                if (item.children) {
                  return (
                    <div key={item.label}>
                      <button
                        onClick={() => !item.disabled && toggleGroup(item.label)}
                        disabled={item.disabled}
                        className={[
                          "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-heading transition-colors",
                          item.disabled
                            ? "opacity-40 cursor-not-allowed text-muted-foreground"
                            : active
                            ? "bg-primary/10 text-primary"
                            : "text-foreground hover:bg-muted",
                        ].join(" ")}
                      >
                        <item.icon size={17} className="flex-shrink-0" />
                        <span className="flex-1 text-left">{item.label}</span>
                        {item.disabled ? (
                          <span className="text-[10px] text-muted-foreground border border-border rounded px-1">No module</span>
                        ) : (
                          <ChevronDown size={14} className={`text-muted-foreground transition-transform ${openState ? "rotate-180" : ""}`} />
                        )}
                      </button>

                      {openState && !item.disabled && (
                        <div className="ml-4 pl-3 border-l border-border mt-0.5 mb-1 space-y-0.5">
                          {item.children.map((child) => {
                            const childActive = location.pathname === child.path;
                            const ChildIcon = child.icon;
                            return (
                              <button
                                key={child.path}
                                onClick={() => go(child.path)}
                                className={[
                                  "w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors",
                                  childActive
                                    ? "bg-primary/10 text-primary font-semibold"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                ].join(" ")}
                              >
                                {ChildIcon && <ChildIcon size={14} className="flex-shrink-0" />}
                                {child.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <button
                    key={item.path}
                    onClick={() => go(item.path!)}
                    className={[
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-heading transition-colors",
                      active ? "bg-primary/10 text-primary font-semibold" : "text-foreground hover:bg-muted",
                    ].join(" ")}
                  >
                    <item.icon size={17} className="flex-shrink-0" />
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.count ? (
                      <span className="text-[11px] bg-destructive text-destructive-foreground font-semibold px-1.5 py-0.5 rounded-full leading-none">
                        {item.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* THEME */}
            <div className="p-3 border-t border-border">
              <p className="text-xs font-heading text-muted-foreground mb-2">Theme</p>
              <div className="flex gap-2 flex-wrap">
                {(Object.entries(THEME_DOTS) as [Theme, { bg: string; label: string }][]).map(([t, { bg, label }]) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    title={label}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${theme === t ? "ring-2 ring-primary ring-offset-2 ring-offset-card border-transparent" : "border-border"}`}
                    style={{ background: bg }}
                  />
                ))}
              </div>
            </div>

          </div>
        </div>
      )}
    </>
  );
};
