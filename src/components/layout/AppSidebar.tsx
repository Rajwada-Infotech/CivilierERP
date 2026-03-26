import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useModule } from "@/contexts/ModuleContext";
import { useTask } from "@/contexts/TaskContext";
import { useSidebarState } from "./AppLayout";
import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  FileText,
  Scale,
  Shield,
  Landmark,
  ShieldCheck,
  FolderArchive,
  MessageSquare,
} from "lucide-react";

interface SubItem {
  label: string;
  path: string;
  badge?: number;
}

interface SubSection {
  label: string;
  icon: React.ElementType;
  items: SubItem[];
}

interface NavItem {
  label: string;
  icon: React.ElementType;
  path?: string;
  children?: SubItem[];
  sections?: SubSection[];
}

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
      { label: "Received Payment", path: "/received-payments" },
      { label: "BRS", path: "/brs" },
    ],
  },
  {
    label: "Record Management",
    icon: FolderArchive,
    children: [{ label: "Records", path: "/records" }],
  },
];

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
    children: [{ label: "Expense Booking", path: "/admin/expense-booking" }],
  },
  {
    label: "Communicator",
    icon: MessageSquare,
    children: [
      { label: "SMS Setup", path: "/admin/communicator/sms-setup" },
      { label: "Email Setup", path: "/admin/communicator/email-setup" },
      { label: "WhatsApp Setup", path: "/admin/communicator/whatsapp-setup" },
    ],
  },
  { label: "API Integration", icon: Shield, path: "/admin/api-integration" },
  { label: "Signature", icon: FileText, path: "/admin/signature" },
];

const NavButton = ({
  item,
  collapsed,
  isActive,
}: {
  item: NavItem;
  collapsed: boolean;
  isActive: boolean;
}) => {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => item.path && navigate(item.path)}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
        isActive
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

const NavGroup = ({
  item,
  collapsed,
  hasActiveChild,
}: {
  item: NavItem;
  collapsed: boolean;
  hasActiveChild: boolean;
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(hasActiveChild);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    () => {
      const init: Record<string, boolean> = {};
      (item.sections || []).forEach((s: any) => {
        init[s.label] = s.items.some(
          (i: SubItem) => location.pathname === i.path,
        );
      });
      return init;
    },
  );

  const handleClick = () => {
    if (collapsed && item.children?.length) {
      navigate(item.children[0].path);
      return;
    }
    setOpen((prev) => !prev);
  };

  const toggleSection = (label: string) =>
    setOpenSections((prev) => ({ ...prev, [label]: !prev[label] }));

  return (
    <div>
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
          hasActiveChild
            ? "bg-primary/10 text-primary"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        }`}
      >
        <item.icon size={18} className="shrink-0" />
        {!collapsed && (
          <span className="flex-1 text-left truncate">{item.label}</span>
        )}
        {!collapsed &&
          (open ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
      </button>

      {!collapsed && open && (
        <div className="ml-6 mt-1 space-y-1">
          {item.children?.map((child: SubItem) => (
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
                <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full">
                  {child.badge}
                </span>
              )}
            </button>
          ))}

          {item.sections?.map((section: any) => (
            <div key={section.label}>
              <button
                onClick={() => toggleSection(section.label)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              >
                <section.icon size={13} />
                <span className="flex-1 text-left truncate font-medium">
                  {section.label}
                </span>
                {openSections[section.label] ? (
                  <ChevronUp size={11} />
                ) : (
                  <ChevronDown size={11} />
                )}
              </button>

              {openSections[section.label] && (
                <div className="ml-4 mt-0.5 space-y-0.5">
                  {section.items.map((child: SubItem) => (
                    <button
                      key={child.path}
                      onClick={() => navigate(child.path)}
                      className={`w-full text-xs px-2 py-1.5 rounded-md ${
                        location.pathname === child.path
                          ? "bg-primary/15 text-primary font-medium"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent"
                      }`}
                    >
                      {child.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const AppSidebar = () => {
  const location = useLocation();
  const { activeModule } = useModule();
  const { collapsed, setCollapsed } = useSidebarState();
  const { getOverdueTasks } = useTask();

  const overdueCount = getOverdueTasks().length;

  const isAdminPage =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/users");

  const NAV_ITEMS = buildNavItems(overdueCount);
  const itemsToRender = isAdminPage ? ADMIN_NAV_ITEMS : NAV_ITEMS;

  const isFinance = !isAdminPage && activeModule === "finance";
  const isAdmin = isAdminPage;

  return (
    <aside
      className={`fixed top-14 left-0 bottom-0 flex flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-in-out z-40 ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {itemsToRender.map((item) =>
          item.children || item.sections ? (
            <NavGroup
              key={item.label}
              item={item}
              collapsed={collapsed}
              hasActiveChild={
                item.children?.some((c) => location.pathname === c.path) ||
                item.sections?.some((s: any) =>
                  s.items.some((i: any) => location.pathname === i.path),
                )
              }
            />
          ) : (
            <NavButton
              key={item.label}
              item={item}
              collapsed={collapsed}
              isActive={
                item.path === "/"
                  ? location.pathname === "/"
                  : location.pathname.startsWith(item.path || "")
              }
            />
          ),
        )}
      </div>

      <div className="p-2 border-t border-sidebar-border space-y-2">
        {!collapsed ? (
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border ${
              isAdmin
                ? "bg-blue-500/10 text-blue-500 border-blue-500/20"
                : isFinance
                ? "bg-primary/10 text-primary border-primary/20"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            {isAdmin ? <ShieldCheck size={13} /> : <Landmark size={13} />}
            <span>{isAdmin ? "Admin" : isFinance ? "Finance" : "No module"}</span>
          </div>
        ) : (
          <div className="flex justify-center">
            <div
              className={`w-2 h-2 rounded-full ${
                isAdmin
                  ? "bg-blue-500"
                  : isFinance
                  ? "bg-primary"
                  : "bg-muted-foreground/40"
              }`}
            />
          </div>
        )}

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex justify-center p-2 rounded-lg hover:bg-sidebar-accent"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
};