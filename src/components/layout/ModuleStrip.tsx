import React, { useState } from "react";
import ReactDOM from "react-dom";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight } from "lucide-react";
import {
  Bank,
  Box,
  Notepad,
  Message2,
  ShoppingCart,
  Building3,
  Chart21,
  Archive,
  VideoPlay,
  Shield,
  MoneyRecive,
} from "iconsax-react";
import { HardHat } from "lucide-react";
import { useModule } from "@/contexts/ModuleContext";
import { MODULE_DASHBOARD_ROUTES, Module } from "@/contexts/module.utils";
import { useAuth } from "@/contexts/AuthContext";
import { useSidebarState } from "./layoutContexts";
import { useTheme } from "@/contexts/ThemeContext";

// ── Module definitions ────────────────────────────────────────────────────────
// ringRgb: raw "r,g,b" used to build valid RGBA strings at runtime

// iconsax icons take a `variant` prop ("Bold"/"Outline"); lucide's HardHat
// doesn't know that prop but happily ignores extra ones via its ...rest
// spread, so this adapter just gives it the same call signature as the
// iconsax icons above so it drops into MODULES without special-casing the
// render below.
const HardHatIcon: React.FC<{ size?: number; variant?: string; className?: string; style?: React.CSSProperties }> = ({
  variant,
  ...rest
}) => <HardHat {...rest} />;

const MODULES = [
  {
    id: "finance" as Module,
    icon: Bank,
    label: "Finance",
    desc: "Ledger, payments & BRS",
    color: "#6366f1",
    bg: "rgba(99,102,241,0.22)",
    ringRgb: "99,102,241",
  },
  {
    id: "material" as Module,
    icon: Box,
    label: "Material",
    desc: "GRN, PO & inventory",
    color: "#10b981",
    bg: "rgba(16,185,129,0.22)",
    ringRgb: "16,185,129",
  },
  {
    id: "loan" as Module,
    icon: MoneyRecive,
    label: "Loan",
    desc: "Loan management (coming soon)",
    color: "#22c55e",
    bg: "rgba(34,197,94,0.22)",
    ringRgb: "34,197,94",
  },
  {
    id: "engineering" as Module,
    icon: HardHatIcon,
    label: "Engineering",
    desc: "Projects, work orders & site",
    color: "#f97316",
    bg: "rgba(249,115,22,0.22)",
    ringRgb: "249,115,22",
  },
  {
    id: "followup" as Module,
    icon: Notepad,
    label: "Follow-Up",
    desc: "Sales, agreements & CRM",
    color: "#0d9488",
    bg: "rgba(13,148,136,0.18)",
    ringRgb: "13,148,136",
  },
  {
    id: "ticket" as Module,
    icon: Message2,
    label: "Ticket",
    desc: "Support & issue tracking",
    color: "#ec4899",
    bg: "rgba(236,72,153,0.22)",
    ringRgb: "236,72,153",
  },
  {
    id: "sales" as Module,
    icon: ShoppingCart,
    label: "Sales",
    desc: "Sale orders & payments",
    color: "#a855f7",
    bg: "rgba(168,85,247,0.22)",
    ringRgb: "168,85,247",
  },
  {
    id: "civilworkdpr" as Module,
    icon: Building3,
    label: "Civil Work DPR",
    desc: "Internal operations workspace",
    color: "#0891b2",
    bg: "rgba(8,145,178,0.22)",
    ringRgb: "8,145,178",
  },
  {
    id: "sales-automation" as Module,
    icon: VideoPlay,
    label: "Sales Automation",
    desc: "Campaigns, leads & bookings",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.22)",
    ringRgb: "245,158,11",
  },
  {
    id: "crm" as Module,
    icon: Chart21,
    label: "CRM",
    desc: "Applications, bookings & agreements",
    color: "#0ea5e9",
    bg: "rgba(14,165,233,0.22)",
    ringRgb: "14,165,233",
  },
  // Records is always last — new modules get inserted above this entry
  {
    id: "records" as Module,
    icon: Archive,
    label: "Records",
    desc: "Every attachment, in one place",
    color: "#e11d48",
    bg: "rgba(225,29,72,0.18)",
    ringRgb: "225,29,72",
  },
];

const ADMIN_MODULE = {
  id: "admin" as Module,
  icon: Shield,
  label: "Admin",
  desc: "Users, rights & configuration",
  color: "#3b82f6",
  bg: "rgba(59,130,246,0.22)",
  ringRgb: "59,130,246",
};

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
  const isDark = theme !== "light";
  const role = currentUser?.role ?? "";
  const isAdminTier = ["super_admin", "admin", "dba"].includes(role);

  const activeModuleItem =
    [...MODULES, ADMIN_MODULE].find((m) => m.id === activeModule) ?? MODULES[0];
  const activeRingRgb = activeModuleItem.ringRgb;

  const { canAccessPage } = useAuth();
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  // Map each module to a representative page key that signals access.
  // A user with ANY view right in a module's page definitions will see that module.
  const MODULE_SAMPLE_PAGES: Record<string, string[]> = {
    finance:     ["finance-dashboard", "new-payment", "received-payment", "brs", "transactions", "expense-booking"],
    material:    ["material-dashboard", "purchase-orders", "grn-master", "material-request", "material-issues", "stock-ledger"],
    followup:    ["followup-dashboard", "followup-applications", "followup-bookings", "followup-agreements", "followup-demands"],
    engineering: ["engineering-dashboard", "boq", "engineering-work-order", "work-done", "dpr"],
    ticket:      ["ticket-dashboard", "tickets"],
    sales:       ["sale-order", "sale-invoice", "sales-payment"],
    civilworkdpr: ["civilworkdpr-dashboard"],
    "sales-automation": ["sa-social-media", "sa-campaigns", "sa-ads", "sa-leads", "sa-lead-distribution", "sa-inquiry", "sa-site-visits", "sa-marketing-invoices"],
  };

  const userHasModuleAccess = (moduleId: string): boolean => {
    if (isAdminTier) return true;
    const pages = MODULE_SAMPLE_PAGES[moduleId] ?? [];
    return pages.some((pk) => canAccessPage(pk as any));
  };

  // Filter regular modules; admin for admin-tier OR users with approval-inbox access
  const canAccessApprovalInbox = canAccessPage("approval-inbox" as any);
  const regularItems = MODULES.filter((m) => userHasModuleAccess(m.id));
  const adminItems = (isAdminTier || canAccessApprovalInbox) ? [ADMIN_MODULE] : [];

  const handleSwitch = async (mod: NonNullable<Module>) => {
    setTooltip(null);
    setCollapsed(false);
    if (activeModule === mod) return;
    setModuleSwitching(true);
    await new Promise((r) => setTimeout(r, 260));
    setActiveModule(mod);
    // Non-admin-tier users with only approval-inbox access land directly on the inbox
    const dest =
      mod === "admin" && !isAdminTier
        ? "/admin/approval/inbox"
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
        {/* ── Inner oval pill strip (fully rounded top + bottom) ───────────── */}
        <div
          className="relative flex-1 flex flex-col overflow-hidden rounded-[28px]"
          style={
            isDark
              ? {
                  background: "rgba(15, 17, 26, 0.52)",
                  border: "1px solid rgba(255,255,255,0.13)",
                  boxShadow:
                    "0 2px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.10)",
                  backdropFilter: "blur(22px) saturate(160%)",
                  WebkitBackdropFilter: "blur(22px) saturate(160%)",
                }
              : {
                  background: "rgba(255,255,255,0.42)",
                  border: "1px solid rgba(255,255,255,0.65)",
                  boxShadow:
                    "0 2px 16px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.85)",
                  backdropFilter: "blur(22px) saturate(180%)",
                  WebkitBackdropFilter: "blur(22px) saturate(180%)",
                }
          }
        >
          {/* Dot-grid overlay */}
          <div
            className="absolute inset-0 pointer-events-none z-0"
            style={{
              backgroundImage:
                "radial-gradient(circle, hsl(var(--foreground) / 0.10) 1px, transparent 1px)",
              backgroundSize: "14px 14px",
            }}
          />

          {/* Top radial glow — tracks active module color */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeModuleItem.id as string}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="absolute top-0 left-0 right-0 h-36 pointer-events-none z-0"
              style={{
                background: `radial-gradient(ellipse at 50% 0%, rgba(${activeRingRgb},0.45) 0%, rgba(${activeRingRgb},0.15) 40%, transparent 70%)`,
              }}
            />
          </AnimatePresence>

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
                src="/loader.gif"
                alt="Refresh"
                width={56}
                height={56}
                className="object-contain select-none"
                draggable={false}
              />
            </motion.button>
          </div>

          {/* Divider below logo */}
          <div className="mx-3 mb-1 h-px bg-gradient-to-r from-transparent via-foreground/30 to-transparent relative z-10" />

          {/* ── Scrollable icon region — regular + admin modules. Scrolls
              internally (instead of overflowing the pill) once there are
              too many modules for the viewport, so the footer's expand
              button below always stays fully visible, never clipped. ── */}
          <div className="relative z-10 flex-1 min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
              <div className="flex flex-col items-center my-1.5">
                {/* Top line */}
                <div
                  className="w-px h-5"
                  style={{
                    background: `linear-gradient(to bottom, transparent, rgba(${activeRingRgb},0.6))`,
                  }}
                />
                {/* Pulsing dot — subtle, no scale change, just opacity + soft glow */}
                <motion.div
                  className="rounded-full"
                  style={{
                    width: 5,
                    height: 5,
                    background: activeModuleItem.color,
                  }}
                  animate={{
                    opacity: [0.45, 1, 0.45],
                    boxShadow: [
                      `0 0 0px rgba(${activeRingRgb},0)`,
                      `0 0 5px 1px rgba(${activeRingRgb},0.70)`,
                      `0 0 0px rgba(${activeRingRgb},0)`,
                    ],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
                {/* Bottom line */}
                <div
                  className="w-px h-5"
                  style={{
                    background: `linear-gradient(to top, transparent, rgba(${activeRingRgb},0.6))`,
                  }}
                />
              </div>
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
                  className="relative flex items-center justify-center w-8 h-8 rounded-full
                    bg-primary/10 hover:bg-primary/20 border border-primary/30
                    text-primary transition-colors duration-150"
                  title="Expand menu"
                >
                  {/* Sonar rings — explicit RGBA, high opacity for all-theme visibility */}
                  <motion.span
                    className="absolute inset-0 rounded-full"
                    animate={{
                      boxShadow: [
                        "0 0 0 0px rgba(99,102,241,0.85)",
                        "0 0 0 5px rgba(99,102,241,0)",
                        "0 0 0 0px rgba(99,102,241,0.85)",
                      ],
                    }}
                    transition={{
                      duration: 1.8,
                      repeat: Infinity,
                      ease: "easeOut",
                    }}
                  />
                  <motion.span
                    className="absolute inset-0 rounded-full"
                    animate={{
                      boxShadow: [
                        "0 0 0 0px rgba(99,102,241,0.55)",
                        "0 0 0 9px rgba(99,102,241,0)",
                        "0 0 0 0px rgba(99,102,241,0.55)",
                      ],
                    }}
                    transition={{
                      duration: 1.8,
                      repeat: Infinity,
                      ease: "easeOut",
                      delay: 0.32,
                    }}
                  />
                  <ChevronRight size={13} strokeWidth={2.4} />
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
                {/* Explicit colors instead of the --popover/--card tokens —
                    those sit only a shade lighter than --background in this
                    theme, so the tooltip used to nearly vanish against the
                    page behind it. Matches the strip's own pill background
                    (also hardcoded rgba, same reason) rather than the washed
                    -out shared tokens. */}
                <div
                  className="rounded-xl shadow-2xl relative"
                  style={{
                    padding: "8px 14px",
                    minWidth: 150,
                    background: isDark ? "rgba(58,61,86,0.98)" : "rgba(255,255,255,0.98)",
                    border: isDark ? "1px solid rgba(255,255,255,0.22)" : "1px solid rgba(15,17,26,0.10)",
                    boxShadow: isDark
                      ? "0 8px 28px rgba(0,0,0,0.55)"
                      : "0 8px 28px rgba(15,17,26,0.18)",
                  }}
                >
                  <p className="text-[12px] font-semibold leading-snug" style={{ color: isDark ? "#f4f5f9" : "#14161f" }}>
                    {tooltip.label}
                  </p>
                  <p className="text-[10px] mt-0.5 leading-snug" style={{ color: isDark ? "rgba(244,245,249,0.62)" : "rgba(20,22,31,0.62)" }}>
                    {tooltip.desc}
                  </p>
                  <span
                    className="absolute top-1/2 -translate-y-1/2 -left-[5px] w-2.5 h-2.5 rotate-45"
                    style={{
                      background: isDark ? "rgba(58,61,86,0.98)" : "rgba(255,255,255,0.98)",
                      borderLeft: isDark ? "1px solid rgba(255,255,255,0.22)" : "1px solid rgba(15,17,26,0.10)",
                      borderBottom: isDark ? "1px solid rgba(255,255,255,0.22)" : "1px solid rgba(15,17,26,0.10)",
                    }}
                  />
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
  const { icon: Icon, color, bg, ringRgb } = item;

  // Build valid RGBA strings for each animation phase
  const ringSolid = `rgba(${ringRgb},0.80)`; // visible at origin
  const ringFade = `rgba(${ringRgb},0.00)`; // transparent at max spread
  const ringGlow = `rgba(${ringRgb},0.55)`; // icon drop-shadow

  // 42px ring — margin-based centering avoids CSS transform conflict with framer-motion
  const D = 42;
  const C = D / 2; // = 21

  return (
    <div className="w-full flex justify-center">
      <motion.button
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.88 }}
        transition={{ type: "spring", stiffness: 440, damping: 22 }}
        className="relative flex items-center justify-center rounded-full cursor-pointer group"
        style={{ width: 46, height: 46 }}
      >
        {/* ── Active background circle ──────────────────────────────────────── */}
        <AnimatePresence>
          {isActive && (
            <motion.span
              key="active-bg"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ type: "spring", stiffness: 480, damping: 28 }}
              className="absolute rounded-full pointer-events-none"
              style={{
                width: D,
                height: D,
                top: "50%",
                left: "50%",
                marginTop: -C,
                marginLeft: -C,
                background: bg,
              }}
            />
          )}
        </AnimatePresence>

        {/* ── Hover background for inactive ────────────────────────────────── */}
        {!isActive && (
          <span
            className="absolute rounded-full pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            style={{
              width: D,
              height: D,
              top: "50%",
              left: "50%",
              marginTop: -C,
              marginLeft: -C,
              background: "hsl(var(--sidebar-accent))",
            }}
          />
        )}

        {/* ── Sonar pulse rings — proper RGBA keyframes (no appended hex suffix) */}
        {isActive && (
          <>
            {/* Inner ring: 0px → 5px spread */}
            <motion.span
              className="absolute rounded-full pointer-events-none"
              style={{
                width: D,
                height: D,
                top: "50%",
                left: "50%",
                marginTop: -C,
                marginLeft: -C,
              }}
              animate={{
                boxShadow: [
                  `0 0 0 0px ${ringSolid}`,
                  `0 0 0 5px ${ringFade}`,
                  `0 0 0 0px ${ringSolid}`,
                ],
              }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
            />
            {/* Outer ring: 0px → 9px spread, delayed */}
            <motion.span
              className="absolute rounded-full pointer-events-none"
              style={{
                width: D,
                height: D,
                top: "50%",
                left: "50%",
                marginTop: -C,
                marginLeft: -C,
              }}
              animate={{
                boxShadow: [
                  `0 0 0 0px ${ringGlow}`,
                  `0 0 0 9px ${ringFade}`,
                  `0 0 0 0px ${ringGlow}`,
                ],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeOut",
                delay: 0.38,
              }}
            />
          </>
        )}

        <Icon
          size={18}
          variant={isActive ? "Bold" : "Outline"}
          className="relative z-10 transition-all duration-200"
          style={{
            color: isActive ? color : "hsl(var(--muted-foreground))",
            filter: isActive ? `drop-shadow(0 0 5px ${ringGlow})` : "none",
          }}
        />
      </motion.button>
    </div>
  );
}
