import React, { useState, useMemo, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { PanelLeftOpen } from "lucide-react";
import { TopNavbar } from "./TopNavbar";
import { AppSidebar } from "./AppSidebar";
import { ModuleStrip } from "./ModuleStrip";
import { MobileNav } from "./MobileNav";
import { useIsMobile } from "@/hooks/use-mobile";
import { useModule } from "@/contexts/ModuleContext";
import { useActivityBrowser } from "@/contexts/ActivityBrowserContext";
import { IdleLogoutWatcher } from "@/components/IdleLogoutWatcher";
import { LoginRemindersPopup } from "@/components/LoginRemindersPopup";
const SlowConnectionBanner = React.lazy(
  () => import("@/components/SlowConnectionBanner"),
);
// import AskCivilierAI from "@/components/AskCivilierAI";
import {
  SidebarContext,
  NavbarCollapseContext,
  useSidebarState,
} from "./layoutContexts";
import ErrorBoundary from "@/components/ErrorBoundary";
import { CompassProvider } from "@/components/compass/CompassProvider";

// ── Home page detection ───────────────────────────────────────────────────────

function useIsHomePage() {
  const location = useLocation();
  return location.pathname === "/" || location.pathname.startsWith("/home");
}

// ── Module Activity Logger ────────────────────────────────────────────────────

const SKIP_LOG_PREFIXES = ["/", "/home", "/login", "/admin/activity-browser"];

function useModuleActivityLogger() {
  const location = useLocation();
  const { activeModule } = useModule();
  const { recordAction } = useActivityBrowser();
  const lastLoggedPath = useRef<string | null>(null);

  useEffect(() => {
    const path = location.pathname;
    if (
      SKIP_LOG_PREFIXES.some(
        (prefix) =>
          path === prefix || (prefix !== "/" && path.startsWith(prefix)),
      )
    )
      return;
    if (lastLoggedPath.current === path) return;
    lastLoggedPath.current = path;
    const resource = activeModule ? `${activeModule}:${path}` : path;
    recordAction({
      method: "GET",
      url: path,
      actionType: "read",
      resource,
      details: `Navigated to ${path}`,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
}

// ── NavPanel wrapper — auto-expands when module changes ───────────────────────

function NavPanelAutoExpand({ children }: { children: React.ReactNode }) {
  const { activeModule } = useModule();
  const { setCollapsed } = useSidebarState();
  const prevModule = useRef<typeof activeModule>(activeModule);

  useEffect(() => {
    if (activeModule && activeModule !== prevModule.current) {
      setCollapsed(false);
    }
    prevModule.current = activeModule;
  }, [activeModule, setCollapsed]);

  return <>{children}</>;
}

// ── AppLayout ─────────────────────────────────────────────────────────────────

export const AppLayout = ({ children }: { children: React.ReactNode }) => {
  // `collapsed` now means the nav PANEL is hidden (only strip shows)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const isMobile = useIsMobile();
  const { moduleSwitching, activeModule } = useModule();
  const isHome = useIsHomePage();
  const location = useLocation();

  // Home hides the strip/nav panel by default (full-width dashboard), but
  // that also hides the only way to reach every other module from there —
  // this lets a toggle button temporarily reveal them without leaving
  // Home. Resets whenever the user actually navigates away, so it's never
  // left stuck open if they come back to Home later.
  const [homeNavOpen, setHomeNavOpen] = useState(false);
  useEffect(() => {
    if (!isHome) setHomeNavOpen(false);
  }, [isHome]);
  const effectiveIsHome = isHome && !homeNavOpen;

  // Pages that have their own sidebar content even without an activeModule
  const SPECIAL_SIDEBAR_PREFIXES = ["/admin", "/dba", "/superadmin", "/user/profile", "/masters/named-entry-type", "/masters/type-of-doc"];
  const isSpecialSidebarPage = SPECIAL_SIDEBAR_PREFIXES.some((p) => location.pathname.startsWith(p));

  // Hide nav panel when no module is selected and we're not on a special page
  const hideNavPanel = effectiveIsHome || (!activeModule && !isSpecialSidebarPage);

  useModuleActivityLogger();

  // Sync data-module to <body> so Radix UI portals (SelectContent, etc.)
  // inherit module-scoped CSS variables even though they render outside the layout div.
  useEffect(() => {
    if (activeModule) {
      document.body.setAttribute("data-module", activeModule);
    } else {
      document.body.removeAttribute("data-module");
    }
  }, [activeModule]);

  const sidebarValue = useMemo(
    () => ({ collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed }),
    [sidebarCollapsed],
  );

  const navbarValue = useMemo(
    () => ({ navCollapsed, setNavCollapsed }),
    [navCollapsed],
  );

  // Strip = 76px, NavPanel = 200px, total = 276px. Home renders full-width
  // with no side rail at all — neither the module strip nor the nav panel
  // — so it isn't squeezed into the same left gutter every module page
  // uses; TopNavbar (fixed, full-width) is its only chrome.
  const STRIP_W = 76;
  const NAV_W = 200;
  const mainML = isMobile || effectiveIsHome
    ? 0
    : hideNavPanel
      ? STRIP_W
      : sidebarCollapsed
        ? STRIP_W
        : STRIP_W + NAV_W;

  return (
    <CompassProvider>
    <SidebarContext.Provider value={sidebarValue}>
      <NavbarCollapseContext.Provider value={navbarValue}>
        <NavPanelAutoExpand>
          <div className="min-h-screen bg-background" data-module={activeModule ?? undefined}>
            <TopNavbar />

            {/* ── Home-only toggle — the only way back to the module strip
                from a page that otherwise renders with none at all. Once
                open, the strip itself (plus clicking outside it) is how
                you close it — no separate close button sitting on top of
                the strip's own icons. ── */}
            {!isMobile && isHome && !homeNavOpen && (
              <button
                onClick={() => setHomeNavOpen(true)}
                title="Open modules"
                className="fixed z-50 flex items-center justify-center w-9 h-9 rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors shadow-sm"
                style={{ top: 66, left: 14 }}
              >
                <PanelLeftOpen size={16} />
              </button>
            )}

            {!isMobile && (
              <>
                {/* Click-outside-to-close catcher — present while the drawer
                    is open on Home. Fully transparent: it only exists to
                    catch the click, not to dim/fade the Home page behind it. */}
                <AnimatePresence>
                  {isHome && homeNavOpen && (
                    <motion.div
                      key="home-nav-backdrop"
                      onClick={() => setHomeNavOpen(false)}
                      style={{ position: "fixed", inset: 0, top: 56, background: "transparent", zIndex: 39 }}
                    />
                  )}
                </AnimatePresence>

                {/* ── Module strip — visible on every desktop page except
                    Home, where it's hidden by default and only shown while
                    the toggle above has temporarily revealed it. ── */}
                {!effectiveIsHome && (
                <motion.div
                  key="module-strip"
                  initial={{ x: -STRIP_W, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -STRIP_W, opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  style={{
                    position: "fixed",
                    top: 56,
                    left: 0,
                    bottom: 0,
                    width: STRIP_W,
                    zIndex: 40,
                  }}
                >
                  <ModuleStrip />
                </motion.div>
                )}

                {/* ── Nav panel — only on module pages, not home.
                    Stays mounted across collapse/expand toggles (only the
                    isHome-driven mount/unmount tears it down) so collapsing
                    is a pure transform/opacity animation rather than a full
                    remount of AppSidebar's hooks (approval polling,
                    reminders, etc.) — that remount cost was the source of
                    the laggy/clunky open-close feel. ── */}
                <AnimatePresence>
                  {!hideNavPanel && (
                    <motion.div
                      key="nav-panel"
                      initial={{ x: -NAV_W, opacity: 0 }}
                      animate={{
                        x: sidebarCollapsed ? -NAV_W : 0,
                        opacity: sidebarCollapsed ? 0 : 1,
                      }}
                      exit={{ x: -NAV_W, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                      style={{
                        position: "fixed",
                        top: 56,
                        left: STRIP_W,
                        bottom: 0,
                        width: NAV_W,
                        zIndex: 40,
                        pointerEvents: sidebarCollapsed ? "none" : "auto",
                        willChange: "transform, opacity",
                      }}
                    >
                      <AppSidebar />
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {isMobile && <MobileNav />}

            <main
              className={`pt-14 min-h-screen ${isMobile ? "pb-16" : ""}`}
              style={{
                marginLeft: mainML,
                transition: "margin-left 250ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              {/* Page-curve wrapper: 8px top gap + rounded-tl to mirror strip/sidebar shape */}
              <div
                className={
                  !effectiveIsHome && !isMobile ? "pt-2 min-h-[calc(100vh-56px)]" : ""
                }
              >
                <div
                  className={
                    !effectiveIsHome && !isMobile
                      ? "rounded-tl-[20px] min-h-[calc(100vh-64px)] p-4 md:p-6 transition-opacity duration-300 bg-background"
                      : "p-4 md:p-6 transition-opacity duration-300"
                  }
                  style={{ opacity: moduleSwitching ? 0 : 1 }}
                >
                  <ErrorBoundary>{children}</ErrorBoundary>
                </div>
              </div>
            </main>

            <React.Suspense fallback={null}>
              <SlowConnectionBanner />
            </React.Suspense>

            {/* Auto-logout on inactivity — mounted once for every
                authenticated page rendered through AppLayout. */}
            <IdleLogoutWatcher />

            {/* Reminders popup shown once right after a fresh login (see
                the __just_logged_in one-shot flag in AuthContext.login).
                Toggleable off from the Profile page. */}
            <LoginRemindersPopup />

            {/* Universal assistant — fixed-position, mounted once for every
                page rendered through AppLayout. Suggested queries adapt to
                the current page/module (see askCivilierQueries.ts). */}
            {/* <AskCivilierAI /> */}
          </div>
        </NavPanelAutoExpand>
      </NavbarCollapseContext.Provider>
    </SidebarContext.Provider>
    </CompassProvider>
  );
};
