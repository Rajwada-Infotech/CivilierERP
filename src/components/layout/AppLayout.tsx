import React, { createContext, useContext, useState, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { TopNavbar } from "./TopNavbar";
import { AppSidebar } from "./AppSidebar";
import { MobileNav } from "./MobileNav";
import { useIsMobile } from "@/hooks/use-mobile";
import { useModule } from "@/contexts/ModuleContext";

// ─── Sidebar Context ──────────────────────────────────────────────────────────

interface SidebarContextType {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  setCollapsed: () => {},
});

export const useSidebarState = () => useContext(SidebarContext);

// ─── Navbar Collapse Context ──────────────────────────────────────────────────

interface NavbarCollapseContextType {
  navCollapsed: boolean;
  setNavCollapsed: (v: boolean) => void;
}

const NavbarCollapseContext = createContext<NavbarCollapseContextType>({
  navCollapsed: false,
  setNavCollapsed: () => {},
});

export const useNavbarCollapse = () => useContext(NavbarCollapseContext);

// ─── Home page detection helper ───────────────────────────────────────────────

function useIsHomePage() {
  const location = useLocation();
  return location.pathname === "/" || location.pathname === "/home";
}

// ─── AppLayout ────────────────────────────────────────────────────────────────

export const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const isMobile = useIsMobile();
  const { moduleSwitching } = useModule();
  const isHome = useIsHomePage();

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
                  style={{ position: "fixed", top: 56, left: 0, bottom: 0, zIndex: 40 }}
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
        </div>
      </NavbarCollapseContext.Provider>
    </SidebarContext.Provider>
  );
};
