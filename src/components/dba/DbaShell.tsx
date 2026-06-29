import React from "react";
import { motion } from "framer-motion";
import { Database } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

interface DbaShellProps {
  title: string;
  subtitle?: React.ReactNode;
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Shared glass-themed wrapper for all DBA module pages — mirrors
 * AdminShell/MaterialShell/FinanceShell so DBA gets the same ambient glow,
 * frosted header band, and consistent layout as every other module, tinted
 * to the DBA accent (#10b981, matching AppSidebar's MODULE_HEADER for "dba").
 */
export const DbaShell: React.FC<DbaShellProps> = ({
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
        background: "rgba(6, 20, 16, 0.45)",
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
        <div
          className="absolute -top-24 -left-24 w-96 h-96 rounded-full"
          style={{
            background: isDark
              ? "radial-gradient(circle, rgba(16,185,129,0.10) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 70%)",
          }}
        />
        <div
          className="absolute -bottom-32 -right-32 w-80 h-80 rounded-full"
          style={{
            background: isDark
              ? "radial-gradient(circle, rgba(45,212,191,0.08) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(45,212,191,0.05) 0%, transparent 70%)",
          }}
        />
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
        <div
          className="absolute inset-0 pointer-events-none rounded-2xl"
          style={{
            background:
              "linear-gradient(135deg, rgba(16,185,129,0.10) 0%, transparent 60%)",
          }}
        />
        <div
          className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-2xl"
          style={{
            background:
              "linear-gradient(to bottom, transparent 10%, #10b981 30%, #10b981 70%, transparent 90%)",
          }}
        />

        <div className="relative z-10 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: "rgba(16,185,129,0.18)",
                border: "1px solid rgba(16,185,129,0.35)",
                boxShadow: "0 0 12px rgba(16,185,129,0.2)",
              }}
            >
              {PageIcon ? (
                <PageIcon size={16} style={{ color: "#34d399" }} />
              ) : (
                <Database size={16} style={{ color: "#34d399" }} />
              )}
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
      <div className="relative z-10 space-y-5">{children}</div>
    </div>
  );
};
