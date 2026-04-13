import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  BarChart3,
  CheckCircle2,
  Menu,
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
  ChevronDown,
  Layers,
  Scale,
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
  RefreshCw,
  CalendarClock,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useModule, MODULE_DASHBOARD_ROUTES } from "@/contexts/ModuleContext";
import { BillingIcon } from "@/components/icons/BillingIcon";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme, THEME_DOTS, Theme } from "@/contexts/ThemeContext";
import { useTask } from "@/contexts/TaskContext";
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
  isMasters?: boolean;
}

// ─── Reminder Types & Helpers ─────────────────────────────────────────────────

interface ReminderItem {
  id: string | number;
  type: "purchase_order" | "grn" | "cheque" | "tds" | "general";
  title: string;
  subtitle: string;
  dueDate: string;
  timeSlot?: string;
  urgency: "overdue" | "today" | "soon" | "upcoming";
  amount?: number;
}

const URGENCY_CFG = {
  overdue: {
    label: "Overdue",
    cls: "bg-red-500/15 text-red-600 border-red-400/30",
    dot: "bg-red-500",
  },
  today: {
    label: "Today",
    cls: "bg-amber-500/15 text-amber-600 border-amber-400/30",
    dot: "bg-amber-500",
  },
  soon: {
    label: "Soon",
    cls: "bg-blue-500/15 text-blue-600 border-blue-400/30",
    dot: "bg-blue-500",
  },
  upcoming: {
    label: "Upcoming",
    cls: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
};

const REM_ICON: Record<ReminderItem["type"], React.ElementType> = {
  purchase_order: ShoppingCart,
  grn: Package,
  cheque: BookOpen,
  tds: FileWarning,
  general: Bell,
};

function classifyUrgency(d: string): ReminderItem["urgency"] {
  const due = new Date(d);
  due.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.floor((due.getTime() - now.getTime()) / 86400000);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 7) return "soon";
  return "upcoming";
}

function relLabel(d: string, ts?: string) {
  const due = new Date(d);
  due.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.floor((due.getTime() - now.getTime()) / 86400000);
  const base =
    diff < 0
      ? `${Math.abs(diff)}d overdue`
      : diff === 0
        ? "Today"
        : diff === 1
          ? "Tomorrow"
          : `In ${diff}d`;
  return ts ? `${base} · ${ts}` : base;
}

async function loadReminders(): Promise<ReminderItem[]> {
  const [poR, grnR, chqR, tdsR] = await Promise.allSettled([
    fetchWithAuth("/api/purchase-orders"),
    fetchWithAuth("/api/grns"),
    fetchWithAuth("/api/cheque-master"),
    fetchWithAuth("/api/tds-master"),
  ]);
  const items: ReminderItem[] = [];
  const push = (
    rows: any[],
    type: ReminderItem["type"],
    titleFn: (r: any) => string,
    subtitleFn: (r: any) => string,
    dateFn: (r: any) => string,
    amtFn: (r: any) => number | undefined,
    tsFn: (r: any) => string | undefined,
  ) => {
    rows.forEach((r) => {
      const d = dateFn(r);
      if (!d) return;
      const urgency = classifyUrgency(d);
      if (urgency === "upcoming") return;
      items.push({
        id: `${type}-${r.Id ?? r.id}`,
        type,
        title: titleFn(r),
        subtitle: subtitleFn(r),
        dueDate: d,
        timeSlot: tsFn(r),
        urgency,
        amount: amtFn(r),
      });
    });
  };
  if (poR.status === "fulfilled" && poR.value.ok) {
    const d = await poR.value.json();
    push(
      Array.isArray(d) ? d : (d.data ?? []),
      "purchase_order",
      (r) => `PO #${r.PONumber || r.DocumentNumber || r.Id}`,
      (r) => r.SupplierName || r.VendorName || "Purchase Order",
      (r) => r.ExpectedDeliveryDate || r.DeliveryDate || r.DocumentDate,
      (r) => r.TotalAmount || r.Amount,
      (r) => r.TimeSlot || r.DeliveryTime,
    );
  }
  if (grnR.status === "fulfilled" && grnR.value.ok) {
    const d = await grnR.value.json();
    push(
      Array.isArray(d) ? d : (d.data ?? []),
      "grn",
      (r) => `GRN #${r.GRNNumber || r.DocumentNumber || r.Id}`,
      (r) => r.SupplierName || r.VendorName || "Goods Receipt",
      (r) => r.ExpectedDate || r.ReceivedDate || r.DocumentDate,
      (r) => r.TotalAmount,
      (r) => r.TimeSlot,
    );
  }
  if (chqR.status === "fulfilled" && chqR.value.ok) {
    const d = await chqR.value.json();
    push(
      Array.isArray(d) ? d : (d.data ?? []),
      "cheque",
      (r) => `Cheque #${r.ChequeNumber || r.Id}`,
      (r) => r.BankName || r.PartyName || "Cheque",
      (r) => r.ChequeDate || r.DueDate || r.Date,
      (r) => r.Amount,
      (r) => r.TimeSlot,
    );
  }
  if (tdsR.status === "fulfilled" && tdsR.value.ok) {
    const d = await tdsR.value.json();
    push(
      Array.isArray(d) ? d : (d.data ?? []),
      "tds",
      (r) => `TDS #${r.TDSCertificateNo || r.Id}`,
      (r) => r.PartyName || r.DeducteeName || "TDS Payment",
      (r) => r.DueDate || r.PaymentDate || r.Date,
      (r) => r.TDSAmount || r.Amount,
      (r) => r.TimeSlot,
    );
  }
  const ORD = { overdue: 0, today: 1, soon: 2, upcoming: 3 };
  items.sort((a, b) => ORD[a.urgency] - ORD[b.urgency]);
  return items;
}

export const MobileNav: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [groupStates, setGroupStates] = useState<Record<string, boolean>>({});
  const [setupOpen, setSetupOpen] = useState(false);
  const [remOpen, setRemOpen] = useState(false);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [remLoading, setRemLoading] = useState(false);
  const [remFetched, setRemFetched] = useState(false);
  const [badgeCount, setBadgeCount] = useState(0);

  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { currentUser, logout } = useAuth();
  const { activeModule, setActiveModule } = useModule();
  const { getOverdueTasks } = useTask();
  const { handleLogout, overlay: logoutOverlay } = useGracefulLogout();

  const overdueCount = getOverdueTasks().length;

  // Background badge count
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const items = await loadReminders();
        if (!cancelled) {
          setBadgeCount(
            items.filter(
              (i) => i.urgency === "overdue" || i.urgency === "today",
            ).length,
          );
        }
      } catch {
        /* non-critical */
      }
    };
    refresh();
    const id = setInterval(refresh, 120_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const fetchReminders = useCallback(async () => {
    setRemLoading(true);
    try {
      const items = await loadReminders();
      setReminders(items);
      setBadgeCount(
        items.filter((i) => i.urgency === "overdue" || i.urgency === "today")
          .length,
      );
      setRemFetched(true);
    } catch {
      /* non-critical */
    } finally {
      setRemLoading(false);
    }
  }, []);

  const isAdminPage =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/users") ||
    location.pathname.startsWith("/dba");

  const isSuperAdmin = currentUser?.role === "super_admin";
  const isDba = currentUser?.role === "dba";
  const isAdmin = currentUser?.role === "admin" || isSuperAdmin || isDba;

  // Admin Navigation Items
  const ADMIN_NAV_ITEMS: NavItem[] = [
    { label: "Transaction", icon: BarChart3, path: "/admin" },
    {
      label: "Enterprise",
      icon: Building2,
      children: [
        {
          label: "Business Unit",
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
      label: "Security",
      icon: ShieldCheck,
      children: [
        {
          label: "Password Reset",
          path: "/admin/security/password-reset",
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

  // Module-specific Navigation Items
  const getModuleNavItems = (): NavItem[] => {
    switch (activeModule) {
      case "material":
        return [
          {
            label: "Transaction",
            icon: Receipt,
            children: [
              {
                label: "GRN",
                path: "/material/grn",
                icon: Package,
              },
              {
                label: "Expense Booking",
                path: "/material/expense-booking",
                icon: Receipt,
              },
              {
                label: "Work Order",
                path: "/material/work-order",
                icon: HardHat,
              },
              {
                label: "Purchase Order",
                path: "/material/purchase-order",
                icon: FileText,
              },
            ],
          },
          {
            label: "Debit Note",
            icon: FileWarning,
            path: "/masters/debit-note",
          },
        ];

      case "finance":
        return [
          { label: "Amendments", icon: BarChart3, path: "/" },
          {
            label: "Query",
            icon: Landmark,
            children: [
              { label: "Trial Balance", path: "/transactions", icon: FileText },
              {
                label: "Tasks",
                path: "/tasks",
                icon: CheckCircle2,
                count: overdueCount,
              },
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
          {
            label: "Record Management",
            icon: Archive,
            children: [{ label: "Records", path: "/records", icon: Archive }],
          },
          { label: "Widgets", path: "/widgets", icon: Puzzle },
        ];

      case "followup":
        return [
          {
            label: "Dashboard",
            icon: BarChart3,
            path: "/followup",
          },
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
            label: "Agreement",
            icon: FileText,
            children: [
              {
                label: "Agreements",
                path: "/followup/agreement/agreements",
                icon: FileText,
              },
            ],
          },
          {
            label: "Finance",
            icon: Landmark,
            children: [
              {
                label: "Demands",
                path: "/followup/finance/demands",
                icon: FileText,
              },
              {
                label: "Payments",
                path: "/followup/finance/payments",
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
          {
            label: "Reports",
            icon: BarChart3,
            children: [
              {
                label: "Customer Report",
                path: "/followup/reports/customer",
                icon: FileText,
              },
              {
                label: "Financial Report",
                path: "/followup/reports/financial",
                icon: FileText,
              },
              {
                label: "Project Status",
                path: "/followup/reports/project-status",
                icon: FileText,
              },
            ],
          },
        ];

      default:
        return [{ label: "Amendments", icon: BarChart3, path: "/" }];
    }
  };

  const itemsToRender = isAdminPage ? ADMIN_NAV_ITEMS : getModuleNavItems();

  // ── Setup items (mirrors TopNavbar desktop Setup dropdown) ─────────────────
  const financeSetupItems = [
    {
      icon: Layers,
      label: "AC Group",
      path: "/masters/account-group",
      color: "text-indigo-500",
    },
    {
      icon: Receipt,
      label: "General Ledger",
      path: "/masters/general-ledger",
      color: "text-orange-400",
    },
    {
      icon: Truck,
      label: "Suppliers",
      path: "/masters/suppliers",
      color: "text-blue-400",
    },
    {
      icon: HardHat,
      label: "Contractors",
      path: "/masters/contractors",
      color: "text-yellow-500",
    },
    {
      icon: Users,
      label: "Customers",
      path: "/masters/customers",
      color: "text-purple-400",
    },
    {
      icon: Landmark,
      label: "Banks",
      path: "/masters/banks",
      color: "text-green-500",
    },
    {
      icon: Calendar,
      label: "Fin Year",
      path: "/masters/financial-year",
      color: "text-amber-500",
    },
    {
      icon: BookOpen,
      label: "Cheque",
      path: "/masters/cheque",
      color: "text-cyan-500",
    },
    {
      icon: CreditCard,
      label: "Card",
      path: "/masters/card",
      color: "text-rose-500",
    },
    {
      icon: FileText,
      label: "TDS",
      path: "/masters/tds",
      color: "text-emerald-500",
    },
  ];
  const materialSetupItems = [
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
    { icon: Hash, label: "HSN", path: "/masters/hsn", color: "text-pink-400" },
    {
      icon: Activity,
      label: "Activity",
      path: "/masters/activity",
      color: "text-green-400",
    },
    {
      icon: BillingIcon,
      label: "Billing",
      path: "/masters/billing-terms",
      color: "text-lime-500",
    },
  ];
  const adminSetupItems = [
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
  ];

  const getSetupConfig = () => {
    if (isAdminPage)
      return {
        items: adminSetupItems,
        label: "Admin",
        available: true,
        accent: "text-blue-500",
        bg: "bg-blue-500/10",
        border: "border-blue-400/40",
      };
    if (activeModule === "material")
      return {
        items: materialSetupItems,
        label: "Material",
        available: true,
        accent: "text-emerald-500",
        bg: "bg-emerald-500/10",
        border: "border-emerald-400/40",
      };
    if (activeModule === "finance")
      return {
        items: financeSetupItems,
        label: "Finance",
        available: true,
        accent: "text-primary",
        bg: "bg-primary/10",
        border: "border-primary/40",
      };
    return {
      items: [],
      label: "",
      available: false,
      accent: "",
      bg: "",
      border: "",
    };
  };
  const setupConfig = getSetupConfig();

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

  const themeCheckmarkClasses: Record<Theme, string> = {
    dark: "text-indigo-400",
    light: "text-violet-400",
    midnight: "text-teal-400",
    sepia: "text-amber-400",
    crimson: "text-rose-400",
  };

  return (
    <>
      {logoutOverlay}
      {/* Floating Action Button */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        className="fixed bottom-4 right-4 z-50 w-12 h-12 rounded-full gradient-accent text-primary-foreground flex items-center justify-center shadow-lg md:hidden"
      >
        <Menu size={20} />
        {badgeCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none border-2 border-card">
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Drawer */}
          <div className="absolute bottom-0 left-0 right-0 rounded-t-3xl bg-card border-t border-border max-h-[90vh] flex flex-col shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
              <span className="font-heading font-semibold text-base text-foreground">
                Menu
              </span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground"
              >
                <X size={22} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 pb-6">
              {/* User Section */}
              <div className="p-5 border-b border-border">
                <div className="flex items-center gap-4">
                  <div className="relative w-12 h-12 rounded-2xl flex items-center justify-center bg-primary text-primary-foreground font-heading font-semibold text-lg flex-shrink-0">
                    {currentUser?.initials || "?"}
                    {isSuperAdmin && (
                      <span className="absolute -bottom-1 -right-1 w-6 h-6 flex items-center justify-center rounded-full border-2 border-card bg-violet-600">
                        <Crown size={12} className="text-white" />
                      </span>
                    )}
                    {!isSuperAdmin && isDba && (
                      <span className="absolute -bottom-1 -right-1 w-6 h-6 flex items-center justify-center rounded-full border-2 border-card bg-emerald-600">
                        <Database size={12} className="text-white" />
                      </span>
                    )}
                    {!isSuperAdmin && !isDba && isAdmin && (
                      <span className="absolute -bottom-1 -right-1 w-6 h-6 flex items-center justify-center rounded-full border-2 border-card bg-blue-600">
                        <ShieldCheck size={12} className="text-white" />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="font-heading font-semibold text-foreground truncate">
                      {currentUser?.name}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                      {currentUser?.email}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setOpen(false);
                        if (isSuperAdmin) navigate("/superadmin");
                        else if (isDba) navigate("/dba");
                        else if (currentUser?.role === "admin")
                          navigate("/admin/profile");
                        else navigate("/user/profile");
                      }}
                      className="p-3 border border-border rounded-2xl hover:bg-muted transition-colors"
                    >
                      <User size={18} />
                    </button>
                    <button
                      onClick={handleLogout}
                      className="p-3 border border-border rounded-2xl hover:bg-destructive/10 text-destructive transition-colors"
                    >
                      <LogOut size={18} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Module Switcher */}
              <div className="px-4 pt-4 pb-4 border-b border-border">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-2.5">
                  Module
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    {
                      label: "Finance",
                      module: "finance",
                      active: activeModule === "finance" && !isAdminPage,
                      icon: TrendingUp,
                      activeClass:
                        "bg-primary/10 border-primary/40 text-primary",
                      dotClass: "bg-primary",
                      onClick: () => {
                        setActiveModule("finance");
                        navigate(MODULE_DASHBOARD_ROUTES.finance);
                        setOpen(false);
                      },
                    },
                    {
                      label: "Material",
                      module: "material",
                      active: activeModule === "material" && !isAdminPage,
                      icon: Package,
                      activeClass:
                        "bg-emerald-500/10 border-emerald-500/40 text-emerald-600",
                      dotClass: "bg-emerald-500",
                      onClick: () => {
                        setActiveModule("material");
                        navigate(MODULE_DASHBOARD_ROUTES.material);
                        setOpen(false);
                      },
                    },
                    {
                      label: "Follow Up",
                      module: "followup",
                      active: activeModule === "followup" && !isAdminPage,
                      icon: Calendar,
                      activeClass:
                        "bg-indigo-500/10 border-indigo-500/40 text-indigo-600",
                      dotClass: "bg-indigo-500",
                      onClick: () => {
                        setActiveModule("followup");
                        navigate(MODULE_DASHBOARD_ROUTES.followup);
                        setOpen(false);
                      },
                    },
                    ...(isAdmin
                      ? [
                          {
                            label: "Admin",
                            module: "admin",
                            active: isAdminPage,
                            icon: ShieldCheck,
                            activeClass:
                              "bg-blue-500/10 border-blue-500/40 text-blue-600",
                            dotClass: "bg-blue-500",
                            onClick: () => {
                              navigate("/admin/dashboard");
                              setOpen(false);
                            },
                          },
                        ]
                      : []),
                  ].map((btn) => {
                    const Icon = btn.icon;
                    return (
                      <button
                        key={btn.module}
                        onClick={btn.onClick}
                        className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border transition-all text-left ${
                          btn.active
                            ? btn.activeClass
                            : "border-border hover:bg-muted text-foreground"
                        }`}
                      >
                        <Icon
                          size={15}
                          className={
                            btn.active ? "opacity-100" : "text-muted-foreground"
                          }
                        />
                        <span className="text-sm font-heading font-medium">
                          {btn.label}
                        </span>
                        {btn.active && (
                          <span
                            className={`ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0 ${btn.dotClass}`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Navigation */}
              <div className="px-4 pt-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-2.5">
                  Navigation
                </p>
              </div>

              {/* Setup Section */}
              {setupConfig.available && (
                <div className="px-4 pb-1">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setSetupOpen((p) => !p)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSetupOpen((p) => !p);
                      }
                    }}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-2xl border border-border hover:bg-muted transition-all text-sm font-heading text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <div className="flex items-center gap-2">
                      <Settings size={16} className="text-muted-foreground" />
                      <span>Setup</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-heading border ${setupConfig.bg} ${setupConfig.accent} ${setupConfig.border}`}
                      >
                        {setupConfig.label}
                      </span>
                    </div>
                    <ChevronDown
                      size={15}
                      className={`text-muted-foreground transition-transform duration-200 ${setupOpen ? "rotate-180" : ""}`}
                    />
                  </div>

                  {setupOpen && (
                    <div className="mt-2 p-3 rounded-2xl border border-border bg-muted/30">
                      <div className="grid grid-cols-4 gap-2">
                        {setupConfig.items.map(
                          ({ icon: Icon, label, path, color }) => (
                            <button
                              key={path}
                              onClick={() => go(path)}
                              className={`group flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all active:scale-95 ${
                                location.pathname === path
                                  ? "border-primary/40 bg-primary/[0.06]"
                                  : "border-transparent hover:border-border hover:bg-muted/60"
                              }`}
                            >
                              <div
                                className={`w-8 h-8 rounded-lg flex items-center justify-center bg-muted/50 group-hover:bg-muted transition-colors ${location.pathname === path ? "bg-primary/10" : ""}`}
                              >
                                <Icon size={16} className={color} />
                              </div>
                              <span className="text-[9px] font-heading text-muted-foreground group-hover:text-foreground text-center leading-tight line-clamp-2">
                                {label}
                              </span>
                            </button>
                          ),
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Reminders Section ──────────────────────────────── */}
              <div className="px-4 pb-2">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (!remFetched) fetchReminders();
                    setRemOpen((p) => !p);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (!remFetched) fetchReminders();
                      setRemOpen((p) => !p);
                    }
                  }}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-2xl border border-border hover:bg-muted transition-all text-sm font-heading text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <div className="flex items-center gap-2">
                    <Bell size={16} className="text-amber-500" />
                    <span>Reminders</span>
                    {badgeCount > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white leading-none">
                        {badgeCount}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        fetchReminders();
                      }}
                      className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <RefreshCw
                        size={12}
                        className={remLoading ? "animate-spin" : ""}
                      />
                    </button>
                    <ChevronDown
                      size={15}
                      className={`text-muted-foreground transition-transform duration-200 ${remOpen ? "rotate-180" : ""}`}
                    />
                  </div>
                </div>

                {remOpen && (
                  <div className="mt-2 rounded-2xl border border-border bg-muted/20 overflow-hidden">
                    {remLoading ? (
                      <div className="flex items-center justify-center gap-2 py-6">
                        <RefreshCw
                          size={16}
                          className="text-muted-foreground animate-spin"
                        />
                        <span className="text-xs text-muted-foreground">
                          Loading…
                        </span>
                      </div>
                    ) : reminders.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 gap-2 text-center px-4">
                        <CheckCircle2 size={24} className="text-emerald-500" />
                        <p className="text-sm font-heading font-semibold text-foreground">
                          All clear!
                        </p>
                        <p className="text-xs text-muted-foreground">
                          No overdue or upcoming items in the next 7 days.
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* urgency summary pills */}
                        {(() => {
                          const counts = reminders.reduce(
                            (a, r) => ({
                              ...a,
                              [r.urgency]: (a[r.urgency] || 0) + 1,
                            }),
                            {} as Record<string, number>,
                          );
                          return (
                            <div className="flex gap-1.5 px-3 pt-3 pb-1 flex-wrap">
                              {(["overdue", "today", "soon"] as const).map(
                                (u) =>
                                  counts[u] ? (
                                    <span
                                      key={u}
                                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${URGENCY_CFG[u].cls}`}
                                    >
                                      {counts[u]} {URGENCY_CFG[u].label}
                                    </span>
                                  ) : null,
                              )}
                            </div>
                          );
                        })()}
                        <div className="divide-y divide-border/50 max-h-56 overflow-y-auto">
                          {reminders.map((r) => {
                            const Icon = REM_ICON[r.type];
                            const cfg = URGENCY_CFG[r.urgency];
                            return (
                              <div
                                key={r.id}
                                className={`flex items-start gap-3 px-3 py-3
                                  ${r.urgency === "overdue" ? "bg-red-500/5" : r.urgency === "today" ? "bg-amber-500/5" : ""}`}
                              >
                                <div
                                  className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${cfg.cls}`}
                                >
                                  <Icon size={13} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-1">
                                    <p className="text-xs font-semibold text-foreground truncate">
                                      {r.title}
                                    </p>
                                    {r.amount !== undefined && (
                                      <span className="text-[10px] font-bold text-emerald-600 shrink-0">
                                        ₹{r.amount.toLocaleString("en-IN")}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-muted-foreground truncate">
                                    {r.subtitle}
                                  </p>
                                  <span
                                    className={`inline-flex items-center gap-1 mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${cfg.cls}`}
                                  >
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`}
                                    />
                                    {relLabel(r.dueDate, r.timeSlot)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <p className="text-[10px] text-muted-foreground text-center py-2 border-t border-border/60">
                          Overdue · Today · Next 7 days
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* ── Reports + Widgets quick links ───────────────────── */}
              <div className="px-4 pb-1 flex gap-2">
                <button
                  onClick={() => go("/reports")}
                  className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-2xl border text-sm font-heading transition-all
                    ${location.pathname === "/reports" ? "border-primary/40 bg-primary/10 text-primary" : "border-border hover:bg-muted text-foreground"}`}
                >
                  <BarChart3
                    size={16}
                    className={
                      location.pathname === "/reports"
                        ? "text-primary"
                        : "text-muted-foreground"
                    }
                  />
                  Reports
                </button>
                <button
                  onClick={() => go("/widgets")}
                  className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-2xl border text-sm font-heading transition-all
                    ${location.pathname === "/widgets" ? "border-primary/40 bg-primary/10 text-primary" : "border-border hover:bg-muted text-foreground"}`}
                >
                  <Puzzle
                    size={16}
                    className={
                      location.pathname === "/widgets"
                        ? "text-primary"
                        : "text-muted-foreground"
                    }
                  />
                  Widgets
                </button>
              </div>

              {/* Navigation Items */}
              <div className="px-4 space-y-1">
                {itemsToRender.map((item) => {
                  const openState = groupStates[item.label] ?? false;
                  const active = isActive(item.path, item.children);

                  if (item.children) {
                    return (
                      <div key={item.label}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleGroup(item.label)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleGroup(item.label);
                            }
                          }}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-heading transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
                            active
                              ? "bg-primary/10 text-primary hover:bg-primary/20"
                              : "hover:bg-muted text-foreground"
                          }`}
                        >
                          <item.icon size={18} className="flex-shrink-0" />
                          <span className="flex-1 text-left">{item.label}</span>
                          <ChevronDown
                            size={16}
                            className={`text-muted-foreground transition-transform ${openState ? "rotate-180" : ""}`}
                          />
                        </div>

                        {openState && (
                          <div className="ml-6 pl-4 border-l border-border mt-1 mb-2 space-y-0.5">
                            {item.children.map((child) => {
                              const childActive =
                                location.pathname === child.path;
                              const ChildIcon = child.icon;
                              return (
                                <button
                                  key={child.path}
                                  onClick={() => go(child.path)}
                                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all ${
                                    childActive
                                      ? "bg-primary/10 text-primary font-medium"
                                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                  }`}
                                >
                                  {ChildIcon && (
                                    <ChildIcon
                                      size={16}
                                      className="flex-shrink-0"
                                    />
                                  )}
                                  <span className="flex-1 text-left">
                                    {child.label}
                                  </span>
                                  {!!child.count && (
                                    <span className="text-xs bg-destructive text-destructive-foreground px-2 py-0.5 rounded-full font-medium">
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

                  // Simple item
                  return (
                    <button
                      key={item.path}
                      onClick={() => go(item.path!)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-heading transition-all ${
                        isActive(item.path)
                          ? "bg-primary/10 text-primary font-medium"
                          : "hover:bg-muted text-foreground"
                      }`}
                    >
                      <item.icon size={18} className="flex-shrink-0" />
                      <span className="flex-1 text-left">{item.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Theme Selector */}
              <div className="px-5 pt-8 border-t border-border mt-6">
                <div className="flex items-center gap-2 mb-4 px-1">
                  <Palette size={15} className="text-muted-foreground" />
                  <span className="text-xs uppercase tracking-widest font-heading text-muted-foreground">
                    Appearance
                  </span>
                </div>

                <div className="grid grid-cols-5 gap-3">
                  {(
                    Object.entries(THEME_DOTS) as [
                      Theme,
                      { bg: string; label: string },
                    ][]
                  ).map(([t, { bg, label }]) => {
                    const isSelected = theme === t;
                    return (
                      <button
                        key={t}
                        onClick={() => setTheme(t)}
                        className={`group flex flex-col items-center gap-2 py-2 rounded-2xl transition-all ${
                          isSelected ? "bg-primary/10" : "hover:bg-muted/70"
                        }`}
                      >
                        <div
                          className={`w-11 h-11 rounded-2xl flex items-center justify-center border-2 transition-all ${
                            isSelected
                              ? "border-primary scale-110 shadow"
                              : "border-transparent group-hover:border-border"
                          }`}
                          style={{ backgroundColor: bg }}
                        >
                          {isSelected && (
                            <CheckCircle2
                              size={22}
                              strokeWidth={3}
                              className={
                                themeCheckmarkClasses[t] || "text-white"
                              }
                            />
                          )}
                        </div>
                        <span
                          className={`text-[10px] font-medium text-center ${isSelected ? "text-foreground" : "text-muted-foreground"}`}
                        >
                          {label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MobileNav;
