import { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  type SetupItem,
  financeSetupItems,
  salesSetupItems,
  maintenanceSetupItems,
  hrPayrollSetupItems,
  materialSetupItems,
  fixedAssetSetupItems,
  followupSetupItems,
  engineeringSetupItems,
  civilWorkDprSetupItems,
  salesAutomationSetupItems,
  crmSetupItems,
  adminSetupItems,
} from "./setupMenus";
import { Grip } from "lucide-react";

import {
  IconChartBar as TbChartBar,
  IconChevronDown as TbChevronDown,
  IconChevronRight as TbChevronRight,
  IconCrown as TbCrown,
  IconDatabase as TbDatabase,
  IconHome as TbHome,
  IconLayoutGrid as TbLayoutGrid,
  IconLogout as TbLogout,
  IconMenu2 as TbMenu2,
  IconSearch as TbSearch,
  IconSettings as TbSettings,
  IconShieldCheck as TbShieldCheck,
  IconUser as TbUser,
  IconX as TbX,
} from "@tabler/icons-react";
import { useModule } from "@/contexts/ModuleContext";
import { MODULE_DASHBOARD_ROUTES, firstAccessibleAdminPath, hasAnyAdminPageRight, isAdminTierRole, userHasModuleAccess as sharedUserHasModuleAccess } from "@/contexts/module.utils";
import { ALL_MODULES, hexToHsl } from "./moduleDefs";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme, THEME_DOTS, Theme } from "@/contexts/ThemeContext";
import { useGracefulLogout } from "@/hooks/useGracefulLogout";
import { useReminders } from "@/hooks/useReminders";
import { ADMIN_PATHS } from "@/constants/pageDefinitions";

// ── Desktop sidebar definitions — single source of truth, mirrored here ──────
import { engineeringNavItems } from "./sidebars/EngineeringSidebar";
import { buildFinanceNavItems } from "./sidebars/FinanceSidebar";
import { materialNavItems } from "./sidebars/MaterialSidebar";
import { fixedAssetNavItems } from "./sidebars/FixedAssetSidebar";
import { maintenanceNavItems } from "./sidebars/MaintenanceSidebar";
import { followupNavItems } from "./sidebars/FollowupSidebar";
import { buildAdminNavItems } from "./sidebars/AdminSidebar";
import { dbaNavItems } from "./sidebars/DbaSidebar";
import { superAdminNavItems } from "./sidebars/SuperAdminSidebar";
import { buildTicketNavItems } from "./sidebars/TicketSidebar";
import { salesNavItems } from "./sidebars/SalesSidebar";
import { recordsNavItems } from "./sidebars/RecordsSidebar";
import { buildCivilWorkDprNavItems } from "./sidebars/CivilWorkDprSidebar";
import { salesAutomationNavItems } from "./sidebars/SalesAutomationSidebar";
import { crmNavItems } from "./sidebars/CrmSidebar";
import { loanNavItems } from "./sidebars/LoanSidebar";
import type {
  NavItem as DesktopNavItem,
  SubItem as DesktopSubItem,
} from "./sidebars/SidebarPrimitives";

interface NavItemChild {
  label: string;
  path: string;
  icon?: React.ElementType;
  count?: number;
  pageKey?: string;
}

interface NavItem {
  label: string;
  icon: React.ElementType;
  path?: string;
  children?: NavItemChild[];
  count?: number;
  disabled?: boolean;
  pageKey?: string;
}


// ── Module colour system ──────────────────────────────────────────────────────
type ModuleMeta = {
  h: number;
  s: number;
  l: number;
  icon: React.ElementType;
  label: string;
  route: string;
};
const MODULE_META: Record<string, ModuleMeta> = {
  __none__: { h: 242, s: 65, l: 58, icon: Grip, label: "Menu", route: "/home" },
  ...Object.fromEntries(
    ALL_MODULES.map((m): [string, ModuleMeta] => [
      m.id,
      { ...hexToHsl(m.color), icon: m.icon, label: m.label, route: MODULE_DASHBOARD_ROUTES[m.id] },
    ]),
  ),
};

export const MobileNav: React.FC = () => {
  // Which full-height sheet is open from the bottom bar: the module menu, or "Me" (profile, theme, sign out).
  const [sheet, setSheet] = useState<null | "menu" | "me">(null);
  const open = sheet !== null;
  const setOpen = (v: boolean) => { if (!v) setSheet(null); };
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [query, setQuery] = useState("");

  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { currentUser, canAccessPage } = useAuth();
  const { activeModule, setActiveModule } = useModule();
  const { handleLogout, overlay: logoutOverlay } = useGracefulLogout();
  const { badgeCount: overdueCount } = useReminders();

  const isAdminPage =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/users") ||
    location.pathname.startsWith("/dba") ||
    location.pathname.startsWith("/superadmin") ||
    ADMIN_PATHS.some((p) => location.pathname.startsWith(p));
  const isSuperAdmin = currentUser?.role?.toLowerCase() === "super_admin";
  const isDba = currentUser?.role?.toLowerCase() === "dba";
  const isAdmin =
    currentUser?.role?.toLowerCase() === "admin" || isSuperAdmin || isDba;
  const isSuperAdminPage =
    isSuperAdmin && location.pathname.startsWith("/superadmin");
  const isDbaPage = isAdmin && location.pathname.startsWith("/dba");

  // Close on route change
  useEffect(() => {
    setSheet(null);
    setExpandedGroup(null);
    setQuery("");
  }, [location.pathname]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // ── Setup items scoped to current module/page ────────────────────────────
  const setupConfig = (() => {
    if (isAdminPage)
      return { items: adminSetupItems, label: "Admin", available: true };
    if (activeModule === "material")
      return { items: materialSetupItems, label: "Material", available: true };
    if (activeModule === "fixed-asset")
      return { items: fixedAssetSetupItems, label: "Fixed Asset", available: true };
    if (activeModule === "followup")
      return { items: followupSetupItems, label: "Follow-Up", available: true };
    if (activeModule === "engineering")
      return {
        items: engineeringSetupItems,
        label: "Engineering",
        available: true,
      };
    if (activeModule === "civilworkdpr")
      return {
        items: civilWorkDprSetupItems,
        label: "Civil Work DPR",
        available: true,
      };
    if (activeModule === "finance")
      return { items: financeSetupItems, label: "Finance", available: true };
    if (activeModule === "sales")
      return { items: salesSetupItems, label: "Sales", available: true };
    if (activeModule === "hr-payroll")
      return { items: hrPayrollSetupItems, label: "HR and Payroll", available: true };
    if (activeModule === "sales-automation")
      return {
        items: salesAutomationSetupItems,
        label: "Sales Automation",
        available: true,
      };
    if (activeModule === "crm")
      return { items: crmSetupItems, label: "CRM", available: true };
    if (activeModule === "maintenance")
      return { items: maintenanceSetupItems, label: "Maintenance", available: true };
    return { items: [] as SetupItem[], label: "", available: false };
  })();

  // ── Nav item definitions ────────────────────────────────────────────────────
  const adaptChild = (child: DesktopSubItem): NavItemChild | null => {
    if (child.pageKey && !canAccessPage(child.pageKey as any)) return null;
    return {
      label: child.label,
      path: child.path,
      count: child.badge,
      pageKey: child.pageKey,
    };
  };

  const adaptItems = (items: DesktopNavItem[]): NavItem[] =>
    items.reduce<NavItem[]>((acc, item) => {
      if (item.children?.length) {
        const children = item.children
          .map(adaptChild)
          .filter((c): c is NavItemChild => c !== null);
        if (children.length) {
          acc.push({ label: item.label, icon: item.icon, children });
        }
        return acc;
      }
      if (item.sections?.length) {
        const children = item.sections
          .flatMap((s) => s.items)
          .map(adaptChild)
          .filter((c): c is NavItemChild => c !== null);
        if (children.length) {
          acc.push({ label: item.label, icon: item.icon, children });
        }
        return acc;
      }
      if (item.pageKey && !canAccessPage(item.pageKey as any)) return acc;
      if (item.path) {
        acc.push({ label: item.label, icon: item.icon, path: item.path });
      }
      return acc;
    }, []);

  const ADMIN_NAV_ITEMS: NavItem[] = adaptItems(
    buildAdminNavItems(0) as DesktopNavItem[],
  );

  const SUPER_ADMIN_NAV_ITEMS: NavItem[] = adaptItems(
    superAdminNavItems as DesktopNavItem[],
  );

  const DBA_NAV_ITEMS: NavItem[] = adaptItems(dbaNavItems as DesktopNavItem[]);

  const getModuleNavItems = (): NavItem[] => {
    switch (activeModule) {
      case "material":
        return adaptItems(materialNavItems as DesktopNavItem[]);
      case "fixed-asset":
        return adaptItems(fixedAssetNavItems as DesktopNavItem[]);
      case "maintenance":
        return adaptItems(maintenanceNavItems as DesktopNavItem[]);
      case "finance":
        return adaptItems(
          buildFinanceNavItems(overdueCount) as DesktopNavItem[],
        );
      case "followup":
        return adaptItems(followupNavItems as DesktopNavItem[]);
      case "engineering":
        return adaptItems(engineeringNavItems as DesktopNavItem[]);
      case "ticket":
        return adaptItems(buildTicketNavItems(isAdmin) as DesktopNavItem[]);
      case "sales":
        return adaptItems(salesNavItems as DesktopNavItem[]);
      case "records":
        return adaptItems(recordsNavItems as DesktopNavItem[]);
      case "civilworkdpr":
        // Static 0 here — same precedent as buildAdminNavItems(0) above;
        // this badge isn't wired to a live poll on mobile.
        return adaptItems(buildCivilWorkDprNavItems(0) as DesktopNavItem[]);
      case "sales-automation":
        return adaptItems(salesAutomationNavItems as DesktopNavItem[]);
      case "crm":
        return adaptItems(crmNavItems as DesktopNavItem[]);
      case "loan":
        return adaptItems(loanNavItems as DesktopNavItem[]);
      default:
        return [];
    }
  };

  // Filter nav items by user's page rights — mirrors AppSidebar.tsx's
  // filterByRights() so desktop and mobile can't drift apart again.
  const filterByRights = (items: NavItem[]): NavItem[] => {
    if (isAdmin) return items;
    return items.reduce<NavItem[]>((acc, item) => {
      if (item.children) {
        const visibleChildren = item.children.filter(
          (child) => !child.pageKey || canAccessPage(child.pageKey),
        );
        if (visibleChildren.length > 0) {
          acc.push({ ...item, children: visibleChildren });
        }
      } else if (!item.pageKey || canAccessPage(item.pageKey)) {
        acc.push(item);
      }
      return acc;
    }, []);
  };

  const navItems = isSuperAdminPage
    ? SUPER_ADMIN_NAV_ITEMS
    : isDbaPage
      ? DBA_NAV_ITEMS
      : isAdminPage
        ? ADMIN_NAV_ITEMS
        : filterByRights(getModuleNavItems());

  const go = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  const isItemActive = (item: NavItem) => {
    if (item.path) return location.pathname === item.path;
    if (item.children)
      return item.children.some((c) => location.pathname === c.path);
    return false;
  };

  const activeModKey = isAdminPage ? "admin" : (activeModule ?? "__none__");
  const activeMod = MODULE_META[activeModKey] ?? MODULE_META.__none__;

  // Exactly who the desktop module strip shows each module to.
  const isAdminTier = isAdminTierRole(currentUser?.role ?? "");
  const moduleModules = Object.entries(MODULE_META).filter(([id]) => {
    if (id === "__none__") return false;
    if (id === "admin") return isAdminTier || hasAnyAdminPageRight((pk) => canAccessPage(pk as any));
    return sharedUserHasModuleAccess(id, isAdminTier, (pk) => canAccessPage(pk as any));
  });

  const themeCheck: Record<Theme, string> = {
    dark: "#818cf8",
    light: "#7c3aed",
    glass: "#fb7185",
    bw: "#111111",
    sage: "#6b8f71",
  };

  const modColor = (alpha?: number) =>
    alpha == null
      ? `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}%)`
      : `hsl(${activeMod.h} ${activeMod.s}% ${activeMod.l}% / ${alpha})`;
  const ActiveModIcon = activeMod.icon;

  const visibleSetupItems = setupConfig.items.filter((it) => !it.pageKey || canAccessPage(it.pageKey));

  // Open the group that holds the current page, so the menu opens where you are.
  useEffect(() => {
    if (sheet !== "menu") return;
    const g = navItems.find((it) => it.children?.some((c) => c.path === location.pathname));
    setExpandedGroup(g ? g.label : null);
    setShowSetup(visibleSetupItems.some((it) => it.path === location.pathname));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  // Find-a-page: every page of this module and its Setup, by name.
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: { label: string; path: string; where: string; icon?: React.ElementType }[] = [];
    navItems.forEach((it) => {
      if (it.path && it.label.toLowerCase().includes(q)) out.push({ label: it.label, path: it.path, where: activeMod.label, icon: it.icon });
      it.children?.forEach((c) => {
        if (c.label.toLowerCase().includes(q) || it.label.toLowerCase().includes(q))
          out.push({ label: c.label, path: c.path, where: it.label, icon: it.icon });
      });
    });
    visibleSetupItems.forEach((it) => {
      if (it.label.toLowerCase().includes(q)) out.push({ label: it.label, path: it.path, where: "Setup", icon: it.icon });
    });
    return out.slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, navItems.length, activeModKey, visibleSetupItems.length]);

  const profilePath = isSuperAdmin
    ? "/superadmin/profile"
    : isDba
      ? "/dba/profile"
      : currentUser?.role === "admin"
        ? "/admin/profile"
        : "/user/profile";

  const roleLabel = isSuperAdmin ? "Super Admin" : isDba ? "DBA" : isAdmin ? "Admin" : (currentUser?.role || "User");

  const switchModule = (id: string, meta: ModuleMeta) => {
    if (id === "admin") {
      navigate(
        isAdminTier
          ? "/admin/dashboard"
          : firstAccessibleAdminPath((pk) => canAccessPage(pk as any)) ?? "/admin/approval/inbox",
      );
    } else {
      setActiveModule(id as any);
      navigate(meta.route);
    }
    setSheet(null);
  };

  // Square avatar on the sheet: the photo, or initials in ink on paper.
  const Avatar = ({ size }: { size: number }) => (
    <span className="mn-avatar" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {currentUser?.avatarUrl ? (
        <img src={currentUser.avatarUrl} alt={currentUser.name} />
      ) : (
        currentUser?.initials || "?"
      )}
    </span>
  );

  // ── Bottom bar items ──────────────────────────────────────────────────────
  const barItems: { id: string; label: string; icon: React.ElementType; active: boolean; onClick: () => void }[] = [
    { id: "home", label: "Home", icon: TbHome, active: !sheet && location.pathname === "/home", onClick: () => go("/home") },
    { id: "menu", label: "Menu", icon: TbMenu2, active: sheet === "menu", onClick: () => setSheet(sheet === "menu" ? null : "menu") },
    { id: "reports", label: "Reports", icon: TbChartBar, active: !sheet && location.pathname.startsWith("/reports"), onClick: () => go("/reports") },
    { id: "me", label: "Me", icon: TbUser, active: sheet === "me", onClick: () => setSheet(sheet === "me" ? null : "me") },
  ];

  const pad = (n: number) => String(n).padStart(2, "0");
  let rowNo = 0;

  return (
    <>
      {logoutOverlay}
      <style>{MOBILE_NAV_CSS}</style>

      {/* ── Sheet (above the bar) ────────────────────────────────────────────── */}
      {open && (
        <div className="fixed inset-0 z-[60] md:hidden" style={{ animation: "mnFade 180ms ease-out both" }}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSheet(null)} />
          <div
            role="dialog"
            aria-label={sheet === "menu" ? `${activeMod.label} menu` : "Account"}
            className="mn-sheet"
            style={{ ["--mn-mod" as string]: modColor(), ["--mn-mod-wash" as string]: modColor(0.1) } as React.CSSProperties}
          >
            <div className="mn-grab"><span /></div>

            {sheet === "menu" && (
              <>
                {/* Title block: the module you're in, and close */}
                <div className="mn-head">
                  <span className="mn-mark lg" style={{ color: modColor() }}>
                    <ActiveModIcon size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="mn-label">CivilierERP · {activeModKey === "__none__" ? "Menu" : "You are in"}</p>
                    <p className="mn-title truncate">{activeModKey === "__none__" ? "Choose a module" : activeMod.label}</p>
                  </div>
                  <button onClick={() => setSheet(null)} aria-label="Close menu" className="mn-key">
                    <TbX size={15} stroke={1.5} />
                  </button>
                </div>

                {/* Search */}
                <div className="mn-search">
                  <TbSearch size={15} stroke={1.5} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={activeModKey === "__none__" ? "Find a page…" : `Find a page in ${activeMod.label}…`}
                  />
                  {query && (
                    <button onClick={() => setQuery("")} aria-label="Clear search"><TbX size={14} stroke={1.5} /></button>
                  )}
                </div>

                <div className="mn-body">
                  {/* Modules: always shown - swipe for more */}
                  {!query.trim() && (
                    <section>
                      <header className="mn-sec">
                        <span className="mn-label ink">All modules</span>
                        <span className="mn-rule" />
                        <span className="mn-label">{moduleModules.length} · swipe</span>
                      </header>
                      <div className="mn-rail">
                        {moduleModules.map(([id, meta]) => {
                          const isActive = isAdminPage ? id === "admin" : activeModule === id;
                          const Icon = meta.icon;
                          const c = `hsl(${meta.h} ${meta.s}% ${meta.l}%)`;
                          return (
                            <button
                              key={id}
                              onClick={() => switchModule(id, meta)}
                              ref={isActive ? (el) => el?.scrollIntoView({ block: "nearest", inline: "center" }) : undefined}
                              className={`mn-tile ${isActive ? "on" : ""}`}
                              style={{ ["--tile" as string]: c } as React.CSSProperties}
                              aria-current={isActive ? "true" : undefined}
                            >
                              <span className="mn-mark" style={{ color: c }}>
                                <Icon size={17} />
                              </span>
                              <span className="mn-tile-name">{meta.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {query.trim() ? (
                    /* Search results */
                    <section>
                      <header className="mn-sec">
                        <span className="mn-label ink">Pages found</span>
                        <span className="mn-rule" />
                        <span className="mn-label">{searchResults.length}</span>
                      </header>
                      {searchResults.length === 0 ? (
                        <p className="mn-empty">No page matches “{query}”.</p>
                      ) : (
                        <div className="mn-box">
                          {searchResults.map((r) => {
                            const Icon = r.icon;
                            const active = location.pathname === r.path;
                            return (
                              <button key={r.path + r.where} onClick={() => go(r.path)} className={`mn-row ${active ? "on" : ""}`}>
                                <span className="mn-num">{pad(++rowNo)}</span>
                                <span className="mn-mark">{Icon && <Icon size={15} />}</span>
                                <span className="mn-text">
                                  <span className="mn-name">{r.label}</span>
                                  <span className="mn-sub">{r.where}</span>
                                </span>
                                <TbChevronRight size={14} stroke={1.5} className="mn-chev" />
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  ) : (
                    <>
                      {/* Pages */}
                      {navItems.length > 0 && (
                        <section>
                          <header className="mn-sec">
                            <span className="mn-label ink">{activeMod.label} pages</span>
                            <span className="mn-rule" />
                            <span className="mn-label">{navItems.length}</span>
                          </header>
                          <div className="mn-box">
                            {navItems.map((item) => {
                              const active = isItemActive(item);
                              if (item.children) {
                                const isExpanded = expandedGroup === item.label;
                                return (
                                  <div key={item.label}>
                                    <button
                                      onClick={() => setExpandedGroup(isExpanded ? null : item.label)}
                                      className={`mn-row ${active ? "on" : ""} ${isExpanded ? "open" : ""}`}
                                      aria-expanded={isExpanded}
                                    >
                                      <span className="mn-num">{pad(++rowNo)}</span>
                                      <span className="mn-mark"><item.icon size={15} /></span>
                                      <span className="mn-text"><span className="mn-name">{item.label}</span></span>
                                      <span className="mn-count">{item.children.length}</span>
                                      <TbChevronDown size={15} stroke={1.5} className="mn-chev" style={{ transform: isExpanded ? "rotate(180deg)" : undefined }} />
                                    </button>
                                    {isExpanded && (
                                      <div className="mn-children">
                                        {item.children.map((child) => {
                                          const childActive = location.pathname === child.path;
                                          return (
                                            <button
                                              key={child.path}
                                              onClick={() => go(child.path)}
                                              className={`mn-child ${childActive ? "on" : ""}`}
                                              aria-current={childActive ? "page" : undefined}
                                            >
                                              <span className="flex-1 min-w-0 truncate">{child.label}</span>
                                              {!!child.count && <span className="mn-badge">{child.count}</span>}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              }
                              return (
                                <button
                                  key={item.path}
                                  onClick={() => go(item.path!)}
                                  className={`mn-row ${active ? "on" : ""}`}
                                  aria-current={active ? "page" : undefined}
                                >
                                  <span className="mn-num">{pad(++rowNo)}</span>
                                  <span className="mn-mark"><item.icon size={15} /></span>
                                  <span className="mn-text"><span className="mn-name">{item.label}</span></span>
                                  {active ? <i className="mn-here" /> : <TbChevronRight size={14} stroke={1.5} className="mn-chev" />}
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      )}

                      {/* Setup */}
                      {setupConfig.available && visibleSetupItems.length > 0 && (
                        <section>
                          <button onClick={() => setShowSetup((v) => !v)} className="mn-sec mn-sec-btn" aria-expanded={showSetup}>
                            <TbSettings size={12} stroke={1.5} />
                            <span className="mn-label ink">{setupConfig.label} Setup</span>
                            <span className="mn-rule" />
                            <span className="mn-label">{visibleSetupItems.length}</span>
                            <TbChevronDown size={14} stroke={1.5} className="mn-chev" style={{ transform: showSetup ? "rotate(180deg)" : undefined }} />
                          </button>
                          {showSetup && (
                            <div className="mn-grid">
                              {visibleSetupItems.map(({ icon: Icon, label, path, color }) => {
                                const active = location.pathname === path;
                                return (
                                  <button key={path} onClick={() => go(path)} className={`mn-cell ${active ? "on" : ""}`} aria-current={active ? "page" : undefined}>
                                    <span className="mn-mark"><Icon size={15} className={color} /></span>
                                    <span className="mn-cell-name">{label.replace(/ Master$/, "")}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </section>
                      )}

                      {/* Widgets (the one quick link not in the bottom bar) */}
                      <div className="mn-box">
                        <button onClick={() => go("/widgets")} className="mn-row">
                          <span className="mn-num">{pad(++rowNo)}</span>
                          <span className="mn-mark"><TbLayoutGrid size={15} stroke={1.5} /></span>
                          <span className="mn-text"><span className="mn-name">Widgets</span></span>
                          <TbChevronRight size={14} stroke={1.5} className="mn-chev" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {sheet === "me" && (
              <div className="mn-body">
                {/* Title block: who is signed in */}
                <div className="mn-head mn-head-flush">
                  <Avatar size={52} />
                  <div className="min-w-0 flex-1">
                    <p className="mn-label">CivilierERP · Signed in</p>
                    <p className="mn-title truncate">{currentUser?.name}</p>
                    <p className="mn-sub truncate">{currentUser?.email}</p>
                    <span className="mn-role">
                      {isSuperAdmin ? <TbCrown size={10} stroke={1.5} /> : isDba ? <TbDatabase size={10} stroke={1.5} /> : isAdmin ? <TbShieldCheck size={10} stroke={1.5} /> : null}
                      {roleLabel}
                    </span>
                  </div>
                  <button onClick={() => setSheet(null)} aria-label="Close" className="mn-key self-start">
                    <TbX size={15} stroke={1.5} />
                  </button>
                </div>

                <div className="mn-box">
                  <button onClick={() => go(profilePath)} className="mn-row">
                    <span className="mn-num">01</span>
                    <span className="mn-mark"><TbUser size={15} stroke={1.5} /></span>
                    <span className="mn-text"><span className="mn-name">My profile</span></span>
                    <TbChevronRight size={14} stroke={1.5} className="mn-chev" />
                  </button>
                </div>

                {/* Theme */}
                <section>
                  <header className="mn-sec">
                    <span className="mn-label ink">Appearance</span>
                    <span className="mn-rule" />
                    <span className="mn-label">{Object.keys(THEME_DOTS).length}</span>
                  </header>
                  <div className="mn-themes">
                    {(Object.entries(THEME_DOTS) as [Theme, { bg: string; label: string }][]).map(([t, { bg, label }]) => {
                      const isSelected = theme === t;
                      return (
                        <button key={t} onClick={() => setTheme(t)} className={`mn-theme ${isSelected ? "on" : ""}`} aria-pressed={isSelected}>
                          <span className="mn-swatch" style={{ background: bg }}>
                            {isSelected && (
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                <path d="M3 8l3.5 3.5L13 5" stroke={themeCheck[t]} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                          <span className="mn-name">{label}</span>
                          {isSelected && <span className="mn-tag">In use</span>}
                        </button>
                      );
                    })}
                  </div>
                </section>

                <div className="mn-box">
                  <button onClick={handleLogout} className="mn-row danger">
                    <span className="mn-num">02</span>
                    <span className="mn-mark"><TbLogout size={15} stroke={1.5} /></span>
                    <span className="mn-text"><span className="mn-name">Sign out</span></span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Bottom tab bar ───────────────────────────────────────────────────── */}
      <nav
        aria-label="Main"
        className="mn-bar md:hidden"
        style={{ ["--mn-mod" as string]: modColor() } as React.CSSProperties}
      >
        <div className="mn-bar-row" style={{ gridTemplateColumns: `repeat(${barItems.length}, minmax(0, 1fr))` }}>
          {barItems.map(({ id, label, icon: Icon, active, onClick }) => {
            const isMenu = id === "menu";
            return (
              <button
                key={id}
                onClick={onClick}
                aria-label={isMenu ? `${label} menu` : label}
                aria-current={active && !isMenu && id !== "me" ? "page" : undefined}
                className={`mn-tab ${active ? "on" : ""}`}
              >
                {active && !isMenu && <span className="mn-tab-mark" />}
                {isMenu ? (
                  <span className={`mn-menu-key ${sheet === "menu" ? "open" : ""}`}>
                    {sheet === "menu" ? <TbX size={18} stroke={1.5} /> : <Icon size={18} stroke={1.75} />}
                    {/* The open module, so "Menu" plainly means "this module's pages and every other module". */}
                    {sheet !== "menu" && activeModKey !== "__none__" && (
                      <span className="mn-menu-mod">
                        <ActiveModIcon size={10} />
                      </span>
                    )}
                  </span>
                ) : id === "me" ? (
                  <span className={`mn-me ${active ? "on" : ""}`}>
                    <Avatar size={24} />
                  </span>
                ) : (
                  <Icon size={20} stroke={active ? 2 : 1.5} />
                )}
                <span className="mn-tab-label">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};

// The mobile navigation drawn on the sheet, like the rest of the app: a square bottom bar with an ink rule and
// capital labels, and pull-up sheets with the faint grid, a title block, ruled sections, numbered rows with square
// marks and square keys. The open module's colour (--mn-mod) marks where you are. Colours otherwise come from the
// theme's variables, so every theme matches.
//
// Responsive: on a phone the sheet runs edge to edge; from 560px up (a phone in landscape, a small tablet) it becomes
// a centred panel, so rows don't stretch across the whole screen. The module rail swipes; the Setup and theme grids
// re-flow to as many columns as fit.
const MOBILE_NAV_CSS = `
@keyframes mnFade { from { opacity: 0 } to { opacity: 1 } }
@keyframes mnSheet { from { transform: translateY(100%) } to { transform: translateY(0) } }
.mn-sheet, .mn-bar {
  --mn-ink: hsl(var(--foreground));
  --mn-graphite: hsl(var(--muted-foreground));
  --mn-rule: hsl(var(--border));
  --mn-rule-soft: hsl(var(--border) / 0.55);
  --mn-paper: hsl(var(--card));
  font-family: "DM Sans", sans-serif;
  font-variant-numeric: tabular-nums;
}
.mn-sheet {
  position: absolute; left: 0; right: 0; display: flex; flex-direction: column; overflow: hidden;
  bottom: calc(64px + env(safe-area-inset-bottom, 0px));
  max-height: calc(100svh - 64px - env(safe-area-inset-bottom, 0px) - 24px);
  background-color: var(--mn-paper);
  background-image:
    linear-gradient(hsl(var(--foreground) / 0.04) 1px, transparent 1px),
    linear-gradient(90deg, hsl(var(--foreground) / 0.04) 1px, transparent 1px);
  background-size: 24px 24px;
  color: var(--mn-ink);
  border-top: 3px solid var(--mn-mod);
  box-shadow: 0 -1.5px 0 var(--mn-ink), 0 -10px 30px hsl(0 0% 0% / 0.18);
  animation: mnSheet 280ms cubic-bezier(0.32, 0.72, 0, 1) both;
}
@media (min-width: 560px) {
  .mn-sheet { left: 50%; right: auto; width: min(560px, calc(100vw - 32px)); transform: translateX(-50%);
    border: 1.5px solid var(--mn-ink); border-top: 3px solid var(--mn-mod); box-shadow: 6px 6px 0 hsl(var(--foreground) / 0.14);
    bottom: calc(76px + env(safe-area-inset-bottom, 0px)); animation: mnFade 200ms ease-out both; }
}
.mn-sheet .mn-grab { display: flex; justify-content: center; padding: 8px 0 2px; flex-shrink: 0; }
.mn-sheet .mn-grab span { width: 36px; height: 3px; background: var(--mn-rule); }
.mn-sheet .mn-label { font-family: "Sora", sans-serif; font-weight: 600; font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--mn-graphite); white-space: nowrap; }
.mn-sheet .mn-label.ink { color: var(--mn-ink); }
.mn-sheet .mn-title { font-family: "Sora", sans-serif; font-weight: 700; font-size: 19px; letter-spacing: -0.02em; line-height: 1.15; margin-top: 3px; color: var(--mn-ink); }
.mn-sheet .mn-head { display: flex; align-items: center; gap: 12px; padding: 6px 16px 12px; border-bottom: 1.5px solid var(--mn-ink); flex-shrink: 0; }
.mn-sheet .mn-head-flush { padding: 6px 0 14px; margin: 0 0 4px; }
.mn-sheet .mn-key { width: 34px; height: 34px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--mn-ink); color: var(--mn-ink); background: var(--mn-paper); }
.mn-sheet .mn-key:active { background: var(--mn-ink); color: var(--mn-paper); }
.mn-sheet .mn-mark { width: 30px; height: 30px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--mn-rule); background: var(--mn-paper); color: var(--mn-ink); }
.mn-sheet .mn-mark.lg { width: 44px; height: 44px; border: 1.5px solid var(--mn-ink); }
.mn-sheet .mn-search { display: flex; align-items: center; gap: 8px; margin: 12px 16px 4px; padding: 0 12px; flex-shrink: 0;
  border: 1px solid var(--mn-ink); background: var(--mn-paper); color: var(--mn-graphite); }
.mn-sheet .mn-search input { flex: 1; min-width: 0; height: 42px; background: transparent; border: 0; outline: none; color: var(--mn-ink); font-size: 14px; }
.mn-sheet .mn-search input::placeholder { color: var(--mn-graphite); opacity: 0.8; }
.mn-sheet .mn-body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 16px 20px; display: flex; flex-direction: column; gap: 6px; }
.mn-sheet .mn-sec { display: flex; align-items: center; gap: 10px; padding: 14px 0 8px; width: 100%; color: var(--mn-ink); text-align: left; }
.mn-sheet .mn-rule { flex: 1; height: 1px; background: var(--mn-rule); }
.mn-sheet .mn-chev { color: var(--mn-graphite); flex-shrink: 0; transition: transform .2s; }
.mn-sheet .mn-rail { display: flex; gap: 8px; overflow-x: auto; margin: 0 -16px; padding: 0 16px 4px; scroll-snap-type: x mandatory; scroll-padding-inline: 16px; scrollbar-width: none; }
.mn-sheet .mn-rail::-webkit-scrollbar { display: none; }
.mn-sheet .mn-tile { width: 76px; flex-shrink: 0; scroll-snap-align: start; display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 10px 4px 8px; border: 1px solid var(--mn-rule); background: var(--mn-paper); }
.mn-sheet .mn-tile.on { border: 1.5px solid var(--mn-ink); box-shadow: inset 0 -3px 0 var(--tile); }
.mn-sheet .mn-tile-name { width: 100%; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--mn-ink); }
.mn-sheet .mn-box { border: 1px solid var(--mn-rule); background: var(--mn-paper); }
.mn-sheet .mn-row { display: grid; grid-template-columns: 20px 30px minmax(0, 1fr) auto auto; align-items: center; gap: 10px; width: 100%;
  min-height: 48px; padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--mn-rule-soft); transition: background-color .12s; }
.mn-sheet .mn-box > .mn-row:last-child, .mn-sheet .mn-box > div:last-child > .mn-row { border-bottom: 0; }
.mn-sheet .mn-row:active, .mn-sheet .mn-row.open { background: hsl(var(--primary) / 0.08); }
.mn-sheet .mn-row.on { background: var(--mn-mod-wash); box-shadow: inset 3px 0 0 var(--mn-mod); }
.mn-sheet .mn-row.on .mn-name, .mn-sheet .mn-row.on .mn-mark { color: var(--mn-mod); }
.mn-sheet .mn-row.on .mn-mark { border-color: var(--mn-mod); }
.mn-sheet .mn-row.danger .mn-name, .mn-sheet .mn-row.danger .mn-mark { color: hsl(var(--destructive)); }
.mn-sheet .mn-row.danger:active { background: hsl(var(--destructive) / 0.08); }
.mn-sheet .mn-num { font-family: "Sora", sans-serif; font-size: 10px; font-weight: 600; color: var(--mn-graphite); }
.mn-sheet .mn-text { display: flex; flex-direction: column; min-width: 0; }
.mn-sheet .mn-name { font-size: 14px; font-weight: 600; color: var(--mn-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mn-sheet .mn-sub { font-size: 11.5px; color: var(--mn-graphite); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.mn-sheet .mn-count { font-family: "Sora", sans-serif; font-size: 10px; font-weight: 600; color: var(--mn-graphite); }
.mn-sheet .mn-here { width: 8px; height: 8px; background: var(--mn-mod); }
.mn-sheet .mn-children { margin: 0 0 6px 42px; border-left: 1px solid var(--mn-ink); }
.mn-sheet .mn-child { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 42px; padding: 6px 12px; text-align: left;
  font-size: 13.5px; color: var(--mn-graphite); border-bottom: 1px solid var(--mn-rule-soft); }
.mn-sheet .mn-child:last-child { border-bottom: 0; }
.mn-sheet .mn-child.on { color: var(--mn-mod); font-weight: 600; background: var(--mn-mod-wash); box-shadow: inset 2px 0 0 var(--mn-mod); }
.mn-sheet .mn-badge { min-width: 18px; height: 18px; padding: 0 5px; display: inline-flex; align-items: center; justify-content: center;
  background: hsl(var(--destructive)); color: hsl(var(--destructive-foreground)); font-family: "Sora", sans-serif; font-size: 9.5px; font-weight: 600; }
.mn-sheet .mn-sec-btn { cursor: pointer; }
.mn-sheet .mn-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; }
.mn-sheet .mn-cell { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 6px 8px; border: 1px solid var(--mn-rule); background: var(--mn-paper); }
.mn-sheet .mn-cell.on { border: 1.5px solid var(--mn-mod); background: var(--mn-mod-wash); }
.mn-sheet .mn-cell-name { width: 100%; text-align: center; font-size: 11px; line-height: 1.25; color: var(--mn-ink);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mn-sheet .mn-empty { margin: 4px 0; padding: 22px; text-align: center; border: 1px dashed var(--mn-rule); font-size: 13px; color: var(--mn-graphite); }
.mn-sheet .mn-role { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 7px; margin-top: 7px; border: 1px solid var(--mn-mod); color: var(--mn-mod);
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; }
.mn-sheet .mn-themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
.mn-sheet .mn-theme { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 6px 10px; text-align: left; border: 1px solid var(--mn-rule); background: var(--mn-paper); }
.mn-sheet .mn-theme.on { border: 1.5px solid var(--mn-ink); }
.mn-sheet .mn-swatch { width: 26px; height: 26px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--mn-ink); }
.mn-sheet .mn-tag { margin-left: auto; height: 18px; padding: 0 6px; display: inline-flex; align-items: center; background: var(--mn-ink); color: var(--mn-paper);
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 8.5px; letter-spacing: 0.12em; text-transform: uppercase; }
.mn-avatar { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden;
  border: 1.5px solid hsl(var(--foreground)); background: hsl(var(--card)); color: hsl(var(--foreground));
  font-family: "Sora", sans-serif; font-weight: 700; letter-spacing: -0.02em; }
.mn-avatar img { width: 100%; height: 100%; object-fit: cover; }

/* Bottom bar */
.mn-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 61; padding-bottom: env(safe-area-inset-bottom, 0px);
  background: var(--mn-paper); border-top: 1.5px solid var(--mn-ink); }
.mn-bar .mn-bar-row { display: grid; height: 64px; }
.mn-bar .mn-tab { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; color: var(--mn-graphite); transition: transform .12s; }
.mn-bar .mn-tab:active { transform: scale(0.95); }
.mn-bar .mn-tab + .mn-tab { border-left: 1px solid var(--mn-rule-soft); }
.mn-bar .mn-tab.on { color: var(--mn-mod); }
.mn-bar .mn-tab-mark { position: absolute; top: -1.5px; left: 22%; right: 22%; height: 3px; background: var(--mn-mod); }
.mn-bar .mn-tab-label { max-width: 100%; padding: 0 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1;
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; }
.mn-bar .mn-tab.on .mn-tab-label { color: var(--mn-mod); }
.mn-bar .mn-menu-key { position: relative; width: 46px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
  background: var(--mn-ink); color: var(--mn-paper); box-shadow: 3px 3px 0 var(--mn-mod); }
.mn-bar .mn-menu-key.open { background: var(--mn-mod); box-shadow: 3px 3px 0 var(--mn-ink); }
.mn-bar .mn-menu-mod { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center;
  background: var(--mn-paper); color: var(--mn-mod); border: 1.5px solid var(--mn-ink); }
.mn-bar .mn-me { display: inline-flex; }
.mn-bar .mn-me.on { box-shadow: 0 0 0 2px var(--mn-mod); }
.mn-bar .mn-tab:nth-child(2) .mn-tab-label { color: var(--mn-ink); }
@media (max-width: 340px) {
  .mn-bar .mn-tab-label { font-size: 8px; letter-spacing: 0.06em; }
  .mn-sheet .mn-row { grid-template-columns: 16px 28px minmax(0, 1fr) auto auto; gap: 8px; padding: 8px 10px; }
  .mn-sheet .mn-themes { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) { .mn-sheet { animation: none; } }
`;

export default MobileNav;
