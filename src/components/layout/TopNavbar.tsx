import React, { useState, useRef, useEffect, useCallback } from "react";
import { useGracefulLogout } from "@/hooks/useGracefulLogout";
import { useNavigate, useLocation } from "react-router-dom";
import { LogoFull } from "../Logo";
import { useModule } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavbarCollapse } from "./layoutContexts";
import { useTheme } from "@/contexts/ThemeContext";
import { ReminderBell } from "@/components/navbar/ReminderBell";
import { ThemeSwitcher } from "@/components/navbar/ThemeSwitcher";
import {
  Calendar,
  FileText,
  Settings,
  BarChart3,
  LogOut,
  User,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  ShieldCheck,
  Crown,
  Shield,
  Receipt,
  Truck,
  Users,
  HardHat,
  Landmark,
  Package,
  Layers,
  Hash,
  ReceiptIndianRupee,
  CreditCard,
  BookOpen,
  Tag,
  FileType2,
  Activity,
  ChevronDown,
  Database,
  ClipboardList,
  Ruler,
  SlidersHorizontal,
} from "lucide-react";
import { BillingIcon } from "@/components/icons/BillingIcon";
import { ADMIN_PATHS } from "@/constants/pageDefinitions";

// ─── useClickOutside ──────────────────────────────────────────────────────────

function useClickOutside(
  ref: React.RefObject<HTMLElement>,
  onClose: () => void,
  open: boolean,
) {
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [ref, open, onClose]);
}

// ─── Dropdown primitive ───────────────────────────────────────────────────────

const Dropdown = ({
  open,
  onClose,
  trigger,
  children,
  className,
  style,
}: {
  open: boolean;
  onClose: () => void;
  trigger: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapperRef, onClose, open);

  return (
    <div className="relative shrink-0" ref={wrapperRef}>
      {trigger}
      <div
        style={style}
        className={`absolute top-full mt-2.5 z-50 rounded-2xl border border-border/60 bg-card/95 backdrop-blur-2xl shadow-2xl transition-all duration-200 origin-top overflow-visible
          ${open ? "opacity-100 scale-100 pointer-events-auto translate-y-0" : "opacity-0 scale-95 pointer-events-none -translate-y-2"} ${className || ""}`}
      >
        {children}
      </div>
    </div>
  );
};

// ─── Module color helpers ──────────────────────────────────────────────────────

// RGB triplets for dynamic glow (matches ModuleStrip ringRgb values)
const MODULE_GLOW_RGB: Record<string, string> = {
  finance: "99,102,241",
  material: "16,185,129",
  followup: "129,140,248",
  engineering: "249,115,22",
  ticket: "236,72,153",
  sales: "168,85,247",
  admin: "59,130,246",
};

// HSL values derived from MODULE_HEADER hex colors in AppSidebar for consistency
const MODULE_COLORS: Record<string, { h: number; s: number; l: number }> = {
  finance: { h: 239, s: 84, l: 67 },     // #6366f1 indigo
  material: { h: 160, s: 84, l: 39 },    // #10b981 emerald
  followup: { h: 235, s: 90, l: 74 },    // #818cf8 light indigo-violet
  engineering: { h: 25, s: 95, l: 53 },  // #f97316 orange
  ticket: { h: 330, s: 81, l: 60 },      // #ec4899 pink
  sales: { h: 271, s: 91, l: 65 },       // #a855f7 purple
  admin: { h: 217, s: 91, l: 60 },       // #3b82f6 blue
};

function moduleColorVars(id: string): React.CSSProperties {
  const c = MODULE_COLORS[id] ?? MODULE_COLORS.finance;
  return {
    "--mod-h": c.h,
    "--mod-s": `${c.s}%`,
    "--mod-l": `${c.l}%`,
  } as React.CSSProperties;
}

const MODULE_STYLES: Record<
  string,
  {
    activeClass: string;
    activeStyle: React.CSSProperties;
  }
> = Object.fromEntries(
  Object.keys(MODULE_COLORS).map((id) => [
    id,
    {
      activeClass: "border backdrop-blur-md",
      activeStyle: {
        background: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.12)",
        borderColor: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.35)",
        boxShadow:
          "0 2px 16px 0 hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.18), inset 0 1px 0 hsl(0 0% 100% / 0.08)",
      } as React.CSSProperties,
    },
  ]),
);

// ─── Setup Items ──────────────────────────────────────────────────────────────

const financeSetupItems = [
  {
    icon: Layers,
    label: "AC Group",
    path: "/masters/account-group",
    color: "text-indigo-400",
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
    color: "text-amber-500",
  },
  {
    icon: Landmark,
    label: "Banks",
    path: "/masters/banks",
    color: "text-emerald-500",
  },
  {
    icon: Calendar,
    label: "Fin Year",
    path: "/masters/financial-year",
    color: "text-purple-400",
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
    color: "text-green-500",
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
    icon: ClipboardList,
    label: "Inventory",
    path: "/material/inventory-master",
    color: "text-sky-400",
  },
];

const followupSetupItems = [
  {
    icon: ClipboardList,
    label: "Payment Plan",
    path: "/followup/setup/payment-plan-master",
    color: "text-emerald-500",
  },
  {
    icon: Layers,
    label: "Block",
    path: "/followup/setup/block-master",
    color: "text-cyan-500",
  },
  {
    icon: Ruler,
    label: "Unit",
    path: "/followup/setup/unit-master",
    color: "text-orange-500",
  },
  {
    icon: Calendar,
    label: "Reminders",
    path: "/followup/follow-ups/reminders",
    color: "text-indigo-500",
  },
  {
    icon: Activity,
    label: "Pending Tasks",
    path: "/followup/setup/pending-tasks",
    color: "text-purple-500",
  },
  {
    icon: Users,
    label: "Customers",
    path: "/followup/setup/customer-master",
    color: "text-violet-500",
  },
];

const engineeringSetupItems = [
  {
    icon: Activity,
    label: "Activity",
    path: "/masters/activity",
    color: "text-orange-400",
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
  {
    icon: Users,
    label: "Role Master",
    path: "/admin/masters/role-master",
    color: "text-blue-400",
  },
  {
    icon: LayoutGrid,
    label: "Menu Types",
    path: "/admin/masters/menu-types",
    color: "text-emerald-500",
  },
];

// ─── Setup Dropdown ───────────────────────────────────────────────────────────

const SetupDropdown = ({
  open,
  onClose,
  onToggle,
  items,
  moduleLabel,
  colorStyle,
  setupAvailable,
  navigate,
  location,
}: {
  open: boolean;
  onClose: () => void;
  onToggle: () => void;
  items: {
    icon: React.ElementType<any>;
    label: string;
    path: string;
    color: string;
  }[];
  moduleLabel: string;
  colorStyle: React.CSSProperties;
  setupAvailable: boolean;
  navigate: (p: string) => void;
  location: { pathname: string };
}) => {
  const modVars = {
    "--mod-h": (colorStyle as any)["--mod-h"],
    "--mod-s": (colorStyle as any)["--mod-s"],
    "--mod-l": (colorStyle as any)["--mod-l"],
  } as React.CSSProperties;

  return (
    <Dropdown
      open={open}
      onClose={onClose}
      className="origin-top-left left-0"
      style={{ minWidth: "min(22rem, calc(100vw - 2rem))", ...modVars }}
      trigger={
        <button
          onClick={onToggle}
          className={`nav-pill-btn ${open ? "nav-pill-btn--active" : ""}`}
          style={open ? {
            background: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.12)",
            borderColor: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.4)",
            color: "hsl(var(--mod-h) var(--mod-s) var(--mod-l))",
            ...modVars,
          } : modVars}
        >
          <SlidersHorizontal size={13} />
          <span>Setup</span>
          <ChevronDown
            size={12}
            className={`transition-transform duration-300 opacity-60 ${open ? "rotate-180" : ""}`}
          />
        </button>
      }
    >
      {/* ── Gradient header ── */}
      <div
        className="relative px-4 pt-4 pb-3.5 overflow-hidden rounded-t-2xl"
        style={{
          background: `linear-gradient(135deg,
            hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.18) 0%,
            hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.06) 60%,
            transparent 100%)`,
          borderBottom: `1px solid hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.18)`,
        }}
      >
        {/* radial bloom */}
        <div
          className="absolute -top-6 -left-4 w-32 h-32 rounded-full pointer-events-none"
          style={{
            background: `radial-gradient(circle, hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.22) 0%, transparent 70%)`,
            filter: "blur(16px)",
          }}
        />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg shrink-0"
              style={{
                background: `hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.2)`,
                border: `1.5px solid hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.4)`,
                boxShadow: `0 4px 14px hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.3), inset 0 1px 0 hsl(0 0% 100% / 0.1)`,
                color: `hsl(var(--mod-h) var(--mod-s) var(--mod-l))`,
              }}
            >
              <Settings size={15} strokeWidth={2} />
            </div>
            <div>
              <p className="text-[11px] font-heading font-bold text-foreground uppercase tracking-widest leading-none">
                Setup
              </p>
              <p
                className="text-[10px] font-heading mt-0.5 leading-none"
                style={{ color: `hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.8)` }}
              >
                Configure {moduleLabel}
              </p>
            </div>
          </div>
          <span
            className="text-[10px] font-heading font-semibold px-2.5 py-1 rounded-full border tracking-wide"
            style={{
              color: `hsl(var(--mod-h) var(--mod-s) var(--mod-l))`,
              borderColor: `hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.35)`,
              background: `hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.12)`,
            }}
          >
            {moduleLabel}
          </span>
        </div>
      </div>

      {/* ── Items grid ── */}
      <div className="p-3">
        <div className={`grid grid-cols-3 sm:grid-cols-4 gap-2 ${open ? "setup-grid-open" : ""}`}>
          {items.map(({ icon: Icon, label, path, color }, i) => {
            const isActivePath = location.pathname === path;
            return (
              <button
                key={path}
                onClick={() => { navigate(path); onClose(); }}
                className={`setup-item group flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all duration-200 active:scale-[0.93] cursor-pointer
                  ${isActivePath ? "shadow-sm" : "border-transparent hover:border-border hover:bg-muted/50"}`}
                style={{
                  animationDelay: `${i * 35}ms`,
                  ...(isActivePath ? {
                    borderColor: `hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.45)`,
                    background: `hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.08)`,
                  } : {}),
                }}
              >
                <div className="relative w-9 h-9 flex items-center justify-center">
                  <div
                    className={`absolute inset-0 rounded-xl transition-all duration-200 ${isActivePath ? "" : "bg-muted/60 group-hover:bg-muted"}`}
                    style={isActivePath ? { background: `hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.16)` } : undefined}
                  />
                  <div
                    className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                    style={{ boxShadow: `0 0 0 1.5px hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.35), 0 4px 12px hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.2)` }}
                  />
                  <div
                    className="setup-icon-shimmer absolute inset-0 rounded-xl pointer-events-none opacity-0 group-hover:opacity-100"
                    style={{
                      background: `linear-gradient(105deg, transparent 30%, hsl(0 0% 100% / 0.12) 50%, transparent 70%)`,
                      backgroundSize: "200% 100%",
                    }}
                  />
                  <Icon
                    size={16}
                    className={`relative z-10 ${color} transition-transform duration-200 group-hover:scale-110`}
                    strokeWidth={isActivePath ? 2.5 : 2}
                  />
                </div>
                <span
                  className={`text-[9px] font-heading text-center leading-tight line-clamp-2 transition-colors duration-150
                    ${isActivePath ? "font-semibold" : "text-muted-foreground group-hover:text-foreground"}`}
                  style={isActivePath ? { color: `hsl(var(--mod-h) var(--mod-s) var(--mod-l))` } : undefined}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Footer ── */}
      <div
        className="px-4 py-2.5 rounded-b-2xl flex items-center justify-between"
        style={{
          borderTop: `1px solid hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.12)`,
          background: `hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.04)`,
        }}
      >
        <p className="text-[9px] text-muted-foreground font-heading">
          {items.length} configuration{items.length !== 1 ? "s" : ""}
        </p>
        <div className="flex items-center gap-1">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: `hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.7)` }}
          />
          <p
            className="text-[9px] font-heading font-medium"
            style={{ color: `hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.8)` }}
          >
            {moduleLabel} Module
          </p>
        </div>
      </div>
    </Dropdown>
  );
};

// ─── User Menu ────────────────────────────────────────────────────────────────

const UserMenuContent: React.FC<{
  currentUser: ReturnType<typeof useAuth>["currentUser"];
  isSuperAdmin: boolean;
  isDba: boolean;
  onClose: () => void;
  navigate: (p: string) => void;
  handleLogout: () => void;
}> = ({
  currentUser,
  isSuperAdmin,
  isDba,
  onClose,
  navigate,
  handleLogout,
}) => (
  <>
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
        onClose();
        if (isSuperAdmin) navigate("/superadmin/profile");
        else if (isDba) navigate("/dba/profile");
        else if (currentUser?.role === "admin") navigate("/admin/profile");
        else navigate("/user/profile");
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
  </>
);

// ─── TopNavbar ────────────────────────────────────────────────────────────────

// Module-level flag: true until TopNavbar mounts for the first time.
// Persists across React remounts (route changes) within the same page session.
let _pillNavFirstMount = true;

export const TopNavbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeModule } = useModule();
  const { currentUser } = useAuth();
  const { navCollapsed, setNavCollapsed } = useNavbarCollapse();
  const { handleLogout, overlay: logoutOverlay } = useGracefulLogout();

  // "light" is the only light-background theme; everything else is dark
  const { theme } = useTheme();
  const isDark = theme !== "light";

  // Track first-mount so remounts skip the entrance animation.
  const isFirstMount = useRef(_pillNavFirstMount);
  const prevNavCollapsed = useRef(false);

  useEffect(() => {
    _pillNavFirstMount = false;
    isFirstMount.current = false;
  }, []);

  const isHome =
    location.pathname === "/" || location.pathname.startsWith("/home");

  const [setupOpen, setSetupOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  const isSuperAdmin = currentUser?.role === "super_admin";
  const isDba = currentUser?.role === "dba";
  const isAdmin = currentUser?.role === "admin" || isSuperAdmin || isDba;
  const isAdminPage =
    isAdmin &&
    (location.pathname.startsWith("/admin") ||
      location.pathname.startsWith("/users") ||
      ADMIN_PATHS.some((p) => location.pathname.startsWith(p)));
  const isDbaPage = isDba && location.pathname.startsWith("/dba");

  const activeGlowRgb = MODULE_GLOW_RGB[
    isAdminPage ? "admin" : (activeModule ?? "finance")
  ] ?? MODULE_GLOW_RGB.finance;

  const RoleIcon = isSuperAdmin
    ? Crown
    : isDba
      ? Database
      : isAdmin
        ? Shield
        : null;
  const roleBadgeCls = isSuperAdmin
    ? "bg-violet-600"
    : isDba
      ? "bg-emerald-600"
      : "bg-blue-600";

  const setupConfig = (() => {
    const makeColorStyle = (id: string) =>
      ({
        ...moduleColorVars(id),
        color: "hsl(var(--mod-h) var(--mod-s) var(--mod-l))",
        borderColor: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.35)",
        background: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.10)",
      }) as React.CSSProperties;

    if (isAdminPage)
      return {
        items: adminSetupItems,
        label: "Admin",
        colorStyle: makeColorStyle("admin"),
        available: true,
      };
    if (activeModule === "material")
      return {
        items: materialSetupItems,
        label: "Material",
        colorStyle: makeColorStyle("material"),
        available: true,
      };
    if (activeModule === "followup")
      return {
        items: followupSetupItems,
        label: "Follow-Up",
        colorStyle: makeColorStyle("followup"),
        available: true,
      };
    if (activeModule === "engineering")
      return {
        items: engineeringSetupItems,
        label: "Engineering",
        colorStyle: makeColorStyle("engineering"),
        available: true,
      };
    if (activeModule === "finance")
      return {
        items: financeSetupItems,
        label: "Finance",
        colorStyle: makeColorStyle("finance"),
        available: true,
      };
    return {
      items: [],
      label: "No Module",
      colorStyle: {} as React.CSSProperties,
      available: false,
    };
  })();

  const closeSetup = useCallback(() => setSetupOpen(false), []);
  const closeTheme = useCallback(() => setThemeOpen(false), []);
  const closeUser = useCallback(() => setUserOpen(false), []);

  const closeAll = useCallback(() => {
    setSetupOpen(false);
    setUserOpen(false);
    setThemeOpen(false);
  }, []);

  const toggleSetup = useCallback(() => {
    if (setupConfig.available) {
      setSetupOpen((p) => !p);
      setUserOpen(false);
      setThemeOpen(false);
    }
  }, [setupConfig.available]);

  const toggleTheme = useCallback(() => {
    setThemeOpen((p) => !p);
    setSetupOpen(false);
    setUserOpen(false);
  }, []);
  const toggleUser = useCallback(() => {
    setUserOpen((p) => !p);
    setSetupOpen(false);
    setThemeOpen(false);
  }, []);

  const isActive = (path: string) => location.pathname === path;

  // Animate in on first load or after explicit collapse→expand; static on remounts.
  const expanding = !navCollapsed && prevNavCollapsed.current;
  const pillNavClass = navCollapsed
    ? "pill-nav-collapse"
    : isFirstMount.current || expanding
      ? "pill-nav-expand"
      : "pill-nav-static";

  useEffect(() => {
    prevNavCollapsed.current = navCollapsed;
  });

  return (
    <>
      {logoutOverlay}

      {/* ── CSS overrides scoped to this navbar ── */}
      <style>{`
        .nav-pill-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.375rem 0.75rem;
          border-radius: 9999px;
          font-size: 0.8125rem;
          font-weight: 500;
          font-family: var(--font-heading, inherit);
          color: hsl(var(--foreground) / 0.70);
          background: transparent;
          border: 1px solid transparent;
          transition: background 150ms, border-color 150ms, color 150ms;
          white-space: nowrap;
          cursor: pointer;
        }
        .nav-pill-btn:hover {
          background: rgba(128,128,128,0.15);
          border-color: rgba(128,128,128,0.20);
          color: hsl(var(--foreground));
        }
        .nav-pill-btn--active {
          background: rgba(128,128,128,0.15);
          border-color: rgba(128,128,128,0.20);
          color: hsl(var(--foreground));
        }

        /* pill nav genie — expand: pinched sliver → full pill */
        @keyframes genie-expand {
          0%   {
            opacity: 0;
            clip-path: inset(0% 48% 0% 48% round 99px);
            transform: translateX(-50%) scaleY(0.4);
            filter: blur(6px);
          }
          40%  {
            opacity: 1;
            filter: blur(1px);
          }
          70%  {
            clip-path: inset(0% 0% 0% 0% round 99px);
            transform: translateX(-50%) scaleY(1.06);
          }
          100% {
            opacity: 1;
            clip-path: none;
            transform: translateX(-50%) scaleY(1);
            filter: blur(0px);
          }
        }

        /* pill nav genie — collapse: full pill → pinched sliver */
        @keyframes genie-collapse {
          0%   {
            opacity: 1;
            clip-path: inset(0% 0% 0% 0% round 99px);
            transform: translateX(-50%) scaleY(1);
            filter: blur(0px);
          }
          50%  {
            clip-path: inset(0% 42% 0% 42% round 99px);
            filter: blur(2px);
          }
          100% {
            opacity: 0;
            clip-path: inset(0% 50% 0% 50% round 99px);
            transform: translateX(-50%) scaleY(0.3);
            filter: blur(6px);
          }
        }

        .pill-nav-expand {
          animation: genie-expand 0.45s cubic-bezier(0.34, 1.3, 0.64, 1) forwards;
        }
        .pill-nav-collapse {
          animation: genie-collapse 0.3s cubic-bezier(0.4, 0, 1, 1) forwards;
          pointer-events: none;
        }
        /* Static — nav already expanded, no animation (used on remounts) */
        .pill-nav-static {
          opacity: 1;
          transform: translateX(-50%) scaleY(1);
          filter: blur(0px);
        }

        /* setup item staggered entrance */
        @keyframes setup-item-in {
          from {
            opacity: 0;
            transform: translateY(8px) scale(0.88);
            filter: blur(3px);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0px);
          }
        }
        .setup-grid-open .setup-item {
          animation: setup-item-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }

        /* icon shimmer on hover */
        @keyframes icon-shimmer {
          0%   { background-position: -100% 0; }
          100% { background-position: 200% 0; }
        }
        .setup-item:hover .setup-icon-shimmer {
          animation: icon-shimmer 0.6s linear;
        }

        /* sidebar toggle — rotating arc ring */
        @keyframes spin-ring {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>

      <header className="fixed top-0 left-0 right-0 h-14 z-50 flex items-center px-3 sm:px-4 gap-3 border-b border-border bg-card/90 backdrop-blur-xl">
        {/* ── Logo ── */}
        <button
          onClick={() => navigate("/home")}
          className="flex items-center hover:opacity-80 transition-opacity shrink-0"
        >
          <LogoFull />
        </button>

        {/* ── Spacer — pushes center pill to true center ── */}
        <div className="hidden md:flex flex-1 min-w-0" />

        {/* ── Center pill nav — absolute center of the header ── */}
        <nav
          className={`hidden md:flex items-center gap-0.5 absolute left-1/2 ${pillNavClass}`}
          style={isDark ? {
            borderRadius: "9999px",
            padding: "0.25rem",
            background: "rgba(15, 17, 26, 0.52)",
            border: "1px solid rgba(255,255,255,0.13)",
            boxShadow: "0 2px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.10)",
            backdropFilter: "blur(22px) saturate(160%)",
            WebkitBackdropFilter: "blur(22px) saturate(160%)",
          } : {
            borderRadius: "9999px",
            padding: "0.25rem",
            background: "rgba(255,255,255,0.42)",
            border: "1px solid rgba(255,255,255,0.65)",
            boxShadow: "0 2px 16px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.85)",
            backdropFilter: "blur(22px) saturate(180%)",
            WebkitBackdropFilter: "blur(22px) saturate(180%)",
          }}
        >
          {/* Dot grid + glow — clipped to pill, tracks active module color */}
          {(() => {
            const modKey = isAdminPage ? "admin" : (activeModule ?? "finance");
            const glowRgb = MODULE_GLOW_RGB[modKey] ?? MODULE_GLOW_RGB.finance;
            return (
              <div className="absolute inset-0 rounded-full overflow-hidden pointer-events-none z-0">
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    backgroundImage:
                      "radial-gradient(circle, hsl(var(--foreground) / 0.10) 1px, transparent 1px)",
                    backgroundSize: "14px 14px",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: `radial-gradient(ellipse at 50% 0%, rgba(${glowRgb},0.38) 0%, rgba(${glowRgb},0.12) 50%, transparent 80%)`,
                  }}
                />
              </div>
            );
          })()}

          {/* Content — sits above glow */}
          <div className="relative z-10 flex items-center gap-0.5">
            {!isHome && setupConfig.available && (
              <SetupDropdown
                open={setupOpen}
                onClose={closeSetup}
                onToggle={toggleSetup}
                items={setupConfig.items}
                moduleLabel={setupConfig.label}
                colorStyle={setupConfig.colorStyle}
                setupAvailable={setupConfig.available}
                navigate={navigate}
                location={location}
              />
            )}

            <button
              onClick={() => {
                navigate("/reports");
                closeAll();
              }}
              className={`nav-pill-btn ${isActive("/reports") ? "nav-pill-btn--active" : ""}`}
            >
              <BarChart3 size={13} />
              <span>Reports</span>
            </button>

            <button
              onClick={() => {
                navigate("/widgets");
                closeAll();
              }}
              className={`nav-pill-btn ${isActive("/widgets") ? "nav-pill-btn--active" : ""}`}
            >
              <Puzzle size={13} />
              <span>Widgets</span>
            </button>
          </div>
        </nav>

        {/* ── Right actions ── */}
        <div className="hidden md:flex items-center gap-1.5 ml-auto shrink-0">
          {/* Collapse sidebar toggle */}
          <div className="relative shrink-0">
            {/* Rotating conic-gradient arc ring */}
            <span
              className="absolute -inset-[2px] rounded-full pointer-events-none opacity-70"
              style={{
                background:
                  `conic-gradient(from 0deg, transparent 60%, rgba(${activeGlowRgb},0.85) 80%, transparent 100%)`,
                animation: "spin-ring 3s linear infinite",
              }}
            />
            <button
              onClick={() => setNavCollapsed(!navCollapsed)}
              title={navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="relative z-10 w-8 h-8 rounded-full flex items-center justify-center border border-border bg-muted hover:bg-muted/80 text-foreground transition-all duration-200 active:scale-90 hover:scale-105"
            >
              {navCollapsed ? (
                <PanelLeftOpen size={15} />
              ) : (
                <PanelLeftClose size={15} />
              )}
            </button>
          </div>

          <ReminderBell />
          <ThemeSwitcher
            open={themeOpen}
            onToggle={toggleTheme}
            onClose={closeTheme}
          />

          {/* Avatar / user menu */}
          <Dropdown
            open={userOpen}
            onClose={closeUser}
            className="right-0 w-56 p-1"
            trigger={
              <div className="relative">
                <button
                  onClick={toggleUser}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-heading text-primary-foreground font-bold hover:opacity-90 overflow-hidden ring-2 ring-border hover:ring-primary/40 transition-all ${currentUser?.avatarUrl ? "bg-muted" : "gradient-accent"}`}
                >
                  {currentUser?.avatarUrl ? (
                    <img
                      src={currentUser.avatarUrl}
                      alt={currentUser.name}
                      className="w-full h-full object-cover rounded-full"
                    />
                  ) : (
                    currentUser?.initials || "?"
                  )}
                </button>
                {RoleIcon && (
                  <span
                    className={`pointer-events-none absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center ${roleBadgeCls}`}
                  >
                    <RoleIcon size={9} className="text-white" />
                  </span>
                )}
              </div>
            }
          >
            <UserMenuContent
              currentUser={currentUser}
              isSuperAdmin={isSuperAdmin}
              isDba={isDba}
              onClose={closeUser}
              navigate={navigate}
              handleLogout={handleLogout}
            />
          </Dropdown>
        </div>

        {/* ── Mobile right ── */}
        <div className="flex md:hidden items-center gap-1.5 ml-auto">
          <ReminderBell />
          <Dropdown
            open={userOpen}
            onClose={closeUser}
            className="right-0 w-56 p-1"
            trigger={
              <div className="relative">
                <button
                  onClick={toggleUser}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-heading text-primary-foreground font-bold overflow-hidden ring-2 ring-border ${currentUser?.avatarUrl ? "bg-muted" : "gradient-accent"}`}
                >
                  {currentUser?.avatarUrl ? (
                    <img
                      src={currentUser.avatarUrl}
                      alt={currentUser.name}
                      className="w-full h-full object-cover rounded-full"
                    />
                  ) : (
                    currentUser?.initials || "?"
                  )}
                </button>
                {RoleIcon && (
                  <span
                    className={`pointer-events-none absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center ${roleBadgeCls}`}
                  >
                    <RoleIcon size={9} className="text-white" />
                  </span>
                )}
              </div>
            }
          >
            <UserMenuContent
              currentUser={currentUser}
              isSuperAdmin={isSuperAdmin}
              isDba={isDba}
              onClose={closeUser}
              navigate={navigate}
              handleLogout={handleLogout}
            />
          </Dropdown>
        </div>
      </header>
    </>
  );
};

export default TopNavbar;
