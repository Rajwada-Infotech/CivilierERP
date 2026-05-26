import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useModule } from "@/contexts/ModuleContext";
import { useReminders } from "@/hooks/useReminders";
import { useAppVersion } from "@/hooks/useAppVersion";
import { useAuth } from "@/contexts/AuthContext";
import { useSidebarState } from "./AppLayout";
import {
  BarChart3,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Crown,
  Database,
  Landmark,
  Package,
  ShieldCheck,
  User,
  Wrench,
  MessageSquare,
} from "lucide-react";

// ── Per-module nav definitions ────────────────────────────────────────────────
import { engineeringNavItems } from "./sidebars/EngineeringSidebar";
import { buildFinanceNavItems } from "./sidebars/FinanceSidebar";
import { materialNavItems } from "./sidebars/MaterialSidebar";
import { followupNavItems } from "./sidebars/FollowupSidebar";
import { buildAdminNavItems } from "./sidebars/AdminSidebar";
import { dbaNavItems } from "./sidebars/DbaSidebar";
import { superAdminNavItems } from "./sidebars/SuperAdminSidebar";
import { buildTicketNavItems } from "./sidebars/TicketSidebar";
import { SidebarNav, NavItem } from "./sidebars/SidebarPrimitives";

// ── User sidebar (tiny — lives here) ─────────────────────────────────────────
const userNavItems: NavItem[] = [
  { label: "My Profile", icon: User, path: "/user/profile" },
  { label: "Dashboard", icon: BarChart3, path: "/home" },
];

// ── Approval count poller ─────────────────────────────────────────────────────
function useApprovalCount() {
  const [count, setCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failRef = useRef(0);

  const poll = () => {
    if (document.visibilityState === "hidden") {
      timerRef.current = setTimeout(poll, 60_000);
      return;
    }
    const token = localStorage.getItem("token");
    window
      .fetch("/api/approval-inbox/count", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        failRef.current = 0;
        setCount(d.total ?? 0);
        timerRef.current = setTimeout(poll, 60_000);
      })
      .catch(() => {
        failRef.current += 1;
        timerRef.current = setTimeout(
          poll,
          Math.min(5 * 60_000, 60_000 * failRef.current),
        );
      });
  };

  useEffect(() => {
    poll();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return count;
}

// ── Module badge metadata ─────────────────────────────────────────────────────
type ModuleKey =
  | "engineering"
  | "finance"
  | "material"
  | "followup"
  | "admin"
  | "super_admin"
  | "dba"
  | "user"
  | "ticket"
  | "customer";

const MODULE_META: Record<
  ModuleKey,
  { label: string; icon: React.ElementType; color: string; dot: string }
> = {
  engineering: {
    label: "Engineering",
    icon: Wrench,
    color: "bg-orange-500/10 text-orange-500 border-orange-500/20",
    dot: "bg-orange-500",
  },
  finance: {
    label: "Finance",
    icon: Landmark,
    color: "bg-primary/10 text-primary border-primary/20",
    dot: "bg-primary",
  },
  material: {
    label: "Material",
    icon: Package,
    color: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    dot: "bg-emerald-500",
  },
  followup: {
    label: "Follow-Up",
    icon: Calendar,
    color: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
    dot: "bg-indigo-500",
  },
  admin: {
    label: "Admin",
    icon: ShieldCheck,
    color: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    dot: "bg-blue-500",
  },
  super_admin: {
    label: "Super Admin",
    icon: Crown,
    color: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    dot: "bg-yellow-500",
  },
  dba: {
    label: "DBA",
    icon: Database,
    color: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    dot: "bg-emerald-500",
  },
  user: {
    label: "User",
    icon: User,
    color: "bg-gray-500/10 text-gray-500 border-gray-500/20",
    dot: "bg-gray-400",
  },
  ticket: {
    label: "Ticket",
    icon: MessageSquare,
    color: "bg-pink-500/10 text-pink-500 border-pink-500/20",
    dot: "bg-pink-500",
  },
};

// ── AppSidebar ────────────────────────────────────────────────────────────────
export const AppSidebar = () => {
  const location = useLocation();
  const { activeModule } = useModule();
  const { collapsed, setCollapsed } = useSidebarState();
  const { badgeCount: overdueCount } = useReminders();
  const { currentUser } = useAuth();
  const { version } = useAppVersion();
  const pendingApprovalCount = useApprovalCount();

  const role = currentUser?.role ?? "";
  const isAdminTier = ["super_admin", "admin", "dba"].includes(role);

  const ADMIN_SETUP_PATHS = [
    "/masters/named-entry-type",
    "/masters/type-of-doc",
  ];

  const isSuperAdminPage =
    role === "super_admin" && location.pathname.startsWith("/superadmin");
  const isDbaPage = isAdminTier && location.pathname.startsWith("/dba");
  const isAdminPage =
    isAdminTier &&
    (location.pathname.startsWith("/admin") ||
      location.pathname.startsWith("/users") ||
      ADMIN_SETUP_PATHS.some((p) => location.pathname.startsWith(p)));
  const isUserProfilePage = location.pathname.startsWith("/user/profile");
  const isHomePage = location.pathname === "/home" || location.pathname === "/";
  const isCustomerPage = role === "customer";

  // ── Pick nav items ──────────────────────────────────────────────────────────
  const getNavItems = (): NavItem[] => {
    if (isHomePage && !isCustomerPage) return [];
    if (isCustomerPage) return [
      { label: "My Tickets", icon: MessageSquare, path: "/customer-portal" },
      { label: "My Profile", icon: User, path: "/user/profile" },
    ];
    if (isSuperAdminPage) return superAdminNavItems;
    if (isDbaPage) return dbaNavItems;
    if (isUserProfilePage) return userNavItems;
    if (isAdminPage) return buildAdminNavItems(pendingApprovalCount);

    switch (activeModule) {
      case "engineering":
        return engineeringNavItems;
      case "finance":
        return buildFinanceNavItems(overdueCount);
      case "material":
        return materialNavItems;
      case "followup":
        return followupNavItems;
      case "ticket":
        // Pass isAdminTier so the nav reflects what the logged-in role can see
        return buildTicketNavItems(isAdminTier);
      case "admin":
        return buildAdminNavItems(pendingApprovalCount);
      default:
        return [];
    }
  };

  // ── Resolve module key for badge ────────────────────────────────────────────
  const resolvedModule: ModuleKey | null = isSuperAdminPage
    ? "super_admin"
    : isDbaPage
      ? "dba"
      : isUserProfilePage
        ? "user"
        : isAdminPage
          ? "admin"
          : (activeModule as ModuleKey | null);

  const meta = resolvedModule ? MODULE_META[resolvedModule] : null;
  const ModuleIcon = meta?.icon;

  return (
    <aside
      className={`h-full flex flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-in-out ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      {/* Nav items */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <SidebarNav items={getNavItems()} collapsed={collapsed} />
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-sidebar-border space-y-2">
        {meta &&
          (collapsed ? (
            <div className="flex justify-center">
              <div className={`w-2 h-2 rounded-full ${meta.dot}`} />
            </div>
          ) : (
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border ${meta.color}`}
            >
              {ModuleIcon && <ModuleIcon size={13} />}
              <span>{meta.label}</span>
            </div>
          ))}

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex justify-center p-2 rounded-lg hover:bg-sidebar-accent"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>

        {!collapsed && (
          <div className="px-3 pb-1 text-[10px] text-muted-foreground/50 text-center select-none">
            v{version}
          </div>
        )}
      </div>
    </aside>
  );
};
