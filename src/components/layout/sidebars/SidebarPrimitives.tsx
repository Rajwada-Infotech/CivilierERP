import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ChevronDown, ChevronUp } from "lucide-react";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface SubItem {
  label: string;
  path: string;
  badge?: number;
  state?: Record<string, unknown>;
  /** Page key that must appear in user's pagePermissions to show this item */
  pageKey?: string;
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
  /** Page key for leaf items (items without children) */
  pageKey?: string;
  children?: SubItem[];
  sections?: SubSection[];
}

// ─── NavButton ────────────────────────────────────────────────────────────────

export const NavButton = ({
  item,
  collapsed,
  isActive,
  accentColor,
}: {
  item: NavItem;
  collapsed: boolean;
  isActive: boolean;
  accentColor?: string;
}) => {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => item.path && navigate(item.path)}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
        isActive
          ? accentColor
            ? "font-medium"
            : "bg-primary/15 text-primary font-medium"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      } ${collapsed ? "justify-center" : ""}`}
      style={
        isActive && accentColor
          ? { background: `${accentColor}26`, color: accentColor }
          : undefined
      }
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
  accentColor,
}: {
  item: NavItem;
  collapsed: boolean;
  hasActiveChild: boolean;
  accentColor?: string;
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
            ? accentColor
              ? ""
              : "bg-primary/10 text-primary"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        }`}
        style={
          hasActiveChild && accentColor
            ? { background: `${accentColor}1A`, color: accentColor }
            : undefined
        }
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
          {item.children?.map((child: SubItem) => {
            const childActive = location.pathname === child.path;
            return (
              <button
                key={child.path}
                onClick={() => navigate(child.path, child.state ? { state: child.state } : undefined)}
                className={`w-full flex justify-between items-center text-xs px-2 py-1.5 rounded-md transition-colors ${
                  childActive
                    ? accentColor
                      ? "font-medium"
                      : "bg-primary/15 text-primary font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
                style={
                  childActive && accentColor
                    ? { background: `${accentColor}26`, color: accentColor }
                    : undefined
                }
              >
                <span>{child.label}</span>
                {child.badge && (
                  <span className="bg-red-500 text-white text-[9px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full">
                    {child.badge}
                  </span>
                )}
              </button>
            );
          })}

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
                  {section.items.map((child: SubItem) => {
                    const sChildActive = location.pathname === child.path;
                    return (
                      <button
                        key={child.path}
                        onClick={() => navigate(child.path)}
                        className={`w-full text-xs px-2 py-1.5 rounded-md ${
                          sChildActive
                            ? accentColor
                              ? "font-medium"
                              : "bg-primary/15 text-primary font-medium"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent"
                        }`}
                        style={
                          sChildActive && accentColor
                            ? { background: `${accentColor}26`, color: accentColor }
                            : undefined
                        }
                      >
                        {child.label}
                      </button>
                    );
                  })}
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
  accentColor,
}: {
  items: NavItem[];
  collapsed: boolean;
  accentColor?: string;
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
            accentColor={accentColor}
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
            accentColor={accentColor}
            isActive={
              item.path === "/"
                ? location.pathname === "/"
                : location.pathname === item.path ||
                  location.pathname.startsWith((item.path || "") + "/")
            }
          />
        ),
      )}
    </>
  );
};
