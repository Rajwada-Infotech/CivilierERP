import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SHEET_FRAME_CSS } from "@/components/sheet/Sheet";

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

// The profile pages drawn on the sheet: the frame's paper, rules and capitals around a title block (square avatar,
// name, role, email, and the figures on a ruled row), squared ink tabs, and sections as ruled boxes. Everything inside
// the frame is squared off by SHEET_FRAME_CSS; this adds the profile's own parts, and squares the avatar pop-up,
// which opens outside the frame.
const PROFILE_CSS = `
.sheet-frame .pf-avatar {
  width: 72px; height: 72px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; overflow: hidden;
  border: 1.5px solid var(--ink); background: hsl(var(--card)); color: var(--ink);
  font-family: "Sora", sans-serif; font-weight: 700; font-size: 22px; letter-spacing: -0.02em; position: relative;
}
.sheet-frame .pf-avatar img { width: 100%; height: 100%; object-fit: cover; }
.sheet-frame .pf-avatar .pf-cam { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: hsl(var(--foreground) / 0.55); color: hsl(var(--card)); opacity: 0; transition: opacity .15s; }
.sheet-frame .pf-avatar:hover .pf-cam { opacity: 1; }
.sheet-frame .pf-figure { font-family: "Sora", sans-serif; font-weight: 600; font-size: 20px; letter-spacing: -0.02em; line-height: 1; color: var(--ink); }
.sheet-frame .pf-tabs { display: inline-flex; flex-wrap: wrap; max-width: 100%; }
/* Badges and status dots on a profile read as square marks, like the rest of the sheet. */
.pf-sheet .rounded-full { border-radius: 0 !important; }
.sheet-frame .pf-tabs button { display: inline-flex; align-items: center; gap: 6px; }
.sheet-frame .pf-sec { border: 1px solid var(--rule); background: hsl(var(--card)); }
.sheet-frame .pf-sec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--ink); }
.sheet-frame .pf-mark { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  border: 1px solid var(--rule); color: var(--ink); background: hsl(var(--card)); }
.sheet-frame .pf-key { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid var(--ink);
  color: var(--ink); background: hsl(var(--card)); font-family: "Sora", sans-serif; font-weight: 600; font-size: 9.5px;
  letter-spacing: 0.12em; text-transform: uppercase; transition: background-color .15s, color .15s; }
.sheet-frame .pf-key:hover { background: var(--ink); color: hsl(var(--card)); }
.sheet-frame .pf-value { font-size: 14px; font-weight: 600; color: var(--ink); margin-top: 5px; }

.pf-modal { border-radius: 0 !important; border: 1.5px solid hsl(var(--foreground)) !important; box-shadow: 6px 6px 0 hsl(var(--foreground) / 0.14) !important; }
.pf-modal [class*="rounded-"]:not(.rounded-full), .pf-modal button, .pf-modal input { border-radius: 0 !important; }
.pf-modal .shadow-lg { box-shadow: none !important; }
`;

export function ProfileShell({
  breadcrumbs,
  initials,
  name,
  email,
  roleBadge,
  avatarUrl,
  onAvatarClick,
  stats,
  tabs,
  activeTab,
  onTabChange,
  children,
}: ProfileShellProps) {
  return (
    <div className="max-w-5xl mx-auto">
      <style>{SHEET_FRAME_CSS + PROFILE_CSS}</style>
      <div className="mb-4">
        <Breadcrumbs items={breadcrumbs} />
      </div>

      <div className="sheet-frame sheet-in pf-sheet">
        {/* ── Title block ──────────────────────────────────────────────────── */}
        <div style={{ padding: "20px 22px 18px" }}>
          <p className="label">CivilierERP · Profile</p>
          <div className="flex flex-col gap-5 mt-3">
            <div className="flex items-end gap-4 sm:gap-5 flex-1 min-w-0">
            <span
              className="pf-avatar"
              onClick={onAvatarClick}
              title={onAvatarClick ? "Click to change avatar" : undefined}
              style={{ cursor: onAvatarClick ? "pointer" : undefined }}
            >
              {avatarUrl ? <img src={avatarUrl} alt={name} /> : initials}
              {onAvatarClick && (
                <span className="pf-cam" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </span>
              )}
            </span>

            <div className="flex-1 min-w-0">
              <h1 className="title" style={{ fontSize: "clamp(22px, 2.8vw, 34px)", margin: 0, lineHeight: 1.08, overflowWrap: "anywhere" }}>{name}</h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 min-w-0">
                <span className="shrink-0 whitespace-nowrap">{roleBadge}</span>
                <span className="min-w-0 max-w-full truncate" title={email} style={{ fontSize: 13, color: "var(--ink-2)" }}>{email}</span>
              </div>
            </div>
            </div>

            {stats.length > 0 && (
              <div className={`statrow ${stats.length >= 4 ? "four" : ""} w-full pt-4`} style={{ minWidth: 0, borderTop: "1px solid var(--rule)" }}>
                {stats.map((s) => (
                  <div key={s.label}>
                    <p className="label">{s.label}</p>
                    <p className="pf-figure" style={{ marginTop: 6, textTransform: "capitalize", overflowWrap: "anywhere" }}>{typeof s.value === "string" ? s.value.replace(/_/g, " ") : s.value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div className="cell" style={{ paddingTop: 14, paddingBottom: 14 }}>
          <div className="seg pf-tabs">
            {tabs.map((tab) => (
              <button key={tab.key} type="button" onClick={() => onTabChange(tab.key)} className={activeTab === tab.key ? "on" : ""}>
                <tab.icon size={12} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab content ──────────────────────────────────────────────────── */}
        <div className="cell">{children}</div>
      </div>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

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
    <section className="pf-sec">
      <header className="pf-sec-head">
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && (
            <span className="pf-mark">
              <Icon size={13} />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="label" style={{ color: "var(--ink)", margin: 0 }}>{title}</h2>
            {subtitle && <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 3 }}>{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {headerRight}
          {onEdit && (
            <button type="button" onClick={onEdit} className="pf-key">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </button>
          )}
        </div>
      </header>
      <div className={noPadding ? "" : "px-4 py-4 sm:px-5 sm:py-5"}>{children}</div>
    </section>
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
    <div>
      <p className="label">{label}</p>
      <div className={`pf-value ${mono ? "font-mono" : ""}`}>{value || "—"}</div>
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
          <label className="label mb-1.5 block">
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
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </div>
      ))}
      {pwMismatch && (
        <p className="text-[0.6875rem] text-destructive">Passwords do not match</p>
      )}
      {pwMatch && (
        <p className="text-[0.6875rem] text-emerald-600 flex items-center gap-1">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Passwords match
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onSubmit}
          disabled={!pw.current || !pwMatch || isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg btn-module text-white text-sm font-semibold disabled:opacity-50 transition-all"
        >
          {isPending ? (
            <svg width="13" height="13" className="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
