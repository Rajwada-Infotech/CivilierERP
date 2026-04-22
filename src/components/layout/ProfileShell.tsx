// src/components/layout/ProfileShell.tsx
// Shared shell used by all profile pages — consistent hero + tabs + layout

import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export type ProfileTab = {
  key: string;
  label: string;
  icon: React.ElementType;
};

interface ProfileShellProps {
  breadcrumbs: string[];
  // Hero
  initials: string;
  name: string;
  email: string;
  roleBadge: React.ReactNode;
  avatarGradient: string; // tailwind gradient classes e.g. "from-violet-600 to-violet-400"
  heroAccent: string; // tailwind bg classes for the band e.g. "from-violet-600/20 via-primary/10"
  stats: { label: string; value: string | number }[];
  // Tabs
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
  heroAccent,
  stats,
  tabs,
  activeTab,
  onTabChange,
  children,
}: ProfileShellProps) {
  return (
    <div className="max-w-5xl mx-auto">
      <Breadcrumbs items={breadcrumbs} />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden border border-border bg-card mb-6">
        <div className={`h-20 bg-gradient-to-r ${heroAccent}`} />
        <div className="px-6 pb-5 -mt-9 flex flex-col sm:flex-row sm:items-end gap-4">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            <div
              className={`w-18 h-18 w-[72px] h-[72px] rounded-2xl bg-gradient-to-br ${avatarGradient} flex items-center justify-center shadow-lg ring-4 ring-card text-white text-xl font-heading font-bold select-none`}
            >
              {initials}
            </div>
          </div>

          {/* Name + email + badge */}
          <div className="flex-1 min-w-0 pb-1">
            <div className="flex flex-wrap items-center gap-2 mb-0.5">
              <h1 className="text-xl font-heading font-bold text-foreground truncate">
                {name}
              </h1>
              {roleBadge}
            </div>
            <p className="text-xs text-muted-foreground">{email}</p>
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

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex gap-0.5 mb-5 border-b border-border">
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

      {children}
    </div>
  );
}
