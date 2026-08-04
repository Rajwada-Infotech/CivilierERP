import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useModule } from "@/contexts/ModuleContext";
import { useReminders } from "@/hooks/useReminders";
import { useAppVersion } from "@/hooks/useAppVersion";
import { useAuth } from "@/contexts/AuthContext";
import { useSidebarState } from "./layoutContexts";
import {
  Chart2,
  Calendar,
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
} from "iconsax-react";

// ── Per-module nav definitions ────────────────────────────────────────────────
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
import { loanNavItems } from "./sidebars/LoanSidebar";
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
    icon: Bank,
    color: "#6366f1",
    from: "from-indigo-500/30",
    to: "to-indigo-500/0",
  },
  material: {
    label: "Material",
    icon: Box,
    color: "#10b981",
    from: "from-emerald-500/30",
    to: "to-emerald-500/0",
  },
  followup: {
    label: "Follow-Up",
    icon: Calendar,
    color: "#0d9488",
    from: "from-teal-600/30",
    to: "to-teal-600/0",
  },
  engineering: {
    label: "Engineering",
    icon: Setting2,
    color: "#f97316",
    from: "from-orange-500/30",
    to: "to-orange-500/0",
  },
  ticket: {
    label: "Ticket",
    icon: Message2,
    color: "#ec4899",
    from: "from-pink-500/30",
    to: "to-pink-500/0",
  },
  sales: {
    label: "Sales",
    icon: Shop,
    color: "#a855f7",
    from: "from-purple-500/30",
    to: "to-purple-500/0",
  },
  records: {
    label: "Records",
    icon: Archive,
    color: "#e11d48",
    from: "from-rose-600/30",
    to: "to-rose-600/0",
  },
  civilworkdpr: {
    label: "Civil Work DPR",
    icon: Buildings2,
    color: "#0891b2",
    from: "from-cyan-600/30",
    to: "to-cyan-600/0",
  },
  "sales-automation": {
    label: "Sales Automation",
    icon: Volume,
    color: "#f59e0b",
    from: "from-amber-500/30",
    to: "to-amber-500/0",
  },
  crm: {
    label: "CRM",
    icon: Buildings2,
    color: "#0ea5e9",
    from: "from-sky-500/30",
    to: "to-sky-500/0",
  },
  loan: {
    label: "Loan",
    icon: MoneyRecive,
    color: "#22c55e",
    from: "from-green-500/30",
    to: "to-green-500/0",
  },
  admin: {
    label: "Admin",
    icon: ShieldTick,
    color: "#3b82f6",
    from: "from-blue-500/30",
    to: "to-blue-500/0",
  },
  super_admin: {
    label: "Super Admin",
    icon: Crown,
    color: "#eab308",
    from: "from-yellow-500/30",
    to: "to-yellow-500/0",
  },
  dba: {
    label: "DBA",
    icon: Data,
    color: "#10b981",
    from: "from-emerald-500/30",
    to: "to-emerald-500/0",
  },
  user: {
    label: "Profile",
    icon: User,
    color: "#94a3b8",
    from: "from-slate-500/30",
    to: "to-slate-500/0",
  },
};

// ── Approval count poller ─────────────────────────────────────────────────────
function useApprovalCount() {
  const [count, setCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failRef = useRef(0);
  // Guards against state updates / rescheduling from a fetch that resolves
  // after the component (e.g. on logout) has already unmounted.
  const mountedRef = useRef(true);

  // Declared once per hook instance and only ever called from this effect's
  // own setTimeout chain — not passed as a prop/dependency elsewhere — so it
  // doesn't need useCallback. Refs (timerRef/failRef/mountedRef) are stable
  // across renders, so the stale-closure risk that exhaustive-deps would
  // normally flag doesn't apply here.
  const poll = () => {
    if (!mountedRef.current) return;
    if (document.visibilityState === "hidden") {
      timerRef.current = setTimeout(poll, 60_000);
      return;
    }
    const token = localStorage.getItem("token");
    window
      .fetch("/api/approval-inbox/count", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      .then((r) => (r.ok ? r.json().catch(() => ({})) : Promise.reject()))
      .then((d) => {
        if (!mountedRef.current) return;
        failRef.current = 0;
        setCount(d.count ?? 0);
        timerRef.current = setTimeout(poll, 60_000);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        failRef.current += 1;
        timerRef.current = setTimeout(
          poll,
          Math.min(5 * 60_000, 60_000 * failRef.current),
        );
      });
  };

  // Immediately re-poll when any page fires the "approval-action" custom
  // event (after an approve or reject). Without this the badge can take up
  // to 60 s to drop even though the approval already happened.
  const onApprovalAction = () => {
    if (!mountedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    poll();
  };

  useEffect(() => {
    mountedRef.current = true;
    poll();
    window.addEventListener("approval-action", onApprovalAction);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener("approval-action", onApprovalAction);
    };
  }, []);

  return count;
}

// ── AppSidebar (nav panel) ────────────────────────────────────────────────────
export const AppSidebar = () => {
  const location = useLocation();
  const { activeModule } = useModule();
  const { setCollapsed } = useSidebarState();
  const { badgeCount: overdueCount } = useReminders();
  const { currentUser } = useAuth();
  useAppVersion();
  const pendingApprovalCount = useApprovalCount();

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
  const canAccessApprovalInbox = canAccessPage("approval-inbox" as any);
  const isAdminPage =
    (isAdminTier || canAccessApprovalInbox) &&
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
      // Non-admin-tier users with approval-inbox access see only that item
      return [
        {
          label: "Approval",
          icon: TickCircle,
          children: [
            {
              label: "Inbox",
              path: "/admin/approval/inbox",
              badge: pendingApprovalCount > 0 ? pendingApprovalCount : undefined,
            },
          ],
        },
      ];
    }
    if (isAdminPage) return buildAdminNavItems(pendingApprovalCount);

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
        raw = civilWorkDprNavItems;
        break;
      case "sales-automation":
        raw = salesAutomationNavItems;
        break;
      case "crm":
        raw = crmNavItems;
        break;
      case "loan":
        raw = loanNavItems;
        break;
      case "admin":
        raw = buildAdminNavItems(pendingApprovalCount);
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
      <aside
        className="relative flex-1 flex flex-col bg-sidebar"
        style={{
          borderTopLeftRadius: 20,
          borderBottomLeftRadius: 20,
          overflow: "hidden",
          isolation: "isolate",
          clipPath: "inset(0 0 0 0 round 20px 0 0 20px)",
        }}
      >
        {/* ── Module-colored radial glow at top ────────────────────────────────── */}
        <AnimatePresence mode="wait">
          <motion.div
            key={resolvedKey + "-bg"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute top-0 left-0 right-0 h-14 pointer-events-none z-0"
            style={{
              background: `radial-gradient(ellipse at 30% 0%, ${accentColor}2A 0%, transparent 100%)`,
            }}
          />
        </AnimatePresence>

        {/* ── Left accent stripe — fades at top & dissolves well before bottom curve */}
        <AnimatePresence mode="wait">
          <motion.div
            key={resolvedKey + "-stripe"}
            initial={{ opacity: 0, scaleY: 0 }}
            animate={{ opacity: 1, scaleY: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="absolute left-0 top-0 bottom-0 w-px pointer-events-none z-10"
            style={{
              background: `linear-gradient(to bottom, transparent 12%, ${accentColor}40 22%, ${accentColor}90 35%, ${accentColor}90 65%, ${accentColor}40 78%, transparent 88%)`,
              transformOrigin: "top",
              borderRadius: 20,
            }}
          />
        </AnimatePresence>

        {/* ── Fading right border ───────────────────────────────────────────────── */}
        <div
          className="absolute top-0 right-0 bottom-0 w-px pointer-events-none z-30"
          style={{
            background:
              "linear-gradient(to bottom, hsl(var(--sidebar-border)) 0%, hsl(var(--sidebar-border)) 55%, transparent 100%)",
          }}
        />

        {/* ── Module header ────────────────────────────────────────────────────── */}
        {header && (
          <AnimatePresence mode="wait">
            <motion.div
              key={resolvedKey}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="relative z-20 flex items-center gap-3 px-4 py-3.5 overflow-hidden"
            >
              {/* Header inner glow */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: `linear-gradient(135deg, ${accentColor}22 0%, transparent 60%)`,
                }}
              />
              {/* Icon badge */}
              <motion.div
                whileHover={{ scale: 1.08 }}
                className="relative z-10 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 shadow-sm"
                style={{
                  background: `${accentColor}28`,
                  color: accentColor,
                  border: `1px solid ${accentColor}40`,
                }}
              >
                <header.icon size={14} strokeWidth={2.2} />
              </motion.div>
              {/* Label */}
              <span
                className="relative z-10 text-[11px] font-bold tracking-widest uppercase"
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
          <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/40">
            Menu
          </p>
          <SidebarNav
            items={getNavItems()}
            collapsed={false}
            accentColor={accentColor}
          />
        </motion.div>

        {/* ── Footer ──────────────────────────────────────────────────────────── */}
        <div className="bg-sidebar/80 backdrop-blur-sm h-16 flex items-center justify-center">
          {/* Collapse — same size/style as expand button, rose accent */}
          <motion.button
            onClick={() => setCollapsed(true)}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.14 }}
            whileTap={{ scale: 0.88 }}
            transition={{ type: "spring", stiffness: 440, damping: 26 }}
            className="relative flex items-center justify-center w-8 h-8 rounded-full border transition-colors duration-150"
            style={{
              background: "rgba(244,63,94,0.12)",
              borderColor: "rgba(244,63,94,0.35)",
              color: "#f43f5e",
            }}
            title="Collapse menu"
          >
            {/* Inner sonar ring */}
            <motion.span
              className="absolute inset-0 rounded-full pointer-events-none"
              animate={{
                boxShadow: [
                  "0 0 0 0px rgba(244,63,94,0.80)",
                  "0 0 0 5px rgba(244,63,94,0)",
                  "0 0 0 0px rgba(244,63,94,0.80)",
                ],
              }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
            />
            {/* Outer sonar ring */}
            <motion.span
              className="absolute inset-0 rounded-full pointer-events-none"
              animate={{
                boxShadow: [
                  "0 0 0 0px rgba(244,63,94,0.55)",
                  "0 0 0 9px rgba(244,63,94,0)",
                  "0 0 0 0px rgba(244,63,94,0.55)",
                ],
              }}
              transition={{
                duration: 1.8,
                repeat: Infinity,
                ease: "easeOut",
                delay: 0.32,
              }}
            />
            <ArrowLeft2 size={13} />
          </motion.button>
        </div>
      </aside>
    </div>
  );
};