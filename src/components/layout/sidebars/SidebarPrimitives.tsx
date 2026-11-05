import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ChromeIcons } from "@/components/icons/moduleIcons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Portal as TooltipPortal } from "@radix-ui/react-tooltip";

// Only one sidebar tooltip at a time: opening one closes any lingering one.
let closeActiveTooltip: (() => void) | null = null;

/** Shows the full text in a tooltip on hover, but only when the wrapped
 *  label is actually cut off ("…" / line-clamp). */
const OverflowTooltip = ({
  text,
  children,
}: {
  text: string;
  children: React.ReactElement;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip
        open={open}
        // Radix would open on any hover; opening is driven by the overflow
        // check below instead, so only honour close requests here.
        onOpenChange={() => {}}
      >
        <TooltipTrigger
          asChild
          onPointerEnter={(e) => {
            const t = e.currentTarget as HTMLElement;
            if (t.scrollWidth > t.clientWidth || t.scrollHeight > t.clientHeight + 1) {
              const close = () => setOpen(false);
              if (closeActiveTooltip && closeActiveTooltip !== close) closeActiveTooltip();
              closeActiveTooltip = close;
              setOpen(true);
            }
          }}
          onPointerLeave={() => setOpen(false)}
        >
          {children}
        </TooltipTrigger>
        {/* Portalled so the sidebar's overflow clipping can't cut it off. */}
        <TooltipPortal>
          <TooltipContent side="right" sideOffset={10} className="z-[100] max-w-xs text-xs">
            {text}
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </TooltipProvider>
  );
};

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

/** The item's number in the module's index ("01", "02" ...), in place of a bullet. The active one takes the
 *  module's hue; it also tells items apart in the collapsed rail, where there are no labels. */
const IndexMark = ({ index, active, accentColor }: { index: number; active: boolean; accentColor?: string }) => (
  <span
    className="shrink-0 font-heading tabular-nums text-[0.625rem] font-semibold leading-none transition-colors"
    style={{ width: 18, color: active ? accentColor || "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}
  >
    {String(index).padStart(2, "0")}
  </span>
);

/** Sub-items hang off a short rule; the active one's rule is longer and takes the module's hue. */
const SubMark = ({ active, accentColor }: { active: boolean; accentColor?: string }) => (
  <span
    className="shrink-0 transition-all duration-200"
    style={{
      width: active ? 12 : 6,
      height: active ? 2 : 1,
      background: active ? accentColor || "hsl(var(--primary))" : "currentColor",
      opacity: active ? 1 : 0.45,
    }}
  />
);

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
    className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 whitespace-nowrap px-3 py-1.5 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100"
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
  <span className="bg-foreground text-card font-heading text-[0.625rem] font-semibold tabular-nums min-w-[20px] h-[18px] px-1 flex items-center justify-center shrink-0">
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
  <OverflowTooltip text={label}>
  <span
    className={`relative inline-block min-w-0 max-w-full ${wrap ? "line-clamp-2 leading-tight" : "truncate"} ${className}`}
  >
    <span
      className={`transition-all duration-200 ease-out ${active ? "font-semibold text-foreground" : "font-normal"}`}
    >
      {label}
    </span>
    <span
      className="absolute left-0 right-0 -bottom-0.5 h-[2px] origin-left transition-transform duration-300 ease-out"
      style={{
        transform: active ? "scaleX(1)" : "scaleX(0)",
        background: accentColor || "hsl(var(--primary))",
      }}
    />
  </span>
  </OverflowTooltip>
);

// ─── NavButton ────────────────────────────────────────────────────────────────

export const NavButton = ({
  item,
  collapsed,
  isActive,
  accentColor,
  index = 1,
}: {
  item: NavItem;
  collapsed: boolean;
  isActive: boolean;
  accentColor?: string;
  index?: number;
}) => {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => item.path && navigate(item.path)}
      className={`group relative w-full flex items-center gap-2 transition-colors duration-150 ${
        item.isDashboard
          ? "px-2.5 py-2 mb-1 text-xs font-semibold"
          : "px-2.5 py-2 text-xs"
      } text-sidebar-foreground ${
        isActive ? "" : "hover:bg-primary/10"
      } ${collapsed ? "justify-center" : ""}`}
      style={isActive ? { background: `${accentColor || "#6366f1"}14`, boxShadow: `inset 3px 0 0 ${accentColor || "hsl(var(--primary))"}` } : undefined}
    >
      <IndexMark index={index} active={isActive} accentColor={accentColor} />
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
  index = 1,
}: {
  item: NavItem;
  collapsed: boolean;
  hasActiveChild: boolean;
  accentColor?: string;
  index?: number;
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
        className={`group relative w-full flex items-center gap-2 px-2.5 py-2 text-xs text-sidebar-foreground transition-colors duration-150 ${
          hasActiveChild ? "" : "hover:bg-primary/10"
        } ${collapsed ? "justify-center" : ""}`}
        style={hasActiveChild ? { boxShadow: `inset 3px 0 0 ${accentColor || "hsl(var(--primary))"}` } : undefined}
      >
        <IndexMark index={index} active={hasActiveChild} accentColor={accentColor} />
        {!collapsed && (
          <NavLabel
            label={item.label}
            active={hasActiveChild}
            accentColor={accentColor}
            className="flex-1 text-left"
          />
        )}
        {!collapsed &&
          (open ? <ChromeIcons.up size={13} /> : <ChromeIcons.down size={13} />)}
        {collapsed && <RailTooltip label={item.label} accentColor={accentColor} />}
      </button>

      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          !collapsed && open ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="ml-[18px] mt-1 mb-1 space-y-0.5 pl-2.5" style={{ borderLeft: "1px solid hsl(var(--border))" }}>
          {item.children?.map((child: SubItem) => {
            const childActive = location.pathname === child.path;
            return (
              <button
                key={child.path}
                onClick={() => navigate(child.path, child.state ? { state: child.state } : undefined)}
                className={`w-full flex justify-between items-center gap-2 text-[0.6875rem] px-2 py-1.5 text-sidebar-foreground/70 transition-colors duration-150 ${
                  childActive ? "" : "hover:bg-primary/10"
                }`}
              >
                <SubMark active={childActive} accentColor={accentColor} />
                <NavLabel label={child.label} active={childActive} accentColor={accentColor} className="flex-1 text-left" />
                {child.badge && (
                  <span className="bg-foreground text-card font-heading text-[0.5625rem] font-semibold tabular-nums min-w-[16px] h-[16px] px-0.5 flex items-center justify-center">
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
                className="w-full flex items-center gap-2 px-2 py-1.5 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground hover:bg-primary/10"
              >
                <OverflowTooltip text={section.label}>
                  <span className="flex-1 text-left truncate">
                    {section.label}
                  </span>
                </OverflowTooltip>
                {openSections[section.label] ? (
                  <ChromeIcons.up size={12} />
                ) : (
                  <ChromeIcons.down size={12} />
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
                        className={`w-full flex items-center gap-2 text-[0.6875rem] px-2 py-1.5 text-sidebar-foreground/70 transition-colors duration-150 ${
                          sChildActive ? "" : "hover:bg-primary/10"
                        }`}
                      >
                        <SubMark active={sChildActive} accentColor={accentColor} />
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
  // One link lit at a time: the one whose path matches the page most closely. A prefix match alone lit the
  // module's dashboard ("/finance") on every page under it ("/finance/contracts") as well as the page's own link.
  // A dashboard often sits at the module root (/finance, /sales-automation), so it lights only on that exact path —
  // a page under it with no link of its own lights nothing rather than the dashboard.
  const dashboards = new Set(items.filter((it) => it.isDashboard).map((it) => it.path));
  const covers = (path?: string) =>
    !!path && (path === "/" || dashboards.has(path) ? location.pathname === path : location.pathname === path || location.pathname.startsWith(path + "/"));
  // Group entries count too, so a page inside a group (Transaction › Payment) doesn't also light the dashboard.
  const allPaths = items.flatMap((it) => [it.path, ...(it.children ?? []).map((c) => c.path), ...(it.sections ?? []).flatMap((s) => s.items.map((x) => x.path))]);
  const activePath = allPaths
    .filter(covers)
    .reduce<string | undefined>((best, p) => (!best || (p || "").length > best.length ? p : best), undefined);
  return (
    <div className={collapsed ? "space-y-1.5" : "space-y-1"}>
      {items.map((item, i) =>
        item.children || item.sections ? (
          <NavGroup
            key={item.label}
            index={i + 1}
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
            index={i + 1}
            item={item}
            collapsed={collapsed}
            accentColor={accentColor}
            isActive={!!item.path && item.path === activePath}
          />
        ),
      )}
    </div>
  );
};
