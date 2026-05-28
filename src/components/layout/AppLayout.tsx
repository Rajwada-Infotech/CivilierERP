import React, { useState, useMemo, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { TopNavbar } from "./TopNavbar";
import { AppSidebar } from "./AppSidebar";
import { MobileNav } from "./MobileNav";
import { useIsMobile } from "@/hooks/use-mobile";
import { useModule } from "@/contexts/ModuleContext";
import { useActivityBrowser } from "@/contexts/ActivityBrowserContext";
import SlowConnectionBanner from "@/components/SlowConnectionBanner";
import {
  SidebarContext,
  NavbarCollapseContext,
  useSidebarState,
  useNavbarCollapse,
} from "./layoutContexts";

// ─── Sidebar Context ──────────────────────────────────────────────────────────

// ─── Home page detection helper ───────────────────────────────────────────────

function useIsHomePage() {
  const location = useLocation();
  return location.pathname === "/" || location.pathname === "/home";
}

// ─── Module Activity Logger ───────────────────────────────────────────────────
// Fires recordAction("read") whenever the user navigates to a new page,
// capturing which module/resource they accessed and the exact route.
// Skips home, login, and the activity browser itself to avoid log spam.

const SKIP_LOG_PREFIXES = ["/", "/home", "/login", "/admin/activity-browser"];

function useModuleActivityLogger() {
  const location = useLocation();
  const { activeModule } = useModule();
  const { recordAction } = useActivityBrowser();

  // Track last-logged path so rapid React re-renders don't duplicate entries
  const lastLoggedPath = useRef<string | null>(null);

  useEffect(() => {
    const path = location.pathname;

    // Skip paths that aren't meaningful module pages
    if (
      SKIP_LOG_PREFIXES.some(
        (prefix) =>
          path === prefix || (prefix !== "/" && path.startsWith(prefix)),
      )
    ) {
      return;
    }

    // Don't re-log if the path hasn't changed (e.g. query-string-only update)
    if (lastLoggedPath.current === path) return;
    lastLoggedPath.current = path;

    // Derive a human-readable resource label from the active module + path
    const resource = activeModule ? `${activeModule}:${path}` : path;

    recordAction({
      method: "GET",
      url: path,
      actionType: "read",
      resource,
      details: `Navigated to ${path}`,
    }).catch(() => {
      // fire-and-forget — never block navigation
    });
    // recordAction is stable (useCallback with no deps that change), so
    // we can safely omit it from the array. activeModule intentionally
    // excluded: we only want to log when the PATH changes, not when the
    // module label re-derives from the same path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
}

// ─── AppLayout ────────────────────────────────────────────────────────────────

export const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const isMobile = useIsMobile();
  const { moduleSwitching } = useModule();
  const isHome = useIsHomePage();

  // Log every page navigation to UserActivityLog
  useModuleActivityLogger();

  const sidebarValue = useMemo(
    () => ({ collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed }),
    [sidebarCollapsed],
  );

  const navbarValue = useMemo(
    () => ({ navCollapsed, setNavCollapsed }),
    [navCollapsed],
  );

  // On home page sidebar is completely hidden; compute main margin accordingly
  const mainMargin = isMobile
    ? "ml-0"
    : isHome
      ? "ml-0"
      : sidebarCollapsed
        ? "ml-16"
        : "ml-56";

  return (
    <SidebarContext.Provider value={sidebarValue}>
      <NavbarCollapseContext.Provider value={navbarValue}>
        <div className="min-h-screen bg-background">
          <TopNavbar />

          {/* Desktop sidebar — hidden on home page with slide animation */}
          {!isMobile && (
            <AnimatePresence>
              {!isHome && (
                <motion.div
                  key="sidebar"
                  initial={{ x: -224, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -224, opacity: 0 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  style={{
                    position: "fixed",
                    top: 56,
                    left: 0,
                    bottom: 0,
                    zIndex: 40,
                  }}
                >
                  <AppSidebar />
                </motion.div>
              )}
            </AnimatePresence>
          )}

          {/* Mobile nav — always present, sidebar visibility handled internally */}
          {isMobile && <MobileNav />}

          <main
            className={`pt-14 transition-[margin-left] duration-300 ease-in-out min-h-screen ${mainMargin} ${
              isMobile ? "pb-16" : ""
            }`}
          >
            <div
              className="p-4 md:p-6 transition-opacity duration-300"
              style={{ opacity: moduleSwitching ? 0 : 1 }}
            >
              {children}
            </div>
          </main>
          <SlowConnectionBanner />
        </div>
      </NavbarCollapseContext.Provider>
    </SidebarContext.Provider>
  );
};
