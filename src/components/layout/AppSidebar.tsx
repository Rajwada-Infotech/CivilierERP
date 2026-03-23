import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useModule } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSidebarState } from "./AppLayout";
import {
  BarChart3, CheckCircle2, ChevronLeft, ChevronRight,
  ChevronDown, ChevronUp, FileText, Scale,
} from "lucide-react";

interface SubItem { label: string; path: string }
interface NavItem {
  label: string;
  icon: React.ElementType;
  path?: string;
  children?: SubItem[];
}

// NORMAL NAV (Users removed)
const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", icon: BarChart3, path: "/" },
  {
    label: "Query",
    icon: Scale,
    children: [
      { label: "Trial Balance", path: "/transactions" },
    ],
  },
  { label: "Tasks", icon: CheckCircle2, path: "/tasks" },
];

// ADMIN NAV
const ADMIN_NAV_ITEMS: NavItem[] = [
  {
    label: "User Control",
    icon: FileText,
    children: [
      { label: "Manage Users", path: "/users" },
    ],
  },
];

const NavButton = ({ item, collapsed, active }: { item: NavItem; collapsed: boolean; active: boolean }) => {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => item.path && navigate(item.path)}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors duration-200 ${
        active ? "bg-primary/15 text-primary font-medium" : "text-sidebar-foreground hover:bg-sidebar-accent"
      }`}
      title={collapsed ? item.label : undefined}
    >
      <item.icon size={18} className="shrink-0" />
      <span className={`truncate transition-opacity duration-200 ${collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"}`}>
        {item.label}
      </span>
    </button>
  );
};

const NavGroup = ({ item, collapsed, activeChild }: { item: NavItem; collapsed: boolean; activeChild: boolean }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(activeChild);

  return (
    <div>
      <button
        onClick={() => !collapsed && setOpen(p => !p)}
        title={collapsed ? item.label : undefined}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors duration-200 ${
          activeChild ? "bg-primary/10 text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent"
        }`}
      >
        <item.icon size={18} className="shrink-0" />
        <span className={`flex-1 text-left truncate transition-opacity duration-200 ${collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"}`}>
          {item.label}
        </span>
        {!collapsed && (open
          ? <ChevronUp size={14} className="shrink-0 text-muted-foreground" />
          : <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
        )}
      </button>

      {!collapsed && open && item.children && (
        <div className="mt-0.5 ml-4 pl-3 border-l border-sidebar-border space-y-0.5">
          {item.children.map(child => (
            <button
              key={child.path}
              onClick={() => navigate(child.path)}
              className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-heading transition-colors ${
                location.pathname === child.path
                  ? "bg-primary/15 text-primary font-semibold"
                  : "text-sidebar-foreground hover:bg-sidebar-accent"
              }`}
            >
              {child.label}
            </button>
          ))}
        </div>
      )}

      {collapsed && item.children && (
        <div className="mt-0.5 space-y-0.5">
          {item.children.map(child => (
            <button
              key={child.path}
              onClick={() => navigate(child.path)}
              title={child.label}
              className={`w-full flex items-center justify-center py-1.5 rounded-lg text-xs transition-colors ${
                location.pathname === child.path
                  ? "bg-primary/15 text-primary"
                  : "text-sidebar-foreground hover:bg-sidebar-accent"
              }`}
            >
              <FileText size={14} className="shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const AppSidebar = () => {
  const location = useLocation();
  const { moduleLabel } = useModule();
  const { collapsed, setCollapsed } = useSidebarState();
  useAuth();

  // ✅ ONLY CHANGE HERE
  const isAdminPage =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/users");

  const itemsToRender = isAdminPage ? ADMIN_NAV_ITEMS : NAV_ITEMS;

  return (
    <aside className={`fixed top-14 left-0 bottom-0 z-40 flex flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-in-out ${collapsed ? "w-16" : "w-56"} max-md:hidden`}>
      <div className="flex-1 flex flex-col gap-1 p-2 pt-4 overflow-y-auto">

        {itemsToRender.map(item => {
          if (item.children) {
            return (
              <NavGroup
                key={item.label}
                item={item}
                collapsed={collapsed}
                activeChild={item.children.some(c => location.pathname === c.path)}
              />
            );
          }
          return (
            <NavButton
              key={item.label}
              item={item}
              collapsed={collapsed}
              active={location.pathname === item.path}
            />
          );
        })}

      </div>

      <div className="border-t border-sidebar-border p-2 space-y-2">
        <div className={`transition-all duration-200 overflow-hidden ${collapsed ? "h-0 opacity-0" : "h-auto opacity-100"}`}>
          <div className="px-2 py-1.5 rounded-md bg-sidebar-accent text-xs font-heading text-sidebar-accent-foreground text-center">
            {isAdminPage ? "Admin Module" : moduleLabel}
          </div>
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center py-1.5 rounded-md hover:bg-sidebar-accent transition-colors text-sidebar-foreground"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
};