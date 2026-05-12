import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useModule } from "@/contexts/ModuleContext";
import { useReminders } from "@/hooks/useReminders";
import { useAuth } from "@/contexts/AuthContext";
import { useSidebarState } from "./AppLayout";
import {
  TrendingUp,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  FileText,
  Scale,
  Shield,
  Landmark,
  ShieldCheck,
  Archive,
  MessageSquare,
  Package,
  Receipt,
  HardHat,
  Building2,
  Users,
  FileWarning,
  Crown,
  Database,
  Globe,
  User,
  Key,
  Terminal,
  Megaphone,
  BellRing,
  FileEdit,
} from "lucide-react";

// ── Approval pending count (polls every 60 s) ────────────────────────────────
function useApprovalCount() {
  const [count, setCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failureCountRef = useRef(0);

  const fetch = () => {
    if (document.visibilityState === "hidden") {
      timerRef.current = setTimeout(fetch, 60_000);
      return;
    }

    const token = localStorage.getItem("token");
    window
      .fetch("/api/approval-inbox/count", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        failureCountRef.current = 0;
        setCount(d.total ?? 0);
        timerRef.current = setTimeout(fetch, 60_000);
      })
      .catch(() => {
        failureCountRef.current += 1;
        const delay = Math.min(5 * 60_000, 60_000 * failureCountRef.current);
        timerRef.current = setTimeout(fetch, delay);
      });
  };

  useEffect(() => {
    fetch();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return count;
}

interface SubItem {
  label: string;
  path: string;
  badge?: number;
}

interface SubSection {
  label: string;
  icon: React.ElementType;
  items: SubItem[];
}

interface NavItem {
  label: string;
  icon: React.ElementType;
  path?: string;
  children?: SubItem[];
  sections?: SubSection[];
}

// ── Finance module sidebar ──────────────────────────────────────────────────
const buildFinanceNavItems = (overdueCount: number): NavItem[] => [
  { label: "Proceeding", icon: BarChart3, path: "/finance" },
  {
    label: "Transaction",
    icon: Landmark,
    children: [
      { label: "Payment", path: "/payments" },
      { label: "Received Payment", path: "/received-payments" },
      { label: "BRS", path: "/brs" },
    ],
  },
  {
    label: "Query",
    icon: Scale,
    children: [
      { label: "Trial Balance", path: "/transactions" },
      {
        label: "Tasks",
        path: "/tasks",
        badge: overdueCount > 0 ? overdueCount : undefined,
      },
    ],
  },
  {
    label: "Record Management",
    icon: Archive,
    children: [{ label: "Records", path: "/records" }],
  },
];

// ── Follow-Up module sidebar ─────────────────────────────────────────────────
const buildFollowupNavItems = (): NavItem[] => [
  { label: "Proceeding", icon: BarChart3, path: "/followup" },
  {
    label: "Sales",
    icon: Users,
    children: [
      { label: "Applicants", path: "/followup/sales/applicants" },
      { label: "Unit Selection", path: "/followup/sales/unit-selection" },
      { label: "Welcome Calls", path: "/followup/sales/welcome-calls" },
    ],
  },
  {
    label: "Agreement",
    icon: FileText,
    children: [{ label: "Agreements", path: "/followup/agreement/agreements" }],
  },
  {
    label: "Finance",
    icon: Landmark,
    children: [
      { label: "Demands", path: "/followup/finance/demands" },
      { label: "Payments", path: "/followup/finance/payments" },
    ],
  },
  {
    label: "Closure",
    icon: CheckCircle2,
    children: [
      { label: "NOC", path: "/followup/closure/noc" },
      { label: "Sales Deed", path: "/followup/closure/sales-deed" },
      { label: "Handover", path: "/followup/closure/handover" },
    ],
  },
  {
    label: "Follow-Ups",
    icon: BellRing,
    children: [
      { label: "Reminders", path: "/followup/follow-ups/reminders" },
      { label: "Tasks", path: "/followup/follow-ups/tasks" },
      { label: "Follow-Up Log", path: "/followup/follow-ups/log" },
    ],
  },
  {
    label: "Construction",
    icon: HardHat,
    children: [{ label: "Updates", path: "/followup/construction/updates" }],
  },
  {
    label: "Reports",
    icon: BarChart3,
    children: [
      { label: "Customer Report", path: "/followup/reports/customer" },
      { label: "Financial Report", path: "/followup/reports/financial" },
      { label: "Project Status", path: "/followup/reports/project-status" },
      {
        label: "Employee Performance",
        path: "/followup/reports/employee-performance",
      },
    ],
  },
];

// ── Material module sidebar ──────────────────────────────────────────────────
const buildMaterialNavItems = (): NavItem[] => [
  { label: "Proceeding", icon: BarChart3, path: "/material" },
  {
    label: "Transaction",
    icon: Receipt,
    children: [
      { label: "Work Order", path: "/material/work-order" },
      { label: "Purchase Order", path: "/material/purchase-order" },
      { label: "GRN", path: "/material/grn" },
      { label: "BOQ", path: "/material/boq" },
      { label: "Issues", path: "/material/issues" },
      { label: "Expense Booking", path: "/material/expense-booking" },
    ],
  },
  {
    label: "Debit Note",
    icon: FileWarning,
    path: "/masters/debit-note",
  },
  { label: "Amendment Menu", icon: FileEdit, path: "/material/amendment-menu" },
];

// ── Admin sidebar ──────────────────────────────────────────────────────────
const buildAdminNavItems = (pendingCount: number): NavItem[] => [
  { label: "Proceeding", icon: BarChart3, path: "/admin" },
  {
    label: "Enterprise",
    icon: Building2,
    children: [
      { label: "Enterprise", path: "/admin/masters/business-unit" },
      { label: "Company", path: "/admin/masters/company" },
      { label: "Project", path: "/admin/masters/project" },
    ],
  },
  {
    label: "User Control",
    icon: Users,
    children: [
      { label: "Manage Users", path: "/users" },
      { label: "Activity Browser", path: "/admin/activity-browser" },
    ],
  },
  {
    label: "Rights",
    icon: Shield,
    children: [
      { label: "Menu", path: "/admin/rights/menu" },
      { label: "Widgets", path: "/admin/rights/widgets" },
      { label: "Financial Year", path: "/admin/rights/fin-year" },
    ],
  },
  {
    label: "Approval",
    icon: CheckCircle2,
    children: [
      {
        label: "Inbox",
        path: "/admin/approval/inbox",
        badge: pendingCount > 0 ? pendingCount : undefined,
      },
      { label: "Approval Setup", path: "/admin/approval/setup" },
      { label: "Post Approval Rights", path: "/admin/approval/post-rights" },
    ],
  },
  {
    label: "Security",
    icon: ShieldCheck,
    children: [
      { label: "Password Reset", path: "/admin/security/password-reset" },
    ],
  },
  {
    label: "Communicator",
    icon: MessageSquare,
    children: [
      { label: "SMS Setup", path: "/admin/communicator/sms-setup" },
      { label: "Email Setup", path: "/admin/communicator/email-setup" },
      { label: "WhatsApp Setup", path: "/admin/communicator/whatsapp-setup" },
    ],
  },
  { label: "API Integration", icon: Shield, path: "/admin/api-integration" },
  { label: "Live Metrics", icon: TrendingUp, path: "/admin/metrics" },
  { label: "Signature", icon: FileText, path: "/admin/signature" },
];

// ── Super Admin sidebar ────────────────────────────────────────────────────
const SUPER_ADMIN_NAV_ITEMS: NavItem[] = [
  { label: "Control Panel", icon: Crown, path: "/superadmin" },
  {
    label: "Tenant Management",
    icon: Building2,
    children: [
      { label: "All Tenants", path: "/superadmin" },
      { label: "Admin Control", path: "/admin/control-panel" },
    ],
  },
  {
    label: "Admin Tools",
    icon: ShieldCheck,
    children: [
      { label: "Menu Rights", path: "/admin/rights/menu" },
      { label: "Widgets Rights", path: "/admin/rights/widgets" },
      { label: "Approval Setup", path: "/admin/approval/setup" },
      { label: "Activity Browser", path: "/admin/activity-browser" },
      { label: "Password Reset", path: "/admin/security/password-reset" },
    ],
  },
  {
    label: "Enterprise",
    icon: Globe,
    children: [
      { label: "Enterprise", path: "/admin/masters/business-unit" },
      { label: "Company", path: "/admin/masters/company" },
      { label: "Project", path: "/admin/masters/project" },
    ],
  },
  { label: "API Integration", icon: Shield, path: "/admin/api-integration" },
];

// ── DBA sidebar ────────────────────────────────────────────────────────────
const DBA_NAV_ITEMS: NavItem[] = [
  { label: "DB Console", icon: Database, path: "/dba" },
  {
    label: "Database",
    icon: Terminal,
    children: [
      { label: "Overview", path: "/dba" },
      { label: "Control Panel", path: "/dba/control-panel" },
    ],
  },
  {
    label: "Ads",
    icon: Megaphone,
    children: [{ label: "Campaigns", path: "/dba/ads" }],
  },
  {
    label: "Reminders",
    icon: BellRing,
    children: [{ label: "Payment Reminders", path: "/dba/reminders" }],
  },
  {
    label: "Logs",
    icon: Receipt,
    children: [{ label: "Payment Logs", path: "/dba/payment-logs" }],
  },
  {
    label: "Admin Tools",
    icon: ShieldCheck,
    children: [
      { label: "Manage Users", path: "/users" },
      { label: "Activity Browser", path: "/admin/activity-browser" },
    ],
  },
];

// ── User sidebar ───────────────────────────────────────────────────────────
const USER_NAV_ITEMS: NavItem[] = [
  { label: "My Profile", icon: User, path: "/user/profile" },
  { label: "Dashboard", icon: BarChart3, path: "/home" },
];

// NavButton Component
const NavButton = ({
  item,
  collapsed,
  isActive,
}: {
  item: NavItem;
  collapsed: boolean;
  isActive: boolean;
}) => {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => item.path && navigate(item.path)}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[15px] font-medium transition-colors ${
        isActive
          ? "bg-primary/15 text-primary font-semibold"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      } ${collapsed ? "justify-center" : ""}`}
      title={collapsed ? item.label : undefined}
    >
      <item.icon size={18} className="shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </button>
  );
};

// NavGroup Component
const NavGroup = ({
  item,
  collapsed,
  hasActiveChild,
}: {
  item: NavItem;
  collapsed: boolean;
  hasActiveChild: boolean;
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(hasActiveChild);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    () => {
      const init: Record<string, boolean> = {};
      (item.sections || []).forEach((s: SubSection) => {
        init[s.label] = s.items.some(
          (i: SubItem) => location.pathname === i.path,
        );
      });
      return init;
    },
  );

  const handleClick = () => {
    if (collapsed && item.children?.length) {
      navigate(item.children[0].path);
      return;
    }
    setOpen((prev) => !prev);
  };

  const toggleSection = (label: string) =>
    setOpenSections((prev) => ({ ...prev, [label]: !prev[label] }));

  return (
    <div>
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[15px] font-medium transition-colors ${
          hasActiveChild
            ? "bg-primary/10 text-primary font-semibold"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        }`}
      >
        <item.icon size={18} className="shrink-0" />
        {!collapsed && (
          <span className="flex-1 text-left truncate">{item.label}</span>
        )}
        {!collapsed &&
          (open ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
      </button>

      {!collapsed && open && (
        <div className="ml-6 mt-1 space-y-1">
          {item.children?.map((child: SubItem) => (
            <button
              key={child.path}
              onClick={() => navigate(child.path)}
              className={`w-full flex justify-between items-center text-[13px] px-2 py-1.5 rounded-md transition-colors ${
                location.pathname === child.path
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <span>{child.label}</span>
              {child.badge && (
                <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full">
                  {child.badge}
                </span>
              )}
            </button>
          ))}

          {item.sections?.map((section: SubSection) => (
            <div key={section.label}>
              <button
                onClick={() => toggleSection(section.label)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              >
                <section.icon size={13} />
                <span className="flex-1 text-left truncate font-medium">
                  {section.label}
                </span>
                {openSections[section.label] ? (
                  <ChevronUp size={11} />
                ) : (
                  <ChevronDown size={11} />
                )}
              </button>
              {openSections[section.label] && (
                <div className="ml-4 mt-0.5 space-y-0.5">
                  {section.items.map((child: SubItem) => (
                    <button
                      key={child.path}
                      onClick={() => navigate(child.path)}
                      className={`w-full text-[13px] px-2 py-1.5 rounded-md ${
                        location.pathname === child.path
                          ? "bg-primary/15 text-primary font-medium"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent"
                      }`}
                    >
                      {child.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const AppSidebar = () => {
  const location = useLocation();
  const { activeModule } = useModule();
  const { collapsed, setCollapsed } = useSidebarState();
  const { overdueTaskCount: overdueCount } = useReminders();
  const { currentUser } = useAuth();
  const pendingApprovalCount = useApprovalCount();

  const ADMIN_SETUP_PATHS = [
    "/masters/named-entry-type",
    "/masters/type-of-doc",
  ];

  const ADMIN_TIER_ROLES = ["super_admin", "admin", "dba"];
  const hasAdminRole = ADMIN_TIER_ROLES.includes(currentUser?.role ?? "");

  const isAdminPage =
    hasAdminRole &&
    (location.pathname.startsWith("/admin") ||
      location.pathname.startsWith("/users") ||
      ADMIN_SETUP_PATHS.some((p) => location.pathname.startsWith(p)));

  const isSuperAdminPage =
    currentUser?.role === "super_admin" &&
    location.pathname.startsWith("/superadmin");

  const isDbaPage = hasAdminRole && location.pathname.startsWith("/dba");
  const isUserProfilePage = location.pathname.startsWith("/user/profile");

  const getModuleNavItems = (): NavItem[] => {
    switch (activeModule) {
      case "admin":
        return buildAdminNavItems(pendingApprovalCount);
      case "material":
        return buildMaterialNavItems();
      case "finance":
        return buildFinanceNavItems(overdueCount);
      case "followup":
        return buildFollowupNavItems();
      default:
        return [];
    }
  };

  const isHomePage = location.pathname === "/home" || location.pathname === "/";

  const getNavItems = (): NavItem[] => {
    if (isHomePage) return [];
    if (isSuperAdminPage) return SUPER_ADMIN_NAV_ITEMS;
    if (isDbaPage) return DBA_NAV_ITEMS;
    if (isUserProfilePage) return USER_NAV_ITEMS;
    if (isAdminPage) return buildAdminNavItems(pendingApprovalCount);
    return getModuleNavItems();
  };

  const itemsToRender = getNavItems();

  const isAdminModule = activeModule === "admin";
  const isFinance =
    !isAdminPage &&
    !isSuperAdminPage &&
    !isDbaPage &&
    !isUserProfilePage &&
    activeModule === "finance";

  const isMaterial =
    !isAdminPage &&
    !isSuperAdminPage &&
    !isDbaPage &&
    !isUserProfilePage &&
    activeModule === "material";

  const isAdmin = isAdminPage;
  const isSuperAdmin = isSuperAdminPage;
  const isDba = isDbaPage;

  const getModuleLabel = () => {
    if (isSuperAdmin) return "Super Admin";
    if (isDba) return "DBA";
    if (isUserProfilePage) return "User";
    if (isAdminModule || isAdmin) return "Admin";
    if (isFinance) return "Finance";
    if (isMaterial) return "Material";
    if (activeModule === "followup") return "Follow-Up";
    return "No module";
  };

  const getModuleColor = () => {
    if (isSuperAdmin)
      return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
    if (isDba)
      return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
    if (isUserProfilePage)
      return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    if (isAdminModule || isAdmin)
      return "bg-blue-500/10 text-blue-500 border-blue-500/20";
    if (isFinance) return "bg-primary/10 text-primary border-primary/20";
    if (isMaterial)
      return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
    if (activeModule === "followup")
      return "bg-indigo-500/10 text-indigo-500 border-indigo-500/20";
    return "bg-muted text-muted-foreground border-border";
  };

  const getDotColor = () => {
    if (isSuperAdmin) return "bg-yellow-500";
    if (isDba) return "bg-emerald-500";
    if (isAdminModule || isAdmin) return "bg-blue-500";
    if (isFinance) return "bg-primary";
    if (isMaterial) return "bg-emerald-500";
    return "bg-muted-foreground/40";
  };

  const getModuleIcon = () => {
    if (isSuperAdmin) return Crown;
    if (isDba) return Database;
    if (isUserProfilePage) return User;
    if (isAdminModule || isAdmin) return ShieldCheck;
    if (isFinance) return Landmark;
    if (isMaterial) return Package;
    if (activeModule === "followup") return Calendar;
    return Landmark;
  };

  const ModuleIcon = getModuleIcon();

  return (
    <aside
      className={`h-full flex flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-in-out ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {itemsToRender.map((item) =>
          item.children || item.sections ? (
            <NavGroup
              key={item.label}
              item={item}
              collapsed={collapsed}
              hasActiveChild={
                !!(
                  item.children?.some((c) => location.pathname === c.path) ||
                  item.sections?.some((s) =>
                    s.items.some((i) => location.pathname === i.path),
                  )
                )
              }
            />
          ) : (
            <NavButton
              key={item.label}
              item={item}
              collapsed={collapsed}
              isActive={
                item.path === "/"
                  ? location.pathname === "/"
                  : location.pathname.startsWith(item.path || "")
              }
            />
          ),
        )}
      </div>

      <div className="p-2 border-t border-sidebar-border space-y-2">
        {!collapsed ? (
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold border ${getModuleColor()}`}
          >
            <ModuleIcon size={13} />
            <span>{getModuleLabel()}</span>
          </div>
        ) : (
          <div className="flex justify-center">
            <div className={`w-2 h-2 rounded-full ${getDotColor()}`} />
          </div>
        )}

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex justify-center p-2 rounded-lg hover:bg-sidebar-accent"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
};
