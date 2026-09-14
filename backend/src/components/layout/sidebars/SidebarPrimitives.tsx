import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowDown2, ArrowUp2 } from "iconsax-react";

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
  /** Marks the module's primary dashboard/landing entry — rendered larger
   *  and set apart from the rest of the list, regardless of its label
   *  (e.g. "Proceeding", "Control Center", "All Records"). */
  isDashboard?: boolean;
  /** Notification-style count shown as a filled badge next to the label. */
  badge?: number;
  /** Wraps the label onto two lines instead of truncating with an ellipsis —
   *  for labels too long to read at a glance when cut off (e.g. "Task
   *  Performance Report"). Leave unset for the default single-line + ellipsis
   *  behaviour every other nav item uses. */
  wrapLabel?: boolean;
}

// ─── Shared bits ──────────────────────────────────────────────────────────────

/** Icon, sat inside a soft rounded chip — matches the icon-tile look of the
 *  reference design rather than a bare glyph. */
const IconChip = ({
  icon: Icon,
  size,
  active,
  compact,
}: {
  icon: React.ElementType;
  size: number;
  active: boolean;
  compact?: boolean;
}) => {
  const pad = compact ? 6 : 12;
  return (
    <span
      className="flex items-center justify-center rounded-md shrink-0 transition-colors bg-sidebar-accent/50 text-sidebar-foreground/60"
      style={{
        width: size + pad,
        height: size + pad,
      }}
    >
      <Icon size={size} variant={active ? "Bold" : "Linear"} />
    </span>
  );
};

/** Hover tooltip used in the collapsed (icon-only) rail — a small pill that
 *  flies out to the right of the icon, mirroring the reference design. */
const RailTooltip = ({
  label,
  accentColor,
}: {
  label: string;
  accentColor?: string;
}) => (
  <span
    className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold text-white opacity-0 scale-95 shadow-lg transition-all duration-150 group-hover:opacity-100 group-hover:scale-100"
    style={{ background: accentColor || "hsl(var(--primary))" }}
  >
    {label}
    <span
      className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent"
      style={{ borderRightColor: accentColor || "hsl(var(--primary))" }}
    />
  </span>
);

const Badge = ({ count }: { count: number }) => (
  <span className="bg-blue-500 text-white text-[10px] font-bold min-w-[20px] h-5 px-1 flex items-center justify-center rounded-full shrink-0">
    {count}
  </span>
);

/** Active-state indicator for a nav label — no background box, just a bold
 *  weight + an animated underline that smoothly grows in/out from the left
 *  as the option switches. */
const NavLabel = ({
  label,
  active,
  accentColor,
  className = "",
  wrap = false,
}: {
  label: string;
  active: boolean;
  accentColor?: string;
  className?: string;
  wrap?: boolean;
}) => (
  <span
    className={`relative inline-block min-w-0 max-w-full ${wrap ? "line-clamp-2 leading-tight" : "truncate"} ${className}`}
  >
    <span
      className={`transition-all duration-200 ease-out ${active ? "font-bold" : "font-normal"}`}
    >
      {label}
    </span>
    <span
      className="absolute left-0 right-0 -bottom-0.5 h-[2px] rounded-full origin-left transition-transform duration-300 ease-out"
      style={{
        transform: active ? "scaleX(1)" : "scaleX(0)",
        background: accentColor || "hsl(var(--primary))",
      }}
    />
  </span>
);

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
  const iconSize = item.isDashboard ? 16 : 15;

  return (
    <button
      onClick={() => item.path && navigate(item.path)}
      className={`group relative w-full flex items-center gap-2 rounded-lg transition-all duration-200 ${
        item.isDashboard
          ? "px-2.5 py-1.5 mb-1 text-xs font-semibold"
          : "px-2.5 py-2 text-xs"
      } text-sidebar-foreground ${
        isActive
          ? ""
          : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      } ${collapsed ? "justify-center" : ""}`}
    >
      <IconChip
        icon={item.icon}
        size={iconSize}
        active={isActive}
        compact={item.isDashboard}
      />
      {!collapsed && (
        <NavLabel
          label={item.label}
          active={isActive}
          accentColor={accentColor}
          className="flex-1 text-left"
          wrap={item.wrapLabel}
        />
      )}
      {!collapsed && !!item.badge && <Badge count={item.badge} />}
      {collapsed && <RailTooltip label={item.label} accentColor={accentColor} />}
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
        className={`group relative w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-sidebar-foreground transition-all duration-200 ${
          hasActiveChild
            ? ""
            : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        } ${collapsed ? "justify-center" : ""}`}
      >
        <IconChip
          icon={item.icon}
          size={15}
          active={hasActiveChild}
        />
        {!collapsed && (
          <NavLabel
            label={item.label}
            active={hasActiveChild}
            accentColor={accentColor}
            className="flex-1 text-left"
          />
        )}
        {!collapsed &&
          (open ? <ArrowUp2 size={12} /> : <ArrowDown2 size={12} />)}
        {collapsed && <RailTooltip label={item.label} accentColor={accentColor} />}
      </button>

      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          !collapsed && open ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="ml-4 mt-1 space-y-0.5 border-l border-sidebar-border/60 pl-2.5">
          {item.children?.map((child: SubItem) => {
            const childActive = location.pathname === child.path;
            return (
              <button
                key={child.path}
                onClick={() => navigate(child.path, child.state ? { state: child.state } : undefined)}
                className={`w-full flex justify-between items-center gap-2 text-[11px] px-2 py-1 rounded-md text-sidebar-foreground/70 transition-all duration-200 ${
                  childActive
                    ? ""
                    : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <span
                  className="shrink-0 w-1 h-1 rounded-full transition-colors"
                  style={{ background: childActive ? (accentColor || "hsl(var(--primary))") : "currentColor", opacity: childActive ? 1 : 0.4 }}
                />
                <NavLabel label={child.label} active={childActive} accentColor={accentColor} className="flex-1 text-left" />
                {child.badge && (
                  <span className="bg-blue-500 text-white text-[9px] font-bold min-w-[16px] h-[16px] flex items-center justify-center rounded-full">
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
                className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md text-[11px] text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              >
                <section.icon size={12} />
                <span className="flex-1 text-left truncate font-medium">
                  {section.label}
                </span>
                {openSections[section.label] ? (
                  <ArrowUp2 size={10} />
                ) : (
                  <ArrowDown2 size={10} />
                )}
              </button>
              <div
                className={`overflow-hidden transition-all duration-300 ease-out ${
                  openSections[section.label] ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                <div className="ml-3.5 mt-0.5 space-y-0.5">
                  {section.items.map((child: SubItem) => {
                    const sChildActive = location.pathname === child.path;
                    return (
                      <button
                        key={child.path}
                        onClick={() => navigate(child.path)}
                        className={`w-full flex items-center gap-2 text-[11px] px-2 py-1 rounded-md text-sidebar-foreground/70 transition-all duration-200 ${
                          sChildActive
                            ? ""
                            : "hover:bg-sidebar-accent"
                        }`}
                      >
                        <span
                          className="shrink-0 w-1 h-1 rounded-full transition-colors"
                          style={{ background: sChildActive ? (accentColor || "hsl(var(--primary))") : "currentColor", opacity: sChildActive ? 1 : 0.4 }}
                        />
                        <NavLabel label={child.label} active={sChildActive} accentColor={accentColor} className="flex-1 text-left" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
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
    <div className={collapsed ? "space-y-1.5" : "space-y-1"}>
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
    </div>
  );
};
