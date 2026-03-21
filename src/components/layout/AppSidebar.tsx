import React, { useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { LogoIcon } from "../Logo";
import { useModule } from "@/contexts/ModuleContext";
import { useSidebarState } from "./AppLayout";
import { BarChart3, CreditCard, ChevronLeft, ChevronRight } from "lucide-react";

interface NavItem { label: string; icon: React.ElementType; path: string }

const navItems: NavItem[] = [
  { label: "Dashboard", icon: BarChart3, path: "/" },
  { label: "Transactions", icon: CreditCard, path: "/transactions" },
];

const NavButton = ({ item, collapsed, active }: { item: NavItem; collapsed: boolean; active: boolean }) => {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(item.path)}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors duration-200 ${active ? "bg-primary/15 text-primary font-medium" : "text-sidebar-foreground hover:bg-sidebar-accent"}`}
      title={collapsed ? item.label : undefined}
    >
      <item.icon size={18} className="shrink-0" />
      <span className={`truncate transition-opacity duration-200 ${collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"}`}>{item.label}</span>
    </button>
  );
};

export const AppSidebar = () => {
  const location = useLocation();
  const { moduleLabel } = useModule();
  const { collapsed, setCollapsed } = useSidebarState();

  return (
    <aside className={`fixed top-14 left-0 bottom-0 z-40 flex flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-in-out ${collapsed ? "w-16" : "w-56"} max-md:hidden`}>
      <div className="flex-1 flex flex-col gap-1 p-2 pt-4 overflow-y-auto">
        {collapsed && (
          <div className="flex justify-center mb-3">
            <LogoIcon size={24} />
          </div>
        )}
        {navItems.map((item) => (
          <NavButton key={item.path} item={item} collapsed={collapsed} active={location.pathname === item.path} />
        ))}
      </div>

      <div className="border-t border-sidebar-border p-2 space-y-2">
        <div className={`transition-all duration-200 overflow-hidden ${collapsed ? "h-0 opacity-0" : "h-auto opacity-100"}`}>
          <div className="px-2 py-1.5 rounded-md bg-sidebar-accent text-xs font-heading text-sidebar-accent-foreground text-center">
            {moduleLabel}
          </div>
        </div>
        <button onClick={() => setCollapsed(!collapsed)} className="w-full flex items-center justify-center py-1.5 rounded-md hover:bg-sidebar-accent transition-colors text-sidebar-foreground">
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
};
