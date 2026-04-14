import React, { useState, useRef, useEffect, useCallback } from "react";
import { useGracefulLogout } from "@/hooks/useGracefulLogout";
import { useNavigate, useLocation } from "react-router-dom";
import { LogoFull } from "../Logo";
import { useTheme, THEME_DOTS, Theme } from "@/contexts/ThemeContext";
import { useModule, MODULE_DASHBOARD_ROUTES } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavbarCollapse } from "./AppLayout";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Calendar,
  FileText,
  Settings,
  BarChart3,
  LogOut,
  User,
  Palette,
  LayoutGrid,
  Puzzle,
  ShieldCheck,
  Crown,
  Shield,
  Receipt,
  Truck,
  Users,
  HardHat,
  Landmark,
  ChevronsLeft,
  ChevronsRight,
  Package,
  Layers,
  Hash,
  CreditCard,
  BookOpen,
  Tag,
  FileType2,
  Activity,
  ChevronDown,
  Database,
  Bell,
  CheckCircle2,
  CalendarClock,
  ShoppingCart,
  FileWarning,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { BillingIcon } from "@/components/icons/BillingIcon";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReminderItem {
  id: string | number;
  type:
    | "payment"
    | "deadline"
    | "purchase_order"
    | "grn"
    | "cheque"
    | "tds"
    | "general";
  title: string;
  subtitle: string;
  dueDate: string;
  timeSlot?: string;
  urgency: "overdue" | "today" | "soon" | "upcoming";
  amount?: number;
}

// ─── Reminder helpers ─────────────────────────────────────────────────────────

function classifyUrgency(dueDateStr: string): ReminderItem["urgency"] {
  const due = new Date(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "today";
  if (diffDays <= 7) return "soon";
  return "upcoming";
}

const URGENCY_CONFIG = {
  overdue: {
    label: "Overdue",
    className: "bg-red-500/15 text-red-600 border-red-400/30",
    dot: "bg-red-500",
  },
  today: {
    label: "Today",
    className: "bg-amber-500/15 text-amber-600 border-amber-400/30",
    dot: "bg-amber-500",
  },
  soon: {
    label: "Soon",
    className: "bg-blue-500/15 text-blue-600 border-blue-400/30",
    dot: "bg-blue-500",
  },
  upcoming: {
    label: "Upcoming",
    className: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
};

const TYPE_ICON: Record<ReminderItem["type"], React.ElementType> = {
  payment: CreditCard,
  deadline: CalendarClock,
  purchase_order: ShoppingCart,
  grn: Package,
  cheque: BookOpen,
  tds: FileWarning,
  general: Bell,
};

function formatRelative(dueDateStr: string, timeSlot?: string): string {
  const due = new Date(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((due.getTime() - today.getTime()) / 86400000);
  const base =
    diffDays < 0
      ? `${Math.abs(diffDays)}d overdue`
      : diffDays === 0
        ? "Today"
        : diffDays === 1
          ? "Tomorrow"
          : `In ${diffDays} days`;
  return timeSlot ? `${base} · ${timeSlot}` : base;
}

async function fetchAllReminders(): Promise<ReminderItem[]> {
  const [poRes, grnRes, chequeRes, tdsRes] = await Promise.allSettled([
    fetchWithAuth("/api/purchase-orders"),
    fetchWithAuth("/api/grns"),
    fetchWithAuth("/api/cheque-master"),
    fetchWithAuth("/api/tds-master"),
  ]);

  const items: ReminderItem[] = [];

  // Purchase Orders
  if (poRes.status === "fulfilled" && poRes.value.ok) {
    const data = await poRes.value.json();
    (Array.isArray(data) ? data : (data.data ?? [])).forEach((po: any) => {
      const d = po.ExpectedDeliveryDate || po.DeliveryDate || po.DocumentDate;
      if (!d) return;
      const urgency = classifyUrgency(d);
      if (urgency === "upcoming") return;
      items.push({
        id: `po-${po.Id ?? po.id}`,
        type: "purchase_order",
        title: `PO #${po.PONumber || po.DocumentNumber || po.Id}`,
        subtitle: po.SupplierName || po.VendorName || "Purchase Order",
        dueDate: d,
        timeSlot: po.TimeSlot || po.DeliveryTime || undefined,
        urgency,
        amount: po.TotalAmount || po.Amount || undefined,
      });
    });
  }

  // GRNs
  if (grnRes.status === "fulfilled" && grnRes.value.ok) {
    const data = await grnRes.value.json();
    (Array.isArray(data) ? data : (data.data ?? [])).forEach((grn: any) => {
      const d = grn.ExpectedDate || grn.ReceivedDate || grn.DocumentDate;
      if (!d) return;
      const urgency = classifyUrgency(d);
      if (urgency === "upcoming") return;
      items.push({
        id: `grn-${grn.Id ?? grn.id}`,
        type: "grn",
        title: `GRN #${grn.GRNNumber || grn.DocumentNumber || grn.Id}`,
        subtitle: grn.SupplierName || grn.VendorName || "Goods Receipt",
        dueDate: d,
        timeSlot: grn.TimeSlot || undefined,
        urgency,
        amount: grn.TotalAmount || undefined,
      });
    });
  }

  // Cheques
  if (chequeRes.status === "fulfilled" && chequeRes.value.ok) {
    const data = await chequeRes.value.json();
    (Array.isArray(data) ? data : (data.data ?? [])).forEach((chq: any) => {
      const d = chq.ChequeDate || chq.DueDate || chq.Date;
      if (!d) return;
      const urgency = classifyUrgency(d);
      if (urgency === "upcoming") return;
      items.push({
        id: `chq-${chq.Id ?? chq.id}`,
        type: "cheque",
        title: `Cheque #${chq.ChequeNumber || chq.Id}`,
        subtitle: chq.BankName || chq.PartyName || "Cheque",
        dueDate: d,
        timeSlot: chq.TimeSlot || undefined,
        urgency,
        amount: chq.Amount || undefined,
      });
    });
  }

  // TDS
  if (tdsRes.status === "fulfilled" && tdsRes.value.ok) {
    const data = await tdsRes.value.json();
    (Array.isArray(data) ? data : (data.data ?? [])).forEach((tds: any) => {
      const d = tds.DueDate || tds.PaymentDate || tds.Date;
      if (!d) return;
      const urgency = classifyUrgency(d);
      if (urgency === "upcoming") return;
      items.push({
        id: `tds-${tds.Id ?? tds.id}`,
        type: "tds",
        title: `TDS #${tds.TDSCertificateNo || tds.Id}`,
        subtitle: tds.PartyName || tds.DeducteeName || "TDS Payment",
        dueDate: d,
        timeSlot: tds.TimeSlot || undefined,
        urgency,
        amount: tds.TDSAmount || tds.Amount || undefined,
      });
    });
  }

  const ORDER = { overdue: 0, today: 1, soon: 2, upcoming: 3 };
  items.sort((a, b) => ORDER[a.urgency] - ORDER[b.urgency]);
  return items;
}

// ─── Bell / Reminders Dropdown ────────────────────────────────────────────────

const RemindersDropdown: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await fetchAllReminders();
      setReminders(items);
      setFetched(true);
    } catch {
      /* non-critical */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !fetched) load();
  }, [open, fetched, load]);

  const urgencyCounts = reminders.reduce(
    (acc, r) => {
      acc[r.urgency] = (acc[r.urgency] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const criticalCount =
    (urgencyCounts.overdue || 0) + (urgencyCounts.today || 0);

  return (
    <div
      ref={ref}
      className={`absolute top-full mt-2 z-50 rounded-xl border border-border bg-card shadow-2xl transition-all duration-200 origin-top-right right-0
        ${open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"}`}
      style={{ width: "22rem" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Bell size={14} className="text-amber-500" />
          <span className="text-xs font-heading font-semibold text-foreground uppercase tracking-wider">
            Reminders
          </span>
          {criticalCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white leading-none">
              {criticalCount}
            </span>
          )}
        </div>
        <button
          onClick={() => {
            setFetched(false);
            load();
          }}
          title="Refresh"
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Summary pills */}
      {!loading && reminders.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border/60 flex-wrap">
          {(["overdue", "today", "soon"] as const).map((u) =>
            urgencyCounts[u] ? (
              <span
                key={u}
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${URGENCY_CONFIG[u].className}`}
              >
                {urgencyCounts[u]} {URGENCY_CONFIG[u].label}
              </span>
            ) : null,
          )}
        </div>
      )}

      {/* Body */}
      <div className="overflow-y-auto" style={{ maxHeight: "22rem" }}>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <RefreshCw
              size={18}
              className="text-muted-foreground animate-spin"
            />
            <p className="text-xs text-muted-foreground">Loading reminders…</p>
          </div>
        ) : reminders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-center px-4">
            <CheckCircle2 size={28} className="text-emerald-500" />
            <p className="text-sm font-heading font-semibold text-foreground">
              All clear!
            </p>
            <p className="text-xs text-muted-foreground">
              No overdue or upcoming items in the next 7 days.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {reminders.map((r) => {
              const Icon = TYPE_ICON[r.type];
              const cfg = URGENCY_CONFIG[r.urgency];
              return (
                <div
                  key={r.id}
                  className={`flex items-start gap-3 px-4 py-3 transition-colors cursor-default
                    ${
                      r.urgency === "overdue"
                        ? "bg-red-500/5 hover:bg-red-500/10"
                        : r.urgency === "today"
                          ? "bg-amber-500/5 hover:bg-amber-500/10"
                          : "hover:bg-muted/40"
                    }`}
                >
                  <div
                    className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${cfg.className}`}
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
                    <div className="mt-1">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${cfg.className}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`}
                        />
                        {formatRelative(r.dueDate, r.timeSlot)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border px-4 py-2.5">
        <p className="text-[10px] text-muted-foreground text-center">
          Overdue · Today · Next 7 days · Time-slotted items only
        </p>
      </div>
    </div>
  );
};

// ─── Generic Dropdown ─────────────────────────────────────────────────────────
const Dropdown = ({
  open,
  onClose,
  children,
  className,
  style,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, onClose]);
  return (
    <div
      ref={ref}
      style={style}
      className={`absolute top-full mt-2 z-50 rounded-xl border border-border bg-card shadow-2xl transition-all duration-200 origin-top-right
        ${open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"} ${className || ""}`}
    >
      {children}
    </div>
  );
};

// ─── Setup Items ──────────────────────────────────────────────────────────────
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
  {
    icon: FileText,
    label: "T&C",
    path: "/material/t-c-master",
    color: "text-purple-500",
  },
];

const followupSetupItems = [
  {
    icon: Calendar,
    label: "Reminders",
    path: "/followup/reminders",
    color: "text-indigo-500",
  },
  {
    icon: FileText,
    label: "Follow-up Log",
    path: "/followup/log",
    color: "text-violet-500",
  },
  {
    icon: Activity,
    label: "Pending Tasks",
    path: "/followup/tasks",
    color: "text-purple-500",
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

// ─── Setup Dropdown ───────────────────────────────────────────────────────────
const SetupDropdown = ({
  open,
  onClose,
  items,
  moduleLabel,
  moduleColor,
  navigate,
  location,
}: {
  open: boolean;
  onClose: () => void;
  items: {
    icon: React.ElementType;
    label: string;
    path: string;
    color: string;
  }[];
  moduleLabel: string;
  moduleColor: string;
  navigate: (p: string) => void;
  location: { pathname: string };
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, onClose]);
  return (
    <div
      ref={ref}
      className={`absolute top-full mt-2 z-50 rounded-xl border border-border bg-card shadow-2xl transition-all duration-200 origin-top-left left-0
        ${open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"}`}
      style={{ minWidth: "20rem" }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Settings size={14} className="text-muted-foreground" />
          <span className="text-xs font-heading font-semibold text-foreground uppercase tracking-wider">
            Setup
          </span>
        </div>
        <span
          className={`text-[10px] font-heading px-2 py-0.5 rounded-full border ${moduleColor}`}
        >
          {moduleLabel}
        </span>
      </div>
      <div className="p-3">
        <div className="grid grid-cols-4 gap-2">
          {items.map(({ icon: Icon, label, path, color }) => (
            <button
              key={path}
              onClick={() => {
                navigate(path);
                onClose();
              }}
              className={`group flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all duration-150 active:scale-95
                ${location.pathname === path ? "border-primary/40 bg-primary/[0.06]" : "border-transparent hover:border-border hover:bg-muted/60"}`}
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
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── TopNavbar ────────────────────────────────────────────────────────────────
export const TopNavbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { activeModule, setActiveModule, moduleSwitching, setModuleSwitching } =
    useModule();
  const { currentUser, logout } = useAuth();
  const { navCollapsed, setNavCollapsed } = useNavbarCollapse();
  const { handleLogout, overlay: logoutOverlay } = useGracefulLogout();

  const [setupOpen, setSetupOpen] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [moduleOpen, setModuleOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);

  // Badge count — fetched in background every 2 min
  const [badgeCount, setBadgeCount] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const items = await fetchAllReminders();
        if (!cancelled)
          setBadgeCount(
            items.filter(
              (i) => i.urgency === "overdue" || i.urgency === "today",
            ).length,
          );
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

  const ADMIN_PATHS = ["/masters/named-entry-type", "/masters/type-of-doc"];
  const isAdminPage =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/users") ||
    ADMIN_PATHS.some((p) => location.pathname.startsWith(p));
  const isSuperAdmin = currentUser?.role === "super_admin";
  const isDba = currentUser?.role === "dba";
  const isAdmin = currentUser?.role === "admin" || isSuperAdmin || isDba;

  const RoleIcon = isSuperAdmin
    ? Crown
    : isAdmin
      ? Shield
      : isDba
        ? Database
        : null;
  const roleBadgeCls = isSuperAdmin
    ? "bg-violet-600"
    : isDba
      ? "bg-emerald-600"
      : "bg-blue-600";

  const getSetupConfig = () => {
    if (isAdminPage)
      return {
        items: adminSetupItems,
        label: "Admin",
        color: "bg-blue-500/10 text-blue-600 border-blue-200/60",
        available: true,
      };
    if (activeModule === "material")
      return {
        items: materialSetupItems,
        label: "Material",
        color: "bg-emerald-500/10 text-emerald-600 border-emerald-200/60",
        available: true,
      };
    if (activeModule === "followup")
      return {
        items: followupSetupItems,
        label: "Follow-Up",
        color: "bg-indigo-500/10 text-indigo-600 border-indigo-200/60",
        available: true,
      };
    if (activeModule === "finance")
      return {
        items: financeSetupItems,
        label: "Finance",
        color: "bg-primary/10 text-primary border-primary/20",
        available: true,
      };
    return { items: [], label: "No Module", color: "", available: false };
  };
  const setupConfig = getSetupConfig();

  const closeAll = useCallback(() => {
    setSetupOpen(false);
    setModuleOpen(false);
    setUserOpen(false);
    setThemeOpen(false);
    setBellOpen(false);
  }, []);
  const toggleSetup = useCallback(() => {
    if (!setupConfig.available) return;
    setSetupOpen((p) => !p);
    setModuleOpen(false);
    setUserOpen(false);
    setThemeOpen(false);
    setBellOpen(false);
  }, [setupConfig.available]);
  const toggleMod = useCallback(() => {
    setModuleOpen((p) => !p);
    setSetupOpen(false);
    setUserOpen(false);
    setThemeOpen(false);
    setBellOpen(false);
  }, []);
  const toggleTheme = useCallback(() => {
    setThemeOpen((p) => !p);
    setSetupOpen(false);
    setModuleOpen(false);
    setUserOpen(false);
    setBellOpen(false);
  }, []);
  const toggleUser = useCallback(() => {
    setUserOpen((p) => !p);
    setSetupOpen(false);
    setModuleOpen(false);
    setThemeOpen(false);
    setBellOpen(false);
  }, []);
  const toggleBell = useCallback(() => {
    setBellOpen((p) => !p);
    setSetupOpen(false);
    setModuleOpen(false);
    setUserOpen(false);
    setThemeOpen(false);
  }, []);

  const navBtn = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading transition-all whitespace-nowrap ${active ? "bg-muted text-foreground" : "hover:bg-muted text-foreground"}`;

  return (
    <>
      {logoutOverlay}
      <header className="fixed top-0 left-0 right-0 h-14 z-50 flex items-center justify-between px-4 border-b border-border bg-card/80 backdrop-blur-lg">
        {/* Logo */}
        <button
          type="button"
          onClick={() =>
            navigate(activeModule ? MODULE_DASHBOARD_ROUTES[activeModule] : "/")
          }
          title="Go to dashboard"
          aria-label="Go to dashboard"
          className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0"
        >
          <span className="sr-only">Go to dashboard</span>
          <LogoFull />
        </button>

        {/* ── DESKTOP NAV ────────────────────────────────────────────────── */}
        <div className="hidden md:flex items-center gap-1">
          {/* Collapse toggle */}
          <button
            onClick={() => setNavCollapsed(!navCollapsed)}
            title={navCollapsed ? "Expand navigation" : "Collapse navigation"}
            className="p-1.5 rounded-md bg-muted hover:bg-muted/80 text-foreground border border-border transition-all duration-200 shrink-0"
          >
            {navCollapsed ? (
              <ChevronsRight size={15} />
            ) : (
              <ChevronsLeft size={15} />
            )}
          </button>

          {/* Collapsible items */}
          <div
            className={`flex items-center gap-1 transition-all duration-300 ease-in-out max-w-[700px]
            ${navCollapsed ? "w-0 opacity-0 invisible pointer-events-none" : "w-auto opacity-100 visible pointer-events-auto"}`}
          >
            {/* Setup */}
            <div className="relative shrink-0">
              <button
                onClick={toggleSetup}
                title={
                  !setupConfig.available
                    ? "Select a module to access Setup"
                    : ""
                }
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading transition-all duration-200 whitespace-nowrap
                  ${setupOpen ? "bg-muted text-foreground" : setupConfig.available ? "hover:bg-muted text-foreground" : "text-muted-foreground/40 cursor-not-allowed"}`}
              >
                <Settings size={15} />
                <span>Setup</span>
                {setupConfig.available && (
                  <ChevronDown
                    size={13}
                    className={`transition-transform duration-200 ${setupOpen ? "rotate-180" : ""}`}
                  />
                )}
              </button>
              <SetupDropdown
                open={setupOpen}
                onClose={() => setSetupOpen(false)}
                items={setupConfig.items}
                moduleLabel={setupConfig.label}
                moduleColor={setupConfig.color}
                navigate={navigate}
                location={location}
              />
            </div>

            {/* Reports (extracted from Widgets) */}
            <button
              onClick={() => {
                navigate("/reports");
                closeAll();
              }}
              className={navBtn(location.pathname === "/reports")}
            >
              <BarChart3 size={15} />
              <span>Reports</span>
            </button>

            {/* Widgets */}
            <button
              onClick={() => {
                navigate("/widgets");
                closeAll();
              }}
              className={navBtn(location.pathname === "/widgets")}
            >
              <Puzzle size={16} />
              <span>Widgets</span>
            </button>

            {/* Module selector */}
            <div className="relative shrink-0">
              <button
                onClick={toggleMod}
                className={navBtn(moduleOpen)}
                disabled={moduleSwitching}
              >
                <LayoutGrid
                  size={16}
                  className={moduleSwitching ? "animate-spin" : ""}
                />
                <span>{switchingTo ? `${switchingTo}…` : "Module"}</span>
                <ChevronDown
                  size={13}
                  className={`transition-transform duration-200 ${moduleOpen ? "rotate-180" : ""} ${moduleSwitching ? "opacity-0" : ""}`}
                />
              </button>

              <Dropdown
                open={moduleOpen}
                onClose={() => setModuleOpen(false)}
                className="right-0 p-1.5"
                style={{ minWidth: "17rem" }}
              >
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading px-3 pt-2 pb-2">
                  Switch Module
                </p>

                {/* Finance */}
                <button
                  onClick={async () => {
                    setModuleOpen(false);
                    setSwitchingTo("Finance");
                    setModuleSwitching(true);
                    await new Promise((r) => setTimeout(r, 350));
                    setActiveModule("finance");
                    navigate(MODULE_DASHBOARD_ROUTES.finance);
                    setModuleSwitching(false);
                    setSwitchingTo(null);
                  }}
                  className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                    activeModule === "finance" && !isAdminPage
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted text-foreground"
                  }`}
                >
                  <span
                    className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
                      activeModule === "finance" && !isAdminPage
                        ? "bg-primary/15"
                        : "bg-muted group-hover:bg-muted-foreground/10"
                    }`}
                  >
                    <TrendingUp
                      size={14}
                      className={
                        activeModule === "finance" && !isAdminPage
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground"
                      }
                    />
                  </span>
                  <div className="flex-1 text-left">
                    <p
                      className={`text-sm font-heading font-medium leading-none ${activeModule === "finance" && !isAdminPage ? "text-primary" : "text-foreground"}`}
                    >
                      Finance
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Ledger, payments & BRS
                    </p>
                  </div>
                  {activeModule === "finance" && !isAdminPage && (
                    <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                  )}
                </button>

                {/* Material */}
                <button
                  onClick={async () => {
                    setModuleOpen(false);
                    setSwitchingTo("Material");
                    setModuleSwitching(true);
                    await new Promise((r) => setTimeout(r, 350));
                    setActiveModule("material");
                    navigate(MODULE_DASHBOARD_ROUTES.material);
                    setModuleSwitching(false);
                    setSwitchingTo(null);
                  }}
                  className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                    activeModule === "material" && !isAdminPage
                      ? "bg-emerald-500/10 text-emerald-600"
                      : "hover:bg-muted text-foreground"
                  }`}
                >
                  <span
                    className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
                      activeModule === "material" && !isAdminPage
                        ? "bg-emerald-500/15"
                        : "bg-muted group-hover:bg-muted-foreground/10"
                    }`}
                  >
                    <Package
                      size={14}
                      className={
                        activeModule === "material" && !isAdminPage
                          ? "text-emerald-500"
                          : "text-muted-foreground group-hover:text-foreground"
                      }
                    />
                  </span>
                  <div className="flex-1 text-left">
                    <p
                      className={`text-sm font-heading font-medium leading-none ${activeModule === "material" && !isAdminPage ? "text-emerald-600" : "text-foreground"}`}
                    >
                      Material
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      GRN, PO & work orders
                    </p>
                  </div>
                  {activeModule === "material" && !isAdminPage && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  )}
                </button>

                {/* Follow-Up */}
                <button
                  onClick={async () => {
                    setModuleOpen(false);
                    setSwitchingTo("Follow-Up");
                    setModuleSwitching(true);
                    await new Promise((res) => setTimeout(res, 350));
                    setActiveModule("followup");
                    navigate(MODULE_DASHBOARD_ROUTES.followup);
                    setModuleSwitching(false);
                    setSwitchingTo(null);
                  }}
                  className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                    activeModule === "followup" && !isAdminPage
                      ? "bg-indigo-500/10 text-indigo-600"
                      : "hover:bg-muted text-foreground"
                  }`}
                >
                  <span
                    className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
                      activeModule === "followup" && !isAdminPage
                        ? "bg-indigo-500/15"
                        : "bg-muted group-hover:bg-muted-foreground/10"
                    }`}
                  >
                    <Calendar
                      size={14}
                      className={
                        activeModule === "followup" && !isAdminPage
                          ? "text-indigo-500"
                          : "text-muted-foreground group-hover:text-foreground"
                      }
                    />
                  </span>
                  <div className="flex-1 text-left">
                    <p
                      className={`text-sm font-heading font-medium leading-none ${activeModule === "followup" && !isAdminPage ? "text-indigo-600" : "text-foreground"}`}
                    >
                      Follow-Up
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Sales, agreements & CRM
                    </p>
                  </div>
                  {activeModule === "followup" && !isAdminPage && (
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
                  )}
                </button>

                {/* Admin */}
                {isAdmin && (
                  <>
                    <div className="mx-3 my-1.5 border-t border-border" />
                    <button
                      onClick={async () => {
                        setModuleOpen(false);
                        setSwitchingTo("Admin");
                        setModuleSwitching(true);
                        await new Promise((r) => setTimeout(r, 350));
                        navigate("/admin/dashboard");
                        setModuleSwitching(false);
                        setSwitchingTo(null);
                      }}
                      className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                        isAdminPage
                          ? "bg-blue-500/10 text-blue-600"
                          : "hover:bg-muted text-foreground"
                      }`}
                    >
                      <span
                        className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors relative ${
                          isAdminPage
                            ? "bg-blue-500/15"
                            : "bg-muted group-hover:bg-muted-foreground/10"
                        }`}
                      >
                        <ShieldCheck
                          size={14}
                          className={
                            isAdminPage
                              ? "text-blue-500"
                              : "text-muted-foreground group-hover:text-foreground"
                          }
                        />
                        {isSuperAdmin && (
                          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full flex items-center justify-center bg-violet-600">
                            <Crown size={6} className="text-white" />
                          </span>
                        )}
                      </span>
                      <div className="flex-1 text-left">
                        <p
                          className={`text-sm font-heading font-medium leading-none ${isAdminPage ? "text-blue-600" : "text-foreground"}`}
                        >
                          Admin
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Users, rights & config
                        </p>
                      </div>
                      {isAdminPage && (
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                      )}
                    </button>
                  </>
                )}

                <div className="mx-3 mt-1.5 mb-1 pt-2 border-t border-border">
                  <p className="text-[10px] text-muted-foreground font-heading">
                    {isAdminPage
                      ? "Currently in Admin"
                      : activeModule
                        ? `Active: ${activeModule.charAt(0).toUpperCase() + activeModule.slice(1)}`
                        : "No module selected"}
                  </p>
                </div>
              </Dropdown>
            </div>
          </div>

          {/* ── Bell ─────────────────────────────────────────────────────── */}
          <div className="relative shrink-0">
            <button
              onClick={toggleBell}
              title="Reminders"
              className={`relative p-2 rounded-md transition-all text-foreground ${bellOpen ? "bg-muted" : "hover:bg-muted"}`}
            >
              <Bell size={17} />
              {badgeCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                  {badgeCount > 99 ? "99+" : badgeCount}
                </span>
              )}
            </button>
            <RemindersDropdown
              open={bellOpen}
              onClose={() => setBellOpen(false)}
            />
          </div>

          {/* Theme */}
          <div className="relative shrink-0">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-md hover:bg-muted transition-all text-foreground"
              title="Change theme"
            >
              <Palette size={17} />
            </button>
            <Dropdown
              open={themeOpen}
              onClose={() => setThemeOpen(false)}
              className="right-0 w-48 p-1.5"
            >
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading px-2 py-1.5 mb-0.5">
                Appearance
              </p>
              {(
                Object.entries(THEME_DOTS) as [
                  Theme,
                  { bg: string; label: string },
                ][]
              ).map(([t, { bg, label }]) => (
                <button
                  key={t}
                  onClick={() => {
                    setTheme(t);
                    setThemeOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-heading transition-all ${theme === t ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"}`}
                >
                  <span
                    className={`w-3.5 h-3.5 rounded-full shrink-0 border border-border/50 bg-[${bg}]`}
                  />
                  {label}
                  {theme === t && (
                    <span className="ml-auto text-primary text-xs">✓</span>
                  )}
                </button>
              ))}
            </Dropdown>
          </div>

          {/* User */}
          <div className="relative shrink-0">
            <button
              onClick={toggleUser}
              className="relative w-8 h-8 rounded-full gradient-accent flex items-center justify-center text-xs font-heading text-primary-foreground font-bold hover:opacity-90"
            >
              {currentUser?.initials || "?"}
              {RoleIcon && (
                <span
                  className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center ${roleBadgeCls}`}
                >
                  <RoleIcon size={9} className="text-white" />
                </span>
              )}
            </button>
            <Dropdown
              open={userOpen}
              onClose={() => setUserOpen(false)}
              className="right-0 w-56 p-1"
            >
              <div className="px-3 py-2 border-b border-border mb-1">
                <p className="text-sm font-heading font-semibold text-foreground">
                  {currentUser?.name}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {currentUser?.email}
                </p>
                <div className="mt-1.5">
                  {isSuperAdmin && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-heading bg-violet-500/10 text-violet-600">
                      Super Admin
                    </span>
                  )}
                  {currentUser?.role === "admin" && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-heading bg-blue-500/10 text-blue-600">
                      Admin
                    </span>
                  )}
                  {currentUser?.role === "dba" && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-heading bg-emerald-500/10 text-emerald-600">
                      DBA
                    </span>
                  )}
                  {currentUser?.role === "user" && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-heading bg-muted text-muted-foreground">
                      User · {currentUser.pagePermissions?.length || 0} pages
                    </span>
                  )}
                </div>
              </div>
              <button
                onMouseDown={() => {
                  setUserOpen(false);
                  isSuperAdmin
                    ? navigate("/superadmin")
                    : isDba
                      ? navigate("/dba")
                      : currentUser?.role === "admin"
                        ? navigate("/admin/profile")
                        : navigate("/user/profile");
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors text-foreground"
              >
                <User size={14} /> Profile
              </button>
              <button
                onMouseDown={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors text-destructive"
              >
                <LogOut size={14} /> Sign Out
              </button>
            </Dropdown>
          </div>
        </div>

        {/* ── MOBILE RIGHT ───────────────────────────────────────────────── */}
        <div className="flex md:hidden items-center gap-1.5">
          {/* Bell mobile */}
          <div className="relative">
            <button
              onClick={toggleBell}
              className="relative p-2 rounded-md hover:bg-muted transition-all text-foreground"
            >
              <Bell size={17} />
              {badgeCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                  {badgeCount > 99 ? "99+" : badgeCount}
                </span>
              )}
            </button>
            <RemindersDropdown
              open={bellOpen}
              onClose={() => setBellOpen(false)}
            />
          </div>

          {/* User mobile */}
          <div className="relative">
            <button
              onClick={toggleUser}
              className="relative w-8 h-8 rounded-full gradient-accent flex items-center justify-center text-xs font-heading text-primary-foreground font-bold"
            >
              {currentUser?.initials || "?"}
              {RoleIcon && (
                <span
                  className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center ${roleBadgeCls}`}
                >
                  <RoleIcon size={9} className="text-white" />
                </span>
              )}
            </button>
            <Dropdown
              open={userOpen}
              onClose={() => setUserOpen(false)}
              className="right-0 w-56 p-1"
            >
              <div className="px-3 py-2 border-b border-border mb-1">
                <p className="text-sm font-heading font-semibold text-foreground">
                  {currentUser?.name}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {currentUser?.email}
                </p>
              </div>
              <button
                onMouseDown={() => {
                  setUserOpen(false);
                  isSuperAdmin
                    ? navigate("/superadmin")
                    : isDba
                      ? navigate("/dba")
                      : currentUser?.role === "admin"
                        ? navigate("/admin/profile")
                        : navigate("/user/profile");
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted text-foreground"
              >
                <User size={14} /> Profile
              </button>
              <button
                onMouseDown={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted text-destructive"
              >
                <LogOut size={14} /> Sign Out
              </button>
            </Dropdown>
          </div>
        </div>
      </header>
    </>
  );
};

export default TopNavbar;
