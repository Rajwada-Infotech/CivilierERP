import React, { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { LogoFull } from "../Logo";
import { useTheme, THEME_DOTS, Theme } from "@/contexts/ThemeContext";
import { useModule } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import {
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
  CheckCircle2,
  Menu,
  X,
  Receipt,
  Truck,
  Users,
  HardHat,
  Landmark,
  ChevronsLeft,
  ChevronsRight,
  Package,
  Layers,
} from "lucide-react";

// ─── Dropdown ─────────────────────────────────────────────────────────────────
const Dropdown = ({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
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
      className={`absolute top-full mt-2 z-50 rounded-lg border border-border bg-card shadow-xl transition-all duration-200 origin-top-right ${
        open
          ? "opacity-100 scale-100 pointer-events-auto"
          : "opacity-0 scale-95 pointer-events-none"
      } ${className || ""}`}
    >
      {children}
    </div>
  );
};

const masterItems = [
  {
    icon: Receipt,
    label: "Expenses",
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
    icon: Users,
    label: "Customers",
    path: "/masters/customers",
    color: "text-purple-400",
  },
  {
    icon: HardHat,
    label: "Contractors",
    path: "/masters/contractors",
    color: "text-yellow-400",
  },
  {
    icon: Landmark,
    label: "Banks",
    path: "/masters/banks",
    color: "text-green-400",
  },
  {
    icon: Package,
    label: "Items",
    path: "/masters/items",
    color: "text-teal-400",
  },
  {
    icon: Layers,
    label: "Item Groups",
    path: "/masters/item-groups",
    color: "text-indigo-400",
  },
];

export const TopNavbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { activeModule, setActiveModule } = useModule();
  const { currentUser, logout } = useAuth();
  const [setupOpen, setSetupOpen] = useState(false);
  const [moduleOpen, setModuleOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);

  const isModuleActive = activeModule !== null;
  const isSuperAdmin = currentUser?.role === "super_admin";
  const isAdmin = currentUser?.role === "admin" || isSuperAdmin;

  const RoleIcon = isSuperAdmin ? Crown : isAdmin ? Shield : null;
  const roleColor = isSuperAdmin ? "#7c3aed" : "#2563eb";

  const closeAll = () => {
    setSetupOpen(false);
    setModuleOpen(false);
    setUserOpen(false);
    setThemeOpen(false);
  };

  const handleSetupClick = useCallback(() => {
    if (!isModuleActive) return;
    setSetupOpen((p) => !p);
    setModuleOpen(false);
    setUserOpen(false);
    setThemeOpen(false);
  }, [isModuleActive]);

  return (
    <header className="fixed top-0 left-0 right-0 h-14 z-50 flex items-center justify-between px-4 border-b border-border bg-card/80 backdrop-blur-lg">
      {/* Logo */}
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0"
      >
        <LogoFull />
      </button>

      {/* ── DESKTOP NAV ─────────────────────────────────────────────────── */}
      <div className="hidden md:flex items-center gap-1">
        {/* Collapse toggle */}
        <button
          onClick={() => setNavCollapsed((p) => !p)}
          title={navCollapsed ? "Expand navigation" : "Collapse navigation"}
          className="p-1.5 rounded-md bg-muted hover:bg-muted/80 text-foreground border border-border transition-all duration-200 shrink-0"
        >
          {navCollapsed ? (
            <ChevronsRight size={15} />
          ) : (
            <ChevronsLeft size={15} />
          )}
        </button>

        {/* Collapsible block */}
        <div
          className="flex items-center gap-1 transition-all duration-300 ease-in-out"
          style={{
            maxWidth: navCollapsed ? 0 : 600,
            opacity: navCollapsed ? 0 : 1,
            overflow: navCollapsed ? "hidden" : "visible",
            pointerEvents: navCollapsed ? "none" : "auto",
          }}
        >
          {/* Setup */}
          <div className="relative shrink-0">
            <button
              onClick={handleSetupClick}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading transition-all duration-200 whitespace-nowrap ${
                isModuleActive
                  ? "hover:bg-muted text-foreground"
                  : "text-muted-foreground cursor-not-allowed opacity-40"
              }`}
              title={isModuleActive ? "Setup" : "Select a module first"}
            >
              <Settings size={16} /> Setup
            </button>
            <Dropdown
              open={setupOpen}
              onClose={() => setSetupOpen(false)}
              className="right-0 w-72 p-3"
            >
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-3">
                Masters
              </p>
              <div className="grid grid-cols-3 gap-2">
                {masterItems.map(({ icon: Icon, label, path, color }) => (
                  <button
                    key={label}
                    onClick={() => {
                      navigate(path);
                      setSetupOpen(false);
                    }}
                    className={`group flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${
                      location.pathname === path
                        ? "border-primary/60 bg-primary/10"
                        : "border-border/50 hover:border-border hover:bg-muted/60"
                    }`}
                  >
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-muted/60 group-hover:bg-muted transition-colors">
                      <Icon size={18} className={color} />
                    </div>
                    <span className="text-[11px] font-heading text-muted-foreground group-hover:text-foreground transition-colors text-center">
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            </Dropdown>
          </div>

          {/* Reports */}
          <button
            onClick={() => navigate("/reports")}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading transition-all duration-200 whitespace-nowrap ${location.pathname === "/reports" ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground"}`}
          >
            <BarChart3 size={16} /> Reports
          </button>

          {/* Widgets */}
          <button
            onClick={() => navigate("/widgets")}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading transition-all duration-200 whitespace-nowrap ${location.pathname === "/widgets" ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground"}`}
          >
            <Puzzle size={16} /> Widgets
          </button>

          {/* Module */}
          <div className="relative shrink-0">
            <button
              onClick={() => {
                setModuleOpen((p) => !p);
                setSetupOpen(false);
                setUserOpen(false);
                setThemeOpen(false);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-heading hover:bg-muted transition-all duration-200 text-foreground whitespace-nowrap"
            >
              <LayoutGrid size={16} /> Module
            </button>
            <Dropdown
              open={moduleOpen}
              onClose={() => setModuleOpen(false)}
              className="right-0 w-80 p-3"
            >
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-3">
                Select Module
              </p>
              <div
                className={`grid gap-3 ${isAdmin ? "grid-cols-2" : "grid-cols-1"}`}
              >
                <button
                  onClick={() => {
                    setActiveModule("finance");
                    setModuleOpen(false);
                    navigate("/");
                  }}
                  className={`group flex flex-col items-center gap-2 p-4 rounded-lg border transition-all ${activeModule === "finance" ? "border-primary bg-primary/10" : "border-border hover:border-primary hover:bg-muted"}`}
                >
                  <svg width="32" height="32" viewBox="0 0 36 36" fill="none">
                    <circle
                      cx="12"
                      cy="22"
                      r="7"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-primary"
                    />
                    <circle
                      cx="24"
                      cy="22"
                      r="7"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-secondary"
                    />
                    <rect
                      x="8"
                      y="6"
                      width="20"
                      height="3"
                      rx="1.5"
                      fill="currentColor"
                      className="text-primary"
                    />
                  </svg>
                  <span className="text-xs font-heading text-muted-foreground group-hover:text-foreground transition-colors">
                    Finance
                  </span>
                  {activeModule === "finance" && (
                    <span className="text-[10px] text-primary font-heading">
                      Active
                    </span>
                  )}
                </button>
                {isAdmin && (
                  <button
                    onClick={() => {
                      setModuleOpen(false);
                      navigate("/admin");
                    }}
                    className={`group flex flex-col items-center gap-2 p-4 rounded-lg border transition-all ${location.pathname.startsWith("/admin") ? "border-primary bg-primary/10" : "border-border hover:border-primary hover:bg-muted"}`}
                  >
                    <div className="relative">
                      <ShieldCheck
                        size={32}
                        className={`transition-colors ${location.pathname.startsWith("/admin") ? "text-primary" : "text-muted-foreground group-hover:text-primary"}`}
                      />
                      {isSuperAdmin && (
                        <span
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
                          style={{ background: "#7c3aed" }}
                        >
                          <Crown size={8} className="text-white" />
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-heading text-muted-foreground group-hover:text-foreground transition-colors">
                      Admin
                    </span>
                    {location.pathname.startsWith("/admin") && (
                      <span className="text-[10px] text-primary font-heading">
                        Active
                      </span>
                    )}
                  </button>
                )}
              </div>
            </Dropdown>
          </div>
        </div>
        {/* end collapsible */}

        {/* ── Always visible: Theme + User ── */}

        {/* Theme */}
        <div className="relative shrink-0">
          <button
            onClick={() => {
              setThemeOpen((p) => !p);
              setSetupOpen(false);
              setModuleOpen(false);
              setUserOpen(false);
            }}
            className="p-2 rounded-md hover:bg-muted transition-all duration-200 text-foreground"
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
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-heading transition-all duration-150 ${theme === t ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"}`}
              >
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0 border border-border/50"
                  style={{ background: bg }}
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
            onClick={() => {
              setUserOpen((p) => !p);
              setModuleOpen(false);
              setSetupOpen(false);
              setThemeOpen(false);
            }}
            className="relative w-8 h-8 rounded-full gradient-accent flex items-center justify-center text-xs font-heading text-primary-foreground font-bold transition-opacity hover:opacity-90"
          >
            {currentUser?.initials || "?"}
            {RoleIcon && (
              <span
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
                style={{ background: roleColor }}
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
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-heading"
                    style={{
                      background: "rgba(124,58,237,0.12)",
                      color: "#7c3aed",
                    }}
                  >
                    Super Admin
                  </span>
                )}
                {currentUser?.role === "admin" && (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-heading"
                    style={{
                      background: "rgba(37,99,235,0.12)",
                      color: "#2563eb",
                    }}
                  >
                    Admin
                  </span>
                )}
                {currentUser?.role === "user" && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-heading bg-muted text-muted-foreground">
                    User · {currentUser.pagePermissions.length} pages
                  </span>
                )}
              </div>
            </div>
            <button className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors text-foreground">
              <User size={14} /> Profile
            </button>
            <button
              onMouseDown={() => { logout(); navigate("/login"); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors text-destructive"
            >
              <LogOut size={14} /> Sign Out
            </button>
          </Dropdown>
        </div>
      </div>

      {/* ── MOBILE RIGHT ─────────────────────────────────────────────────── */}
      <div className="flex md:hidden items-center">
        {/* User avatar */}
        <div className="relative">
          <button
            onClick={() => {
              setUserOpen((p) => !p);
            }}
            className="relative w-8 h-8 rounded-full gradient-accent flex items-center justify-center text-xs font-heading text-primary-foreground font-bold"
          >
            {currentUser?.initials || "?"}
            {RoleIcon && (
              <span
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
                style={{ background: roleColor }}
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
            <button className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors text-foreground">
              <User size={14} /> Profile
            </button>
            <button
              onMouseDown={() => { logout(); navigate("/login"); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors text-destructive"
            >
              <LogOut size={14} /> Sign Out
            </button>
          </Dropdown>
        </div>
      </div>
    </header>
  );
};
