import React from "react";
import { motion } from "framer-motion";
import { useTheme } from "@/contexts/ThemeContext";

// Generic, color-parameterized version of FinanceShell/MaterialShell —
// those two are pixel-identical aside from hardcoded color constants, so
// every other module's dashboard should use this instead of copy-pasting
// a third near-duplicate. Pass `accentColor` (and optionally
// `secondaryColor` for the bottom-right bloom) to theme it per module.

interface GlassShellProps {
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
  accentColor: string;
  secondaryColor?: string;
}

/** Shared glass-themed wrapper for module dashboards. */
export const GlassShell: React.FC<GlassShellProps> = ({
  title,
  subtitle,
  icon: PageIcon,
  action,
  children,
  accentColor,
  secondaryColor,
}) => {
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const secondary = secondaryColor || accentColor;

  const glassCard = isDark
    ? {
        background: "rgba(15, 17, 26, 0.45)",
        border: `1px solid ${accentColor}2e`,
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        boxShadow:
          "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)",
      }
    : {
        background: "rgba(255,255,255,0.72)",
        border: `1px solid ${accentColor}33`,
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        boxShadow: `0 8px 32px ${accentColor}14, inset 0 1px 0 rgba(255,255,255,0.9)`,
      };

  return (
    <div className="relative min-h-full p-4 space-y-5">
      {/* ── Ambient background orbs ─────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-0">
        <div
          className="absolute -top-24 -left-24 w-96 h-96 rounded-full"
          style={{
            background: isDark
              ? `radial-gradient(circle, ${accentColor}1f 0%, transparent 70%)`
              : `radial-gradient(circle, ${accentColor}14 0%, transparent 70%)`,
          }}
        />
        <div
          className="absolute -bottom-32 -right-32 w-80 h-80 rounded-full"
          style={{
            background: isDark
              ? `radial-gradient(circle, ${secondary}17 0%, transparent 70%)`
              : `radial-gradient(circle, ${secondary}0f 0%, transparent 70%)`,
          }}
        />
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-48 rounded-full"
          style={{
            background: isDark
              ? `radial-gradient(ellipse, ${accentColor}0d 0%, transparent 70%)`
              : `radial-gradient(ellipse, ${accentColor}0a 0%, transparent 70%)`,
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
        <div
          className="absolute inset-0 pointer-events-none rounded-2xl"
          style={{
            background: `linear-gradient(135deg, ${accentColor}1f 0%, transparent 60%)`,
          }}
        />
        <div
          className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-2xl"
          style={{
            background: `linear-gradient(to bottom, transparent 10%, ${accentColor} 30%, ${accentColor} 70%, transparent 90%)`,
          }}
        />

        <div className="relative z-10 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: `${accentColor}2e`,
                border: `1px solid ${accentColor}59`,
                boxShadow: `0 0 12px ${accentColor}33`,
              }}
            >
              <PageIcon size={16} style={{ color: accentColor }} />
            </div>
            <div>
              <h1 className="text-base font-heading font-bold text-foreground">
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
      <div className="relative z-10 space-y-5">{children}</div>
    </div>
  );
};

/** Glass-styled stat card — generic version of FinanceGlassCard/MaterialGlassCard */
export const GlassCard: React.FC<{
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
        background: isDark ? "rgba(15,17,26,0.5)" : "rgba(255,255,255,0.75)",
        border: `1px solid ${accentColor}28`,
        backdropFilter: "blur(16px) saturate(150%)",
        WebkitBackdropFilter: "blur(16px) saturate(150%)",
        boxShadow: isDark
          ? "0 4px 20px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)"
          : "0 4px 20px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `linear-gradient(135deg, ${accentColor}10 0%, transparent 60%)`,
        }}
      />
      <div
        className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full"
        style={{ background: accentColor }}
      />
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
            {trend === "up" && <span style={{ color: "#10b981" }}>↑</span>}
            {trend === "down" && <span style={{ color: "#ef4444" }}>↓</span>}
            {sub}
          </p>
        )}
        {children}
      </div>
    </motion.div>
  );
};

/** Glass section divider with label — generic version of finance/material's GlassSection */
export const GlassSection: React.FC<{
  title: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
  accentColor?: string;
}> = ({ title, icon: Icon, action, children, accentColor = "#6366f1" }) => {
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
          <h2 className="text-xs font-heading font-bold uppercase tracking-widest text-muted-foreground">
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

/** Skeleton placeholder matching GlassCard's footprint, for loading states */
export const GlassCardSkeleton: React.FC = () => (
  <div className="rounded-xl overflow-hidden border border-border/40 bg-card/40 backdrop-blur-sm p-4">
    <div className="flex items-start justify-between mb-3">
      <div className="h-3 w-24 rounded bg-muted/60 animate-pulse" />
      <div className="h-7 w-7 rounded-lg bg-muted/60 animate-pulse" />
    </div>
    <div className="h-7 w-20 mb-2 rounded bg-muted/60 animate-pulse" />
    <div className="h-3 w-32 rounded bg-muted/60 animate-pulse" />
  </div>
);
