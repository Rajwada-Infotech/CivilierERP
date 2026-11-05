import React from "react";
import { motion } from "framer-motion";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useTheme, isLightTheme } from "@/contexts/ThemeContext";

export const ACCENT = "#e6195d"; // sales-automation — see the module palette in index.css

interface SalesAutoShellProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: string[];
  action?: React.ReactNode;
  children: React.ReactNode;
}

// Plain page header — breadcrumb, title, subtitle, action — on the app's own
// surface. The module accent stays for links/primary buttons only; it no
// longer tints the whole page.
export const SalesAutoShell: React.FC<SalesAutoShellProps> = ({
  title,
  subtitle,
  breadcrumbs,
  action,
  children,
}) => (
  <div className="min-h-full px-4 py-5 lg:px-6 space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pb-4 border-b border-border">
      <div className="min-w-0">
        {breadcrumbs && <Breadcrumbs items={breadcrumbs} className="mb-1.5" />}
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
    <div className="space-y-6">{children}</div>
  </div>
);

export const SalesAutoGlassCard: React.FC<{
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
  accentColor = ACCENT,
  onClick,
  trend,
  children,
}) => {
  const { theme } = useTheme();
  const isDark = !isLightTheme(theme);

  return (
    <motion.div
      whileHover={onClick ? { y: -2, scale: 1.01 } : undefined}
      whileTap={onClick ? { scale: 0.98 } : undefined}
      onClick={onClick}
      className={`relative rounded-xl overflow-hidden ${onClick ? "cursor-pointer" : ""}`}
      style={{
        background: isDark ? "rgba(15,12,3,0.5)" : "rgba(255,255,255,0.75)",
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
        style={{ background: `linear-gradient(135deg, ${accentColor}10 0%, transparent 60%)` }}
      />
      <div
        className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full"
        style={{ background: accentColor }}
      />
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accentColor}50, transparent)` }}
      />

      <div className="relative z-10 p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <p
            className="text-[0.625rem] font-heading font-semibold uppercase tracking-widest"
            style={{ color: accentColor, opacity: 0.85 }}
          >
            {label}
          </p>
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `${accentColor}18`, border: `1px solid ${accentColor}30` }}
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

export const SalesAutoSection: React.FC<{
  title: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
  accentColor?: string;
}> = ({ title, icon: Icon, action, children, accentColor = ACCENT }) => {
  const { theme } = useTheme();
  const isDark = !isLightTheme(theme);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {Icon && (
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center"
              style={{ background: `${accentColor}18`, border: `1px solid ${accentColor}30` }}
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
