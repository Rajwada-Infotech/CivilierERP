import React from "react";
import { motion } from "framer-motion";
import { Landmark } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

interface FinanceShellProps {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Shared glass-themed wrapper for all Finance module pages.
 * Provides ambient indigo glow, frosted header band, and consistent layout.
 */
export const FinanceShell: React.FC<FinanceShellProps> = ({
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
        background: "rgba(15, 17, 26, 0.45)",
        border: "1px solid rgba(99,102,241,0.18)",
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        boxShadow:
          "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)",
      }
    : {
        background: "rgba(255,255,255,0.72)",
        border: "1px solid rgba(99,102,241,0.20)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        boxShadow:
          "0 8px 32px rgba(99,102,241,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
      };

  return (
    <div className="relative min-h-full p-4 space-y-5">
      {/* ── Ambient background orbs ─────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-0">
        {/* Top-left indigo bloom */}
        <div
          className="absolute -top-24 -left-24 w-96 h-96 rounded-full"
          style={{
            background: isDark
              ? "radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)",
          }}
        />
        {/* Bottom-right violet bloom */}
        <div
          className="absolute -bottom-32 -right-32 w-80 h-80 rounded-full"
          style={{
            background: isDark
              ? "radial-gradient(circle, rgba(139,92,246,0.09) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 70%)",
          }}
        />
        {/* Center faint glow */}
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-48 rounded-full"
          style={{
            background: isDark
              ? "radial-gradient(ellipse, rgba(99,102,241,0.05) 0%, transparent 70%)"
              : "radial-gradient(ellipse, rgba(99,102,241,0.04) 0%, transparent 70%)",
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
              "linear-gradient(135deg, rgba(99,102,241,0.12) 0%, transparent 60%)",
          }}
        />
        {/* Left accent stripe */}
        <div
          className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-2xl"
          style={{
            background:
              "linear-gradient(to bottom, transparent 10%, #6366f1 30%, #6366f1 70%, transparent 90%)",
          }}
        />

        {/* flex-row only kicks in at lg — below that, a wide action cluster
            (several labeled buttons) has nowhere to go but to steal width
            from the title block, which has no explicit basis and so
            shrinks toward its word-wrap minimum, squeezing the subtitle
            down to one or two words per line. Stacking through the whole
            sm/md range sidesteps that; the action row's own flex-wrap
            still lets its buttons wrap sensibly once it has full width. */}
        <div className="relative z-10 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {/* Icon badge */}
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: "rgba(99,102,241,0.18)",
                border: "1px solid rgba(99,102,241,0.35)",
                boxShadow: "0 0 12px rgba(99,102,241,0.2)",
              }}
            >
              {PageIcon
                ? <PageIcon size={16} style={{ color: "#818cf8" }} />
                : <Landmark size={16} style={{ color: "#818cf8" }} />
              }
            </div>
            <div className="min-w-0">
              <h1
                className="text-base font-heading font-bold"
                style={{ color: isDark ? "#e0e7ff" : "#3730a3" }}
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
          {action && <div className="w-full lg:w-auto lg:shrink-0">{action}</div>}
        </div>
      </motion.div>

      {/* ── Page content ────────────────────────────────────────────────── */}
      <div className="relative z-10 space-y-5">{children}</div>
    </div>
  );
};

/** Glass-styled stat card for Finance pages */
export const FinanceGlassCard: React.FC<{
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
  accentColor = "#6366f1",
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
          ? `rgba(15,17,26,0.5)`
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
export const GlassSection: React.FC<{
  title: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
  accentColor?: string;
}> = ({ title, icon: Icon, action, children, accentColor = "#6366f1" }) => {
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
