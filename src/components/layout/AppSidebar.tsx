import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useModule } from "@/contexts/ModuleContext";
import { useReminders } from "@/hooks/useReminders";
import { useAppVersion } from "@/hooks/useAppVersion";
import { useAuth } from "@/contexts/AuthContext";
import { useSidebarState } from "./layoutContexts";
import { ModuleIcons, ChromeIcons } from "@/components/icons/moduleIcons";
import {
  Chart2,
  Grid1,
  ArrowLeft2,
  Crown,
  Data,
  Bank,
  Message2,
  Box,
  ShieldTick,
  Shop,
  Archive,
  User,
  Setting2,
  Buildings2,
  Volume,
  TickCircle,
  MoneyRecive,
  Cpu,
  Profile2User,
} from "iconsax-react";
import { Wrench } from "lucide-react";
import { TimelineIcon } from "@/components/icons/TimelineIcon";

// ── Per-module nav definitions ────────────────────────────────────────────────
import { engineeringNavItems } from "./sidebars/EngineeringSidebar";
import { buildFinanceNavItems } from "./sidebars/FinanceSidebar";
import { materialNavItems } from "./sidebars/MaterialSidebar";
import { followupNavItems } from "./sidebars/FollowupSidebar";
import { buildAdminNavItems, filterAdminNavItems } from "./sidebars/AdminSidebar";
import { hasAnyAdminPageRight } from "@/contexts/module.utils";
import { dbaNavItems } from "./sidebars/DbaSidebar";
import { superAdminNavItems } from "./sidebars/SuperAdminSidebar";
import { buildTicketNavItems } from "./sidebars/TicketSidebar";
import { salesNavItems } from "./sidebars/SalesSidebar";
import { recordsNavItems } from "./sidebars/RecordsSidebar";
import { buildCivilWorkDprNavItems } from "./sidebars/CivilWorkDprSidebar";
import { salesAutomationNavItems } from "./sidebars/SalesAutomationSidebar";
import { crmNavItems, withSentBackBadges } from "./sidebars/CrmSidebar";
import { loanNavItems } from "./sidebars/LoanSidebar";
import { fixedAssetNavItems } from "./sidebars/FixedAssetSidebar";
import { maintenanceNavItems } from "./sidebars/MaintenanceSidebar";

import { hrPayrollNavItems } from "./sidebars/HrPayrollSidebar";
import { legalNavItems } from "./sidebars/LegalSidebar";
import { SidebarNav, NavItem, SubItem } from "./sidebars/SidebarPrimitives";

// ── User sidebar ──────────────────────────────────────────────────────────────
const userNavItems: NavItem[] = [
  { label: "My Profile", icon: User, path: "/user/profile" },
  { label: "Dashboard", icon: Chart2, path: "/home", isDashboard: true },
];

// ── Module header metadata ────────────────────────────────────────────────────
const MODULE_HEADER: Record<
  string,
  {
    label: string;
    icon: React.ElementType;
    color: string;
    from: string;
    to: string;
  }
> = {
  finance: {
    label: "Finance",
    icon: ModuleIcons.finance,
    color: "#2419e6",
    from: "from-[#2419e6]/30",
    to: "to-[#2419e6]/0",
  },
  material: {
    label: "Material",
    icon: ModuleIcons.material,
    color: "#14b84b",
    from: "from-[#14b84b]/30",
    to: "to-[#14b84b]/0",
  },
  followup: {
    label: "Follow-Up",
    icon: ModuleIcons.followup,
    color: "#14b88c",
    from: "from-[#14b88c]/30",
    to: "to-[#14b88c]/0",
  },
  engineering: {
    label: "Engineering",
    icon: ModuleIcons.engineering,
    color: "#e66b19",
    from: "from-[#e66b19]/30",
    to: "to-[#e66b19]/0",
  },
  ticket: {
    label: "Ticket",
    icon: ModuleIcons.ticket,
    color: "#e619a8",
    from: "from-[#e619a8]/30",
    to: "to-[#e619a8]/0",
  },
  sales: {
    label: "Sales",
    icon: ModuleIcons.sales,
    color: "#6e19e6",
    from: "from-[#6e19e6]/30",
    to: "to-[#6e19e6]/0",
  },
  records: {
    label: "Records",
    icon: ModuleIcons.records,
    color: "#e61919",
    from: "from-[#e61919]/30",
    to: "to-[#e61919]/0",
  },
  civilworkdpr: {
    label: "Civil Work DPR",
    icon: ModuleIcons.civilWorkDpr,
    color: "#14a2b8",
    from: "from-[#14a2b8]/30",
    to: "to-[#14a2b8]/0",
  },
  "sales-automation": {
    label: "Sales Automation",
    icon: ModuleIcons.salesAutomation,
    color: "#e6195d",
    from: "from-[#e6195d]/30",
    to: "to-[#e6195d]/0",
  },
  crm: {
    label: "CRM",
    icon: ModuleIcons.crm,
    color: "#1990e6",
    from: "from-[#1990e6]/30",
    to: "to-[#1990e6]/0",
  },
  loan: {
    label: "Loan",
    icon: ModuleIcons.loan,
    color: "#43a512",
    from: "from-[#43a512]/30",
    to: "to-[#43a512]/0",
  },
  "fixed-asset": {
    label: "Fixed Asset",
    icon: ModuleIcons.fixedAsset,
    color: "#a57e12",
    from: "from-[#a57e12]/30",
    to: "to-[#a57e12]/0",
  },
  maintenance: {
    label: "Maintenance",
    icon: ModuleIcons.maintenance,
    color: "#88a512",
    from: "from-[#88a512]/30",
    to: "to-[#88a512]/0",
  },
  "hr-payroll": {
    label: "HR and Payroll",
    icon: ModuleIcons.hrPayroll,
    color: "#ca19e6",
    from: "from-[#ca19e6]/30",
    to: "to-[#ca19e6]/0",
  },
  legal: {
    label: "Legal",
    icon: ModuleIcons.legal,
    color: "#7c4a2e",
    from: "from-[#7c4a2e]/30",
    to: "to-[#7c4a2e]/0",
  },
  admin: {
    label: "Admin",
    icon: ModuleIcons.admin,
    color: "#1957e6",
    from: "from-[#1957e6]/30",
    to: "to-[#1957e6]/0",
  },
  super_admin: {
    label: "Super Admin",
    icon: ModuleIcons.superAdmin,
    color: "#eab308",
    from: "from-yellow-500/30",
    to: "to-yellow-500/0",
  },
  dba: {
    label: "DBA",
    icon: ModuleIcons.dba,
    color: "#10b981",
    from: "from-emerald-500/30",
    to: "to-emerald-500/0",
  },
  user: {
    label: "Profile",
    icon: ModuleIcons.profile,
    color: "#94a3b8",
    from: "from-slate-500/30",
    to: "to-slate-500/0",
  },
};

// ── Sidebar count poller ──────────────────────────────────────────────────────
// Polls a `{ count }` endpoint every 60 s (backing off on failure, paused while
// the tab is hidden) and re-polls at once when a page fires `refreshEvent`
// (after an approve or reject), so a badge drops without waiting for the next
// tick. `url` null = not polled (the module is not open).
function usePolledData(url: string | null, refreshEvent: string) {
  const [data, setData] = useState<any>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failRef = useRef(0);
  // Guards against state updates / rescheduling from a fetch that resolves
  // after the component (e.g. on logout) has already unmounted.
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!url) { setData(null); return; }
    mountedRef.current = true;
    const poll = () => {
      if (!mountedRef.current) return;
      if (document.visibilityState === "hidden") {
        timerRef.current = setTimeout(poll, 60_000);
        return;
      }
      const token = sessionStorage.getItem("token");
      window
        .fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then((r) => (r.ok ? r.json().catch(() => ({})) : Promise.reject()))
        .then((d) => {
          if (!mountedRef.current) return;
          failRef.current = 0;
          setData(d);
          timerRef.current = setTimeout(poll, 60_000);
        })
        .catch(() => {
          if (!mountedRef.current) return;
          failRef.current += 1;
          timerRef.current = setTimeout(poll, Math.min(5 * 60_000, 60_000 * failRef.current));
        });
    };
    const onRefresh = () => {
      if (!mountedRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      poll();
    };
    poll();
    window.addEventListener(refreshEvent, onRefresh);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener(refreshEvent, onRefresh);
    };
  }, [url, refreshEvent]);

  return data;
}

function usePolledCount(url: string | null, refreshEvent: string) {
  return usePolledData(url, refreshEvent)?.count ?? 0;
}

// ── AppSidebar (nav panel) ────────────────────────────────────────────────────
export const AppSidebar = () => {
  const location = useLocation();
  const { activeModule } = useModule();
  const { setCollapsed } = useSidebarState();
  const { badgeCount: overdueCount } = useReminders();
  const { currentUser } = useAuth();
  useAppVersion();
  // Module-wide Approval Inbox.
  const pendingApprovalCount = usePolledCount("/api/approval-inbox/count", "approval-action");
  // CRM entries sent back / resubmitted, per menu path (badges below).
  const crmSentBack = usePolledData(activeModule === "crm" ? "/api/crm/dashboard/sent-back" : null, "approval-action");
  // Civil Work DPR's own per-assignment approvals (dependencyActivityAssignmentApi.ts).
  const civilWorkDprApprovalCount = usePolledCount("/api/dependency-activity-assignment/approvals/pending-count", "civilworkdpr-approval-action");

  const { canAccessPage } = useAuth();

  const role = currentUser?.role ?? "";
  const isAdminTier = ["super_admin", "admin", "dba"].includes(role);
  // marketing_head acts as admin within Sales + SA modules
  const isMarketingHead = role === "marketing_head";
  const isAdminTierForModule = (mod: string | null) =>
    isAdminTier || (isMarketingHead && (mod === "sales-automation" || mod === "sales"));

  // Filter nav items by user's page rights.
  // Privileged roles always see everything.
  // For regular users: leaf items (path only) are hidden if no view right.
  // Group items (children) have their children filtered — the group disappears
  // entirely if all its children are hidden.
  const filterByRights = (items: NavItem[]): NavItem[] => {
    if (isAdminTierForModule(activeModule)) return items;
    return items.reduce<NavItem[]>((acc, item) => {
      if (item.children) {
        const visibleChildren = item.children.filter(
          (child: SubItem) =>
            !child.pageKey || canAccessPage(child.pageKey),
        );
        if (visibleChildren.length > 0) {
          acc.push({ ...item, children: visibleChildren });
        }
      } else if (item.sections) {
        acc.push(item); // sections don't have individual pageKeys yet
      } else {
        if (!item.pageKey || canAccessPage(item.pageKey)) {
          acc.push(item);
        }
      }
      return acc;
    }, []);
  };

  const ADMIN_SETUP_PATHS = [
    "/masters/named-entry-type",
    "/masters/type-of-doc",
  ];

  const isSuperAdminPage =
    role === "super_admin" && location.pathname.startsWith("/superadmin");
  // marketing_head cannot access DBA or system admin panels
  const isDbaPage = isAdminTier && location.pathname.startsWith("/dba");
  // Anyone with at least one Admin page ticked in Menu Rights can be on the Admin pages (they see only those).
  const canAccessAnyAdminPage = hasAnyAdminPageRight((pk) => canAccessPage(pk as any));
  const isAdminPage =
    (isAdminTier || canAccessAnyAdminPage) &&
    (location.pathname.startsWith("/admin") ||
      location.pathname.startsWith("/users") ||
      ADMIN_SETUP_PATHS.some((p) => location.pathname.startsWith(p)));
  const isUserProfilePage = location.pathname.startsWith("/user/profile");
  const isCustomerPage = role === "customer";

  const getNavItems = (): NavItem[] => {
    if (isCustomerPage)
      return [
        { label: "My Tickets", icon: Message2, path: "/customer-portal" },
        { label: "My Profile", icon: User, path: "/user/profile" },
      ];
    if (isSuperAdminPage) return superAdminNavItems;
    if (isDbaPage) return dbaNavItems;
    if (isUserProfilePage) return userNavItems;
    if (isAdminPage && !isAdminTier) {
      // Not admin-tier: only the Admin pages ticked for this role / user in Menu Rights.
      return filterAdminNavItems(buildAdminNavItems(pendingApprovalCount, role === "super_admin"), (pk) => canAccessPage(pk as any));
    }
    if (isAdminPage) return buildAdminNavItems(pendingApprovalCount, role === "super_admin");

    let raw: NavItem[] = [];
    switch (activeModule) {
      case "engineering":
        raw = engineeringNavItems;
        break;
      case "finance":
        raw = buildFinanceNavItems(overdueCount);
        break;
      case "material":
        raw = materialNavItems;
        break;
      case "followup":
        raw = followupNavItems;
        break;
      case "ticket":
        raw = buildTicketNavItems(isAdminTier);
        break;
      case "sales":
        raw = salesNavItems;
        break;
      case "records":
        raw = recordsNavItems;
        break;
      case "civilworkdpr":
        raw = buildCivilWorkDprNavItems(civilWorkDprApprovalCount);
        break;
      case "sales-automation":
        raw = salesAutomationNavItems;
        break;
      case "crm":
        raw = withSentBackBadges(crmNavItems, crmSentBack?.byPath);
        break;
      case "loan":
        raw = loanNavItems;
        break;
      case "fixed-asset":
        raw = fixedAssetNavItems;
        break;
      case "maintenance":
        raw = maintenanceNavItems;
        break;
      case "hr-payroll":
        raw = hrPayrollNavItems;
        break;
      case "legal":
        raw = legalNavItems;
        break;
      case "admin":
        raw = buildAdminNavItems(pendingApprovalCount, role === "super_admin");
        break;
      default:
        raw = [];
    }
    return filterByRights(raw);
  };

  // Resolve which header to show
  const resolvedKey = isSuperAdminPage
    ? "super_admin"
    : isDbaPage
      ? "dba"
      : isUserProfilePage
        ? "user"
        : isAdminPage
          ? "admin"
          : (activeModule ?? "");

  const header = resolvedKey ? MODULE_HEADER[resolvedKey] : null;

  const accentColor = header?.color ?? "#6366f1";

  return (
    <div className="h-full w-full flex flex-col py-2 bg-transparent">
      {/* A ruled sheet margin: square, ink border, faint grid. The module's own hue stays - as a bar across the top,
          a tint behind the header, and the marker on the active item. */}
      <aside
        className="app-sidebar relative flex-1 flex flex-col"
        style={{
          backgroundColor: "hsl(var(--card))",
          backgroundImage:
            "linear-gradient(hsl(var(--foreground) / 0.04) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground) / 0.04) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          border: "1.5px solid hsl(var(--foreground))",
          overflow: "hidden",
        }}
      >
        <div className="absolute top-0 left-0 right-0 z-30 transition-colors duration-300" style={{ height: 3, background: accentColor }} />

        {/* ── Module header ────────────────────────────────────────────────────── */}
        {header && (
          <AnimatePresence mode="wait">
            <motion.div
              key={resolvedKey}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="sb-head relative z-20 flex items-center gap-3 px-4 pt-4 pb-3 overflow-hidden"
              style={{ background: `${accentColor}1F`, borderBottom: "1px solid hsl(var(--foreground))" }}
            >
              {/* Icon tile */}
              <div
                className="sb-head-icon relative z-10 w-7 h-7 flex items-center justify-center shrink-0"
                style={{ color: accentColor, border: `1.5px solid ${accentColor}`, background: "hsl(var(--card))" }}
              >
                <header.icon size={14} strokeWidth={2.2} />
              </div>
              {/* Label */}
              <span
                className="sb-head-label relative z-10 font-heading text-[0.6875rem] font-bold tracking-[0.16em] uppercase"
                style={{ color: accentColor }}
              >
                {header.label}
              </span>
            </motion.div>
          </AnimatePresence>
        )}

        {/* ── Nav items ────────────────────────────────────────────────────────── */}
        <motion.div
          key={resolvedKey + "-nav"}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2, ease: "easeOut", delay: 0.06 }}
          className="relative z-10 flex-1 overflow-y-auto p-2 sidebar-scroll"
        >
          <p className="px-2 pt-1 pb-2 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Index
          </p>
          <SidebarNav
            items={getNavItems()}
            collapsed={false}
            accentColor={accentColor}
          />
        </motion.div>

        {/* ── Footer ──────────────────────────────────────────────────────────── */}
        <div className="h-14 flex items-center justify-center" style={{ borderTop: "1px solid hsl(var(--border))" }}>
          <motion.button
            onClick={() => setCollapsed(true)}
            whileTap={{ scale: 0.92 }}
            className="relative flex items-center justify-center w-8 h-8 text-foreground hover:bg-primary/10 transition-colors duration-150"
            style={{ border: "1px solid hsl(var(--foreground))" }}
            title="Collapse menu"
          >
            <ChromeIcons.left size={15} />
          </motion.button>
        </div>
      </aside>
    </div>
  );
};