import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useModule } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSidebarState } from "./AppLayout";
import {
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  FileText,
  Scale,
  Shield,
} from "lucide-react";

interface SubItem {
  label: string;
  path: string;
}

interface NavItem {
  label: string;
  icon: React.ElementType;
  path?: string;
  children?: SubItem[];
}

// NORMAL NAV
const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", icon: BarChart3, path: "/" },
  {
    label: "Query",
    icon: Scale,
    children: [{ label: "Trial Balance", path: "/transactions" }],
  },
  { label: "Tasks", icon: CheckCircle2, path: "/tasks" },
];

// ADMIN NAV
const ADMIN_NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", icon: BarChart3, path: "/admin" },
  {
    label: "User Control",
    icon: FileText,
    children: [{ label: "Manage Users", path: "/users" }],
  },
  {
    label: "Rights",
    icon: Shield,
    children: [
      { label: "Menu", path: "/admin/rights/menu" },
      { label: "Widgets", path: "/admin/rights/widgets" },
      { label: "Financial Year", path: "/admin/rights/fin-year" },
    ],
  },
  {
    label: "Approval",
    icon: CheckCircle2,
    children: [
      { label: "Approval Setup", path: "/admin/approval/setup" },
      { label: "Post Approval Rights", path: "/admin/approval/post-rights" },
    ],
  },
];

const NavButton = ({
  item,
  collapsed,
  active,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
}) => {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => item.path && navigate(item.path)}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors duration-200 ${
        active
          ? "bg-primary/15 text-primary font-medium"
          : "text-sidebar-foreground hover:bg-sidebar-accent"
      } ${collapsed ? "justify-center" : "justify-start"}`}
      title={collapsed ? item.label : undefined}
    >
      <item.icon size={18} className="shrink-0" />
      <span
        className={`truncate transition-opacity duration-200 ${
          collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
        }`}
      >
        {item.label}
      </span>
    </button>
  );
};

const NavGroup = ({
  item,
  collapsed,
  activeChild,
}: {
  item: NavItem;
  collapsed: boolean;
  activeChild: boolean;
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(activeChild);

  const handleParentClick = () => {
    if (collapsed) {
      // When collapsed → navigate to first child if exists
      if (item.children && item.children.length > 0) {
        navigate(item.children[0].path);
      }
      return;
    }
    // When expanded → toggle submenu
    setOpen((prev) => !prev);
  };

  return (
    <div>
      <button
        onClick={handleParentClick}
        title={collapsed ? item.label : undefined}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors duration-200 ${
          activeChild
            ? "bg-primary/10 text-primary"
            : "text-sidebar-foreground hover:bg-sidebar-accent"
        } ${collapsed ? "justify-center" : "justify-start"}`}
      >
        <item.icon size={18} className="shrink-0" />
        <span
          className={`flex-1 text-left truncate transition-opacity duration-200 ${
            collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
          }`}
        >
          {item.label}
        </span>
        {!collapsed &&
          (open ? (
            <ChevronUp size={14} className="shrink-0" />
          ) : (
            <ChevronDown size={14} className="shrink-0" />
          ))}
      </button>

      {!collapsed && open && item.children && (
        <div className="mt-0.5 ml-4 pl-3 border-l border-sidebar-border space-y-0.5">
          {item.children.map((child) => (
            <button
              key={child.path}
              onClick={() => navigate(child.path)}
              className={`w-full text-left px-3 py-1.5 rounded-lg text-xs ${
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
    </div>
  );
};

export const AppSidebar = () => {
  const location = useLocation();
  const { moduleLabel } = useModule();
  const { collapsed, setCollapsed } = useSidebarState();
  useAuth();

  const isAdminPage =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/users");

  const itemsToRender = isAdminPage ? ADMIN_NAV_ITEMS : NAV_ITEMS;

  return (
    <aside
      className={`fixed top-14 left-0 bottom-0 z-40 flex flex-col border-r bg-sidebar transition-all duration-300 ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      <div className="flex-1 flex flex-col gap-1 p-2 pt-4 overflow-y-auto">
        {itemsToRender.map((item) => {
          if (item.children) {
            return (
              <NavGroup
                key={item.label}
                item={item}
                collapsed={collapsed}
                activeChild={item.children.some((c) =>
                  location.pathname.startsWith(c.path),
                )}
              />
            );
          }
          return (
            <NavButton
              key={item.label}
              item={item}
              collapsed={collapsed}
              active={location.pathname.startsWith(item.path || "")}
            />
          );
        })}
      </div>

      <div className="border-t p-2 space-y-2">
        {!collapsed && (
          <div className="px-2 py-1.5 rounded-md bg-sidebar-accent text-xs text-center">
            {isAdminPage ? "Admin Module" : moduleLabel}
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex justify-center py-1.5 hover:bg-sidebar-accent rounded-lg transition-colors"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
};
