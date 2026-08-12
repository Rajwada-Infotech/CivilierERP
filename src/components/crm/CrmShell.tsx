import React from "react";
import { motion } from "framer-motion";
import { Users } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

interface CrmShellProps {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Shared glass-themed wrapper for all CRM module pages.
 * Provides ambient amber glow, frosted header band, and consistent layout —
 * same structure as FinanceShell/MaterialShell, tinted to match the CRM
 * module's established amber identity (previously borrowed from
 * SalesAutoShell — same #f59e0b accent, just under its own component now).
 */
export const CrmShell: React.FC<CrmShellProps> = ({
  title,
  subtitle,
  icon: PageIcon,
  action,
  children,
}) => {
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const glassCard = isDark
    ? {
        background: "rgba(15, 12, 3, 0.45)",
        border: "1px solid rgba(245,158,11,0.18)",
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        boxShadow:
          "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)",
      }
    : {
        background: "rgba(255,255,255,0.72)",
        border: "1px solid rgba(245,158,11,0.20)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        boxShadow:
          "0 8px 32px rgba(245,158,11,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
      };

  return (
    <div className="relative min-h-full p-3 space-y-3.5">
      {/* ── Ambient background orbs ─────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-0">
        {/* Top-left amber bloom */}
        <div
          className="absolute -top-24 -left-24 w-96 h-96 rounded-full"
          style={{
            background: isDark
              ? "radial-gradient(circle, rgba(245,158,11,0.10) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(245,158,11,0.07) 0%, transparent 70%)",
          }}
        />
        {/* Bottom-right amber/orange bloom */}
        <div
          className="absolute -bottom-32 -right-32 w-80 h-80 rounded-full"
          style={{
            background: isDark
              ? "radial-gradient(circle, rgba(217,119,6,0.08) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(217,119,6,0.05) 0%, transparent 70%)",
          }}
        />
        {/* Center faint glow */}
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-48 rounded-full"
          style={{
            background: isDark
              ? "radial-gradient(ellipse, rgba(245,158,11,0.04) 0%, transparent 70%)"
              : "radial-gradient(ellipse, rgba(245,158,11,0.03) 0%, transparent 70%)",
          }}
        />
      </div>

      {/* ── Glass page header ────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="relative z-30 rounded-xl px-4 py-3"
        style={glassCard}
      >
        {/* Inner top gradient */}
        <div
          className="absolute inset-0 pointer-events-none rounded-xl"
          style={{
            background:
              "linear-gradient(135deg, rgba(245,158,11,0.10) 0%, transparent 60%)",
          }}
        />
        {/* Left accent stripe */}
        <div
          className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-xl"
          style={{
            background:
              "linear-gradient(to bottom, transparent 10%, #f59e0b 30%, #f59e0b 70%, transparent 90%)",
          }}
        />

        <div className="relative z-10 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex items-center gap-2.5">
            {/* Icon badge */}
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{
                background: "rgba(245,158,11,0.18)",
                border: "1px solid rgba(245,158,11,0.35)",
                boxShadow: "0 0 12px rgba(245,158,11,0.2)",
              }}
            >
              {PageIcon
                ? <PageIcon size={14} style={{ color: "#fbbf24" }} />
                : <Users size={14} style={{ color: "#fbbf24" }} />
              }
            </div>
            <div>
              <h1
                className="text-sm font-heading font-bold"
                style={{ color: isDark ? "#fef3c7" : "#78350f" }}
              >
                {title}
              </h1>
              {subtitle && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      </motion.div>

      {/* ── Page content ────────────────────────────────────────────────── */}
      <div className="relative z-10 space-y-3.5 min-w-0">{children}</div>
    </div>
  );
};

/** Glass-styled stat card for CRM pages */
export const CrmGlassCard: React.FC<{
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: React.ElementType;
  accentColor?: string;
  onClick?: () => void;
  trend?: "up" | "down" | "neutral";
  children?: React.ReactNode;
}> = ({
  label,
  value,
  sub,
  icon: Icon,
  accentColor = "#f59e0b",
  onClick,
  trend,
  children,
}) => {
  const { theme } = useTheme();
  const isDark = theme !== "light";

  return (
    <motion.div
      whileHover={onClick ? { y: -2, scale: 1.01 } : undefined}
      whileTap={onClick ? { scale: 0.98 } : undefined}
      onClick={onClick}
      className={`relative rounded-xl overflow-hidden ${onClick ? "cursor-pointer" : ""}`}
      style={{
        background: isDark
          ? `rgba(15,12,3,0.5)`
          : `rgba(255,255,255,0.75)`,
        border: `1px solid ${accentColor}28`,
        backdropFilter: "blur(16px) saturate(150%)",
        WebkitBackdropFilter: "blur(16px) saturate(150%)",
        boxShadow: isDark
          ? `0 4px 20px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)`
          : `0 4px 20px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9)`,
      }}
    >
      {/* Top gradient tint */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `linear-gradient(135deg, ${accentColor}10 0%, transparent 60%)`,
        }}
      />
      {/* Left accent bar */}
      <div
        className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full"
        style={{ background: accentColor }}
      />
      {/* Subtle inner glow at top */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${accentColor}50, transparent)`,
        }}
      />

      <div className="relative z-10 p-3">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <p
            className="text-[10px] font-heading font-semibold uppercase tracking-widest"
            style={{ color: accentColor, opacity: 0.85 }}
          >
            {label}
          </p>
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
            style={{
              background: `${accentColor}18`,
              border: `1px solid ${accentColor}30`,
            }}
          >
            <Icon size={12} style={{ color: accentColor }} />
          </div>
        </div>

        <div
          className="text-xl font-bold font-heading"
          style={{ color: isDark ? "#f1f5f9" : "#78350f" }}
        >
          {value}
        </div>

        {sub && (
          <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
            {trend === "up" && (
              <span style={{ color: "#10b981" }}>↑</span>
            )}
            {trend === "down" && (
              <span style={{ color: "#ef4444" }}>↓</span>
            )}
            {sub}
          </p>
        )}
        {children}
      </div>
    </motion.div>
  );
};

/** Glass section divider with label */
export const CrmSection: React.FC<{
  title: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
  accentColor?: string;
}> = ({ title, icon: Icon, action, children, accentColor = "#f59e0b" }) => {
  const { theme } = useTheme();
  const isDark = theme !== "light";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {Icon && (
            <div
              className="w-5 h-5 rounded-md flex items-center justify-center"
              style={{
                background: `${accentColor}18`,
                border: `1px solid ${accentColor}30`,
              }}
            >
              <Icon size={12} style={{ color: accentColor }} />
            </div>
          )}
          <h2
            className="text-xs font-heading font-bold uppercase tracking-widest"
            style={{ color: isDark ? "#94a3b8" : "#64748b" }}
          >
            {title}
          </h2>
          <div
            className="flex-1 h-px ml-1"
            style={{
              background: `linear-gradient(90deg, ${accentColor}30, transparent)`,
              minWidth: 40,
            }}
          />
        </div>
        {action}
      </div>
      {children}
    </div>
  );
};
