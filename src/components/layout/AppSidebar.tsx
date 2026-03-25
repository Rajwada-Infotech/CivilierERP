import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useModule } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useTask } from "@/contexts/TaskContext";
import { useSidebarState } from "./AppLayout";
import {
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  FileText,
  Receipt,
  Scale,
  Shield,
  Landmark,
} from "lucide-react";

interface SubItem {
  label: string;
  path: string;
  badge?: number;
}

interface NavItem {
  label: string;
  icon: React.ElementType;
  path?: string;
  children?: SubItem[];
}

// FINANCE MODULE sidebar
// - "Dashboard" renamed to "Amendments"
// - "Transaction" group renamed to "Finance"
// - "Payment" moved inside "Finance" group (no longer a standalone item)
const buildNavItems = (overdueCount: number): NavItem[] => [
  { label: "Amendments", icon: BarChart3, path: "/" },

  {
    label: "Query",
    icon: Scale,
    children: [
      { label: "Trial Balance", path: "/transactions" },
      {
        label: "Tasks",
        path: "/tasks",
        badge: overdueCount > 0 ? overdueCount : undefined,
      },
    ],
  },

  {
    label: "Finance",
    icon: Landmark,
    children: [
      { label: "Expense Booking", path: "/transactions/expense-booking" },
      { label: "Payment", path: "/payments" },
    ],
  },
];

// ADMIN MODULE sidebar
// - "Dashboard" renamed to "Transaction" (points to /admin)
// - "Transaction" group renamed to "Finance"
const ADMIN_NAV_ITEMS: NavItem[] = [
  { label: "Transaction", icon: BarChart3, path: "/admin" },
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
  {
    label: "Finance",
    icon: Landmark,
    children: [
      { label: "Expense Booking", path: "/admin/expense-booking" },
    ],
  },
];

const NavButton = ({ item, collapsed, active }: any) => {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => item.path && navigate(item.path)}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
        active
          ? "bg-primary/15 text-primary font-medium"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      } ${collapsed ? "justify-center" : ""}`}
      title={collapsed ? item.label : undefined}
    >
      <item.icon size={18} className="shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </button>
  );
};

const NavGroup = ({ item, collapsed, activeChild }: any) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(activeChild);

  const handleClick = () => {
    if (collapsed) {
      navigate(item.children[0].path);
      return;
    }
    setOpen((p: boolean) => !p);
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
          activeChild
            ? "bg-primary/10 text-primary"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        }`}
      >
        <item.icon size={18} className="shrink-0" />
        {!collapsed && <span className="flex-1 text-left truncate">{item.label}</span>}
        {!collapsed && (open ? <ChevronUp size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />)}
      </button>

      {!collapsed && open && (
        <div className="ml-6 mt-1 space-y-1">
          {item.children.map((child: SubItem) => (
            <button
              key={child.path}
              onClick={() => navigate(child.path)}
              className={`w-full flex justify-between items-center text-xs px-2 py-1.5 rounded-md transition-colors ${
                location.pathname === child.path
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <span>{child.label}</span>
              {child.badge && (
                <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full leading-none">
                  {child.badge}
                </span>
              )}
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
  const { getOverdueTasks } = useTask();
  useAuth();

  const overdueCount = getOverdueTasks().length;

  const isAdminPage =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/users");

  const NAV_ITEMS = buildNavItems(overdueCount);
  const itemsToRender = isAdminPage ? ADMIN_NAV_ITEMS : NAV_ITEMS;

  return (
    <aside
      className={`fixed top-14 left-0 bottom-0 flex flex-col ${
        collapsed ? "w-16" : "w-56"
      } bg-sidebar border-r border-sidebar-border transition-[width] duration-300 ease-in-out z-40`}
    >
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {itemsToRender.map((item) =>
          item.children ? (
            <NavGroup
              key={item.label}
              item={item}
              collapsed={collapsed}
              activeChild={item.children.some((c) =>
                location.pathname === c.path
              )}
            />
          ) : (
            <NavButton
              key={item.label}
              item={item}
              collapsed={collapsed}
              active={
                item.path === "/"
                  ? location.pathname === "/"
                  : location.pathname.startsWith(item.path || "__never__")
              }
            />
          )
        )}
      </div>

      <div className="shrink-0 p-2 border-t border-sidebar-border">
        {!collapsed && (
          <div className="text-xs text-center text-sidebar-foreground/60 mb-2 truncate px-1">
            {moduleLabel}
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center p-2 rounded-lg hover:bg-sidebar-accent text-sidebar-foreground transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
};
