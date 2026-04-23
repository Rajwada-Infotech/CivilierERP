import React, { useState, useRef, useEffect, useCallback } from "react";
import { useGracefulLogout } from "@/hooks/useGracefulLogout";
import { useNavigate, useLocation } from "react-router-dom";
import { LogoFull } from "../Logo";
import { useModule, MODULE_DASHBOARD_ROUTES } from "@/contexts/ModuleContext";
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
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, open, onClose]);
}

// ─── Generic Dropdown ─────────────────────────────────────────────────────────

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
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose, open);
  return (
    <div ref={ref} className="relative shrink-0">
      {trigger}
      <div
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
  { icon: Layers,     label: "AC Group",       path: "/masters/account-group",     color: "text-indigo-500" },
  { icon: Receipt,    label: "General Ledger", path: "/masters/general-ledger",    color: "text-orange-400" },
  { icon: Truck,      label: "Suppliers",      path: "/masters/suppliers",         color: "text-blue-400"   },
  { icon: HardHat,    label: "Contractors",    path: "/masters/contractors",       color: "text-yellow-500" },
  { icon: Users,      label: "Customers",      path: "/masters/customers",         color: "text-purple-400" },
  { icon: Landmark,   label: "Banks",          path: "/masters/banks",             color: "text-green-500"  },
  { icon: Calendar,   label: "Fin Year",       path: "/masters/financial-year",    color: "text-amber-500"  },
  { icon: BookOpen,   label: "Cheque",         path: "/masters/cheque",            color: "text-cyan-500"   },
  { icon: CreditCard, label: "Card",           path: "/masters/card",              color: "text-rose-500"   },
  { icon: FileText,   label: "TDS",            path: "/masters/tds",               color: "text-emerald-500"},
];

const materialSetupItems = [
  { icon: Package,     label: "Items",              path: "/masters/items",            color: "text-teal-500"   },
  { icon: Layers,      label: "Items Group",        path: "/masters/item-groups",      color: "text-indigo-400" },
  { icon: Hash,        label: "Unit of Measurement",path: "/masters/unit-measurement", color: "text-orange-400" },
  { icon: Hash,        label: "HSN",                path: "/masters/hsn",              color: "text-pink-400"   },
  { icon: Activity,    label: "Activity",           path: "/masters/activity",         color: "text-green-400"  },
  { icon: BillingIcon, label: "Billing",            path: "/masters/billing-terms",    color: "text-lime-500"   },
  { icon: FileText,    label: "T&C",                path: "/material/t-c-master",      color: "text-purple-500" },
];

const followupSetupItems = [
  { icon: Calendar, label: "Reminders",     path: "/followup/reminders", color: "text-indigo-500" },
  { icon: FileText, label: "Follow-up Log", path: "/followup/log",       color: "text-violet-500" },
  { icon: Activity, label: "Pending Tasks", path: "/followup/tasks",     color: "text-purple-500" },
];

const adminSetupItems = [
  { icon: Tag,       label: "Entry Type",  path: "/masters/named-entry-type",  color: "text-purple-400" },
  { icon: FileType2, label: "Type of Doc", path: "/masters/type-of-doc",       color: "text-sky-500"    },
  { icon: Users,     label: "Role Master", path: "/admin/masters/role-master", color: "text-blue-400"   },
];

// ─── Setup Dropdown ───────────────────────────────────────────────────────────

const SetupDropdown = ({
  open, onClose, onToggle, items, moduleLabel, moduleColor,
  setupAvailable, navigate, location,
}: {
  open: boolean;
  onClose: () => void;
  onToggle: () => void;
  items: { icon: React.ElementType; label: string; path: string; color: string }[];
  moduleLabel: string;
  moduleColor: string;
  setupAvailable: boolean;
  navigate: (p: string) => void;
  location: { pathname: string };
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose, open);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={onToggle}
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

      <div
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
          <span className={`text-[10px] font-heading px-2 py-0.5 rounded-full border ${moduleColor}`}>
            {moduleLabel}
          </span>
        </div>
        <div className="p-3">
          <div className="grid grid-cols-4 gap-2">
            {items.map(({ icon: Icon, label, path, color }) => (
              <button
                key={path}
                onClick={() => { navigate(path); onClose(); }}
                className={`group flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all duration-150 active:scale-95
                  ${location.pathname === path
                    ? "border-primary/40 bg-primary/[0.06]"
                    : "border-transparent hover:border-border hover:bg-muted/60"}`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-muted/50 group-hover:bg-muted transition-colors ${location.pathname === path ? "bg-primary/10" : ""}`}>
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
    </div>
  );
};

// ─── User Menu Content ────────────────────────────────────────────────────────

const UserMenuContent: React.FC<{
  currentUser: ReturnType<typeof useAuth>["currentUser"];
  isSuperAdmin: boolean;
  isDba: boolean;
  onClose: () => void;
  navigate: (p: string) => void;
  handleLogout: () => void;
}> = ({ currentUser, isSuperAdmin, isDba, onClose, navigate, handleLogout }) => (
  <>
    <div className="px-3 py-2 border-b border-border mb-1">
      <p className="text-sm font-heading font-semibold text-foreground">{currentUser?.name}</p>
      <p className="text-xs text-muted-foreground truncate">{currentUser?.email}</p>
      <div className="mt-1.5">
        {isSuperAdmin && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-heading bg-violet-500/10 text-violet-600">Super Admin</span>
        )}
        {currentUser?.role === "admin" && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-heading bg-blue-500/10 text-blue-600">Admin</span>
        )}
        {currentUser?.role === "dba" && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-heading bg-emerald-500/10 text-emerald-600">DBA</span>
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
        isSuperAdmin
          ? navigate("/superadmin/profile")
          : isDba
            ? navigate("/dba/profile")
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
  </>
);

// ─── TopNavbar ────────────────────────────────────────────────────────────────

export const TopNavbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeModule, setActiveModule, moduleSwitching, setModuleSwitching } = useModule();
  const { currentUser } = useAuth();
  const { navCollapsed, setNavCollapsed } = useNavbarCollapse();
  const { handleLogout, overlay: logoutOverlay } = useGracefulLogout();

  const [setupOpen,   setSetupOpen]   = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [moduleOpen,  setModuleOpen]  = useState(false);
  const [userOpen,    setUserOpen]    = useState(false);
  const [themeOpen,   setThemeOpen]   = useState(false);
  const [bellOpen,    setBellOpen]    = useState(false);

  const isSuperAdmin = currentUser?.role === "super_admin";
  const isDba        = currentUser?.role === "dba";
  const isAdmin      = currentUser?.role === "admin" || isSuperAdmin || isDba;
  const isAdminPage  =
    isAdmin &&
    (location.pathname.startsWith("/admin") ||
      location.pathname.startsWith("/users") ||
      ADMIN_PATHS.some((p) => location.pathname.startsWith(p)));

  const RoleIcon     = isSuperAdmin ? Crown : isDba ? Database : isAdmin ? Shield : null;
  const roleBadgeCls = isSuperAdmin ? "bg-violet-600" : isDba ? "bg-emerald-600" : "bg-blue-600";

  const getSetupConfig = () => {
    if (isAdminPage)                 return { items: adminSetupItems,    label: "Admin",     color: "bg-blue-500/10 text-blue-600 border-blue-200/60",         available: true };
    if (activeModule === "material") return { items: materialSetupItems, label: "Material",  color: "bg-emerald-500/10 text-emerald-600 border-emerald-200/60", available: true };
    if (activeModule === "followup") return { items: followupSetupItems, label: "Follow-Up", color: "bg-indigo-500/10 text-indigo-600 border-indigo-200/60",   available: true };
    if (activeModule === "finance")  return { items: financeSetupItems,  label: "Finance",   color: "bg-primary/10 text-primary border-primary/20",            available: true };
    return { items: [], label: "No Module", color: "", available: false };
  };
  const setupConfig = getSetupConfig();

  // ── close helpers ──────────────────────────────────────────────────────────
  const closeAll    = useCallback(() => { setSetupOpen(false); setModuleOpen(false); setUserOpen(false); setThemeOpen(false); setBellOpen(false); }, []);
  const closeSetup  = useCallback(() => setSetupOpen(false),  []);
  const closeModule = useCallback(() => setModuleOpen(false), []);
  const closeTheme  = useCallback(() => setThemeOpen(false),  []);
  const closeUser   = useCallback(() => setUserOpen(false),   []);
  const closeBell   = useCallback(() => setBellOpen(false),   []);

  // ── toggle helpers (close siblings before opening) ─────────────────────────
  const toggleSetup = useCallback(() => {
    if (!setupConfig.available) return;
    setSetupOpen((p) => !p); setModuleOpen(false); setUserOpen(false); setThemeOpen(false); setBellOpen(false);
  }, [setupConfig.available]);
  const toggleMod   = useCallback(() => { setModuleOpen((p) => !p); setSetupOpen(false); setUserOpen(false); setThemeOpen(false); setBellOpen(false); }, []);
  const toggleTheme = useCallback(() => { setThemeOpen((p) => !p); setSetupOpen(false); setModuleOpen(false); setUserOpen(false); setBellOpen(false); }, []);
  const toggleUser  = useCallback(() => { setUserOpen((p) => !p); setSetupOpen(false); setModuleOpen(false); setThemeOpen(false); setBellOpen(false); }, []);
  const toggleBell  = useCallback(() => { setBellOpen((p) => !p); setSetupOpen(false); setModuleOpen(false); setUserOpen(false); setThemeOpen(false); }, []);

  const navBtn = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading transition-all whitespace-nowrap ${active ? "bg-muted text-foreground" : "hover:bg-muted text-foreground"}`;

  return (
    <>
      {logoutOverlay}
      <header className="fixed top-0 left-0 right-0 h-14 z-50 grid grid-cols-[auto_1fr_auto] items-center gap-2 px-3 sm:px-4 border-b border-border bg-card/80 backdrop-blur-lg">

        {/* Logo */}
        <button
          type="button"
          onClick={() => navigate("/home")}
          title="Go to dashboard"
          aria-label="Go to dashboard"
          className="flex items-center hover:opacity-80 transition-opacity shrink-0 min-w-0"
        >
          <span className="sr-only">Go to dashboard</span>
          <LogoFull />
        </button>

        {/* ── DESKTOP NAV ──────────────────────────────────────────────── */}
        <div className="hidden md:flex items-center justify-end gap-1 min-w-0">

          {/* Collapse toggle */}
          <button
            onClick={() => setNavCollapsed(!navCollapsed)}
            title={navCollapsed ? "Expand navigation" : "Collapse navigation"}
            className="p-1.5 rounded-md bg-muted hover:bg-muted/80 active:scale-90 text-foreground border border-border shrink-0 overflow-hidden transition-colors duration-150"
          >
            <span style={{ display: "block", transform: navCollapsed ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
              <ChevronsRight size={15} />
            </span>
          </button>

          {/* Collapsible items */}
          <div className={`flex items-center gap-1 transition-all duration-300 ease-in-out ${navCollapsed ? "w-0 opacity-0 invisible pointer-events-none overflow-hidden" : "w-auto opacity-100 visible pointer-events-auto"}`}>

            {/* Setup */}
            <SetupDropdown
              open={setupOpen} onClose={closeSetup} onToggle={toggleSetup}
              items={setupConfig.items} moduleLabel={setupConfig.label}
              moduleColor={setupConfig.color} setupAvailable={setupConfig.available}
              navigate={navigate} location={location}
            />

            {/* Reports */}
            <button onClick={() => { navigate("/reports"); closeAll(); }} className={navBtn(location.pathname === "/reports")}>
              <BarChart3 size={15} /><span>Reports</span>
            </button>

            {/* Widgets */}
            <button onClick={() => { navigate("/widgets"); closeAll(); }} className={navBtn(location.pathname === "/widgets")}>
              <Puzzle size={16} /><span>Widgets</span>
            </button>

            {/* Module selector */}
            <Dropdown
              open={moduleOpen} onClose={closeModule}
              trigger={
                <button onClick={toggleMod} className={navBtn(moduleOpen)} disabled={moduleSwitching}>
                  <LayoutGrid size={16} className={moduleSwitching ? "animate-spin" : ""} />
                  <span>{switchingTo ? `${switchingTo}…` : "Module"}</span>
                  <ChevronDown size={13} className={`transition-transform duration-200 ${moduleOpen ? "rotate-180" : ""} ${moduleSwitching ? "opacity-0" : ""}`} />
                </button>
              }
              className="right-0 p-1.5"
              style={{ minWidth: "17rem" }}
            >
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading px-3 pt-2 pb-2">Switch Module</p>

              {/* Finance */}
              <button
                onClick={async () => { setModuleOpen(false); setSwitchingTo("Finance"); setModuleSwitching(true); await new Promise((r) => setTimeout(r, 350)); setActiveModule("finance"); navigate(MODULE_DASHBOARD_ROUTES.finance); setModuleSwitching(false); setSwitchingTo(null); }}
                className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${activeModule === "finance" && !isAdminPage ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground"}`}
              >
                <span className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${activeModule === "finance" && !isAdminPage ? "bg-primary/15" : "bg-muted group-hover:bg-muted-foreground/10"}`}>
                  <TrendingUp size={14} className={activeModule === "finance" && !isAdminPage ? "text-primary" : "text-muted-foreground group-hover:text-foreground"} />
                </span>
                <div className="flex-1 text-left">
                  <p className={`text-sm font-heading font-medium leading-none ${activeModule === "finance" && !isAdminPage ? "text-primary" : "text-foreground"}`}>Finance</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Ledger, payments &amp; BRS</p>
                </div>
                {activeModule === "finance" && !isAdminPage && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
              </button>

              {/* Material */}
              <button
                onClick={async () => { setModuleOpen(false); setSwitchingTo("Material"); setModuleSwitching(true); await new Promise((r) => setTimeout(r, 350)); setActiveModule("material"); navigate(MODULE_DASHBOARD_ROUTES.material); setModuleSwitching(false); setSwitchingTo(null); }}
                className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${activeModule === "material" && !isAdminPage ? "bg-emerald-500/10 text-emerald-600" : "hover:bg-muted text-foreground"}`}
              >
                <span className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${activeModule === "material" && !isAdminPage ? "bg-emerald-500/15" : "bg-muted group-hover:bg-muted-foreground/10"}`}>
                  <Package size={14} className={activeModule === "material" && !isAdminPage ? "text-emerald-500" : "text-muted-foreground group-hover:text-foreground"} />
                </span>
                <div className="flex-1 text-left">
                  <p className={`text-sm font-heading font-medium leading-none ${activeModule === "material" && !isAdminPage ? "text-emerald-600" : "text-foreground"}`}>Material</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">GRN, PO &amp; work orders</p>
                </div>
                {activeModule === "material" && !isAdminPage && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />}
              </button>

              {/* Follow-Up */}
              <button
                onClick={async () => { setModuleOpen(false); setSwitchingTo("Follow-Up"); setModuleSwitching(true); await new Promise((res) => setTimeout(res, 350)); setActiveModule("followup"); navigate(MODULE_DASHBOARD_ROUTES.followup); setModuleSwitching(false); setSwitchingTo(null); }}
                className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${activeModule === "followup" && !isAdminPage ? "bg-indigo-500/10 text-indigo-600" : "hover:bg-muted text-foreground"}`}
              >
                <span className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${activeModule === "followup" && !isAdminPage ? "bg-indigo-500/15" : "bg-muted group-hover:bg-muted-foreground/10"}`}>
                  <Calendar size={14} className={activeModule === "followup" && !isAdminPage ? "text-indigo-500" : "text-muted-foreground group-hover:text-foreground"} />
                </span>
                <div className="flex-1 text-left">
                  <p className={`text-sm font-heading font-medium leading-none ${activeModule === "followup" && !isAdminPage ? "text-indigo-600" : "text-foreground"}`}>Follow-Up</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Sales, agreements &amp; CRM</p>
                </div>
                {activeModule === "followup" && !isAdminPage && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />}
              </button>

              {/* Admin (role-gated) */}
              {isAdmin && (
                <>
                  <div className="mx-3 my-1.5 border-t border-border" />
                  <button
                    onClick={async () => { setModuleOpen(false); setSwitchingTo("Admin"); setModuleSwitching(true); await new Promise((r) => setTimeout(r, 350)); setActiveModule("admin"); navigate(MODULE_DASHBOARD_ROUTES.admin); setModuleSwitching(false); setSwitchingTo(null); }}
                    className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${isAdminPage ? "bg-blue-500/10 text-blue-600" : "hover:bg-muted text-foreground"}`}
                  >
                    <span className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors relative ${isAdminPage ? "bg-blue-500/15" : "bg-muted group-hover:bg-muted-foreground/10"}`}>
                      <ShieldCheck size={14} className={isAdminPage ? "text-blue-500" : "text-muted-foreground group-hover:text-foreground"} />
                      {isSuperAdmin && (
                        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full flex items-center justify-center bg-violet-600">
                          <Crown size={6} className="text-white" />
                        </span>
                      )}
                    </span>
                    <div className="flex-1 text-left">
                      <p className={`text-sm font-heading font-medium leading-none ${isAdminPage ? "text-blue-600" : "text-foreground"}`}>Admin</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Users, rights &amp; config</p>
                    </div>
                    {isAdminPage && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
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

          {/* Bell — now a separate component */}
          <ReminderBell open={bellOpen} onToggle={toggleBell} onClose={closeBell} />

          {/* Theme — now a separate component */}
          <ThemeSwitcher open={themeOpen} onToggle={toggleTheme} onClose={closeTheme} />

          {/* User */}
          <Dropdown
            open={userOpen} onClose={closeUser}
            trigger={
              <button onClick={toggleUser} className="relative w-8 h-8 rounded-full gradient-accent flex items-center justify-center text-xs font-heading text-primary-foreground font-bold hover:opacity-90">
                {currentUser?.initials || "?"}
                {RoleIcon && (
                  <span className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center ${roleBadgeCls}`}>
                    <RoleIcon size={9} className="text-white" />
                  </span>
                )}
              </button>
            }
            className="right-0 w-56 p-1"
          >
            <UserMenuContent currentUser={currentUser} isSuperAdmin={isSuperAdmin} isDba={isDba} onClose={closeUser} navigate={navigate} handleLogout={handleLogout} />
          </Dropdown>
        </div>

        {/* ── MOBILE RIGHT ─────────────────────────────────────────────── */}
        <div className="flex md:hidden items-center gap-1 justify-end">
          <ReminderBell open={bellOpen} onToggle={toggleBell} onClose={closeBell} />

          <Dropdown
            open={userOpen} onClose={closeUser}
            trigger={
              <button onClick={toggleUser} className="relative w-8 h-8 rounded-full gradient-accent flex items-center justify-center text-xs font-heading text-primary-foreground font-bold">
                {currentUser?.initials || "?"}
                {RoleIcon && (
                  <span className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center ${roleBadgeCls}`}>
                    <RoleIcon size={9} className="text-white" />
                  </span>
                )}
              </button>
            }
            className="right-0 w-56 p-1"
          >
            <UserMenuContent currentUser={currentUser} isSuperAdmin={isSuperAdmin} isDba={isDba} onClose={closeUser} navigate={navigate} handleLogout={handleLogout} />
          </Dropdown>
        </div>

      </header>
    </>
  );
};

export default TopNavbar;
