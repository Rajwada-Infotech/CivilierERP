import React from "react";
import { motion } from "framer-motion";
import { Package } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

interface MaterialShellProps {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Shared glass-themed wrapper for all Material module pages.
 * Provides ambient emerald glow, frosted header band, and consistent layout.
 */
export const MaterialShell: React.FC<MaterialShellProps> = ({
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
        background: "rgba(10, 18, 15, 0.45)",
        border: "1px solid rgba(16,185,129,0.18)",
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        boxShadow:
          "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)",
      }
    : {
        background: "rgba(255,255,255,0.72)",
        border: "1px solid rgba(16,185,129,0.20)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        boxShadow:
          "0 8px 32px rgba(16,185,129,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
      };

  return (
    <div className="relative min-h-full p-4 space-y-5">
      {/* ── Ambient background orbs ─────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-0">
        {/* Top-left emerald bloom */}
        <div
          className="absolute -top-24 -left-24 w-96 h-96 rounded-full"
          style={{
            background: isDark
              ? "radial-gradient(circle, rgba(16,185,129,0.10) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 70%)",
          }}
        />
        {/* Bottom-right teal bloom */}
        <div
          className="absolute -bottom-32 -right-32 w-80 h-80 rounded-full"
          style={{
            background: isDark
              ? "radial-gradient(circle, rgba(20,184,166,0.08) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(20,184,166,0.05) 0%, transparent 70%)",
          }}
        />
        {/* Center faint glow */}
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-48 rounded-full"
          style={{
            background: isDark
              ? "radial-gradient(ellipse, rgba(16,185,129,0.04) 0%, transparent 70%)"
              : "radial-gradient(ellipse, rgba(16,185,129,0.03) 0%, transparent 70%)",
          }}
        />
      </div>

      {/* ── Glass page header ────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="relative z-30 rounded-2xl px-5 py-4"
        style={glassCard}
      >
        {/* Inner top gradient */}
        <div
          className="absolute inset-0 pointer-events-none rounded-2xl"
          style={{
            background:
              "linear-gradient(135deg, rgba(16,185,129,0.10) 0%, transparent 60%)",
          }}
        />
        {/* Left accent stripe */}
        <div
          className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-2xl"
          style={{
            background:
              "linear-gradient(to bottom, transparent 10%, #10b981 30%, #10b981 70%, transparent 90%)",
          }}
        />

        <div className="relative z-10 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex items-center gap-3">
            {/* Icon badge */}
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: "rgba(16,185,129,0.18)",
                border: "1px solid rgba(16,185,129,0.35)",
                boxShadow: "0 0 12px rgba(16,185,129,0.2)",
              }}
            >
              {PageIcon
                ? <PageIcon size={16} style={{ color: "#34d399" }} />
                : <Package size={16} style={{ color: "#34d399" }} />
              }
            </div>
            <div>
              <h1
                className="text-base font-heading font-bold"
                style={{ color: isDark ? "#d1fae5" : "#064e3b" }}
              >
                {title}
              </h1>
              {subtitle && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      </motion.div>

      {/* ── Page content ────────────────────────────────────────────────── */}
      <div className="relative z-10 space-y-5 min-w-0">{children}</div>
    </div>
  );
};

/** Glass-styled stat card for Material pages */
export const MaterialGlassCard: React.FC<{
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
  accentColor = "#10b981",
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
          ? `rgba(10,18,15,0.5)`
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

      <div className="relative z-10 p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <p
            className="text-[10px] font-heading font-semibold uppercase tracking-widest"
            style={{ color: accentColor, opacity: 0.85 }}
          >
            {label}
          </p>
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: `${accentColor}18`,
              border: `1px solid ${accentColor}30`,
            }}
          >
            <Icon size={13} style={{ color: accentColor }} />
          </div>
        </div>

        <div
          className="text-2xl font-bold font-heading"
          style={{ color: isDark ? "#f1f5f9" : "#1e1b4b" }}
        >
          {value}
        </div>

        {sub && (
          <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
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
export const MaterialSection: React.FC<{
  title: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
  accentColor?: string;
}> = ({ title, icon: Icon, action, children, accentColor = "#10b981" }) => {
  const { theme } = useTheme();
  const isDark = theme !== "light";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {Icon && (
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center"
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
