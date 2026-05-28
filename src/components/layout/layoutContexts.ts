import { createContext, useContext } from "react";

// ─── Sidebar Context ──────────────────────────────────────────────────────────

interface SidebarContextType {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

export const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  setCollapsed: () => {},
});

export const useSidebarState = () => useContext(SidebarContext);

// ─── Navbar Collapse Context ──────────────────────────────────────────────────

interface NavbarCollapseContextType {
  navCollapsed: boolean;
  setNavCollapsed: (v: boolean) => void;
}

export const NavbarCollapseContext = createContext<NavbarCollapseContextType>({
  navCollapsed: false,
  setNavCollapsed: () => {},
});

export const useNavbarCollapse = () => useContext(NavbarCollapseContext);
