import React, { useState, useRef, useEffect, useCallback } from "react";
import { useGracefulLogout } from "@/hooks/useGracefulLogout";
import { useNavigate, useLocation } from "react-router-dom";
import { LogoFull } from "../Logo";
import { useModule } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavbarCollapse } from "./layoutContexts";
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
        className={`absolute top-full mt-2.5 z-50 rounded-2xl border border-border bg-card shadow-2xl transition-all duration-200 origin-top
          ${open ? "opacity-100 scale-100 pointer-events-auto translate-y-0" : "opacity-0 scale-95 pointer-events-none -translate-y-1"} ${className || ""}`}
      >
        {children}
      </div>
    </div>
  );
};

// ─── Module color helpers ──────────────────────────────────────────────────────

const MODULE_COLORS: Record<string, { h: number; s: number; l: number }> = {
  finance: { h: 217, s: 91, l: 60 },
  material: { h: 160, s: 60, l: 45 },
  followup: { h: 263, s: 70, l: 58 },
  engineering: { h: 38, s: 92, l: 50 },
  ticket: { h: 330, s: 80, l: 60 },
  admin: { h: 217, s: 91, l: 60 },
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
    color: "text-teal-400",
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
        className={`nav-pill-btn ${open ? "nav-pill-btn--active" : ""} ${!setupAvailable ? "opacity-30 cursor-not-allowed" : ""}`}
      >
        <SlidersHorizontal size={13} />
        <span>Setup</span>
        {setupAvailable && (
          <ChevronDown
            size={12}
            className={`transition-transform duration-200 opacity-60 ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>
    }
  >
    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2">
        <Settings size={13} className="text-muted-foreground" />
        <span className="text-[10px] font-heading font-semibold text-foreground uppercase tracking-wider">
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
              <Icon size={15} className={color} />
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

// ─── TopNavbar ────────────────────────────────────────────────────────────────

export const TopNavbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeModule } = useModule();
  const { currentUser } = useAuth();
  const { navCollapsed, setNavCollapsed } = useNavbarCollapse();
  const { handleLogout, overlay: logoutOverlay } = useGracefulLogout();

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
          color: hsl(var(--foreground));
          background: transparent;
          border: 1px solid transparent;
          transition: background 150ms, border-color 150ms, color 150ms;
          white-space: nowrap;
          cursor: pointer;
        }
        .nav-pill-btn:hover {
          background: hsl(var(--muted));
          border-color: hsl(var(--border));
        }
        .nav-pill-btn--active {
          background: hsl(var(--muted));
          border-color: hsl(var(--border));
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
            clip-path: inset(0% 0% 0% 0% round 99px);
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
          key={navCollapsed ? "nav-hidden" : "nav-visible"}
          className={`hidden md:flex items-center gap-0.5 absolute left-1/2 ${navCollapsed ? "pill-nav-collapse" : "pill-nav-expand"}`}
          style={{
            background: "hsl(var(--muted) / 0.6)",
            border: "1px solid hsl(var(--border))",
            borderRadius: "9999px",
            padding: "0.25rem",
            backdropFilter: "blur(8px)",
          }}
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
        </nav>

        {/* ── Right actions ── */}
        <div className="hidden md:flex items-center gap-1.5 ml-auto shrink-0">
          {/* Collapse sidebar toggle */}
          <button
            onClick={() => setNavCollapsed(!navCollapsed)}
            title={navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="w-8 h-8 rounded-full flex items-center justify-center border border-border bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-all duration-150 active:scale-90"
          >
            {navCollapsed ? (
              <PanelLeftOpen size={15} />
            ) : (
              <PanelLeftClose size={15} />
            )}
          </button>

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
