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

// ✅ MERGED NAV (dev logic + your features)
const buildNavItems = (overdueCount: number): NavItem[] => [
  { label: "Dashboard", icon: BarChart3, path: "/" },

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
    label: "Transaction",
    icon: Receipt,
    children: [
      { label: "Expense Booking", path: "/transactions/expense-booking" },
    ],
  },

  { label: "Payment", icon: Receipt, path: "/payments" },
];

// ✅ ADMIN untouched
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

const NavButton = ({ item, collapsed, active }: any) => {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => item.path && navigate(item.path)}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
        active
          ? "bg-primary/15 text-primary font-medium"
          : "text-sidebar-foreground hover:bg-sidebar-accent"
      } ${collapsed ? "justify-center" : ""}`}
      title={collapsed ? item.label : undefined}
    >
      <item.icon size={18} />
      <span className={`${collapsed ? "hidden" : ""}`}>{item.label}</span>
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
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
          activeChild
            ? "bg-primary/10 text-primary"
            : "hover:bg-sidebar-accent"
        }`}
      >
        <item.icon size={18} />
        {!collapsed && <span className="flex-1">{item.label}</span>}
        {!collapsed && (open ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
      </button>

      {!collapsed && open && (
        <div className="ml-6 space-y-1">
          {item.children.map((child: SubItem) => (
            <button
              key={child.path}
              onClick={() => navigate(child.path)}
              className={`w-full flex justify-between text-xs px-2 py-1 rounded ${
                location.pathname.startsWith(child.path)
                  ? "bg-primary/15 text-primary"
                  : "hover:bg-sidebar-accent"
              }`}
            >
              <span>{child.label}</span>
              {child.badge && (
                <span className="bg-red-500 text-white text-[9px] px-1 rounded">
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
    <aside className={`fixed top-14 left-0 bottom-0 ${collapsed ? "w-16" : "w-56"} border-r`}>
      <div className="p-2 space-y-1">
        {itemsToRender.map((item) =>
          item.children ? (
            <NavGroup
              key={item.label}
              item={item}
              collapsed={collapsed}
              activeChild={item.children.some((c) =>
                location.pathname.startsWith(c.path)
              )}
            />
          ) : (
            <NavButton
              key={item.label}
              item={item}
              collapsed={collapsed}
              active={location.pathname.startsWith(item.path || "")}
            />
          )
        )}
      </div>

      <div className="p-2 border-t">
        {!collapsed && <div className="text-xs text-center">{moduleLabel}</div>}
        <button onClick={() => setCollapsed(!collapsed)} className="w-full mt-2">
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
};