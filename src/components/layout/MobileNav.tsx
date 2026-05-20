import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  BarChart3,
  CheckCircle2,
  X,
  Receipt,
  HardHat,
  FileText,
  Archive,
  Puzzle,
  LogOut,
  User,
  Crown,
  Palette,
  ShieldCheck,
  Package,
  Building2,
  MessageSquare,
  Users,
  ChevronRight,
  Layers,
  FileWarning,
  Database,
  Settings,
  Truck,
  Calendar,
  BookOpen,
  CreditCard,
  Hash,
  Tag,
  FileType2,
  Activity,
  Landmark,
  Bell,
  CalendarClock,
  TrendingUp,
  CheckSquare,
  PackageMinus,
  ClipboardList,
  Wrench,
  LayoutGrid,
  Grip,
  Home,
} from "lucide-react";

import { useModule, MODULE_DASHBOARD_ROUTES } from "@/contexts/ModuleContext";
import { BillingIcon } from "@/components/icons/BillingIcon";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme, THEME_DOTS, Theme } from "@/contexts/ThemeContext";
import { useGracefulLogout } from "@/hooks/useGracefulLogout";

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
}

// ── Module colour system (matches TopNavbar CSS-var approach) ──────────────────
const MODULE_META: Record<
  string,
  {
    h: number;
    s: number;
    l: number;
    icon: React.ElementType;
    label: string;
    route: string;
  }
> = {
  __none__: { h: 240, s: 6, l: 55, icon: Grip, label: "Menu", route: "/home" },
  finance: {
    h: 217,
    s: 91,
    l: 60,
    icon: TrendingUp,
    label: "Finance",
    route: MODULE_DASHBOARD_ROUTES.finance,
  },
  material: {
    h: 160,
    s: 60,
    l: 45,
    icon: Package,
    label: "Material",
    route: MODULE_DASHBOARD_ROUTES.material,
  },
  followup: {
    h: 263,
    s: 70,
    l: 58,
    icon: Calendar,
    label: "Follow Up",
    route: MODULE_DASHBOARD_ROUTES.followup,
  },
  engineering: {
    h: 38,
    s: 92,
    l: 50,
    icon: Wrench,
    label: "Engineering",
    route: MODULE_DASHBOARD_ROUTES.engineering,
  },
  ticket: {
    h: 330,
    s: 80,
    l: 60,
    icon: MessageSquare,
    label: "Ticket",
    route: MODULE_DASHBOARD_ROUTES.ticket,
  },
  admin: {
    h: 217,
    s: 91,
    l: 60,
    icon: ShieldCheck,
    label: "Admin",
    route: "/admin/dashboard",
  },
};

function modVars(id: string): React.CSSProperties {
  const m = MODULE_META[id] ?? MODULE_META.finance;
  return {
    "--mod-h": m.h,
    "--mod-s": `${m.s}%`,
    "--mod-l": `${m.l}%`,
  } as React.CSSProperties;
}

export const MobileNav: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"nav" | "theme">("nav");

  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { currentUser } = useAuth();
  const { activeModule, setActiveModule } = useModule();
  const { handleLogout, overlay: logoutOverlay } = useGracefulLogout();

  const isAdminPage =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/users") ||
    location.pathname.startsWith("/dba");
  const isSuperAdmin = currentUser?.role?.toLowerCase() === "super_admin";
  const isDba = currentUser?.role?.toLowerCase() === "dba";
  const isAdmin =
    currentUser?.role?.toLowerCase() === "admin" || isSuperAdmin || isDba;

  // Close on route change
  useEffect(() => {
    setOpen(false);
    setExpandedGroup(null);
  }, [location.pathname]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // ── Nav item definitions ────────────────────────────────────────────────────

  const ADMIN_NAV_ITEMS: NavItem[] = [
    { label: "Dashboard", icon: BarChart3, path: "/admin" },
    {
      label: "Enterprise",
      icon: Building2,
      children: [
        {
          label: "Enterprise",
          path: "/admin/masters/business-unit",
          icon: FileText,
        },
        { label: "Project", path: "/admin/masters/project", icon: FileText },
        { label: "Company", path: "/admin/masters/company", icon: FileText },
      ],
    },
    {
      label: "User Control",
      icon: Users,
      children: [
        { label: "Manage Users", path: "/users", icon: FileText },
        {
          label: "Activity Browser",
          path: "/admin/activity-browser",
          icon: FileText,
        },
      ],
    },
    {
      label: "Rights",
      icon: ShieldCheck,
      children: [
        { label: "Menu", path: "/admin/rights/menu", icon: FileText },
        { label: "Widgets", path: "/admin/rights/widgets", icon: FileText },
        {
          label: "Financial Year",
          path: "/admin/rights/fin-year",
          icon: FileText,
        },
      ],
    },
    {
      label: "Approval",
      icon: CheckCircle2,
      children: [
        {
          label: "Approval Setup",
          path: "/admin/approval/setup",
          icon: FileText,
        },
        {
          label: "Post Approval Rights",
          path: "/admin/approval/post-rights",
          icon: FileText,
        },
      ],
    },
    {
      label: "Communicator",
      icon: MessageSquare,
      children: [
        {
          label: "SMS Setup",
          path: "/admin/communicator/sms-setup",
          icon: FileText,
        },
        {
          label: "Email Setup",
          path: "/admin/communicator/email-setup",
          icon: FileText,
        },
        {
          label: "WhatsApp Setup",
          path: "/admin/communicator/whatsapp-setup",
          icon: FileText,
        },
      ],
    },
  ];

  const getModuleNavItems = (): NavItem[] => {
    switch (activeModule) {
      case "material":
        return [
          { label: "Dashboard", icon: BarChart3, path: "/material" },
          {
            label: "Transaction",
            icon: Receipt,
            children: [
              {
                label: "Purchase Order",
                path: "/material/purchase-order",
                icon: FileText,
              },
              { label: "GRN", path: "/material/grn", icon: Package },
              { label: "Issues", path: "/material/issues", icon: PackageMinus },
              {
                label: "Expense Booking",
                path: "/material/expense-booking",
                icon: Receipt,
              },
            ],
          },
          {
            label: "Debit Note",
            icon: FileWarning,
            path: "/material/debit-note",
          },
          {
            label: "Amendment Menu",
            icon: CheckSquare,
            path: "/material/amendment-menu",
          },
        ];
      case "finance":
        return [
          { label: "Dashboard", icon: BarChart3, path: "/finance" },
          {
            label: "Query",
            icon: Landmark,
            children: [
              { label: "Trial Balance", path: "/transactions", icon: FileText },
              { label: "Tasks", path: "/tasks", icon: CheckCircle2 },
            ],
          },
          {
            label: "Transaction",
            icon: Landmark,
            children: [
              { label: "Payment", path: "/payments", icon: FileText },
              {
                label: "Received Payment",
                path: "/received-payments",
                icon: FileText,
              },
              { label: "BRS", path: "/brs", icon: FileText },
            ],
          },
          { label: "Records", icon: Archive, path: "/records" },
          { label: "Widgets", icon: Puzzle, path: "/widgets" },
        ];
      case "followup":
        return [
          { label: "Dashboard", icon: BarChart3, path: "/followup" },
          {
            label: "Sales",
            icon: Users,
            children: [
              {
                label: "Applicants",
                path: "/followup/sales/applicants",
                icon: FileText,
              },
              {
                label: "Unit Selection",
                path: "/followup/sales/unit-selection",
                icon: FileText,
              },
              {
                label: "Welcome Calls",
                path: "/followup/sales/welcome-calls",
                icon: FileText,
              },
            ],
          },
          {
            label: "Closure",
            icon: CheckCircle2,
            children: [
              { label: "NOC", path: "/followup/closure/noc", icon: FileText },
              {
                label: "Sales Deed",
                path: "/followup/closure/sales-deed",
                icon: FileText,
              },
              {
                label: "Handover",
                path: "/followup/closure/handover",
                icon: FileText,
              },
            ],
          },
          {
            label: "Follow-Ups",
            icon: CalendarClock,
            children: [
              {
                label: "Reminders",
                path: "/followup/follow-ups/reminders",
                icon: Bell,
              },
              {
                label: "Tasks",
                path: "/followup/follow-ups/tasks",
                icon: CheckCircle2,
              },
              {
                label: "Follow-Up Log",
                path: "/followup/follow-ups/log",
                icon: FileText,
              },
            ],
          },
        ];
      case "engineering":
        return [
          { label: "Dashboard", icon: BarChart3, path: "/engineering" },
          {
            label: "Transaction",
            icon: ClipboardList,
            children: [
              {
                label: "Work Order",
                path: "/engineering/work-order",
                icon: HardHat,
              },
              { label: "BOQ", path: "/engineering/boq", icon: FileText },
              {
                label: "Work Done",
                path: "/engineering/work-done",
                icon: Wrench,
              },
            ],
          },
        ];

      case "ticket":
        return [
          {
            label: "Dashboard",
            icon: BarChart3,
            path: "/ticket",
          },
          {
            label: "Ticket",
            icon: MessageSquare,
            children: [
              // Create Ticket — visible to all
              { label: "Create Ticket", path: "/ticket/create", icon: FileText },
              // My Tickets — only for normal users (not admin/super_admin)
              ...(!isAdmin
                ? [{ label: "My Tickets", path: "/ticket/my-tickets", icon: FileText }]
                : []),
              // Pending Tickets — only for admin/super_admin
              ...(isAdmin
                ? [{ label: "Pending Tickets", path: "/ticket/pending", icon: FileText }]
                : []),
              // Resolved Tickets — visible to all
              { label: "Resolved Tickets", path: "/ticket/resolved", icon: FileText },
            ],
          },
        ];

      default:
        return [];
    }
  };

  const navItems = isAdminPage ? ADMIN_NAV_ITEMS : getModuleNavItems();

  const go = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  const isItemActive = (item: NavItem) => {
    if (item.path) return location.pathname === item.path;
    if (item.children)
      return item.children.some((c) => location.pathname === c.path);
    return false;
  };

  // Active module info — falls back to __none__ (neutral) on home page with no module
  const activeModKey = isAdminPage ? "admin" : (activeModule ?? "__none__");
  const activeMod = MODULE_META[activeModKey] ?? MODULE_META.__none__;

  const moduleModules = Object.entries(MODULE_META).filter(
    ([id]) => id !== "__none__" && (id !== "admin" || isAdmin),
  );

  // Theme checkmark colours
  const themeCheck: Record<Theme, string> = {
    dark: "#818cf8",
    light: "#7c3aed",
    midnight: "#2dd4bf",
    sepia: "#f59e0b",
    crimson: "#fb7185",
  };

  return (
    <>
      {logoutOverlay}

      {/* ── FAB trigger ─────────────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="fixed z-50 md:hidden"
        style={{
          bottom: "max(1.25rem, env(safe-area-inset-bottom, 1.25rem))",
          right: "max(1.25rem, env(safe-area-inset-right, 1.25rem))",
        }}
      >
        {/* Outer glow ring — only when a module is active */}
        {activeModule && !isAdminPage && (
          <span
            className="absolute inset-0 rounded-2xl animate-pulse"
            style={{
              background: `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / 0.25)`,
              filter: "blur(8px)",
              transform: "scale(1.3)",
            }}
          />
        )}
        <span
          className="relative flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold shadow-2xl"
          style={
            activeModule || isAdminPage
              ? {
                  background: `linear-gradient(135deg, hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}%), hsl(${activeMod.h} ${activeMod.s}% ${Math.max(activeMod.l - 12, 20)}%))`,
                  color: "white",
                }
              : {
                  background: "hsl(var(--card))",
                  color: "hsl(var(--foreground))",
                  border: "1px solid hsl(var(--border))",
                }
          }
        >
          <Grip size={16} />
          {(activeModule || isAdminPage) && (
            <span className="text-xs tracking-wide font-heading">
              {activeMod.label}
            </span>
          )}
        </span>
      </button>

      {/* ── Full-screen overlay ──────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed inset-0 z-[60] md:hidden"
          style={{ animation: "fadeInOverlay 200ms ease-out both" }}
        >
          <style>{`
            @keyframes fadeInOverlay { from { opacity: 0 } to { opacity: 1 } }
            @keyframes slideUpPanel { from { transform: translateY(100%) } to { transform: translateY(0) } }
            @keyframes popIn {
              from { opacity: 0; transform: scale(0.92) translateY(8px) }
              to   { opacity: 1; transform: scale(1) translateY(0) }
            }
            .nav-item-enter { animation: popIn 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
          `}</style>

          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-background/70 backdrop-blur-md"
            onClick={() => setOpen(false)}
          />

          {/* Panel — slides up from bottom */}
          <div
            className="absolute inset-x-0 bottom-0 flex flex-col rounded-t-[2rem] border-t border-border overflow-hidden"
            style={{
              maxHeight: "93svh",
              animation:
                "slideUpPanel 300ms cubic-bezier(0.32, 0.72, 0, 1) both",
              background: "hsl(var(--card))",
            }}
          >
            {/* ── Colour accent bar at top ─── */}
            <div
              className="h-1 w-full flex-shrink-0 rounded-full"
              style={{
                background: `linear-gradient(90deg, hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}%), hsl(${activeMod.h} ${activeMod.s}% ${Math.min(activeMod.l + 20, 90)}%))`,
              }}
            />

            {/* Drag handle */}
            <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>

            {/* ── Header row ─────────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 px-5 py-3 flex-shrink-0">
              {/* Avatar */}
              <div
                className="relative w-10 h-10 rounded-xl flex-shrink-0 overflow-hidden"
                style={
                  currentUser?.avatarUrl
                    ? { background: "hsl(var(--muted))" }
                    : {
                        background: `linear-gradient(135deg, hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}%), hsl(${activeMod.h} ${activeMod.s}% ${Math.max(activeMod.l - 15, 20)}%))`,
                      }
                }
              >
                {currentUser?.avatarUrl ? (
                  <img
                    src={currentUser.avatarUrl}
                    alt={currentUser.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="w-full h-full flex items-center justify-center text-white font-heading font-bold text-sm">
                    {currentUser?.initials || "?"}
                  </span>
                )}
                {isSuperAdmin && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-violet-600 border-2 border-card flex items-center justify-center">
                    <Crown size={9} className="text-white" />
                  </span>
                )}
                {!isSuperAdmin && isDba && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-emerald-600 border-2 border-card flex items-center justify-center">
                    <Database size={9} className="text-white" />
                  </span>
                )}
                {!isSuperAdmin && !isDba && isAdmin && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-blue-600 border-2 border-card flex items-center justify-center">
                    <ShieldCheck size={9} className="text-white" />
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="font-heading font-semibold text-sm text-foreground truncate leading-tight">
                  {currentUser?.name}
                </p>
                <p className="text-xs text-muted-foreground truncate leading-tight">
                  {currentUser?.email}
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    setOpen(false);
                    navigate(
                      isSuperAdmin
                        ? "/superadmin/profile"
                        : isDba
                          ? "/dba/profile"
                          : currentUser?.role === "admin"
                            ? "/admin/profile"
                            : "/user/profile",
                    );
                  }}
                  className="w-9 h-9 rounded-xl border border-border flex items-center justify-center hover:bg-muted transition-colors"
                >
                  <User size={15} className="text-muted-foreground" />
                </button>
                <button
                  onClick={handleLogout}
                  className="w-9 h-9 rounded-xl border border-destructive/30 flex items-center justify-center hover:bg-destructive/10 transition-colors"
                >
                  <LogOut size={15} className="text-destructive" />
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="w-9 h-9 rounded-xl border border-border flex items-center justify-center hover:bg-muted transition-colors"
                >
                  <X size={15} className="text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* ── Module strip ─────────────────────────────────────────────────── */}
            <div className="px-4 pb-3 flex-shrink-0">
              <div
                className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none"
                style={{ scrollbarWidth: "none" }}
              >
                {moduleModules.map(([id, meta], i) => {
                  const isActive = isAdminPage
                    ? id === "admin"
                    : activeModule === id;
                  const Icon = meta.icon;
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        if (id === "admin") {
                          navigate("/admin/dashboard");
                          setOpen(false);
                          return;
                        }
                        setActiveModule(id as any);
                        navigate(meta.route);
                        setOpen(false);
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl flex-shrink-0 transition-all duration-200 text-xs font-heading font-medium border"
                      style={
                        isActive
                          ? {
                              background: `hsl(${meta.h} ${meta.s}% ${meta.l}% / 0.15)`,
                              borderColor: `hsl(${meta.h} ${meta.s}% ${meta.l}% / 0.4)`,
                              color: `hsl(${meta.h} ${meta.s}% ${meta.l}%)`,
                              backdropFilter: "blur(8px)",
                            }
                          : {
                              borderColor: "hsl(var(--border))",
                              color: "hsl(var(--muted-foreground))",
                              background: "transparent",
                            }
                      }
                    >
                      <Icon size={13} />
                      {meta.label}
                      {isActive && (
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{
                            background: `hsl(${meta.h} ${meta.s}% ${meta.l}%)`,
                          }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Tab bar (Nav / Theme) ───────────────────────────────────────── */}
            <div className="px-4 pb-2 flex-shrink-0">
              <div className="flex gap-1 p-1 rounded-xl bg-muted">
                {(["nav", "theme"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className="flex-1 py-2 rounded-lg text-xs font-heading font-medium transition-all capitalize"
                    style={
                      activeTab === tab
                        ? {
                            background: `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / 0.18)`,
                            color: `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}%)`,
                          }
                        : { color: "hsl(var(--muted-foreground))" }
                    }
                  >
                    {tab === "nav" ? "Navigation" : "Appearance"}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Scrollable content ───────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto overscroll-contain pb-8">
              {activeTab === "nav" && (
                <div className="px-4 space-y-1 pt-1">
                  {/* Quick links */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {[
                      { label: "Home", icon: Home, path: "/home" },
                      { label: "Reports", icon: BarChart3, path: "/reports" },
                      { label: "Widgets", icon: Puzzle, path: "/widgets" },
                      { label: "Tasks", icon: CheckCircle2, path: "/tasks" },
                    ].map(({ label, icon: Icon, path }, i) => {
                      const active = location.pathname === path;
                      return (
                        <button
                          key={path}
                          onClick={() => go(path)}
                          className="nav-item-enter flex items-center gap-2.5 px-3.5 py-3 rounded-xl border text-sm font-heading transition-all text-left"
                          style={{
                            animationDelay: `${i * 35}ms`,
                            borderColor: active
                              ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / 0.4)`
                              : "hsl(var(--border))",
                            background: active
                              ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / 0.10)`
                              : "transparent",
                            color: active
                              ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}%)`
                              : "hsl(var(--foreground))",
                          }}
                        >
                          <Icon
                            size={15}
                            style={{ opacity: active ? 1 : 0.5 }}
                          />
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Section label */}
                  {navItems.length > 0 ? (
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading px-1 pb-1 pt-1">
                      {isAdminPage ? "Admin" : `${activeMod.label} Module`}
                    </p>
                  ) : !activeModule && !isAdminPage ? (
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading px-1 pb-1 pt-1">
                      Select a module above to get started
                    </p>
                  ) : null}

                  {/* Nav items */}
                  {navItems.map((item, idx) => {
                    const active = isItemActive(item);
                    const isExpanded = expandedGroup === item.label;

                    if (item.children) {
                      return (
                        <div
                          key={item.label}
                          className="nav-item-enter"
                          style={{ animationDelay: `${(idx + 4) * 40}ms` }}
                        >
                          <button
                            onClick={() =>
                              setExpandedGroup(isExpanded ? null : item.label)
                            }
                            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-heading transition-all text-left border"
                            style={{
                              borderColor: active
                                ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / 0.35)`
                                : isExpanded
                                  ? "hsl(var(--border))"
                                  : "transparent",
                              background: active
                                ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / 0.10)`
                                : isExpanded
                                  ? "hsl(var(--muted) / 0.5)"
                                  : "transparent",
                            }}
                          >
                            <div
                              className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                              style={{
                                background:
                                  active || isExpanded
                                    ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / 0.15)`
                                    : "hsl(var(--muted))",
                              }}
                            >
                              <item.icon
                                size={15}
                                style={{
                                  color:
                                    active || isExpanded
                                      ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}%)`
                                      : "hsl(var(--muted-foreground))",
                                }}
                              />
                            </div>
                            <span
                              className="flex-1"
                              style={{
                                color: active
                                  ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}%)`
                                  : "hsl(var(--foreground))",
                              }}
                            >
                              {item.label}
                            </span>
                            <ChevronRight
                              size={14}
                              className="text-muted-foreground transition-transform duration-200"
                              style={{
                                transform: isExpanded
                                  ? "rotate(90deg)"
                                  : "rotate(0deg)",
                              }}
                            />
                          </button>

                          {isExpanded && (
                            <div
                              className="ml-5 mt-1 mb-1 pl-4 border-l-2 space-y-0.5"
                              style={{
                                borderColor: `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / 0.25)`,
                              }}
                            >
                              {item.children.map((child, ci) => {
                                const childActive =
                                  location.pathname === child.path;
                                const ChildIcon = child.icon;
                                return (
                                  <button
                                    key={child.path}
                                    onClick={() => go(child.path)}
                                    className="nav-item-enter w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-heading transition-all text-left"
                                    style={{
                                      animationDelay: `${ci * 30}ms`,
                                      background: childActive
                                        ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / 0.12)`
                                        : "transparent",
                                      color: childActive
                                        ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}%)`
                                        : "hsl(var(--muted-foreground))",
                                    }}
                                  >
                                    {ChildIcon && (
                                      <ChildIcon
                                        size={14}
                                        className="flex-shrink-0"
                                      />
                                    )}
                                    <span className="flex-1">
                                      {child.label}
                                    </span>
                                    {!!child.count && (
                                      <span className="text-[10px] bg-destructive text-destructive-foreground px-1.5 py-0.5 rounded-full font-medium">
                                        {child.count}
                                      </span>
                                    )}
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
                        className="nav-item-enter w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-heading transition-all text-left border"
                        style={{
                          animationDelay: `${(idx + 4) * 40}ms`,
                          borderColor: active
                            ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / 0.35)`
                            : "transparent",
                          background: active
                            ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / 0.10)`
                            : "transparent",
                        }}
                      >
                        <div
                          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{
                            background: active
                              ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / 0.18)`
                              : "hsl(var(--muted))",
                          }}
                        >
                          <item.icon
                            size={15}
                            style={{
                              color: active
                                ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}%)`
                                : "hsl(var(--muted-foreground))",
                            }}
                          />
                        </div>
                        <span
                          className="flex-1"
                          style={{
                            color: active
                              ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}%)`
                              : "hsl(var(--foreground))",
                            fontWeight: active ? 600 : 400,
                          }}
                        >
                          {item.label}
                        </span>
                        {active && (
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{
                              background: `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}%)`,
                            }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* ── Theme tab ───────────────────────────────────────────────────── */}
              {activeTab === "theme" && (
                <div className="px-4 pt-2">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-3 px-1">
                    Colour theme
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {(
                      Object.entries(THEME_DOTS) as [
                        Theme,
                        { bg: string; label: string },
                      ][]
                    ).map(([t, { bg, label }], i) => {
                      const isSelected = theme === t;
                      return (
                        <button
                          key={t}
                          onClick={() => setTheme(t)}
                          className="nav-item-enter flex items-center gap-4 px-4 py-3.5 rounded-2xl border transition-all text-left"
                          style={{
                            animationDelay: `${i * 50}ms`,
                            borderColor: isSelected
                              ? `${bg}66`
                              : "hsl(var(--border))",
                            background: isSelected ? `${bg}18` : "transparent",
                          }}
                        >
                          <div
                            className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center shadow-sm"
                            style={{ background: bg }}
                          >
                            {isSelected && (
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 16 16"
                                fill="none"
                              >
                                <path
                                  d="M3 8l3.5 3.5L13 5"
                                  stroke={themeCheck[t]}
                                  strokeWidth="2.2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-heading font-medium text-foreground">
                              {label}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {t === "dark"
                                ? "Deep indigo dark"
                                : t === "light"
                                  ? "Clean bright"
                                  : t === "midnight"
                                    ? "Teal-accented slate"
                                    : t === "sepia"
                                      ? "Warm amber tone"
                                      : "Bold crimson dark"}
                            </p>
                          </div>
                          {isSelected && (
                            <span
                              className="text-[10px] font-heading px-2 py-1 rounded-lg"
                              style={{ background: `${bg}22`, color: bg }}
                            >
                              Active
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MobileNav;