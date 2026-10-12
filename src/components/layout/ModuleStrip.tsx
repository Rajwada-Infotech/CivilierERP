import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import ReactDOM from "react-dom";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChromeIcons } from "@/components/icons/moduleIcons";
import { MODULES, ADMIN_MODULE } from "./moduleDefs";
import { useModule } from "@/contexts/ModuleContext";
import { MODULE_DASHBOARD_ROUTES, Module, firstAccessibleAdminPath, hasAnyAdminPageRight, isAdminTierRole, userHasModuleAccess as sharedUserHasModuleAccess } from "@/contexts/module.utils";
import { useAuth } from "@/contexts/AuthContext";
import { useSidebarState } from "./layoutContexts";
import { useTheme, isLightTheme } from "@/contexts/ThemeContext";

type TooltipState = {
  id: string;
  label: string;
  desc: string;
  y: number;
} | null;



// ── ModuleStrip ───────────────────────────────────────────────────────────────

export const ModuleStrip: React.FC = () => {
  const { activeModule, setActiveModule, setModuleSwitching } = useModule();
  const { collapsed, setCollapsed } = useSidebarState();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const isDark = !isLightTheme(theme);
  const role = currentUser?.role ?? "";
  const isAdminTier = isAdminTierRole(role);

  const activeModuleItem =
    [...MODULES, ADMIN_MODULE].find((m) => m.id === activeModule) ?? MODULES[0];
  const activeRingRgb = activeModuleItem.ringRgb;

  const { canAccessPage } = useAuth();
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  // ── "More icons below" scroll hint ────────────────────────────────────────
  // The icon region scrolls internally once there are too many modules for
  // the viewport (see the region below) — nothing else in the pill hints
  // that, so a collapsed sidebar can look like the module list simply ends.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const updateScrollHint = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hasOverflow = el.scrollHeight - el.clientHeight > 2;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
    setCanScrollDown(hasOverflow && !atBottom);
  }, []);

  // MODULE_SAMPLE_PAGES/userHasModuleAccess now live in module.utils.ts —
  // shared with useGlobalShortcuts.ts's Shift+key module switcher so both
  // agree on exactly who can reach which module.
  const userHasModuleAccess = (moduleId: string): boolean =>
    sharedUserHasModuleAccess(moduleId, isAdminTier, (pk) => canAccessPage(pk as any));

  // Filter regular modules; admin for admin-tier OR anyone with an Admin page ticked in Menu Rights
  const canAccessAnyAdminPage = hasAnyAdminPageRight((pk) => canAccessPage(pk as any));
  const regularItems = MODULES.filter((m) => userHasModuleAccess(m.id));
  const adminItems = (isAdminTier || canAccessAnyAdminPage) ? [ADMIN_MODULE] : [];

  useLayoutEffect(() => {
    updateScrollHint();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateScrollHint);
    ro.observe(el);
    window.addEventListener("resize", updateScrollHint);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateScrollHint);
    };
  }, [updateScrollHint, regularItems.length, adminItems.length]);

  const handleSwitch = async (mod: NonNullable<Module>) => {
    setTooltip(null);
    setCollapsed(false);
    if (activeModule === mod) return;
    setModuleSwitching(true);
    await new Promise((r) => setTimeout(r, 260));
    setActiveModule(mod);
    // Non-admin-tier users land on the first Admin page ticked for them (the Control Center needs its own tick)
    const dest =
      mod === "admin" && !isAdminTier
        ? firstAccessibleAdminPath((pk) => canAccessPage(pk as any)) ?? "/admin/approval/inbox"
        : MODULE_DASHBOARD_ROUTES[mod];
    navigate(dest);
    setTimeout(() => setModuleSwitching(false), 60);
  };

  const handleMouseEnter = (
    item: (typeof MODULES)[0],
    e: React.MouseEvent<HTMLButtonElement>,
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({
      id: item.id as string,
      label: item.label,
      desc: item.desc,
      y: rect.top + rect.height / 2,
    });
  };

  return (
    <>
      {/* ── Outer wrapper — tiny left gap (2px), small right gap, py for oval ── */}
      <div
        className="h-full w-full flex flex-col py-2"
        style={{ paddingLeft: 4, paddingRight: 4 }}
      >
        {/* ── The strip: a ruled sheet margin (square, ink border, faint grid) ── */}
        <div
          className="relative flex-1 flex flex-col overflow-hidden"
          style={{
            backgroundColor: "hsl(var(--card))",
            backgroundImage:
              "linear-gradient(hsl(var(--foreground) / 0.04) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground) / 0.04) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            border: "1.5px solid hsl(var(--foreground))",
          }}
        >
          {/* ── Logo / Refresh button ──────────────────────────────────────── */}
          <div className="relative z-10 flex justify-center items-center pt-5 pb-5">
            <motion.button
              type="button"
              title="Refresh"
              onClick={() => window.location.reload()}
              animate={{ rotate: [0, 8, -8, 0], scale: [1, 1.08, 1] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.9, rotate: 180 }}
              className="cursor-pointer rounded-full"
            >
              <img
                src="/loader.webp"
                alt="Refresh"
                width={56}
                height={56}
                className="object-contain select-none"
                draggable={false}
              />
            </motion.button>
          </div>

          {/* Rule below logo */}
          <div className="mb-1 h-px relative z-10" style={{ background: "hsl(var(--foreground))" }} />

          {/* ── Scrollable icon region — regular + admin modules. Scrolls
              internally (instead of overflowing the pill) once there are
              too many modules for the viewport, so the footer's expand
              button below always stays fully visible, never clipped. ── */}
          <div
            ref={scrollRef}
            onScroll={updateScrollHint}
            className="relative z-10 flex-1 min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {/* ── Regular module icons (finance → ticket) ───────────────────── */}
            <div className="flex flex-col items-center gap-2 pt-2 pb-1">
              {regularItems.map((item) => (
                <IconButton
                  key={item.id as string}
                  item={item}
                  isActive={activeModule === item.id}
                  onClick={() => handleSwitch(item.id as NonNullable<Module>)}
                  onMouseEnter={(e) => handleMouseEnter(item, e)}
                  onMouseLeave={() => setTooltip(null)}
                />
              ))}
            </div>

            {/* ── Separator between ticket and admin ────────────────────────────── */}
            {adminItems.length > 0 && (
              <div className="my-2 mx-3" style={{ borderTop: "1px dashed hsl(var(--border))" }} />
            )}

            {/* ── Admin icon (only for admin-tier) ──────────────────────────── */}
            <div className="flex flex-col items-center gap-2 pb-2">
              {adminItems.map((item) => (
                <IconButton
                  key={item.id as string}
                  item={item}
                  isActive={activeModule === item.id}
                  onClick={() => handleSwitch(item.id as NonNullable<Module>)}
                  onMouseEnter={(e) => handleMouseEnter(item, e)}
                  onMouseLeave={() => setTooltip(null)}
                />
              ))}
            </div>
          </div>

          {/* ── "More icons below" scroll hint — only shown once the icon
              region actually overflows and isn't already scrolled to the
              bottom; fades out as soon as either stops being true. A bare
              pulsing chevron sitting inside the fade, not a badge — a
              circle/border here reads as a floating button rather than a
              hint. ──────────────────────────────────────────────────────── */}
          <AnimatePresence>
            {canScrollDown && (
              <motion.div
                key="scroll-hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute left-0 right-0 z-20 flex flex-col items-center justify-end pointer-events-none"
                style={{ bottom: 64, height: 26 }}
              >
                {/* Fade so the last icon doesn't hard-clip against the hint */}
                <div
                  className="absolute inset-x-0 bottom-0 top-0"
                  style={{
                    background: "linear-gradient(to bottom, transparent, hsl(var(--card)) 75%)",
                  }}
                />
                <motion.div
                  animate={{ opacity: [0.4, 0.9, 0.4] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                  className="relative flex items-center justify-center pb-1"
                >
                  <ChromeIcons.down
                    size={13}
                    strokeWidth={2.6}
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Footer — h-16, expand button when collapsed (no border) ────── */}
          <div className="relative z-10 h-16 shrink-0 flex items-center justify-center">
            <AnimatePresence>
              {collapsed && (
                <motion.button
                  key="expand-btn"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ type: "spring", stiffness: 440, damping: 26 }}
                  onClick={() => setCollapsed(false)}
                  whileHover={{ scale: 1.14 }}
                  whileTap={{ scale: 0.88 }}
                  className="relative flex items-center justify-center w-8 h-8 text-foreground hover:bg-primary/10 transition-colors duration-150"
                  style={{ border: "1px solid hsl(var(--foreground))" }}
                  title="Expand menu"
                >
                  <ChromeIcons.right size={15} />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ── Tooltip via portal — escapes transform stacking context ──────────── */}
      {typeof document !== "undefined" &&
        ReactDOM.createPortal(
          <AnimatePresence>
            {tooltip && (
              <motion.div
                key={tooltip.id}
                initial={{ opacity: 0, x: -10, scale: 0.94 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -10, scale: 0.94 }}
                transition={{ duration: 0.14, ease: "easeOut" }}
                style={{
                  position: "fixed",
                  left: 86,
                  top: tooltip.y,
                  transform: "translateY(-50%)",
                  zIndex: 9999,
                  pointerEvents: "none",
                }}
              >
                <div
                  style={{
                    padding: "8px 12px",
                    minWidth: 150,
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--foreground))",
                    boxShadow: "4px 4px 0 hsl(var(--foreground) / 0.12)",
                  }}
                >
                  <p className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-foreground leading-snug">
                    {tooltip.label}
                  </p>
                  <p className="text-[0.6875rem] mt-1 leading-snug text-muted-foreground">
                    {tooltip.desc}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
};

// ── Icon button ───────────────────────────────────────────────────────────────

type ItemShape = {
  id: Module;
  icon: React.ElementType;
  label: string;
  color: string;
  bg: string;
  ringRgb: string; // "r,g,b" — used to build valid RGBA animation strings
};

function IconButton({
  item,
  isActive,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  item: ItemShape;
  isActive: boolean;
  onClick: () => void;
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseLeave: () => void;
}) {
  const { icon: Icon } = item;

  return (
    <div className="w-full flex justify-center">
      <motion.button
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        whileTap={{ scale: 0.92 }}
        className={`relative flex items-center justify-center cursor-pointer transition-colors duration-150 ${isActive ? "" : "hover:bg-primary/10"}`}
        style={{
          width: 42,
          height: 42,
          background: isActive ? "hsl(var(--foreground))" : undefined,
          border: isActive ? "1px solid hsl(var(--foreground))" : "1px solid transparent",
        }}
        aria-pressed={isActive}
      >
        {/* Red-pencil style tick on the active tile, in the theme's primary */}
        {isActive && (
          <span className="absolute -left-[7px] top-1/2 -translate-y-1/2" style={{ width: 4, height: 18, background: "hsl(var(--primary))" }} />
        )}
        <Icon
          size={18}
          variant={isActive ? "Bold" : "Outline"}
          className="relative z-10"
          style={{ color: isActive ? "hsl(var(--card))" : "hsl(var(--muted-foreground))" }}
        />
      </motion.button>
    </div>
  );
}
