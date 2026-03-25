import React, { createContext, useContext, useState, useMemo } from "react";
import { TopNavbar } from "./TopNavbar";
import { AppSidebar } from "./AppSidebar";
import { MobileNav } from "./MobileNav";
import { useIsMobile } from "@/hooks/use-mobile";

// Sidebar context
interface SidebarContextType {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}
const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  setCollapsed: () => {},
});
export const useSidebarState = () => useContext(SidebarContext);

// Navbar collapse context
interface NavbarCollapseContextType {
  navCollapsed: boolean;
  setNavCollapsed: (v: boolean) => void;
}
const NavbarCollapseContext = createContext<NavbarCollapseContextType>({
  navCollapsed: false,
  setNavCollapsed: () => {},
});
export const useNavbarCollapse = () => useContext(NavbarCollapseContext);

export const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);

  const isMobile = useIsMobile();

  const sidebarValue = useMemo(
    () => ({
      collapsed: sidebarCollapsed,
      setCollapsed: setSidebarCollapsed,
    }),
    [sidebarCollapsed],
  );

  const navbarValue = useMemo(
    () => ({
      navCollapsed,
      setNavCollapsed,
    }),
    [navCollapsed],
  );

  return (
    <SidebarContext.Provider value={sidebarValue}>
      <NavbarCollapseContext.Provider value={navbarValue}>
        <div className="min-h-screen bg-background">
          <TopNavbar />

          {!isMobile && <AppSidebar />}
          {isMobile && <MobileNav />}

          <main
            className={`pt-14 transition-[margin-left] duration-300 ease-in-out min-h-screen ${
              isMobile ? "ml-0 pb-16" : sidebarCollapsed ? "ml-16" : "ml-56"
            }`}
          >
            <div className="p-4 md:p-6">{children}</div>
          </main>
        </div>
      </NavbarCollapseContext.Provider>
    </SidebarContext.Provider>
  );
};
