import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export type ProfileTab = {
  key: string;
  label: string;
  icon: React.ElementType;
};

interface ProfileShellProps {
  breadcrumbs: string[];
  initials: string;
  name: string;
  email: string;
  roleBadge: React.ReactNode;
  avatarGradient: string;
  avatarUrl?: string | null;
  onAvatarClick?: () => void;
  heroAccent: string;
  heroMesh: string; // CSS gradient string for hero mesh
  accentColor: string; // e.g. "violet" | "blue" | "emerald" | "slate"
  stats: { label: string; value: string | number; icon?: React.ElementType }[];
  tabs: ProfileTab[];
  activeTab: string;
  onTabChange: (t: string) => void;
  children: React.ReactNode;
}

export function ProfileShell({
  breadcrumbs,
  initials,
  name,
  email,
  roleBadge,
  avatarGradient,
  avatarUrl,
  onAvatarClick,
  accentColor,
  stats,
  tabs,
  activeTab,
  onTabChange,
  children,
}: ProfileShellProps) {
  return (
    <div className="max-w-5xl mx-auto space-y-0">
      <div className="mb-4">
        <Breadcrumbs items={breadcrumbs} />
      </div>

      {/* ── Header card ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="px-6 pt-6 pb-5 flex flex-col sm:flex-row sm:items-center gap-5">
          {/* Avatar */}
          <div className="relative shrink-0 group">
            <div
              className={`w-16 h-16 rounded-full flex items-center justify-center text-white text-lg font-heading font-bold select-none overflow-hidden ring-1 ring-border ${onAvatarClick ? "cursor-pointer" : ""}`}
              style={{ background: avatarUrl ? "transparent" : avatarGradient }}
              onClick={onAvatarClick}
              title={onAvatarClick ? "Click to change avatar" : undefined}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={name}
                  className="w-full h-full object-cover rounded-full"
                />
              ) : (
                initials
              )}
              {onAvatarClick && (
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-full flex items-center justify-center">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="2"
                  >
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </div>
              )}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-card" />
          </div>

          {/* Name / role / meta */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-heading font-bold text-foreground leading-none">
                {name}
              </h1>
              {roleBadge}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">{email}</p>
          </div>

          {/* Stats — quiet inline values, no boxed glass pills */}
          {stats.length > 0 && (
            <div className="flex items-center gap-5 sm:gap-6 shrink-0 pl-0 sm:pl-2">
              {stats.map((s) => (
                <div key={s.label} className="flex flex-col">
                  <span className="text-sm font-heading font-bold text-foreground leading-none">
                    {s.value}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 px-6 border-t border-border">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-3 text-xs font-heading font-semibold border-b-2 transition-colors -mb-px ${
                activeTab === tab.key
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground/80"
              }`}
            >
              <tab.icon size={13} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ───────────────────────────────────────────────────── */}
      <div className="pt-5">{children}</div>
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

interface ProfileSectionProps {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  headerRight?: React.ReactNode;
  onEdit?: () => void;
  children: React.ReactNode;
  noPadding?: boolean;
}

export function ProfileSection({
  title,
  subtitle,
  icon: Icon,
  headerRight,
  onEdit,
  children,
  noPadding,
}: ProfileSectionProps) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Icon size={13} className="text-muted-foreground" />
            </div>
          )}
          <div>
            <h2 className="text-sm font-heading font-semibold text-foreground leading-none">
              {title}
            </h2>
            {subtitle && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {headerRight}
          {onEdit && (
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold transition-all hover:opacity-90 active:scale-95 text-foreground bg-muted hover:bg-muted/80 border border-border"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </button>
          )}
        </div>
      </div>
      <div className={noPadding ? "" : "px-5 py-5"}>{children}</div>
    </div>
  );
}

// ── Field ─────────────────────────────────────────────────────────────────────

interface ProfileFieldProps {
  label: string;
  value: string | React.ReactNode;
  mono?: boolean;
}

export function ProfileField({ label, value, mono }: ProfileFieldProps) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground">
        {label}
      </p>
      <p
        className={`text-sm font-medium text-foreground ${mono ? "font-mono" : ""}`}
      >
        {value || "—"}
      </p>
    </div>
  );
}

export function ProfileFieldGrid({
  children,
  cols = 3,
}: {
  children: React.ReactNode;
  cols?: 2 | 3;
}) {
  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-2 ${cols === 3 ? "lg:grid-cols-3" : ""} gap-x-8 gap-y-5`}
    >
      {children}
    </div>
  );
}

// ── Shared password form ──────────────────────────────────────────────────────

interface PasswordFormProps {
  pw: { current: string; next: string; confirm: string };
  setPw: React.Dispatch<
    React.SetStateAction<{ current: string; next: string; confirm: string }>
  >;
  showPw: Record<string, boolean>;
  setShowPw: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  isPending: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

export function PasswordForm({
  pw,
  setPw,
  showPw,
  setShowPw,
  isPending,
  onSubmit,
  onCancel,
}: PasswordFormProps) {
  const pwMatch = pw.next && pw.confirm && pw.next === pw.confirm;
  const pwMismatch = pw.next && pw.confirm && pw.next !== pw.confirm;

  const inp =
    "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";

  return (
    <div className="space-y-3 max-w-md">
      {(["current", "next", "confirm"] as const).map((field) => (
        <div key={field}>
          <label className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5 block">
            {field === "current"
              ? "Current Password"
              : field === "next"
                ? "New Password"
                : "Confirm Password"}
          </label>
          <div className="relative">
            <input
              type={showPw[field] ? "text" : "password"}
              value={pw[field]}
              onChange={(e) =>
                setPw((p) => ({ ...p, [field]: e.target.value }))
              }
              className={`${inp} pr-10 ${field === "confirm" && pwMismatch ? "border-destructive" : field === "confirm" && pwMatch ? "border-emerald-500" : ""}`}
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => ({ ...s, [field]: !s[field] }))}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPw[field] ? (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </div>
      ))}
      {pwMismatch && (
        <p className="text-[11px] text-destructive">Passwords do not match</p>
      )}
      {pwMatch && (
        <p className="text-[11px] text-emerald-600 flex items-center gap-1">
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Passwords match
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onSubmit}
          disabled={!pw.current || !pwMatch || isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-all"
        >
          {isPending ? (
            <svg
              width="13"
              height="13"
              className="animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          )}
          Update Password
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
