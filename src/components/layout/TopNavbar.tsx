import React, { useState, useRef, useEffect, useCallback } from "react";
import { useGracefulLogout } from "@/hooks/useGracefulLogout";
import { useNavigate, useLocation } from "react-router-dom";
import { LogoFull } from "../Logo";
import {
  useModule,
  MODULE_DASHBOARD_ROUTES,
  type Module,
} from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavbarCollapse } from "./AppLayout";
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
  Puzzle,
  ShieldCheck,
  Crown,
  Shield,
  Receipt,
  Truck,
  Users,
  HardHat,
  Landmark,
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
  TrendingUp,
  ClipboardList,
  Wrench,
  MessageSquare,
  Ruler,
} from "lucide-react";
import { BillingIcon } from "@/components/icons/BillingIcon";
import { ADMIN_PATHS } from "@/constants/pageDefinitions";

function useClickOutside(
  ref: React.RefObject<HTMLElement>,
  onClose: () => void,
  open: boolean,
) {
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [ref, open, onClose]);
}

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
  const panelRef = useRef<HTMLDivElement>(null);
  useClickOutside(panelRef, onClose, open);

  return (
    <div className="relative shrink-0">
      {trigger}
      <div
        ref={panelRef}
        style={style}
        className={`absolute top-full mt-2 z-50 rounded-xl border border-border bg-card shadow-2xl transition-all duration-200 origin-top-right
          ${open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"} ${className || ""}`}
      >
        {children}
      </div>
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
    color: "text-teal-400",
  },
];

const followupSetupItems = [
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
    color: "text-green-400",
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

// ─── Setup Dropdown (desktop) ──────────────────────────────────────────────

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
    icon: React.ElementType;
    label: string;
    path: string;
    color: string;
  }[];
  moduleLabel: string;
  colorStyle: React.CSSProperties;
  setupAvailable: boolean;
  navigate: (p: string) => void;
  location: { pathname: string };
}) => (
  <Dropdown
    open={open}
    onClose={onClose}
    className="origin-top-left left-0"
    style={{ minWidth: "20rem" }}
    trigger={
      <button
        onClick={onToggle}
        disabled={!setupAvailable}
        title={!setupAvailable ? "Select a module to access Setup" : ""}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading transition-all duration-200 whitespace-nowrap
          ${open ? "bg-muted text-foreground" : setupAvailable ? "hover:bg-muted text-foreground" : "text-muted-foreground/40 cursor-not-allowed"}`}
      >
        <Settings size={15} />
        <span>Setup</span>
        {setupAvailable && (
          <ChevronDown
            size={13}
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>
    }
  >
    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2">
        <Settings size={14} className="text-muted-foreground" />
        <span className="text-xs font-heading font-semibold text-foreground uppercase tracking-wider">
          Setup
        </span>
      </div>
      <span
        className="text-[10px] font-heading px-2 py-0.5 rounded-full border"
        style={colorStyle}
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
              ${
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
        ))}
      </div>
    </div>
  </Dropdown>
);

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

// ─── Module color helpers ──────────────────────────────────────────────────────
// Each module gets a CSS custom-property colour token (--mod-*) so the active
// state, glassmorphism layer, and pip all read from a single source of truth
// that works across every theme (dark, light, midnight, sepia, crimson).

const MODULE_COLORS: Record<string, { h: number; s: number; l: number }> = {
  finance: { h: 217, s: 91, l: 60 }, // blue
  material: { h: 160, s: 60, l: 45 }, // emerald
  followup: { h: 263, s: 70, l: 58 }, // violet
  engineering: { h: 38, s: 92, l: 50 }, // amber
  ticket: { h: 330, s: 80, l: 60 }, // pink
  admin: { h: 217, s: 91, l: 60 }, // blue (same as finance)
};

/** Inject a --mod-h/s/l triplet onto the element so child utilities can use it */
function moduleColorVars(id: string): React.CSSProperties {
  const c = MODULE_COLORS[id] ?? MODULE_COLORS.finance;
  return {
    "--mod-h": c.h,
    "--mod-s": `${c.s}%`,
    "--mod-l": `${c.l}%`,
  } as React.CSSProperties;
}

// Static class sets — colours come from the CSS vars above, not hardcoded hues.
// The glassmorphism selected-module style uses backdrop-filter + a semi-transparent
// tinted background so it looks great on every theme.
const MODULE_STYLES: Record<
  string,
  {
    activeClass: string;
    activeStyle: React.CSSProperties;
    iconWrapClass: string;
    iconColorClass: string;
    pip: string;
    chipActiveClass: string;
    chipTextClass: string;
  }
> = Object.fromEntries(
  Object.keys(MODULE_COLORS).map((id) => [
    id,
    {
      // Glassmorphism card: semi-transparent tinted bg + blur + tinted border
      activeClass: "border backdrop-blur-md",
      activeStyle: {
        background: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.12)",
        borderColor: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.35)",
        boxShadow:
          "0 2px 16px 0 hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.18), inset 0 1px 0 hsl(0 0% 100% / 0.08)",
      } as React.CSSProperties,
      iconWrapClass: "mod-icon-wrap", // handled via inline style below
      iconColorClass: "mod-icon-color", // handled via inline style below
      pip: "mod-pip",
      chipActiveClass: "border backdrop-blur-sm",
      chipTextClass: "mod-chip-text",
    },
  ]),
);

// ─── Redesigned Module Dropdown content ───────────────────────────────────────

const ModuleDropdownContent = ({
  moduleOptions,
  activeModule,
  isAdminPage,
  isDbaPage,
  isAdmin,
  isDba,
  handleModuleSwitch,
  onNavigate,
  onClose,
}: {
  moduleOptions: Array<{
    id: NonNullable<Module>;
    name: string;
    icon: React.ElementType;
    desc: string;
    route: string;
  }>;
  activeModule: Module;
  isAdminPage: boolean;
  isDbaPage: boolean;
  isAdmin: boolean;
  isDba: boolean;
  handleModuleSwitch: (name: string, id: Module, route: string) => void;
  onNavigate: (p: string) => void;
  onClose: () => void;
}) => (
  <>
    {/* Header */}
    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
      <span className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground">
        Switch module
      </span>
      <LayoutGrid size={13} className="text-muted-foreground" />
    </div>

    {/* 2-col module grid */}
    <div
      className="grid gap-1.5 p-2"
      style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
    >
      {moduleOptions.map((m) => {
        const isActive = activeModule === m.id && !isAdminPage;
        const colorVars = moduleColorVars(m.id);
        return (
          <button
            key={m.id}
            onMouseDown={() =>
              handleModuleSwitch(m.name, m.id as Module, m.route)
            }
            style={
              isActive
                ? { ...colorVars, ...MODULE_STYLES[m.id].activeStyle }
                : colorVars
            }
            className={`group relative w-full min-w-0 flex items-center gap-2 px-2.5 py-2.5 rounded-xl transition-all duration-150 active:scale-[0.98] text-left
              ${
                isActive
                  ? MODULE_STYLES[m.id].activeClass
                  : "border border-transparent hover:border-border hover:bg-muted/50"
              }`}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors bg-muted group-hover:bg-muted/80"
              style={
                isActive
                  ? {
                      background:
                        "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.20)",
                    }
                  : undefined
              }
            >
              <m.icon
                size={15}
                style={
                  isActive
                    ? { color: "hsl(var(--mod-h) var(--mod-s) var(--mod-l))" }
                    : undefined
                }
                className={
                  isActive
                    ? ""
                    : "text-muted-foreground group-hover:text-foreground"
                }
              />
            </div>
            <div className="min-w-0 flex-1 overflow-hidden">
              <p
                className="text-[13px] font-heading font-medium leading-none whitespace-nowrap"
                style={
                  isActive
                    ? { color: "hsl(var(--mod-h) var(--mod-s) var(--mod-l))" }
                    : undefined
                }
              >
                {m.name}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug line-clamp-2">
                {m.desc}
              </p>
            </div>
            {isActive && (
              <span
                className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{
                  background: "hsl(var(--mod-h) var(--mod-s) var(--mod-l))",
                }}
              />
            )}
          </button>
        );
      })}
    </div>

    {/* Admin / DBA rows */}
    {(isAdmin || isDba) && (
      <div className="border-t border-border px-2 pb-2 pt-1.5 flex flex-col gap-1">
        {isAdmin && (
          <button
            onMouseDown={() =>
              handleModuleSwitch(
                "Admin",
                "admin",
                MODULE_DASHBOARD_ROUTES.admin,
              )
            }
            style={
              isAdminPage
                ? {
                    ...moduleColorVars("admin"),
                    ...MODULE_STYLES.admin.activeStyle,
                  }
                : moduleColorVars("admin")
            }
            className={`group w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all duration-150 active:scale-[0.98] text-left
              ${
                isAdminPage
                  ? MODULE_STYLES.admin.activeClass
                  : "border border-transparent hover:border-border hover:bg-muted/50"
              }`}
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={
                isAdminPage
                  ? {
                      background:
                        "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.20)",
                    }
                  : undefined
              }
            >
              <ShieldCheck
                size={14}
                style={
                  isAdminPage
                    ? { color: "hsl(var(--mod-h) var(--mod-s) var(--mod-l))" }
                    : undefined
                }
                className={
                  isAdminPage
                    ? ""
                    : "text-muted-foreground group-hover:text-foreground"
                }
              />
            </div>
            <div className="min-w-0 flex-1">
              <p
                className="text-[13px] font-heading font-medium leading-none"
                style={
                  isAdminPage
                    ? { color: "hsl(var(--mod-h) var(--mod-s) var(--mod-l))" }
                    : undefined
                }
              >
                Admin
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Users, rights & config
              </p>
            </div>
            {isAdminPage && (
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{
                  background: "hsl(var(--mod-h) var(--mod-s) var(--mod-l))",
                }}
              />
            )}
          </button>
        )}
        {isDba && (
          <button
            onMouseDown={() => {
              onNavigate("/dba");
              onClose();
            }}
            style={
              isDbaPage
                ? {
                    ...moduleColorVars("material"),
                    ...MODULE_STYLES.material.activeStyle,
                  }
                : moduleColorVars("material")
            }
            className={`group w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all duration-150 active:scale-[0.98] text-left
              ${
                isDbaPage
                  ? MODULE_STYLES.material.activeClass
                  : "border border-transparent hover:border-border hover:bg-muted/50"
              }`}
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={
                isDbaPage
                  ? {
                      background:
                        "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.20)",
                    }
                  : undefined
              }
            >
              <Database
                size={14}
                style={
                  isDbaPage
                    ? { color: "hsl(var(--mod-h) var(--mod-s) var(--mod-l))" }
                    : undefined
                }
                className={
                  isDbaPage
                    ? ""
                    : "text-muted-foreground group-hover:text-foreground"
                }
              />
            </div>
            <div className="min-w-0 flex-1">
              <p
                className="text-[13px] font-heading font-medium leading-none"
                style={
                  isDbaPage
                    ? { color: "hsl(var(--mod-h) var(--mod-s) var(--mod-l))" }
                    : undefined
                }
              >
                DBA Console
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                DB tools, ads & reminders
              </p>
            </div>
            {isDbaPage && (
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{
                  background: "hsl(var(--mod-h) var(--mod-s) var(--mod-l))",
                }}
              />
            )}
          </button>
        )}
      </div>
    )}
  </>
);

// ─── TopNavbar ────────────────────────────────────────────────────────────────

export const TopNavbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeModule, setActiveModule, moduleSwitching, setModuleSwitching } =
    useModule();
  const { currentUser } = useAuth();
  const { navCollapsed, setNavCollapsed } = useNavbarCollapse();
  const { handleLogout, overlay: logoutOverlay } = useGracefulLogout();

  const [setupOpen, setSetupOpen] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [moduleOpen, setModuleOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const isSuperAdmin = currentUser?.role === "super_admin";
  const isDba = currentUser?.role === "dba";
  const isAdmin = currentUser?.role === "admin" || isSuperAdmin || isDba;
  const isAdminPage =
    isAdmin &&
    (location.pathname.startsWith("/admin") ||
      location.pathname.startsWith("/users") ||
      ADMIN_PATHS.some((p) => location.pathname.startsWith(p)));
  const isDbaPage = isDba && location.pathname.startsWith("/dba");

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
    if (isAdminPage)
      return {
        items: adminSetupItems,
        label: "Admin",
        colorStyle: {
          ...moduleColorVars("admin"),
          color: "hsl(var(--mod-h) var(--mod-s) var(--mod-l))",
          borderColor: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.35)",
          background: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.10)",
        } as React.CSSProperties,
        available: true,
      };
    if (activeModule === "material")
      return {
        items: materialSetupItems,
        label: "Material",
        colorStyle: {
          ...moduleColorVars("material"),
          color: "hsl(var(--mod-h) var(--mod-s) var(--mod-l))",
          borderColor: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.35)",
          background: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.10)",
        } as React.CSSProperties,
        available: true,
      };
    if (activeModule === "followup")
      return {
        items: followupSetupItems,
        label: "Follow-Up",
        colorStyle: {
          ...moduleColorVars("followup"),
          color: "hsl(var(--mod-h) var(--mod-s) var(--mod-l))",
          borderColor: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.35)",
          background: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.10)",
        } as React.CSSProperties,
        available: true,
      };
    if (activeModule === "engineering")
      return {
        items: engineeringSetupItems,
        label: "Engineering",
        colorStyle: {
          ...moduleColorVars("engineering"),
          color: "hsl(var(--mod-h) var(--mod-s) var(--mod-l))",
          borderColor: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.35)",
          background: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.10)",
        } as React.CSSProperties,
        available: true,
      };
    if (activeModule === "finance")
      return {
        items: financeSetupItems,
        label: "Finance",
        colorStyle: {
          ...moduleColorVars("finance"),
          color: "hsl(var(--mod-h) var(--mod-s) var(--mod-l))",
          borderColor: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.35)",
          background: "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.10)",
        } as React.CSSProperties,
        available: true,
      };
    return {
      items: [],
      label: "No Module",
      colorStyle: {} as React.CSSProperties,
      available: false,
    };
  })();

  const closeAll = useCallback(() => {
    setSetupOpen(false);
    setModuleOpen(false);
    setUserOpen(false);
    setThemeOpen(false);
    setBellOpen(false);
  }, []);
  const closeSetup = useCallback(() => setSetupOpen(false), []);
  const closeModule = useCallback(() => setModuleOpen(false), []);
  const closeTheme = useCallback(() => setThemeOpen(false), []);
  const closeUser = useCallback(() => setUserOpen(false), []);
  const closeBell = useCallback(() => setBellOpen(false), []);

  const toggleSetup = useCallback(() => {
    if (setupConfig.available) {
      setSetupOpen((p) => !p);
      setModuleOpen(false);
      setUserOpen(false);
      setThemeOpen(false);
      setBellOpen(false);
    }
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

  const handleModuleSwitch = useCallback(
    async (name: string, id: Module, route: string) => {
      // Close all dropdowns synchronously first to beat useClickOutside on touch
      setModuleOpen(false);
      setSetupOpen(false);
      setSwitchingTo(name);
      setModuleSwitching(true);
      await new Promise((r) => setTimeout(r, 300));
      setActiveModule(id);
      navigate(route);
      setModuleSwitching(false);
      setSwitchingTo(null);
    },
    [navigate, setActiveModule, setModuleSwitching],
  );

  const navBtnCls = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading transition-all whitespace-nowrap ${active ? "bg-muted text-foreground" : "hover:bg-muted text-foreground"}`;

  const moduleOptions: Array<{
    id: NonNullable<Module>;
    name: string;
    icon: React.ElementType;
    desc: string;
    route: string;
  }> = [
    {
      id: "finance",
      name: "Finance",
      icon: TrendingUp,
      desc: "Ledger, payments & BRS",
      route: MODULE_DASHBOARD_ROUTES.finance,
    },
    {
      id: "material",
      name: "Material",
      icon: Package,
      desc: "GRN, PO & work orders",
      route: MODULE_DASHBOARD_ROUTES.material,
    },
    {
      id: "followup",
      name: "Follow-Up",
      icon: Calendar,
      desc: "Sales, agreements & CRM",
      route: MODULE_DASHBOARD_ROUTES.followup,
    },
    {
      id: "engineering",
      name: "Engineering",
      icon: Wrench,
      desc: "Projects, work orders & site",
      route: MODULE_DASHBOARD_ROUTES.engineering,
    },
    {
      id: "ticket",
      name: "Ticket",
      icon: MessageSquare,
      desc: "Support & issue tracking",
      route: MODULE_DASHBOARD_ROUTES.ticket,
    },
  ];

  // Close mobile menu on route change
  useEffect(() => {}, [location.pathname]);

  return (
    <>
      {logoutOverlay}
      <header className="fixed top-0 left-0 right-0 h-14 z-50 grid grid-cols-[auto_1fr_auto] items-center gap-2 px-3 sm:px-4 border-b border-border bg-card/80 backdrop-blur-lg">
        {/* Logo */}
        <button
          onClick={() => navigate("/home")}
          className="flex items-center hover:opacity-80 transition-opacity shrink-0 min-w-0"
        >
          <LogoFull />
        </button>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center justify-end gap-1 min-w-0">
          <button
            onClick={() => setNavCollapsed(!navCollapsed)}
            className="p-1.5 rounded-md bg-muted hover:bg-muted/80 active:scale-90 text-foreground border border-border shrink-0 transition-colors duration-150"
          >
            <span
              style={{
                display: "block",
                transform: navCollapsed ? "rotate(0deg)" : "rotate(180deg)",
                transition: "transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            >
              <ChevronsRight size={15} />
            </span>
          </button>

          <div
            className={`flex items-center gap-1 transition-all duration-300 ease-in-out ${navCollapsed ? "w-0 opacity-0 invisible pointer-events-none overflow-hidden" : "w-auto opacity-100 visible pointer-events-auto"}`}
          >
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

            <button
              onClick={() => {
                navigate("/reports");
                closeAll();
              }}
              className={navBtnCls(location.pathname === "/reports")}
            >
              <BarChart3 size={15} />
              <span>Reports</span>
            </button>

            <button
              onClick={() => {
                navigate("/widgets");
                closeAll();
              }}
              className={navBtnCls(location.pathname === "/widgets")}
            >
              <Puzzle size={16} />
              <span>Widgets</span>
            </button>

            {/* ── Redesigned Module Dropdown ── */}
            <Dropdown
              open={moduleOpen}
              onClose={closeModule}
              className="right-0 p-0 overflow-hidden"
              style={{ minWidth: "22rem" }}
              trigger={
                <button
                  onClick={toggleMod}
                  className={navBtnCls(moduleOpen)}
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
              }
            >
              <ModuleDropdownContent
                moduleOptions={moduleOptions}
                activeModule={activeModule}
                isAdminPage={isAdminPage}
                isDbaPage={isDbaPage}
                isAdmin={isAdmin}
                isDba={isDba}
                handleModuleSwitch={handleModuleSwitch}
                onNavigate={navigate}
                onClose={closeModule}
              />
            </Dropdown>
          </div>

          <ReminderBell
            open={bellOpen}
            onToggle={toggleBell}
            onClose={closeBell}
          />
          <ThemeSwitcher
            open={themeOpen}
            onToggle={toggleTheme}
            onClose={closeTheme}
          />

          <Dropdown
            open={userOpen}
            onClose={closeUser}
            className="right-0 w-56 p-1"
            trigger={
              <div className="relative">
                <button
                  onClick={toggleUser}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-heading text-primary-foreground font-bold hover:opacity-90 overflow-hidden ${currentUser?.avatarUrl ? "bg-muted" : "gradient-accent"}`}
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

        {/* Mobile right side */}
        <div className="flex md:hidden items-center gap-1 justify-end">
          <ReminderBell
            open={bellOpen}
            onToggle={toggleBell}
            onClose={closeBell}
          />

          <Dropdown
            open={userOpen}
            onClose={closeUser}
            className="right-0 w-56 p-1"
            trigger={
              <div className="relative">
                <button
                  onClick={toggleUser}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-heading text-primary-foreground font-bold overflow-hidden ${currentUser?.avatarUrl ? "bg-muted" : "gradient-accent"}`}
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
