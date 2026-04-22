// src/components/layout/ProfileShell.tsx
// Redesigned profile shell — matches reference design with dark header + card grid

import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Camera } from "lucide-react";

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
  heroAccent: string;
  stats: { label: string; value: string | number }[];
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
  stats,
  tabs,
  activeTab,
  onTabChange,
  children,
}: ProfileShellProps) {
  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <Breadcrumbs items={breadcrumbs} />

      {/* ── Hero Card ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden border border-border shadow-sm bg-card">
        {/* Dark header band */}
        <div
          className="h-16 w-full"
          style={{
            background: "linear-gradient(135deg, #1a3a2a 0%, #1f4d35 50%, #163221 100%)",
          }}
        />

        {/* Profile info row */}
        <div className="px-6 pb-5 flex flex-col sm:flex-row sm:items-end gap-4 -mt-8">
          {/* Avatar with camera button */}
          <div className="relative flex-shrink-0">
            <div
              className={`w-[72px] h-[72px] rounded-full bg-gradient-to-br ${avatarGradient} flex items-center justify-center shadow-lg ring-4 ring-card text-white text-xl font-heading font-bold select-none`}
            >
              {initials}
            </div>
            <button
              className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-card border border-border flex items-center justify-center shadow-sm hover:bg-muted transition-colors"
              title="Change photo"
            >
              <Camera size={11} className="text-muted-foreground" />
            </button>
          </div>

          {/* Name + role */}
          <div className="flex-1 min-w-0 pb-1 mt-3 sm:mt-0">
            <h1 className="text-lg font-heading font-bold text-foreground leading-tight">
              {name}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-0.5">
              {roleBadge}
              {email && (
                <span className="text-xs text-muted-foreground">{email}</span>
              )}
            </div>
          </div>

          {/* Stats */}
          {stats.length > 0 && (
            <div className="flex items-center gap-5 pb-1 shrink-0">
              {stats.map((s, i) => (
                <React.Fragment key={s.label}>
                  {i > 0 && <div className="w-px h-8 bg-border" />}
                  <div className="text-center">
                    <p className="text-base font-heading font-bold text-foreground leading-none">
                      {s.value}
                    </p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">
                      {s.label}
                    </p>
                  </div>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <div className="flex gap-0.5 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-heading font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon size={13} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ───────────────────────────────────────────────── */}
      {children}
    </div>
  );
}

// ── Reusable section card matching the reference design ───────────────────────
interface ProfileSectionProps {
  title: string;
  onEdit?: () => void;
  children: React.ReactNode;
}

export function ProfileSection({ title, onEdit, children }: ProfileSectionProps) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Section header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h2 className="text-sm font-heading font-semibold text-foreground">
          {title}
        </h2>
        {onEdit && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all hover:opacity-90 active:scale-95"
            style={{ background: "linear-gradient(135deg, #f97316, #ea580c)" }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit
          </button>
        )}
      </div>
      {/* Fields grid */}
      <div className="px-6 py-5">
        {children}
      </div>
    </div>
  );
}

// ── Labeled field matching reference screenshot ────────────────────────────────
interface ProfileFieldProps {
  label: string;
  value: string | React.ReactNode;
}

export function ProfileField({ label, value }: ProfileFieldProps) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-medium text-foreground">{value || "—"}</p>
    </div>
  );
}

// ── Fields grid layout ────────────────────────────────────────────────────────
export function ProfileFieldGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5">
      {children}
    </div>
  );
}
