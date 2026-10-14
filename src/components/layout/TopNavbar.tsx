import React, { useState, useRef, useEffect, useCallback } from "react";
import { useGracefulLogout } from "@/hooks/useGracefulLogout";
import { useNavigate, useLocation } from "react-router-dom";
import { LogoFull } from "../Logo";
import { useModule } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavbarCollapse } from "./layoutContexts";
import { useTheme, isLightTheme } from "@/contexts/ThemeContext";
import { ReminderBell } from "@/components/navbar/ReminderBell";
import { SaNotificationBell } from "@/components/navbar/SaNotificationBell";
import { ThemeSwitcher } from "@/components/navbar/ThemeSwitcher";
import { NAV_PANEL_CSS } from "@/components/navbar/navPanelStyles";
import { ALL_MODULES, hexToHsl } from "./moduleDefs";
import {
  ChevronDown,
  Megaphone,
} from "lucide-react";
import {
  Crown,
  Data,
  Shield,
  Profile,
  Logout,
  SidebarLeft,
  Setting2,
  Chart,
  Element4,
} from "iconsax-react";
import { ADMIN_PATHS } from "@/constants/pageDefinitions";
import { ChromeIcons } from "@/components/icons/moduleIcons";
import { type SetupItem, financeSetupItems, salesSetupItems, maintenanceSetupItems, hrPayrollSetupItems, materialSetupItems, fixedAssetSetupItems, followupSetupItems, engineeringSetupItems, civilWorkDprSetupItems, salesAutomationSetupItems, crmSetupItems, adminSetupItems } from "./setupMenus";

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
        className={`absolute top-full mt-2.5 z-50 border border-foreground bg-card shadow-[5px_5px_0_hsl(var(--foreground)/0.12)] transition-all duration-200 origin-top overflow-visible
          ${open ? "opacity-100 scale-100 pointer-events-auto translate-y-0" : "opacity-0 scale-95 pointer-events-none -translate-y-2"} ${className || ""}`}
      >
        {children}
      </div>
    </div>
  );
};

// ─── Module color helpers ──────────────────────────────────────────────────────

// Glow RGB and HSL per module, derived from the one shared module list (moduleDefs.tsx) so the top
// bar, the module strip and the mobile nav can never disagree about a module's colour.
const MODULE_GLOW_RGB: Record<string, string> = Object.fromEntries(
  ALL_MODULES.map((m) => [m.id, m.ringRgb]),
);
const MODULE_COLORS: Record<string, { h: number; s: number; l: number }> = Object.fromEntries(
  ALL_MODULES.map((m) => [m.id, hexToHsl(m.color)]),
);

function moduleColorVars(id: string): React.CSSProperties {
  const c = MODULE_COLORS[id] ?? MODULE_COLORS.finance;
  return {
    "--mod-h": c.h,
    "--mod-s": `${c.s}%`,
    "--mod-l": `${c.l}%`,
  } as React.CSSProperties;
}


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
  items: SetupItem[];
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
          style={
            open
              ? {
                  background:
                    "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.12)",
                  borderColor:
                    "hsl(var(--mod-h) var(--mod-s) var(--mod-l) / 0.4)",
                  color: "hsl(var(--mod-h) var(--mod-s) var(--mod-l))",
                  ...modVars,
                }
              : modVars
          }
        >
          <ChromeIcons.setup
            size={13}
            variant="Outline"
            color="currentColor"
            className={`transition-transform duration-500 ${open ? "rotate-90" : ""}`}
          />
          <span>Setup</span>
          <ChevronDown
            size={12}
            className={`transition-transform duration-300 opacity-60 ${open ? "rotate-180" : ""}`}
          />
        </button>
      }
    >
      {/* ── Title block ── */}
      <div className="flex items-end justify-between gap-4 px-4 pt-3.5 pb-3 border-b border-foreground">
        <div className="min-w-0">
          <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground leading-none">
            {moduleLabel}
          </p>
          <p className="font-heading text-base font-bold tracking-tight text-foreground leading-none mt-1.5">Setup</p>
        </div>
        <p className="font-heading text-[0.625rem] tabular-nums text-muted-foreground leading-none shrink-0">
          {items.length} page{items.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* ── Index of setup pages: two ruled columns ── */}
      <div className={`grid grid-cols-2 max-h-[min(26rem,70vh)] overflow-y-auto`}>
        {items.map(({ icon: Icon, label, path }, i) => {
          const isActivePath = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => {
                navigate(path);
                onClose();
              }}
              aria-current={isActivePath ? "page" : undefined}
              className={`flex items-center gap-2.5 px-4 py-2.5 text-left border-b border-border/70 transition-colors cursor-pointer
                ${i % 2 === 0 ? "border-r" : ""}
                ${isActivePath ? "bg-foreground text-card" : "text-foreground hover:bg-primary/10"}`}
            >
              <Icon size={14} strokeWidth={1.75} className={`shrink-0 ${isActivePath ? "" : "text-muted-foreground"}`} />
              <span className={`text-xs leading-tight min-w-0 ${isActivePath ? "font-semibold" : "font-medium"}`}>
                {label.replace(/ Master$/, "")}
              </span>
            </button>
          );
        })}
      </div>
    </Dropdown>
  );
};

// ─── User Menu ────────────────────────────────────────────────────────────────

const ROLE_ACCENT: Record<string, { label: string; color: string }> = {
  super_admin: { label: "Super Admin", color: "#a855f7" },
  admin: { label: "Admin", color: "#3b82f6" },
  dba: { label: "DBA", color: "#10b981" },
  marketing_head: { label: "Marketing Head", color: "#f97316" },
  sales_team_lead: { label: "Sales Team Lead", color: "#a855f7" },
  sales_person: { label: "Sales Person", color: "#6366f1" },
  legal_head: { label: "Legal Head", color: "#0ea5e9" },
  legal_person: { label: "Legal Person", color: "#64748b" },
};

const UserMenuContent: React.FC<{
  currentUser: ReturnType<typeof useAuth>["currentUser"];
  isSuperAdmin: boolean;
  isDba: boolean;
  open: boolean;
  onClose: () => void;
  navigate: (p: string) => void;
  handleLogout: () => void;
}> = ({
  currentUser,
  isSuperAdmin,
  isDba,
  open,
  onClose,
  navigate,
  handleLogout,
}) => {
  const roleKey = isSuperAdmin
    ? "super_admin"
    : isDba
      ? "dba"
      : (currentUser?.role ?? "");
  const accent = ROLE_ACCENT[roleKey];

  // Each row reveals with a slight stagger keyed off `open` (rather than a
  // one-shot mount animation) so it re-plays every time the menu opens —
  // the dropdown's content stays mounted, only opacity/scale toggle.
  const cascade = (i: number): React.CSSProperties => ({
    opacity: open ? 1 : 0,
    transform: open ? "translateY(0)" : "translateY(-6px)",
    transition: `opacity 240ms ease ${i * 55}ms, transform 240ms cubic-bezier(0.16,1,0.3,1) ${i * 55}ms`,
  });

  // Drawn on the sheet like the other top-bar panels: a title block with a square avatar, the name and email, and the
  // role as a squared tag in the role's own colour; then numbered rows with square marks, Sign Out in red.
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: NAV_PANEL_CSS }} />
      <div className="np-head" style={{ ...cascade(0), display: "block" }}>
        <p className="np-label">CivilierERP · Signed in</p>
        <div className="np-who">
          <span className="np-avatar">
            {currentUser?.avatarUrl ? (
              <img src={currentUser.avatarUrl} alt={currentUser.name} />
            ) : (
              currentUser?.initials || "?"
            )}
          </span>
          <span className="min-w-0">
            <span className="np-name block truncate" style={{ fontFamily: "Sora, sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>
              {currentUser?.name}
            </span>
            <span className="np-sub block truncate">{currentUser?.email}</span>
          </span>
        </div>
        {accent ? (
          <span className="np-role" style={{ color: accent.color }}>{accent.label}</span>
        ) : (
          <span className="np-role" style={{ color: "hsl(var(--muted-foreground))" }}>
            User · {currentUser?.pagePermissions?.length || 0} pages
          </span>
        )}
      </div>

      <div className="np-list">
        <button
          type="button"
          onMouseDown={() => {
            onClose();
            if (isSuperAdmin) navigate("/superadmin/profile");
            else if (isDba) navigate("/dba/profile");
            else if (currentUser?.role === "admin") navigate("/admin/profile");
            else navigate("/user/profile");
          }}
          style={cascade(1)}
          className="np-row center"
        >
          <span className="np-num">01</span>
          <span className="np-mark"><Profile size={14} /></span>
          <span className="np-name">Profile</span>
          <span />
        </button>
        <button type="button" onMouseDown={handleLogout} style={cascade(2)} className="np-row center danger">
          <span className="np-num">02</span>
          <span className="np-mark"><Logout size={14} /></span>
          <span className="np-name">Sign Out</span>
          <span />
        </button>
      </div>
    </>
  );
};

// ─── TopNavbar ────────────────────────────────────────────────────────────────

// Module-level flag: true until TopNavbar mounts for the first time.
// Persists across React remounts (route changes) within the same page session.
let _pillNavFirstMount = true;

export const TopNavbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeModule } = useModule();
  const { currentUser, canAccessPage } = useAuth();
  const { navCollapsed, setNavCollapsed } = useNavbarCollapse();
  const { handleLogout, overlay: logoutOverlay } = useGracefulLogout();

  // "light" is the only light-background theme; everything else is dark
  const { theme } = useTheme();
  const isDark = !isLightTheme(theme);

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
  const isMarketingHead = currentUser?.role === "marketing_head";
  const isAdmin = currentUser?.role === "admin" || isSuperAdmin || isDba;
  const isAdminPage =
    isAdmin &&
    (location.pathname.startsWith("/admin") ||
      location.pathname.startsWith("/users") ||
      ADMIN_PATHS.some((p) => location.pathname.startsWith(p)));

  const activeGlowRgb =
    MODULE_GLOW_RGB[isAdminPage ? "admin" : (activeModule ?? "finance")] ??
    MODULE_GLOW_RGB.finance;

  const RoleIcon = isSuperAdmin
    ? Crown
    : isDba
      ? Data
      : isAdmin
        ? Shield
        : isMarketingHead
          ? Megaphone
          : null;
  const roleBadgeCls = isSuperAdmin
    ? "bg-violet-600"
    : isDba
      ? "bg-emerald-600"
      : isMarketingHead
        ? "bg-orange-500"
        : "bg-blue-600";

  const isPrivilegedUser = ["super_admin", "admin", "dba"].includes(currentUser?.role ?? "");

  // Filter setup items by page rights for non-privileged users.
  // marketing_head is privileged within their module scope.
  const filterSetupItems = (items: SetupItem[]): SetupItem[] => {
    if (isPrivilegedUser || isMarketingHead) return items;
    return items.filter((item) => !item.pageKey || canAccessPage(item.pageKey as any));
  };

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
        items: filterSetupItems(adminSetupItems),
        label: "Admin",
        colorStyle: makeColorStyle("admin"),
        available: true,
      };
    if (activeModule === "material")
      return {
        items: filterSetupItems(materialSetupItems),
        label: "Material",
        colorStyle: makeColorStyle("material"),
        available: true,
      };
    if (activeModule === "fixed-asset")
      return {
        items: filterSetupItems(fixedAssetSetupItems),
        label: "Fixed Asset",
        colorStyle: makeColorStyle("fixed-asset"),
        available: true,
      };
    if (activeModule === "followup")
      return {
        items: filterSetupItems(followupSetupItems),
        label: "Follow-Up",
        colorStyle: makeColorStyle("followup"),
        available: true,
      };
    if (activeModule === "engineering")
      return {
        items: filterSetupItems(engineeringSetupItems),
        label: "Engineering",
        colorStyle: makeColorStyle("engineering"),
        available: true,
      };
    if (activeModule === "civilworkdpr")
      return {
        items: filterSetupItems(civilWorkDprSetupItems),
        label: "Civil Work DPR",
        colorStyle: makeColorStyle("civilworkdpr"),
        available: true,
      };
    if (activeModule === "finance")
      return {
        items: filterSetupItems(financeSetupItems),
        label: "Finance",
        colorStyle: makeColorStyle("finance"),
        available: true,
      };
    if (activeModule === "sales")
      return {
        items: filterSetupItems(salesSetupItems),
        label: "Sales",
        colorStyle: makeColorStyle("sales"),
        available: true,
      };
    if (activeModule === "sales-automation")
      return {
        items: filterSetupItems(salesAutomationSetupItems),
        label: "Sales Automation",
        colorStyle: makeColorStyle("sales-automation"),
        available: true,
      };
    if (activeModule === "crm")
      return {
        items: filterSetupItems(crmSetupItems),
        label: "CRM",
        colorStyle: makeColorStyle("crm"),
        available: true,
      };
    if (activeModule === "maintenance")
      return {
        items: filterSetupItems(maintenanceSetupItems),
        label: "Maintenance",
        colorStyle: makeColorStyle("maintenance"),
        available: true,
      };
    if (activeModule === "hr-payroll")
      return {
        items: filterSetupItems(hrPayrollSetupItems),
        label: "HR and Payroll",
        colorStyle: makeColorStyle("hr-payroll"),
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
          gap: 0.4rem;
          padding: 0.45rem 0.85rem;
          font-size: 0.625rem;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          font-family: "Sora", sans-serif;
          color: hsl(var(--muted-foreground));
          background: transparent;
          border: 0;
          transition: background 150ms, color 150ms;
          white-space: nowrap;
          cursor: pointer;
        }
        .nav-pill-btn:hover {
          background: hsl(var(--primary) / 0.10);
          color: hsl(var(--foreground));
        }
        .nav-pill-btn--active, .nav-pill-btn--active:hover {
          background: hsl(var(--foreground));
          color: hsl(var(--card));
        }

        /* pill nav genie — expand: pinched sliver → full pill */
        @keyframes genie-expand {
          0%   {
            opacity: 0;
            clip-path: inset(0% 48% 0% 48% round 0px);
            transform: translateX(-50%) scaleY(0.4);
            filter: blur(6px);
          }
          40%  {
            opacity: 1;
            filter: blur(1px);
          }
          70%  {
            clip-path: inset(0% 0% 0% 0% round 0px);
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
            clip-path: inset(0% 0% 0% 0% round 0px);
            transform: translateX(-50%) scaleY(1);
            filter: blur(0px);
          }
          50%  {
            clip-path: inset(0% 42% 0% 42% round 0px);
            filter: blur(2px);
          }
          100% {
            opacity: 0;
            clip-path: inset(0% 50% 0% 50% round 0px);
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

      <header
        className="fixed top-0 left-0 right-0 h-14 z-50 flex items-center px-3 sm:px-4 gap-3"
        style={{
          backgroundColor: "hsl(var(--card))",
          backgroundImage:
            "linear-gradient(hsl(var(--foreground) / 0.04) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground) / 0.04) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          borderBottom: "1.5px solid hsl(var(--foreground))",
        }}
      >
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
          style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--foreground))" }}
        >
          {/* Content — sits above glow */}
          <div className="relative z-10 flex items-center">
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
              <ChromeIcons.reports size={14} />
              <span>Reports</span>
            </button>

            <button
              onClick={() => {
                navigate("/widgets");
                closeAll();
              }}
              className={`nav-pill-btn ${isActive("/widgets") ? "nav-pill-btn--active" : ""}`}
            >
              <ChromeIcons.widgets size={14} />
              <span>Widgets</span>
            </button>
          </div>
        </nav>

        {/* ── Right actions ── */}
        <div className="hidden md:flex items-center gap-1.5 ml-auto shrink-0">
          {/* Collapse sidebar toggle */}
          <div className="relative shrink-0">
            <button
              onClick={() => setNavCollapsed(!navCollapsed)}
              title={navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="relative z-10 w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors duration-150"
            >
              <ChromeIcons.menu size={18} />
            </button>
          </div>

          <SaNotificationBell />
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
            className="right-0 w-[17rem] p-0 np-sheet"
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
              open={userOpen}
              onClose={closeUser}
              navigate={navigate}
              handleLogout={handleLogout}
            />
          </Dropdown>
        </div>

        {/* ── Mobile right ── */}
        <div className="flex md:hidden items-center gap-1.5 ml-auto">
          <SaNotificationBell />
          <ReminderBell />
          <Dropdown
            open={userOpen}
            onClose={closeUser}
            className="right-0 w-[17rem] p-0 np-sheet"
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
              open={userOpen}
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
