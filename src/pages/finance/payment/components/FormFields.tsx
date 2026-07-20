import React from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { Link2, X } from "lucide-react";
import { MODE_STYLE } from "../constants";

export function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

export function SectionHeader({
  icon: Icon,
  label,
  badge,
}: {
  icon: React.ElementType;
  label: string;
  badge?: React.ReactNode;
}) {
  const { theme } = useTheme();
  const isDark = theme !== "light";
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
      style={{
        background: isDark ? "rgba(99,102,241,0.08)" : "rgba(99,102,241,0.06)",
        border: isDark
          ? "1px solid rgba(99,102,241,0.18)"
          : "1px solid rgba(99,102,241,0.15)",
      }}
    >
      <div
        className="flex items-center justify-center w-5 h-5 rounded-md shrink-0"
        style={{
          background: "rgba(99,102,241,0.18)",
          border: "1px solid rgba(99,102,241,0.28)",
        }}
      >
        <Icon size={11} style={{ color: "#818cf8" }} />
      </div>
      <p
        className="text-[10px] font-heading uppercase tracking-widest flex-1"
        style={{ color: isDark ? "#94a3b8" : "#6366f1" }}
      >
        {label}
      </p>
      {badge}
    </div>
  );
}

export function ReadOnlyField({
  value,
  placeholder,
}: {
  value: string;
  placeholder?: string;
}) {
  return (
    <div className="w-full px-3 py-2 rounded-lg text-sm bg-muted/30 border border-border/60 text-muted-foreground cursor-not-allowed truncate min-h-[38px] flex items-center">
      {value || (
        <span className="text-muted-foreground/50 italic text-xs">
          {placeholder ?? "Auto-filled"}
        </span>
      )}
    </div>
  );
}

export function AutoFillBanner({
  docNo,
  onClear,
  label = "Linked to expense",
}: {
  docNo: string;
  onClear: () => void;
  label?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-primary/5 border border-primary/20 px-4 py-2.5">
      <div className="flex items-center gap-2 min-w-0">
        <Link2 size={13} className="text-primary shrink-0" />
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-mono text-xs font-semibold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-md truncate">
          {docNo}
        </span>
      </div>
      <button
        onClick={onClear}
        className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        title="Clear expense link"
      >
        <X size={13} />
      </button>
    </div>
  );
}

export function ModeBadge({ mode }: { mode: string }) {
  const s = MODE_STYLE[mode] ?? {
    ring: "ring-border bg-muted",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-heading font-semibold ring-1 ${s.ring} ${s.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {mode || "—"}
    </span>
  );
}

export function InputField({
  icon: Icon,
  value,
  onChange,
  placeholder,
  type = "text",
  prefix,
  disabled,
}: {
  icon?: React.ElementType;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  prefix?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      {Icon && (
        <Icon
          size={13}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
      )}
      {prefix && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-semibold pointer-events-none">
          {prefix}
        </span>
      )}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full ${Icon || prefix ? "pl-8" : "pl-3"} pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground/60 disabled:opacity-60 disabled:cursor-not-allowed font-mono`}
      />
    </div>
  );
}
