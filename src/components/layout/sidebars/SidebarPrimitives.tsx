import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ChevronDown, ChevronUp } from "lucide-react";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface SubItem {
  label: string;
  path: string;
  badge?: number;
}

export interface SubSection {
  label: string;
  icon: React.ElementType;
  items: SubItem[];
}

export interface NavItem {
  label: string;
  icon: React.ElementType;
  path?: string;
  children?: SubItem[];
  sections?: SubSection[];
}

// ─── NavButton ────────────────────────────────────────────────────────────────

export const NavButton = ({
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

// ─── NavGroup ─────────────────────────────────────────────────────────────────

export const NavGroup = ({
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
      (item.sections || []).forEach((s: SubSection) => {
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

          {item.sections?.map((section: SubSection) => (
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

// ─── SidebarNav — renders a list of NavItems ──────────────────────────────────

export const SidebarNav = ({
  items,
  collapsed,
}: {
  items: NavItem[];
  collapsed: boolean;
}) => {
  const location = useLocation();
  return (
    <>
      {items.map((item) =>
        item.children || item.sections ? (
          <NavGroup
            key={item.label}
            item={item}
            collapsed={collapsed}
            hasActiveChild={
              !!(
                item.children?.some((c) => location.pathname === c.path) ||
                item.sections?.some((s) =>
                  s.items.some((i) => location.pathname === i.path),
                )
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
    </>
  );
};
