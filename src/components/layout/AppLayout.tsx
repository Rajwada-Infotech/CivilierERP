import React, { createContext, useContext, useState, useMemo } from "react";
import { TopNavbar } from "./TopNavbar";
import { AppSidebar } from "./AppSidebar";
import { MobileNav } from "./MobileNav";
import { useIsMobile } from "@/hooks/use-mobile";

interface SidebarContextType { collapsed: boolean; setCollapsed: (v: boolean) => void }
const SidebarContext = createContext<SidebarContextType>({ collapsed: false, setCollapsed: () => {} });
export const useSidebarState = () => useContext(SidebarContext);

export const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const [collapsed, setCollapsed] = useState(false);
  const isMobile = useIsMobile();
  const sidebarValue = useMemo(() => ({ collapsed, setCollapsed }), [collapsed]);

  return (
    <SidebarContext.Provider value={sidebarValue}>
      <div className="min-h-screen bg-background">
        <TopNavbar />
        {!isMobile && <AppSidebar />}
        {isMobile && <MobileNav />}
        <main className={`pt-14 transition-[padding-left] duration-300 ease-in-out min-h-screen ${isMobile ? "pl-0 pb-16" : collapsed ? "pl-16" : "pl-56"}`}>
          <div className="p-4 md:p-6">{children}</div>
        </main>
      </div>
    </SidebarContext.Provider>
  );
};
