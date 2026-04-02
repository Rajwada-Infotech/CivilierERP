import React, { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { LogoFull } from "../Logo";
import { useTheme, THEME_DOTS, Theme } from "@/contexts/ThemeContext";
import { useModule } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavbarCollapse } from "./AppLayout";
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
} from "lucide-react";
import { BillingIcon } from "@/components/icons/BillingIcon";

// ─── Dropdown Component ──────────────────────────────────────────────────────
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
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  return (
    <div
      ref={ref}
      style={style}
      className={`absolute top-full mt-2 z-50 rounded-xl border border-border bg-card shadow-2xl transition-all duration-200 origin-top-right ${
        open
          ? "opacity-100 scale-100 pointer-events-auto"
          : "opacity-0 scale-95 pointer-events-none"
      } ${className || ""}`}
    >
      {children}
    </div>
  );
};

// ─── Setup Items per Module ───────────────────────────────────────────────────
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
    path: "/masters/expenses",
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

// ─── Setup Dropdown Panel ─────────────────────────────────────────────────────
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
  navigate: (path: string) => void;
  location: { pathname: string };
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  return (
    <div
      ref={ref}
      className={`absolute top-full mt-2 z-50 rounded-xl border border-border bg-card shadow-2xl transition-all duration-200 origin-top-left left-0 ${
        open
          ? "opacity-100 scale-100 pointer-events-auto"
          : "opacity-0 scale-95 pointer-events-none"
      }`}
      style={{ minWidth: "20rem" }}
    >
      {/* Header */}
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

      {/* Grid of items */}
      <div className="p-3">
        <div className="grid grid-cols-4 gap-2">
          {items.map(({ icon: Icon, label, path, color }) => (
            <button
              key={path}
              onClick={() => {
                navigate(path);
                onClose();
              }}
              className={`group flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all duration-150 active:scale-95 ${
                location.pathname === path
                  ? "border-primary/40 bg-primary/[0.06]"
                  : "border-transparent hover:border-border hover:bg-muted/60"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center bg-muted/50 group-hover:bg-muted transition-colors ${
                  location.pathname === path ? "bg-primary/10" : ""
                }`}
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

// ─── TopNavbar ───────────────────────────────────────────────────────────────
export const TopNavbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { activeModule, setActiveModule } = useModule();
  const { currentUser, logout } = useAuth();
  const { navCollapsed, setNavCollapsed } = useNavbarCollapse();

  const [setupOpen, setSetupOpen] = useState(false);
  const [moduleOpen, setModuleOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  const isAdminPage =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/users");
  const isSuperAdmin = currentUser?.role === "super_admin";
  const isAdmin = currentUser?.role === "admin" || isSuperAdmin;

  const RoleIcon = isSuperAdmin ? Crown : isAdmin ? Shield : null;
  const roleBadgeClassName = isSuperAdmin ? "bg-violet-600" : "bg-blue-600";

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

  // ─── Toggle Handlers ───────────────────────────────────────────────────────
  const toggleSetup = useCallback(() => {
    if (!setupConfig.available) return;
    setSetupOpen((prev) => !prev);
    setModuleOpen(false);
    setUserOpen(false);
    setThemeOpen(false);
  }, [setupConfig.available]);

  const toggleModuleDropdown = useCallback(() => {
    setModuleOpen((prev) => !prev);
    setSetupOpen(false);
    setUserOpen(false);
    setThemeOpen(false);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeOpen((prev) => !prev);
    setSetupOpen(false);
    setModuleOpen(false);
    setUserOpen(false);
  }, []);

  const toggleUser = useCallback(() => {
    setUserOpen((prev) => !prev);
    setSetupOpen(false);
    setModuleOpen(false);
    setThemeOpen(false);
  }, []);

  const closeAll = useCallback(() => {
    setSetupOpen(false);
    setModuleOpen(false);
    setUserOpen(false);
    setThemeOpen(false);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 h-14 z-50 flex items-center justify-between px-4 border-b border-border bg-card/80 backdrop-blur-lg">
      {/* Logo */}
      <button
        type="button"
        onClick={() => navigate("/")}
        title="Go to dashboard"
        aria-label="Go to dashboard"
        className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0"
      >
        <span className="sr-only">Go to dashboard</span>
        <LogoFull />
      </button>

      {/* DESKTOP NAV */}
      <div className="hidden md:flex items-center gap-1">
        {/* Collapse Toggle */}
        <button
          onClick={() => setNavCollapsed(!navCollapsed)}
          title={navCollapsed ? "Expand navigation" : "Collapse navigation"}
          aria-label={
            navCollapsed ? "Expand navigation" : "Collapse navigation"
          }
          className="p-1.5 rounded-md bg-muted hover:bg-muted/80 text-foreground border border-border transition-all duration-200 shrink-0"
        >
          {navCollapsed ? (
            <ChevronsRight size={15} />
          ) : (
            <ChevronsLeft size={15} />
          )}
        </button>

        {/* Collapsible Nav Items */}
        <div
          className={`flex items-center gap-1 transition-all duration-300 ease-in-out max-w-[700px] ${
            navCollapsed
              ? "w-0 opacity-0 invisible pointer-events-none"
              : "w-auto opacity-100 visible pointer-events-auto"
          }`}
        >
          {/* Setup Dropdown — module-aware */}
          <div className="relative shrink-0">
            <button
              onClick={toggleSetup}
              title={
                !setupConfig.available ? "Select a module to access Setup" : ""
              }
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading transition-all duration-200 whitespace-nowrap ${
                setupOpen
                  ? "bg-muted text-foreground"
                  : setupConfig.available
                    ? "hover:bg-muted text-foreground"
                    : "text-muted-foreground/40 cursor-not-allowed"
              }`}
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

          {/* Reports */}
          <button
            onClick={() => {
              navigate("/reports");
              closeAll();
            }}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading transition-all whitespace-nowrap ${
              location.pathname === "/reports"
                ? "bg-primary/10 text-primary"
                : "hover:bg-muted text-foreground"
            }`}
          >
            <BarChart3 size={16} /> Reports
          </button>

          {/* Widgets */}
          <button
            onClick={() => {
              navigate("/widgets");
              closeAll();
            }}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading transition-all whitespace-nowrap ${
              location.pathname === "/widgets"
                ? "bg-primary/10 text-primary"
                : "hover:bg-muted text-foreground"
            }`}
          >
            <Puzzle size={16} /> Widgets
          </button>

          {/* Module Selector */}
          <div className="relative shrink-0">
            <button
              onClick={toggleModuleDropdown}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading transition-all whitespace-nowrap ${
                moduleOpen
                  ? "bg-muted text-foreground"
                  : "hover:bg-muted text-foreground"
              }`}
            >
              <LayoutGrid size={16} />
              <span>Module</span>
              <ChevronDown
                size={13}
                className={`transition-transform duration-200 ${moduleOpen ? "rotate-180" : ""}`}
              />
            </button>

            <Dropdown
              open={moduleOpen}
              onClose={() => setModuleOpen(false)}
              className="right-0 p-3"
              style={{ minWidth: "20rem" }}
            >
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-3 px-1">
                Select Module
              </p>
              <div
                className={`grid gap-2 ${isAdmin ? "grid-cols-3" : "grid-cols-2"}`}
              >
                {/* Finance */}
                <button
                  onClick={() => {
                    setActiveModule("finance");
                    setModuleOpen(false);
                    navigate("/");
                  }}
                  className={`group flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all ${
                    activeModule === "finance" && !isAdminPage
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border hover:border-primary/40 hover:bg-muted/60"
                  }`}
                >
                  <svg width="22" height="22" viewBox="0 0 36 36" fill="none">
                    <circle
                      cx="12"
                      cy="22"
                      r="7"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={
                        activeModule === "finance" && !isAdminPage
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-primary"
                      }
                    />
                    <circle
                      cx="24"
                      cy="22"
                      r="7"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={
                        activeModule === "finance" && !isAdminPage
                          ? "text-primary/50"
                          : "text-muted-foreground/50 group-hover:text-primary/50"
                      }
                    />
                    <rect
                      x="8"
                      y="6"
                      width="20"
                      height="3"
                      rx="1.5"
                      fill="currentColor"
                      className={
                        activeModule === "finance" && !isAdminPage
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-primary"
                      }
                    />
                  </svg>
                  <span
                    className={`text-xs font-heading ${activeModule === "finance" && !isAdminPage ? "text-primary font-semibold" : "text-muted-foreground group-hover:text-foreground"}`}
                  >
                    Finance
                  </span>
                  {activeModule === "finance" && !isAdminPage && (
                    <span className="text-[9px] font-heading px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                      Active
                    </span>
                  )}
                </button>

                {/* Material */}
                <button
                  onClick={() => {
                    setActiveModule("material");
                    setModuleOpen(false);
                    navigate("/material/expense-booking");
                  }}
                  className={`group flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all ${
                    activeModule === "material" && !isAdminPage
                      ? "border-emerald-500/60 bg-emerald-500/10 shadow-sm"
                      : "border-border hover:border-emerald-500/40 hover:bg-muted/60"
                  }`}
                >
                  <Package
                    size={22}
                    className={`transition-colors ${
                      activeModule === "material" && !isAdminPage
                        ? "text-emerald-500"
                        : "text-muted-foreground group-hover:text-emerald-500"
                    }`}
                  />
                  <span
                    className={`text-xs font-heading ${activeModule === "material" && !isAdminPage ? "text-emerald-600 font-semibold" : "text-muted-foreground group-hover:text-foreground"}`}
                  >
                    Material
                  </span>
                  {activeModule === "material" && !isAdminPage && (
                    <span className="text-[9px] font-heading px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600">
                      Active
                    </span>
                  )}
                </button>

                {/* Admin */}
                {isAdmin && (
                  <button
                    onClick={() => {
                      setModuleOpen(false);
                      navigate("/admin");
                    }}
                    className={`group flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all ${
                      isAdminPage
                        ? "border-blue-500/60 bg-blue-500/10 shadow-sm"
                        : "border-border hover:border-blue-500/40 hover:bg-muted/60"
                    }`}
                  >
                    <div className="relative">
                      <ShieldCheck
                        size={22}
                        className={`transition-colors ${
                          isAdminPage
                            ? "text-blue-500"
                            : "text-muted-foreground group-hover:text-blue-500"
                        }`}
                      />
                      {isSuperAdmin && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center bg-violet-600">
                          <Crown size={8} className="text-white" />
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-xs font-heading ${isAdminPage ? "text-blue-600 font-semibold" : "text-muted-foreground group-hover:text-foreground"}`}
                    >
                      Admin
                    </span>
                    {isAdminPage && (
                      <span className="text-[9px] font-heading px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-600">
                        Active
                      </span>
                    )}
                  </button>
                )}
              </div>

              {/* Active module indicator bar */}
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-[10px] text-muted-foreground font-heading text-center">
                  {isAdminPage
                    ? "Currently in Admin"
                    : activeModule
                      ? `Currently in ${activeModule.charAt(0).toUpperCase() + activeModule.slice(1)}`
                      : "No module selected"}
                </p>
              </div>
            </Dropdown>
          </div>
        </div>

        {/* Theme Selector */}
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
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-heading transition-all ${
                  theme === t
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted"
                }`}
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

        {/* User Menu */}
        <div className="relative shrink-0">
          <button
            onClick={toggleUser}
            className="relative w-8 h-8 rounded-full gradient-accent flex items-center justify-center text-xs font-heading text-primary-foreground font-bold hover:opacity-90"
          >
            {currentUser?.initials || "?"}
            {RoleIcon && (
              <span
                className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center ${roleBadgeClassName}`}
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
                {currentUser?.role === "user" && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-heading bg-muted text-muted-foreground">
                    User · {currentUser.pagePermissions?.length || 0} pages
                  </span>
                )}
              </div>
            </div>
            <button className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors text-foreground">
              <User size={14} /> Profile
            </button>
            <button
              onMouseDown={() => {
                logout();
                navigate("/login");
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors text-destructive"
            >
              <LogOut size={14} /> Sign Out
            </button>
          </Dropdown>
        </div>
      </div>

      {/* MOBILE RIGHT SIDE */}
      <div className="flex md:hidden items-center">
        <div className="relative">
          <button
            onClick={toggleUser}
            className="relative w-8 h-8 rounded-full gradient-accent flex items-center justify-center text-xs font-heading text-primary-foreground font-bold"
          >
            {currentUser?.initials || "?"}
            {RoleIcon && (
              <span
                className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center ${roleBadgeClassName}`}
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
            <button className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted text-foreground">
              <User size={14} /> Profile
            </button>
            <button
              onMouseDown={() => {
                logout();
                navigate("/login");
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted text-destructive"
            >
              <LogOut size={14} /> Sign Out
            </button>
          </Dropdown>
        </div>
      </div>
    </header>
  );
};

export default TopNavbar;
