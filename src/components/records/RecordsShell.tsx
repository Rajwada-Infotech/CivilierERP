import React from "react";
import { motion } from "framer-motion";
import { Archive } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

interface RecordsShellProps {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
}

const ACCENT = "#e11d48"; // rose — distinct from Sales Automation (amber)

export const RecordsShell: React.FC<RecordsShellProps> = ({
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
        border: `1px solid ${ACCENT}2E`,
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        boxShadow:
          "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)",
      }
    : {
        background: "rgba(255,255,255,0.72)",
        border: `1px solid ${ACCENT}33`,
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        boxShadow:
          "0 8px 32px rgba(225,29,72,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
      };

  return (
    <div className="relative min-h-full p-4 space-y-5">
      {/* Ambient background orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-0">
        <div
          className="absolute -top-24 -left-24 w-96 h-96 rounded-full"
          style={{
            background: isDark
              ? "radial-gradient(circle, rgba(225,29,72,0.12) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(225,29,72,0.08) 0%, transparent 70%)",
          }}
        />
        <div
          className="absolute -bottom-32 -right-32 w-80 h-80 rounded-full"
          style={{
            background: isDark
              ? "radial-gradient(circle, rgba(190,18,60,0.09) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(190,18,60,0.06) 0%, transparent 70%)",
          }}
        />
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-48 rounded-full"
          style={{
            background: isDark
              ? "radial-gradient(ellipse, rgba(225,29,72,0.05) 0%, transparent 70%)"
              : "radial-gradient(ellipse, rgba(225,29,72,0.04) 0%, transparent 70%)",
          }}
        />
      </div>

      {/* Glass page header */}
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
              "linear-gradient(135deg, rgba(225,29,72,0.12) 0%, transparent 60%)",
          }}
        />
        <div
          className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-2xl"
          style={{
            background:
              "linear-gradient(to bottom, transparent 10%, #e11d48 30%, #e11d48 70%, transparent 90%)",
          }}
        />

        <div className="relative z-10 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: "rgba(225,29,72,0.18)",
                border: "1px solid rgba(225,29,72,0.35)",
                boxShadow: "0 0 12px rgba(225,29,72,0.2)",
              }}
            >
              {PageIcon ? (
                <PageIcon size={16} style={{ color: "#fb7185" }} />
              ) : (
                <Archive size={16} style={{ color: "#fb7185" }} />
              )}
            </div>
            <div>
              <h1
                className="text-base font-heading font-bold"
                style={{ color: isDark ? "#fecdd3" : "#9f1239" }}
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

      {/* Page content */}
      <div className="relative z-10 space-y-5">{children}</div>
    </div>
  );
};

export const RECORDS_ACCENT = ACCENT;
