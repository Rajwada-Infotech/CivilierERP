import React, { useState, useMemo, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { TopNavbar } from "./TopNavbar";
import { AppSidebar } from "./AppSidebar";
import { ModuleStrip } from "./ModuleStrip";
import { MobileNav } from "./MobileNav";
import { useIsMobile } from "@/hooks/use-mobile";
import { useModule } from "@/contexts/ModuleContext";
import { useActivityBrowser } from "@/contexts/ActivityBrowserContext";
import SlowConnectionBanner from "@/components/SlowConnectionBanner";
import AskCivilierAI from "@/components/AskCivilierAI";
import {
  SidebarContext,
  NavbarCollapseContext,
  useSidebarState,
} from "./layoutContexts";
import ErrorBoundary from "@/components/ErrorBoundary";

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
  const { moduleSwitching } = useModule();
  const isHome = useIsHomePage();

  useModuleActivityLogger();

  const sidebarValue = useMemo(
    () => ({ collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed }),
    [sidebarCollapsed],
  );

  const navbarValue = useMemo(
    () => ({ navCollapsed, setNavCollapsed }),
    [navCollapsed],
  );

  // Strip = 64px, NavPanel = 200px, total = 264px
  const STRIP_W = 64;
  const NAV_W = 200;
  const mainML = isMobile
    ? 0
    : isHome
      ? STRIP_W
      : sidebarCollapsed
        ? STRIP_W
        : STRIP_W + NAV_W;

  return (
    <SidebarContext.Provider value={sidebarValue}>
      <NavbarCollapseContext.Provider value={navbarValue}>
        <NavPanelAutoExpand>
          <div className="min-h-screen bg-background">
            <TopNavbar />

            {!isMobile && (
              <>
                {/* ── Module strip — always visible on desktop ── */}
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

                {/* ── Nav panel — only on module pages, not home ── */}
                <AnimatePresence>
                  {!isHome && !sidebarCollapsed && (
                    <motion.div
                      key="nav-panel"
                      initial={{ x: -NAV_W, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={{ x: -NAV_W, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      style={{
                        position: "fixed",
                        top: 56,
                        left: STRIP_W,
                        bottom: 0,
                        width: NAV_W,
                        zIndex: 40,
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
                transition: "margin-left 300ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              {/* Page-curve wrapper: 8px top gap + rounded-tl to mirror strip/sidebar shape */}
              <div
                className={
                  !isHome && !isMobile ? "pt-2 min-h-[calc(100vh-56px)]" : ""
                }
              >
                <div
                  className={
                    !isHome && !isMobile
                      ? "rounded-tl-[20px] min-h-[calc(100vh-64px)] p-4 md:p-6 transition-opacity duration-300 bg-background"
                      : "p-4 md:p-6 transition-opacity duration-300"
                  }
                  style={{ opacity: moduleSwitching ? 0 : 1 }}
                >
                  <ErrorBoundary>{children}</ErrorBoundary>
                </div>
              </div>
            </main>

            <SlowConnectionBanner />

            {/* Universal assistant — fixed-position, mounted once for every
                page rendered through AppLayout. Suggested queries adapt to
                the current page/module (see askCivilierQueries.ts). */}
            <AskCivilierAI />
          </div>
        </NavPanelAutoExpand>
      </NavbarCollapseContext.Provider>
    </SidebarContext.Provider>
  );
};
