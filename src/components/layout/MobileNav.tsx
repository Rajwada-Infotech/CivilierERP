import { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  BarChart3,
  X,
  Receipt,
  HardHat,
  FileText,
  Puzzle,
  Users,
  ChevronRight,
  ChevronDown,
  Search,
  UserRound,
  Landmark,
  TrendingUp,
  ClipboardList,
  Grip,
  Home,
  Settings,
  Layers,
  Map,
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
  GitBranch,
  XCircle,
  Percent,
  Wrench,
  Handshake,
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
  MoneyRecive,
  Cpu,
  ShoppingCart,
} from "iconsax-react";

import { useModule } from "@/contexts/ModuleContext";
import { MODULE_DASHBOARD_ROUTES, firstAccessibleAdminPath, hasAnyAdminPageRight, isAdminTierRole, userHasModuleAccess as sharedUserHasModuleAccess } from "@/contexts/module.utils";
import { ALL_MODULES, hexToHsl } from "./moduleDefs";
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
import { fixedAssetNavItems } from "./sidebars/FixedAssetSidebar";
import { maintenanceNavItems } from "./sidebars/MaintenanceSidebar";
import { followupNavItems } from "./sidebars/FollowupSidebar";
import { buildAdminNavItems } from "./sidebars/AdminSidebar";
import { dbaNavItems } from "./sidebars/DbaSidebar";
import { superAdminNavItems } from "./sidebars/SuperAdminSidebar";
import { buildTicketNavItems } from "./sidebars/TicketSidebar";
import { salesNavItems } from "./sidebars/SalesSidebar";
import { recordsNavItems } from "./sidebars/RecordsSidebar";
import { buildCivilWorkDprNavItems } from "./sidebars/CivilWorkDprSidebar";
import { salesAutomationNavItems } from "./sidebars/SalesAutomationSidebar";
import { crmNavItems } from "./sidebars/CrmSidebar";
import { loanNavItems } from "./sidebars/LoanSidebar";
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
// Built from the shared module list (moduleDefs.tsx) — the same icon, name, colour and order as the
// desktop module strip and the top bar. Only the "Menu" placeholder (no module open) is local.
type ModuleMeta = {
  h: number;
  s: number;
  l: number;
  icon: React.ElementType;
  label: string;
  route: string;
};
const MODULE_META: Record<string, ModuleMeta> = {
  __none__: { h: 242, s: 65, l: 58, icon: Grip, label: "Menu", route: "/home" },
  ...Object.fromEntries(
    ALL_MODULES.map((m): [string, ModuleMeta] => [
      m.id,
      { ...hexToHsl(m.color), icon: m.icon, label: m.label, route: MODULE_DASHBOARD_ROUTES[m.id] },
    ]),
  ),
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
    label: "Vendors",
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
    icon: Handshake,
    label: "Partners",
    path: "/masters/partners",
    color: "text-orange-500",
    pageKey: "partner-master",
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
  {
    icon: Users,
    label: "Customer Master",
    path: "/masters/customers",
    color: "text-violet-500",
    pageKey: "customer-master",
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
];

const fixedAssetSetupItems: SetupItem[] = [
  {
    icon: Percent,
    label: "Depreciation Setup",
    path: "/fixed-asset/depreciation-setup",
    color: "text-yellow-500",
    pageKey: "depreciation-setup",
  },
  {
    icon: Hash,
    label: "ID Template Master",
    path: "/fixed-asset/id-template-master",
    color: "text-yellow-500",
    pageKey: "id-template-master",
  },
];

const maintenanceSetupItems: SetupItem[] = [
  {
    icon: Receipt,
    label: "Charge Head",
    path: "/masters/charge-head",
    color: "text-slate-500",
    pageKey: "charge-head-master",
  },
];

const followupSetupItems: SetupItem[] = [
  // "Task Master" moved into the Follow-Up module sidebar (followupNavItems)
  // — kept out of the Setup sheet so it isn't listed twice on mobile.
  {
    icon: Users,
    label: "Department Master",
    path: "/followup/setup/department-master",
    color: "text-cyan-500",
    pageKey: "followup-department-master",
  },
  {
    icon: Tag,
    label: "Tag Master",
    path: "/followup/setup/tag-master",
    color: "text-pink-500",
    pageKey: "followup-tag-master",
  },
  {
    icon: XCircle,
    label: "Cancel Template",
    path: "/followup/setup/cancel-template",
    color: "text-red-500",
    pageKey: "followup-cancel-template-master",
  },
];

const engineeringSetupItems: SetupItem[] = [
  {
    icon: Activity,
    label: "Engineering Activity Master",
    path: "/masters/engineering-activity",
    color: "text-orange-400",
    pageKey: "engineering-activity-master",
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
    icon: Ruler,
    label: "Unit Master",
    path: "/crm/setup/unit-master",
    color: "text-orange-500",
    pageKey: "followup-unit-master",
  },
  {
    icon: Map,
    label: "Plot Master",
    path: "/crm/setup/plot-master",
    color: "text-emerald-500",
    pageKey: "crm-auto-project-setup",
  },
  {
    icon: Layers,
    label: "Block Master",
    path: "/crm/setup/block-master",
    color: "text-cyan-500",
    pageKey: "followup-block-master",
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

const civilWorkDprSetupItems: SetupItem[] = [
  {
    icon: ClipboardList,
    label: "Activity Master",
    path: "/masters/activity",
    color: "text-cyan-500",
    pageKey: "activity-master",
  },
  {
    icon: DoorOpen,
    label: "Flat Master",
    path: "/civilworkdpr/room-master",
    color: "text-cyan-500",
    pageKey: "civilworkdpr-room-master",
  },
  {
    icon: GitBranch,
    label: "Dependency Master",
    path: "/masters/dependency",
    color: "text-cyan-500",
    pageKey: "dependency-master",
  },
];

export const MobileNav: React.FC = () => {
  // Which full-height sheet is open from the bottom bar: the module menu, or "Me" (profile, theme, sign out).
  const [sheet, setSheet] = useState<null | "menu" | "me">(null);
  const open = sheet !== null;
  const setOpen = (v: boolean) => { if (!v) setSheet(null); };
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [query, setQuery] = useState("");

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
    setSheet(null);
    setExpandedGroup(null);
    setQuery("");
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
    if (activeModule === "fixed-asset")
      return { items: fixedAssetSetupItems, label: "Fixed Asset", available: true };
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
    if (activeModule === "maintenance")
      return { items: maintenanceSetupItems, label: "Maintenance", available: true };
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
      case "fixed-asset":
        return adaptItems(fixedAssetNavItems as DesktopNavItem[]);
      case "maintenance":
        return adaptItems(maintenanceNavItems as DesktopNavItem[]);
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
        // Static 0 here — same precedent as buildAdminNavItems(0) above;
        // this badge isn't wired to a live poll on mobile.
        return adaptItems(buildCivilWorkDprNavItems(0) as DesktopNavItem[]);
      case "sales-automation":
        return adaptItems(salesAutomationNavItems as DesktopNavItem[]);
      case "crm":
        return adaptItems(crmNavItems as DesktopNavItem[]);
      case "loan":
        return adaptItems(loanNavItems as DesktopNavItem[]);
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

  // Exactly who the desktop module strip shows each module to.
  const isAdminTier = isAdminTierRole(currentUser?.role ?? "");
  const moduleModules = Object.entries(MODULE_META).filter(([id]) => {
    if (id === "__none__") return false;
    if (id === "admin") return isAdminTier || hasAnyAdminPageRight((pk) => canAccessPage(pk as any));
    return sharedUserHasModuleAccess(id, isAdminTier, (pk) => canAccessPage(pk as any));
  });

  const themeCheck: Record<Theme, string> = {
    dark: "#818cf8",
    light: "#7c3aed",
    glass: "#fb7185",
    bw: "#111111",
    sage: "#6b8f71",
  };

  const modColor = (alpha?: number) =>
    alpha == null
      ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}%)`
      : `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / ${alpha})`;
  const ActiveModIcon = activeMod.icon;

  const visibleSetupItems = setupConfig.items.filter((it) => !it.pageKey || canAccessPage(it.pageKey));

  // Open the group that holds the current page, so the menu opens where you are.
  useEffect(() => {
    if (sheet !== "menu") return;
    const g = navItems.find((it) => it.children?.some((c) => c.path === location.pathname));
    setExpandedGroup(g ? g.label : null);
    setShowSetup(visibleSetupItems.some((it) => it.path === location.pathname));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  // Find-a-page: every page of this module and its Setup, by name.
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: { label: string; path: string; where: string; icon?: React.ElementType }[] = [];
    navItems.forEach((it) => {
      if (it.path && it.label.toLowerCase().includes(q)) out.push({ label: it.label, path: it.path, where: activeMod.label, icon: it.icon });
      it.children?.forEach((c) => {
        if (c.label.toLowerCase().includes(q) || it.label.toLowerCase().includes(q))
          out.push({ label: c.label, path: c.path, where: it.label, icon: it.icon });
      });
    });
    visibleSetupItems.forEach((it) => {
      if (it.label.toLowerCase().includes(q)) out.push({ label: it.label, path: it.path, where: "Setup", icon: it.icon });
    });
    return out.slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, navItems.length, activeModKey, visibleSetupItems.length]);

  const profilePath = isSuperAdmin
    ? "/superadmin/profile"
    : isDba
      ? "/dba/profile"
      : currentUser?.role === "admin"
        ? "/admin/profile"
        : "/user/profile";

  const roleLabel = isSuperAdmin ? "Super Admin" : isDba ? "DBA" : isAdmin ? "Admin" : (currentUser?.role || "User");

  const switchModule = (id: string, meta: ModuleMeta) => {
    if (id === "admin") {
      navigate(
        isAdminTier
          ? "/admin/dashboard"
          : firstAccessibleAdminPath((pk) => canAccessPage(pk as any)) ?? "/admin/approval/inbox",
      );
    } else {
      setActiveModule(id as any);
      navigate(meta.route);
    }
    setSheet(null);
  };

  const Avatar = ({ size }: { size: number }) => (
    <span
      className="relative inline-flex shrink-0 overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        background: currentUser?.avatarUrl
          ? "hsl(var(--muted))"
          : `linear-gradient(135deg, ${modColor()}, hsl(${activeMod.h} ${activeMod.s}% ${Math.max(activeMod.l - 15, 20)}%))`,
      }}
    >
      {currentUser?.avatarUrl ? (
        <img src={currentUser.avatarUrl} alt={currentUser.name} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center font-heading font-bold text-white" style={{ fontSize: size * 0.38 }}>
          {currentUser?.initials || "?"}
        </span>
      )}
    </span>
  );

  // ── Bottom bar items ──────────────────────────────────────────────────────
  const barItems: { id: string; label: string; icon: React.ElementType; active: boolean; onClick: () => void }[] = [
    { id: "home", label: "Home", icon: Home, active: !sheet && location.pathname === "/home", onClick: () => go("/home") },
    { id: "menu", label: "Menu", icon: LayoutGrid, active: sheet === "menu", onClick: () => setSheet(sheet === "menu" ? null : "menu") },
    { id: "reports", label: "Reports", icon: BarChart3, active: !sheet && location.pathname.startsWith("/reports"), onClick: () => go("/reports") },
    { id: "me", label: "Me", icon: UserRound, active: sheet === "me", onClick: () => setSheet(sheet === "me" ? null : "me") },
  ];

  const rowBase = "w-full flex items-center gap-3 px-3 min-h-[46px] rounded-xl text-left transition-colors active:scale-[0.99]";

  return (
    <>
      {logoutOverlay}
      <style>{`
        @keyframes mnFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes mnSheet { from { transform: translateY(100%) } to { transform: translateY(0) } }
      `}</style>

      {/* ── Sheet (above the bar) ────────────────────────────────────────────── */}
      {open && (
        <div className="fixed inset-0 z-[60] md:hidden" style={{ animation: "mnFade 180ms ease-out both" }}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSheet(null)} />
          <div
            role="dialog"
            aria-label={sheet === "menu" ? `${activeMod.label} menu` : "Account"}
            className="absolute inset-x-0 flex flex-col overflow-hidden rounded-t-[1.75rem] border-t border-border shadow-2xl"
            style={{
              bottom: "calc(64px + env(safe-area-inset-bottom, 0px))",
              maxHeight: "calc(100svh - 64px - env(safe-area-inset-bottom, 0px) - 24px)",
              background: "hsl(var(--card))",
              animation: "mnSheet 280ms cubic-bezier(0.32, 0.72, 0, 1) both",
            }}
          >
            <div className="flex justify-center pt-2.5 pb-1 shrink-0">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/25" />
            </div>

            {sheet === "menu" && (
              <>
                {/* Header: current module, switch, close */}
                <div className="flex items-center gap-3 px-4 pt-1 pb-3 shrink-0">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm" style={{ background: modColor() }}>
                    <ActiveModIcon size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.625rem] uppercase tracking-[0.18em] text-muted-foreground">{activeModKey === "__none__" ? "Menu" : "You are in"}</p>
                    <p className="truncate font-heading text-base font-bold text-foreground">{activeModKey === "__none__" ? "Choose a module" : activeMod.label}</p>
                  </div>
                  <button onClick={() => setSheet(null)} aria-label="Close menu" className="flex h-9 w-9 items-center justify-center rounded-full border border-border">
                    <X size={16} className="text-muted-foreground" />
                  </button>
                </div>

                {/* Search */}
                <div className="px-4 pb-3 shrink-0">
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3">
                    <Search size={15} className="text-muted-foreground" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={activeModKey === "__none__" ? "Find a page…" : `Find a page in ${activeMod.label}…`}
                      className="h-11 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                    />
                    {query && (
                      <button onClick={() => setQuery("")} aria-label="Clear search"><X size={14} className="text-muted-foreground" /></button>
                    )}
                  </div>
                </div>

                <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-5 space-y-4">
                  {/* Modules: always shown - swipe for more */}
                  {!query.trim() && (
                    <div>
                      <div className="mb-2 flex items-center justify-between px-1">
                        <p className="text-[0.625rem] font-heading font-semibold uppercase tracking-[0.18em] text-muted-foreground">All modules</p>
                        <p className="text-[0.625rem] text-muted-foreground">{moduleModules.length} · swipe →</p>
                      </div>
                    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 snap-x" style={{ scrollbarWidth: "none" }}>
                      {moduleModules.map(([id, meta]) => {
                        const isActive = isAdminPage ? id === "admin" : activeModule === id;
                        const Icon = meta.icon;
                        const c = `hsl(${meta.h} ${meta.s}% ${meta.l}%)`;
                        return (
                          <button
                            key={id}
                            onClick={() => switchModule(id, meta)}
                            ref={isActive ? (el) => el?.scrollIntoView({ block: "nearest", inline: "center" }) : undefined}
                            className="flex w-[4.5rem] shrink-0 snap-start flex-col items-center gap-1.5 rounded-2xl border px-1 py-2.5 transition-colors"
                            style={{
                              borderColor: isActive ? c : "hsl(var(--border))",
                              background: isActive ? `hsl(${meta.h} ${meta.s}% ${meta.l}% / 0.10)` : "transparent",
                            }}
                          >
                            <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `hsl(${meta.h} ${meta.s}% ${meta.l}% / 0.14)`, color: c }}>
                              <Icon size={17} />
                            </span>
                            <span className="w-full truncate text-center text-[0.625rem] font-heading font-medium text-foreground">{meta.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    </div>
                  )}

                  {query.trim() ? (
                    /* Search results */
                    <div className="space-y-1">
                      {searchResults.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">No page matches “{query}”.</p>
                      ) : (
                        searchResults.map((r) => {
                          const Icon = r.icon;
                          const active = location.pathname === r.path;
                          return (
                            <button key={r.path + r.where} onClick={() => go(r.path)} className={rowBase} style={{ background: active ? modColor(0.1) : undefined }}>
                              {Icon && <Icon size={16} style={{ color: active ? modColor() : "hsl(var(--muted-foreground))" }} />}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-heading text-foreground">{r.label}</span>
                                <span className="block truncate text-[0.6875rem] text-muted-foreground">{r.where}</span>
                              </span>
                              <ChevronRight size={14} className="text-muted-foreground" />
                            </button>
                          );
                        })
                      )}
                    </div>
                  ) : (
                    <>
                      {/* Pages */}
                      {navItems.length > 0 && (
                        <p className="-mb-2 px-1 text-[0.625rem] font-heading font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          {activeMod.label} pages
                        </p>
                      )}
                      {navItems.length === 0 ? null : (
                        <div className="rounded-2xl border border-border p-1.5 space-y-0.5">
                          {navItems.map((item) => {
                            const active = isItemActive(item);
                            if (item.children) {
                              const isExpanded = expandedGroup === item.label;
                              return (
                                <div key={item.label}>
                                  <button
                                    onClick={() => setExpandedGroup(isExpanded ? null : item.label)}
                                    className={rowBase}
                                    style={{ background: isExpanded ? "hsl(var(--muted) / 0.5)" : undefined }}
                                    aria-expanded={isExpanded}
                                  >
                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: active ? modColor(0.15) : "hsl(var(--muted))" }}>
                                      <item.icon size={16} style={{ color: active ? modColor() : "hsl(var(--muted-foreground))" }} />
                                    </span>
                                    <span className="flex-1 text-sm font-heading" style={{ color: active ? modColor() : "hsl(var(--foreground))", fontWeight: active ? 600 : 500 }}>
                                      {item.label}
                                    </span>
                                    <span className="text-[0.625rem] tabular-nums text-muted-foreground">{item.children.length}</span>
                                    <ChevronDown size={15} className="text-muted-foreground transition-transform duration-200" style={{ transform: isExpanded ? "rotate(180deg)" : undefined }} />
                                  </button>
                                  {isExpanded && (
                                    <div className="ml-7 mt-0.5 mb-1 border-l pl-2 space-y-0.5" style={{ borderColor: modColor(0.3) }}>
                                      {item.children.map((child) => {
                                        const childActive = location.pathname === child.path;
                                        return (
                                          <button
                                            key={child.path}
                                            onClick={() => go(child.path)}
                                            className="w-full flex items-center gap-2 rounded-lg px-3 min-h-[42px] text-left text-sm font-heading transition-colors"
                                            style={{ background: childActive ? modColor(0.12) : undefined, color: childActive ? modColor() : "hsl(var(--muted-foreground))", fontWeight: childActive ? 600 : 400 }}
                                          >
                                            <span className="flex-1">{child.label}</span>
                                            {!!child.count && (
                                              <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[0.625rem] font-medium text-destructive-foreground">{child.count}</span>
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
                              <button key={item.path} onClick={() => go(item.path!)} className={rowBase} style={{ background: active ? modColor(0.1) : undefined }}>
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: active ? modColor(0.18) : "hsl(var(--muted))" }}>
                                  <item.icon size={16} style={{ color: active ? modColor() : "hsl(var(--muted-foreground))" }} />
                                </span>
                                <span className="flex-1 text-sm font-heading" style={{ color: active ? modColor() : "hsl(var(--foreground))", fontWeight: active ? 600 : 500 }}>
                                  {item.label}
                                </span>
                                {active && <span className="h-2 w-2 rounded-full" style={{ background: modColor() }} />}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Setup */}
                      {setupConfig.available && visibleSetupItems.length > 0 && (
                        <div className="rounded-2xl border border-border">
                          <button onClick={() => setShowSetup((v) => !v)} className={`${rowBase} rounded-2xl`} aria-expanded={showSetup}>
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                              <Settings size={16} className="text-muted-foreground" />
                            </span>
                            <span className="flex-1 text-sm font-heading font-medium text-foreground">{setupConfig.label} Setup</span>
                            <span className="text-[0.625rem] tabular-nums text-muted-foreground">{visibleSetupItems.length}</span>
                            <ChevronDown size={15} className="text-muted-foreground transition-transform duration-200" style={{ transform: showSetup ? "rotate(180deg)" : undefined }} />
                          </button>
                          {showSetup && (
                            <div className="grid gap-1.5 p-1.5 pt-0" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                              {visibleSetupItems.map(({ icon: Icon, label, path, color }) => {
                                const active = location.pathname === path;
                                return (
                                  <button
                                    key={path}
                                    onClick={() => go(path)}
                                    className="flex flex-col items-center gap-1.5 rounded-xl border p-2 transition-colors active:scale-95"
                                    style={{ borderColor: active ? modColor(0.45) : "hsl(var(--border))", background: active ? modColor(0.1) : "transparent" }}
                                  >
                                    <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: active ? modColor(0.18) : "hsl(var(--muted))" }}>
                                      <Icon size={15} className={color} />
                                    </span>
                                    <span className="line-clamp-2 w-full text-center text-[0.625rem] font-heading leading-tight text-muted-foreground">
                                      {label.replace(/ Master$/, "")}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Widgets (the one quick link not in the bottom bar) */}
                      <button onClick={() => go("/widgets")} className={`${rowBase} border border-border rounded-2xl`}>
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <Puzzle size={16} className="text-muted-foreground" />
                        </span>
                        <span className="flex-1 text-sm font-heading font-medium text-foreground">Widgets</span>
                        <ChevronRight size={14} className="text-muted-foreground" />
                      </button>
                    </>
                  )}
                </div>
              </>
            )}

            {sheet === "me" && (
              <div className="overflow-y-auto overscroll-contain px-4 pb-6">
                {/* Profile card */}
                <div className="flex items-center gap-3 rounded-2xl border border-border p-3">
                  <Avatar size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-heading text-sm font-bold text-foreground">{currentUser?.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{currentUser?.email}</p>
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.625rem] font-semibold" style={{ background: modColor(0.12), color: modColor() }}>
                      {isSuperAdmin ? <Crown size={10} /> : isDba ? <Data size={10} /> : isAdmin ? <ShieldTick size={10} /> : null}
                      {roleLabel}
                    </span>
                  </div>
                  <button onClick={() => setSheet(null)} aria-label="Close" className="flex h-9 w-9 items-center justify-center self-start rounded-full border border-border">
                    <X size={16} className="text-muted-foreground" />
                  </button>
                </div>

                <button onClick={() => go(profilePath)} className={`${rowBase} mt-3 border border-border rounded-2xl`}>
                  <Profile size={17} className="text-muted-foreground" />
                  <span className="flex-1 text-sm font-heading font-medium text-foreground">My profile</span>
                  <ChevronRight size={14} className="text-muted-foreground" />
                </button>

                {/* Theme */}
                <p className="mt-5 mb-2 px-1 text-[0.625rem] font-heading uppercase tracking-[0.18em] text-muted-foreground">Appearance</p>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.entries(THEME_DOTS) as [Theme, { bg: string; label: string }][]).map(([t, { bg, label }]) => {
                    const isSelected = theme === t;
                    return (
                      <button
                        key={t}
                        onClick={() => setTheme(t)}
                        className="flex items-center gap-2.5 rounded-xl border px-3 min-h-[48px] text-left transition-colors"
                        style={{ borderColor: isSelected ? bg : "hsl(var(--border))", background: isSelected ? `${bg}18` : "transparent" }}
                        aria-pressed={isSelected}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-sm" style={{ background: bg }}>
                          {isSelected && (
                            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                              <path d="M3 8l3.5 3.5L13 5" stroke={themeCheck[t]} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <span className="text-sm font-heading font-medium text-foreground">{label}</span>
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={handleLogout}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/30 min-h-[48px] text-sm font-heading font-semibold text-destructive active:bg-destructive/10"
                >
                  <Logout size={17} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Bottom tab bar ───────────────────────────────────────────────────── */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-[61] md:hidden border-t border-border"
        style={{
          background: "hsl(var(--card) / 0.92)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div className="grid h-16" style={{ gridTemplateColumns: `repeat(${barItems.length}, minmax(0, 1fr))` }}>
          {barItems.map(({ id, label, icon: Icon, active, onClick }) => {
            const isMenu = id === "menu";
            return (
              <button
                key={id}
                onClick={onClick}
                aria-label={isMenu ? `${label} menu` : label}
                aria-current={active && !isMenu && id !== "me" ? "page" : undefined}
                className="relative flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform"
              >
                {active && !isMenu && <span className="absolute top-0 h-0.5 w-8 rounded-full" style={{ background: modColor() }} />}
                {isMenu ? (
                  <span
                    className="relative flex h-9 w-12 items-center justify-center rounded-2xl text-white shadow-md"
                    style={{ background: modColor(), boxShadow: `0 6px 16px -6px ${modColor(0.7)}` }}
                  >
                    {sheet === "menu" ? <X size={18} /> : <Icon size={18} />}
                    {/* The open module, so "Menu" plainly means "this module's pages and every other module". */}
                    {sheet !== "menu" && activeModKey !== "__none__" && (
                      <span className="absolute -top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 bg-card" style={{ borderColor: "hsl(var(--card))", color: modColor() }}>
                        <ActiveModIcon size={11} />
                      </span>
                    )}
                  </span>
                ) : id === "me" ? (
                  <span className="rounded-full" style={{ boxShadow: active ? `0 0 0 2px ${modColor()}` : undefined }}>
                    <Avatar size={24} />
                  </span>
                ) : (
                  <Icon size={21} style={{ color: active ? modColor() : "hsl(var(--muted-foreground))" }} strokeWidth={active ? 2.3 : 1.8} />
                )}
                <span
                  className="max-w-full truncate px-1 text-[0.625rem] font-heading leading-none"
                  style={{ color: active || isMenu ? modColor() : "hsl(var(--muted-foreground))", fontWeight: active || isMenu ? 600 : 500 }}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};

export default MobileNav;
