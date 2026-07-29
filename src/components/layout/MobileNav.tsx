import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  BarChart3,
  CheckCircle2,
  X,
  Receipt,
  HardHat,
  FileText,
  Puzzle,
  Users,
  ChevronRight,

  Landmark,
  TrendingUp,
  ClipboardList,
  Cpu,
  Grip,
  Home,
  Settings,
  Layers,
  Hash,
  ReceiptIndianRupee,
  CreditCard,
  BookOpen,
  Tag,
  FileType2,
  LayoutGrid,
  Ruler,
  Activity,
  DoorOpen,
  Target,
  Calendar,
  Package,
  RotateCcw,
  Wallet,
  Car,
  PlusCircle,
  Truck,
  Megaphone,
  SlidersHorizontal,
  UsersRound,
  ShieldCheck,
  CalendarClock,
  Wand2,
} from "lucide-react";
import {
  Bank,
  Receipt21,
  Category2,
  ClipboardText,
  Message2,
  Archive,
  Building3,
  Chart21,
  VideoPlay,
  Shield,
  ShieldTick,
  Crown,
  Data,
  Profile,
  Logout,
} from "iconsax-react";

import { useModule } from "@/contexts/ModuleContext";
import { MODULE_DASHBOARD_ROUTES } from "@/contexts/module.utils";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme, THEME_DOTS, Theme } from "@/contexts/ThemeContext";
import { useGracefulLogout } from "@/hooks/useGracefulLogout";
import { useReminders } from "@/hooks/useReminders";
import { BillingIcon } from "@/components/icons/BillingIcon";
import { ADMIN_PATHS } from "@/constants/pageDefinitions";

// ── Desktop sidebar definitions — single source of truth, mirrored here ──────
import { engineeringNavItems } from "./sidebars/EngineeringSidebar";
import { buildFinanceNavItems } from "./sidebars/FinanceSidebar";
import { materialNavItems } from "./sidebars/MaterialSidebar";
import { followupNavItems } from "./sidebars/FollowupSidebar";
import { buildAdminNavItems } from "./sidebars/AdminSidebar";
import { dbaNavItems } from "./sidebars/DbaSidebar";
import { superAdminNavItems } from "./sidebars/SuperAdminSidebar";
import { buildTicketNavItems } from "./sidebars/TicketSidebar";
import { salesNavItems } from "./sidebars/SalesSidebar";
import { recordsNavItems } from "./sidebars/RecordsSidebar";
import { civilWorkDprNavItems } from "./sidebars/CivilWorkDprSidebar";
import { salesAutomationNavItems } from "./sidebars/SalesAutomationSidebar";
import { crmNavItems } from "./sidebars/CrmSidebar";
import type {
  NavItem as DesktopNavItem,
  SubItem as DesktopSubItem,
} from "./sidebars/SidebarPrimitives";

interface NavItemChild {
  label: string;
  path: string;
  icon?: React.ElementType;
  count?: number;
  pageKey?: string;
}

interface NavItem {
  label: string;
  icon: React.ElementType;
  path?: string;
  children?: NavItemChild[];
  count?: number;
  disabled?: boolean;
  pageKey?: string;
}

interface SetupItem {
  icon: React.ElementType<any>;
  label: string;
  path: string;
  color: string;
  pageKey?: string;
}

// ── Module colour system ──────────────────────────────────────────────────────
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
  __none__: { h: 242, s: 65, l: 58, icon: Grip, label: "Menu", route: "/home" },
  finance: {
    h: 217,
    s: 91,
    l: 60,
    icon: Bank,
    label: "Finance",
    route: MODULE_DASHBOARD_ROUTES.finance,
  },
  material: {
    h: 160,
    s: 60,
    l: 45,
    icon: Receipt21,
    label: "Material",
    route: MODULE_DASHBOARD_ROUTES.material,
  },
  followup: {
    h: 174,
    s: 72,
    l: 40,
    icon: Category2,
    label: "Follow Up",
    route: MODULE_DASHBOARD_ROUTES.followup,
  },
  engineering: {
    h: 38,
    s: 92,
    l: 50,
    icon: ClipboardText,
    label: "Engineering",
    route: MODULE_DASHBOARD_ROUTES.engineering,
  },
  ticket: {
    h: 330,
    s: 80,
    l: 60,
    icon: Message2,
    label: "Ticket",
    route: MODULE_DASHBOARD_ROUTES.ticket,
  },
  records: {
    h: 347,
    s: 77,
    l: 50,
    icon: Archive,
    label: "Records",
    route: MODULE_DASHBOARD_ROUTES.records,
  },
  civilworkdpr: {
    h: 192,
    s: 91,
    l: 36,
    icon: Chart21,
    label: "Civil Work DPR",
    route: MODULE_DASHBOARD_ROUTES.civilworkdpr,
  },
  "sales-automation": {
    h: 330,
    s: 70,
    l: 55,
    icon: VideoPlay,
    label: "Sales Automation",
    route: MODULE_DASHBOARD_ROUTES["sales-automation"],
  },
  crm: {
    h: 199,
    s: 89,
    l: 48,
    icon: Building3,
    label: "CRM",
    route: MODULE_DASHBOARD_ROUTES.crm,
  },
  admin: {
    h: 217,
    s: 91,
    l: 60,
    icon: Shield,
    label: "Admin",
    route: "/admin/dashboard",
  },
};

// ── Setup item lists (mirrors TopNavbar) ─────────────────────────────────────
const financeSetupItems: SetupItem[] = [
  {
    icon: Layers,
    label: "AC Group",
    path: "/masters/account-group",
    color: "text-indigo-400",
    pageKey: "account-head",
  },
  {
    icon: Receipt,
    label: "General Ledger",
    path: "/masters/general-ledger",
    color: "text-orange-400",
    pageKey: "general-ledger",
  },
  {
    icon: Truck,
    label: "Suppliers",
    path: "/masters/suppliers",
    color: "text-blue-400",
    pageKey: "supplier-master",
  },
  {
    icon: HardHat,
    label: "Contractors",
    path: "/masters/contractors",
    color: "text-amber-500",
    pageKey: "contractor-master",
  },
  {
    icon: Landmark,
    label: "Banks",
    path: "/masters/banks",
    color: "text-emerald-500",
    pageKey: "bank-master",
  },
  {
    icon: Calendar,
    label: "Fin Year",
    path: "/masters/financial-year",
    color: "text-purple-400",
    pageKey: "financial-year-master",
  },
  {
    icon: BookOpen,
    label: "Cheque",
    path: "/masters/cheque",
    color: "text-cyan-500",
    pageKey: "cheque-master",
  },
  {
    icon: CreditCard,
    label: "Card",
    path: "/masters/card",
    color: "text-rose-500",
    pageKey: "card-master",
  },
  {
    icon: FileText,
    label: "TDS",
    path: "/masters/tds",
    color: "text-green-500",
    pageKey: "tds-master",
  },
  {
    icon: Target,
    label: "Cost Center",
    path: "/masters/cost-center",
    color: "text-pink-500",
    pageKey: "cost-center",
  },
  {
    icon: TrendingUp,
    label: "Profit Center",
    path: "/masters/profit-center",
    color: "text-teal-500",
    pageKey: "profit-center",
  },
  {
    icon: RotateCcw,
    label: "Return Reason",
    path: "/masters/return-reason",
    color: "text-red-400",
    pageKey: "return-reason-master",
  },
  {
    icon: Wallet,
    label: "Payment Reason",
    path: "/masters/payment-reason",
    color: "text-lime-500",
    pageKey: "payment-reason-master",
  },
];

const materialSetupItems: SetupItem[] = [
  {
    icon: Package,
    label: "Items",
    path: "/masters/items",
    color: "text-teal-500",
  },
  {
    icon: Layers,
    label: "Items Group",
    path: "/masters/item-groups",
    color: "text-indigo-400",
  },
  {
    icon: Hash,
    label: "Unit of Measurement",
    path: "/masters/unit-measurement",
    color: "text-orange-400",
  },
  {
    icon: ReceiptIndianRupee,
    label: "HSN",
    path: "/masters/hsn",
    color: "text-pink-400",
  },
  {
    icon: BillingIcon,
    label: "Billing",
    path: "/masters/billing-terms",
    color: "text-lime-500",
  },
  {
    icon: FileText,
    label: "T&C",
    path: "/material/t-c-master",
    color: "text-purple-500",
  },
  {
    icon: CalendarClock,
    label: "Payment Terms",
    path: "/masters/payment-terms",
    color: "text-sky-500",
    pageKey: "payment-terms",
  },
  {
    icon: ClipboardList,
    label: "Inventory",
    path: "/material/inventory-master",
    color: "text-teal-400",
  },
  {
    icon: Cpu,
    label: "Depreciation",
    path: "/material/setup/depreciation",
    color: "text-violet-500",
  },
];

const followupSetupItems: SetupItem[] = [
  {
    icon: ClipboardList,
    label: "Payment Plan",
    path: "/followup/setup/payment-plan-master",
    color: "text-emerald-500",
  },
];

const engineeringSetupItems: SetupItem[] = [
  {
    icon: Activity,
    label: "Activity Master",
    path: "/masters/activity",
    color: "text-orange-400",
    pageKey: "activity-master",
  },
];

const salesAutomationSetupItems: SetupItem[] = [
  {
    icon: Megaphone,
    label: "Social Media",
    path: "/sales-automation/social-media",
    color: "text-pink-500",
    pageKey: "sa-social-media",
  },
  {
    icon: SlidersHorizontal,
    label: "Distribution Rules",
    path: "/sales-automation/distribution-rules",
    color: "text-amber-500",
    pageKey: "sa-distribution-rules",
  },
  {
    icon: UsersRound,
    label: "Teams",
    path: "/sales-automation/teams",
    color: "text-purple-500",
    pageKey: "sa-teams",
  },
  {
    icon: ShieldCheck,
    label: "Role Master",
    path: "/sales-automation/role-master",
    color: "text-orange-500",
    pageKey: "sa-role-master",
  },
];

// Unit/Block/Room/Parking/Extra-Charge masters are shared with the
// Follow-Up module (same underlying data and pageKey gating), but they're
// now ALSO registered under /crm/setup/* in App.tsx so these links stay
// inside the crm module — a /followup/... URL would flip the whole app
// into Follow-Up chrome the moment it's clicked (ModuleContext derives
// activeModule purely from the path prefix). pageKey still points at the
// real (shared, followup-*) permission the route actually checks, so
// visibility for non-privileged users matches the real access gate. Kept
// in sync with TopNavbar.tsx's own copy.
const crmSetupItems: SetupItem[] = [
  {
    icon: Wand2,
    label: "Auto Project Setup",
    path: "/crm/setup/auto-project-setup",
    color: "text-fuchsia-500",
    pageKey: "crm-auto-project-setup",
  },
  {
    icon: Users,
    label: "Customer Master",
    path: "/masters/customers",
    color: "text-violet-500",
    pageKey: "customer-master",
  },
  {
    icon: Ruler,
    label: "Unit Master",
    path: "/crm/setup/unit-master",
    color: "text-orange-500",
    pageKey: "followup-unit-master",
  },
  {
    icon: Layers,
    label: "Block Master",
    path: "/crm/setup/block-master",
    color: "text-cyan-500",
    pageKey: "followup-block-master",
  },
  {
    icon: DoorOpen,
    label: "Room Master",
    path: "/crm/setup/room-master",
    color: "text-teal-500",
    pageKey: "followup-room-master",
  },
  {
    icon: HardHat,
    label: "Broker Master",
    path: "/masters/brokers",
    color: "text-amber-500",
    pageKey: "broker-master",
  },
  {
    icon: ClipboardList,
    label: "Payment Plan Master",
    path: "/crm/payment-plans",
    color: "text-emerald-500",
    pageKey: "crm-payment-plans",
  },
  {
    icon: Landmark,
    label: "Project Bank Mapping",
    path: "/crm/setup/project-banks",
    color: "text-amber-600",
    pageKey: "crm-project-banks",
  },
  {
    icon: CreditCard,
    label: "Home Loan Tracking",
    path: "/crm/loan-details",
    color: "text-cyan-500",
    pageKey: "crm-loan-details",
  },
  {
    icon: Car,
    label: "Parking Rate Master",
    path: "/crm/setup/parking-master",
    color: "text-blue-500",
    pageKey: "followup-parking-master",
  },
  {
    icon: Hash,
    label: "Parking Slot Master",
    path: "/crm/setup/parking-slot-master",
    color: "text-sky-500",
    pageKey: "followup-parking-slot-master",
  },
  {
    icon: PlusCircle,
    label: "Extra Charge Master",
    path: "/crm/setup/extra-charge-master",
    color: "text-pink-500",
    pageKey: "followup-extra-charge-master",
  },
  {
    icon: Activity,
    label: "Pending Tasks",
    path: "/crm/setup/pending-tasks",
    color: "text-purple-500",
    pageKey: "followup-pending-tasks",
  },
  {
    icon: Calendar,
    label: "Reminders",
    path: "/crm/setup/reminders",
    color: "text-indigo-500",
    pageKey: "followup-reminders",
  },
];

const adminSetupItems: SetupItem[] = [
  {
    icon: LayoutGrid,
    label: "Menu Types",
    path: "/admin/masters/menu-types",
    color: "text-emerald-500",
  },
  {
    icon: Tag,
    label: "Entry Type",
    path: "/masters/named-entry-type",
    color: "text-purple-400",
  },
  {
    icon: FileType2,
    label: "Type of Doc",
    path: "/masters/type-of-doc",
    color: "text-sky-500",
  },
  {
    icon: Users,
    label: "Role Master",
    path: "/admin/masters/role-master",
    color: "text-blue-400",
  },
];

// Activity Master is the shared Engineering master (no separate Civil Work
// DPR-specific one) — this just gives quick access to it from this module.
const civilWorkDprSetupItems: SetupItem[] = [
  {
    icon: ClipboardList,
    label: "Activity",
    path: "/masters/activity",
    color: "text-cyan-500",
  },
];

export const MobileNav: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"nav" | "setup" | "theme">("nav");

  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { currentUser, canAccessPage } = useAuth();
  const { activeModule, setActiveModule } = useModule();
  const { handleLogout, overlay: logoutOverlay } = useGracefulLogout();
  const { badgeCount: overdueCount } = useReminders();

  const isAdminPage =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/users") ||
    location.pathname.startsWith("/dba") ||
    location.pathname.startsWith("/superadmin") ||
    ADMIN_PATHS.some((p) => location.pathname.startsWith(p));
  const isSuperAdmin = currentUser?.role?.toLowerCase() === "super_admin";
  const isDba = currentUser?.role?.toLowerCase() === "dba";
  const isAdmin =
    currentUser?.role?.toLowerCase() === "admin" || isSuperAdmin || isDba;
  const isSuperAdminPage =
    isSuperAdmin && location.pathname.startsWith("/superadmin");
  const isDbaPage = isAdmin && location.pathname.startsWith("/dba");

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

  // ── Setup items scoped to current module/page ────────────────────────────
  const setupConfig = (() => {
    if (isAdminPage)
      return { items: adminSetupItems, label: "Admin", available: true };
    if (activeModule === "material")
      return { items: materialSetupItems, label: "Material", available: true };
    if (activeModule === "followup")
      return { items: followupSetupItems, label: "Follow-Up", available: true };
    if (activeModule === "engineering")
      return {
        items: engineeringSetupItems,
        label: "Engineering",
        available: true,
      };
    if (activeModule === "civilworkdpr")
      return {
        items: civilWorkDprSetupItems,
        label: "Civil Work DPR",
        available: true,
      };
    if (activeModule === "finance")
      return { items: financeSetupItems, label: "Finance", available: true };
    if (activeModule === "sales-automation")
      return {
        items: salesAutomationSetupItems,
        label: "Sales Automation",
        available: true,
      };
    if (activeModule === "crm")
      return { items: crmSetupItems, label: "CRM", available: true };
    return { items: [] as SetupItem[], label: "", available: false };
  })();

  // ── Nav item definitions ────────────────────────────────────────────────────
  const adaptChild = (child: DesktopSubItem): NavItemChild | null => {
    if (child.pageKey && !canAccessPage(child.pageKey as any)) return null;
    return {
      label: child.label,
      path: child.path,
      count: child.badge,
      pageKey: child.pageKey,
    };
  };

  const adaptItems = (items: DesktopNavItem[]): NavItem[] =>
    items.reduce<NavItem[]>((acc, item) => {
      if (item.children?.length) {
        const children = item.children
          .map(adaptChild)
          .filter((c): c is NavItemChild => c !== null);
        if (children.length) {
          acc.push({ label: item.label, icon: item.icon, children });
        }
        return acc;
      }
      if (item.sections?.length) {
        const children = item.sections
          .flatMap((s) => s.items)
          .map(adaptChild)
          .filter((c): c is NavItemChild => c !== null);
        if (children.length) {
          acc.push({ label: item.label, icon: item.icon, children });
        }
        return acc;
      }
      if (item.pageKey && !canAccessPage(item.pageKey as any)) return acc;
      if (item.path) {
        acc.push({ label: item.label, icon: item.icon, path: item.path });
      }
      return acc;
    }, []);

  const ADMIN_NAV_ITEMS: NavItem[] = adaptItems(
    buildAdminNavItems(0) as DesktopNavItem[],
  );

  const SUPER_ADMIN_NAV_ITEMS: NavItem[] = adaptItems(
    superAdminNavItems as DesktopNavItem[],
  );

  const DBA_NAV_ITEMS: NavItem[] = adaptItems(dbaNavItems as DesktopNavItem[]);

  const getModuleNavItems = (): NavItem[] => {
    switch (activeModule) {
      case "material":
        return adaptItems(materialNavItems as DesktopNavItem[]);
      case "finance":
        return adaptItems(
          buildFinanceNavItems(overdueCount) as DesktopNavItem[],
        );
      case "followup":
        return adaptItems(followupNavItems as DesktopNavItem[]);
      case "engineering":
        return adaptItems(engineeringNavItems as DesktopNavItem[]);
      case "ticket":
        return adaptItems(buildTicketNavItems(isAdmin) as DesktopNavItem[]);
      case "sales":
        return adaptItems(salesNavItems as DesktopNavItem[]);
      case "records":
        return adaptItems(recordsNavItems as DesktopNavItem[]);
      case "civilworkdpr":
        return adaptItems(civilWorkDprNavItems as DesktopNavItem[]);
      case "sales-automation":
        return adaptItems(salesAutomationNavItems as DesktopNavItem[]);
      case "crm":
        return adaptItems(crmNavItems as DesktopNavItem[]);
      default:
        return [];
    }
  };

  // Filter nav items by user's page rights — mirrors AppSidebar.tsx's
  // filterByRights() so desktop and mobile can't drift apart again.
  const filterByRights = (items: NavItem[]): NavItem[] => {
    if (isAdmin) return items;
    return items.reduce<NavItem[]>((acc, item) => {
      if (item.children) {
        const visibleChildren = item.children.filter(
          (child) => !child.pageKey || canAccessPage(child.pageKey),
        );
        if (visibleChildren.length > 0) {
          acc.push({ ...item, children: visibleChildren });
        }
      } else if (!item.pageKey || canAccessPage(item.pageKey)) {
        acc.push(item);
      }
      return acc;
    }, []);
  };

  const navItems = isSuperAdminPage
    ? SUPER_ADMIN_NAV_ITEMS
    : isDbaPage
      ? DBA_NAV_ITEMS
      : isAdminPage
        ? ADMIN_NAV_ITEMS
        : filterByRights(getModuleNavItems());

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

  const activeModKey = isAdminPage ? "admin" : (activeModule ?? "__none__");
  const activeMod = MODULE_META[activeModKey] ?? MODULE_META.__none__;

  const moduleModules = Object.entries(MODULE_META).filter(([id]) => {
    if (id === "__none__") return false;
    if (id === "admin") return isAdmin;
    if (currentUser?.role?.toLowerCase() === "engineer") {
      return ["followup", "engineering", "ticket", "records"].includes(id);
    }
    return true;
  });

  const themeCheck: Record<Theme, string> = {
    dark: "#818cf8",
    light: "#7c3aed",
    midnight: "#2dd4bf",
    root: "#f59e0b",
    glass: "#fb7185",
  };

  const tabs: Array<{ id: "nav" | "setup" | "theme"; label: string }> = [
    { id: "nav", label: "Navigation" },
    {
      id: "setup",
      label: setupConfig.available ? `Setup · ${setupConfig.label}` : "Setup",
    },
    { id: "theme", label: "Appearance" },
  ];

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
        <span
          className="absolute inset-0 rounded-2xl animate-pulse"
          style={{
            background: `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / 0.25)`,
            filter: "blur(8px)",
            transform: "scale(1.3)",
          }}
        />
        <span
          className="relative flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold shadow-2xl"
          style={{
            background: `linear-gradient(135deg, hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}%), hsl(${activeMod.h} ${activeMod.s}% ${Math.max(activeMod.l - 12, 20)}%))`,
            color: "white",
          }}
        >
          <Grip size={16} />
          <span className="text-xs tracking-wide font-heading">
            {activeMod.label}
          </span>
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

          {/* Panel */}
          <div
            className="absolute inset-x-0 bottom-0 flex flex-col rounded-t-[2rem] border-t border-border overflow-hidden"
            style={{
              maxHeight: "93svh",
              animation:
                "slideUpPanel 300ms cubic-bezier(0.32, 0.72, 0, 1) both",
              background: "hsl(var(--card))",
            }}
          >
            {/* Colour accent bar */}
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
            <div className="flex items-center gap-2.5 px-4 py-3 flex-shrink-0">
              {/* Avatar */}
              <div
                className="relative w-8 h-8 rounded-lg flex-shrink-0 overflow-hidden"
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
                    <Data size={9} className="text-white" />
                  </span>
                )}
                {!isSuperAdmin && !isDba && isAdmin && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-blue-600 border-2 border-card flex items-center justify-center">
                    <ShieldTick size={9} className="text-white" />
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="font-heading font-semibold text-xs text-foreground truncate leading-tight">
                  {currentUser?.name}
                </p>
                <p className="text-[11px] text-muted-foreground truncate leading-tight">
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
                  className="w-7 h-7 rounded-lg border border-border flex items-center justify-center hover:bg-muted transition-colors"
                >
                  <Profile size={15} className="text-muted-foreground" />
                </button>
                <button
                  onClick={handleLogout}
                  className="w-7 h-7 rounded-lg border border-destructive/30 flex items-center justify-center hover:bg-destructive/10 transition-colors"
                >
                  <Logout size={15} className="text-destructive" />
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="w-7 h-7 rounded-lg border border-border flex items-center justify-center hover:bg-muted transition-colors"
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
                {moduleModules.map(([id, meta]) => {
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
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg flex-shrink-0 transition-all duration-200 text-[11px] font-heading font-medium border"
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

            {/* ── Tab bar ─────────────────────────────────────────────────────── */}
            <div className="px-4 pb-2.5 flex-shrink-0">
              <div className="flex gap-1 p-0.5 rounded-lg bg-muted">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className="flex-1 py-1.5 rounded-md text-[11px] font-heading font-medium transition-all text-center"
                    style={
                      activeTab === tab.id
                        ? {
                            background: `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / 0.18)`,
                            color: `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}%)`,
                          }
                        : { color: "hsl(var(--muted-foreground))" }
                    }
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Scrollable content ───────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto overscroll-contain pb-6">
              {/* ── Navigation tab ──────────────────────────────────────────────── */}
              {activeTab === "nav" && (
                <div className="px-4 space-y-0.5 pt-1">
                  {/* Quick links */}
                  <div className="grid grid-cols-2 gap-1.5 mb-2">
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
                          className="nav-item-enter flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-heading transition-all text-left"
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

                  {navItems.length > 0 ? (
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading px-1 pb-1 pt-1">
                      {isAdminPage ? "Admin" : `${activeMod.label} Module`}
                    </p>
                  ) : !activeModule && !isAdminPage ? (
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading px-1 pb-1 pt-1">
                      Select a module above to get started
                    </p>
                  ) : null}

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
                            className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm font-heading transition-all text-left border"
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
                              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
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
                                    className="nav-item-enter w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-heading transition-all text-left"
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
                        className="nav-item-enter w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm font-heading transition-all text-left border"
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
                          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
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

              {/* ── Setup tab ───────────────────────────────────────────────────── */}
              {activeTab === "setup" && (
                <div className="px-4 pt-1.5">
                  {setupConfig.available ? (
                    <>
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <Settings size={13} className="text-muted-foreground" />
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading">
                          {setupConfig.label} Setup
                        </p>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {setupConfig.items.map(
                          ({ icon: Icon, label, path, color }, i) => {
                            const active = location.pathname === path;
                            return (
                              <button
                                key={path}
                                onClick={() => go(path)}
                                className="nav-item-enter group flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all duration-150 active:scale-95"
                                style={{
                                  animationDelay: `${i * 30}ms`,
                                  borderColor: active
                                    ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / 0.4)`
                                    : "hsl(var(--border))",
                                  background: active
                                    ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / 0.10)`
                                    : "transparent",
                                }}
                              >
                                <div
                                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                                  style={{
                                    background: active
                                      ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / 0.18)`
                                      : "hsl(var(--muted))",
                                  }}
                                >
                                  <Icon size={15} className={color} />
                                </div>
                                <span className="text-[10px] font-heading text-muted-foreground group-hover:text-foreground text-center leading-tight line-clamp-2 w-full">
                                  {label}
                                </span>
                              </button>
                            );
                          },
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-3 py-10 text-center">
                      <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
                        <Settings size={20} className="text-muted-foreground" />
                      </div>
                      <p className="text-sm font-heading text-muted-foreground">
                        Select a module to access Setup
                      </p>
                    </div>
                  )}
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
                          className="nav-item-enter flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left"
                          style={{
                            animationDelay: `${i * 50}ms`,
                            borderColor: isSelected
                              ? `${bg}66`
                              : "hsl(var(--border))",
                            background: isSelected ? `${bg}18` : "transparent",
                          }}
                        >
                          <div
                            className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center shadow-sm"
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
                                    : t === "root"
                                      ? "Warm amber tone"
                                      : "Soft glass tone"}
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
