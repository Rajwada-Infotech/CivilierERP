// Shared pieces of the Activity Browser: drawing-sheet ink styles, the event and role marks,
// and the small formatters both views use.
import React, { useEffect, useState } from "react";
import { parseDeviceInfo } from "@/utils/deviceFingerprint";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
export const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
export const RULE = "1px solid hsl(var(--foreground))";
export const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
export const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
export const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
export const INPUT = "w-full border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none";
export const SELECT = "h-8 border border-foreground/40 focus:border-foreground bg-card pl-3 pr-8 text-xs text-foreground outline-none appearance-none";
/** A small squared choice chip; filled in ink when chosen. */
export const chip = (on: boolean) =>
  `h-7 px-2.5 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] border transition-colors ${
    on ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"
  }`;

const TAG = "inline-flex items-center shrink-0 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap";

// How each kind of event is drawn: a change that adds is inked solid, one that alters is an ink outline,
// a delete is the one red, and looking around (pages opened, sign-ins) stays faint.
const KIND_INK: Record<string, string> = {
  create: "bg-foreground text-card border-foreground",
  update: "text-foreground border-foreground",
  delete: "text-destructive border-destructive",
  export: "text-foreground border-dashed border-foreground/60",
  settings_change: "text-foreground border-dashed border-foreground/60",
  read: "text-muted-foreground border-foreground/25",
  login: "text-muted-foreground border-foreground/25",
  logout: "text-muted-foreground border-foreground/25",
};

export const kindLabel = (kind: string) => (kind === "settings_change" ? "settings" : kind === "read" ? "opened" : kind);

export const KindTag: React.FC<{ kind: string; label?: string }> = ({ kind, label }) => (
  <span className={`${TAG} ${KIND_INK[kind] ?? KIND_INK.read}`}>{label ?? kindLabel(kind)}</span>
);

export function roleLabel(role: string) {
  const map: Record<string, string> = { super_admin: "Super Admin", admin: "Admin", user: "User", dba: "DBA" };
  return map[role] || role.replace(/_/g, " ");
}

export const RoleTag: React.FC<{ role: string }> = ({ role }) => (
  <span className={`${TAG} text-foreground border-foreground/40`}>{roleLabel(role)}</span>
);

export function fmtDate(iso?: string) {
  if (!iso) return { date: "—", time: "—", relative: "" };
  const d = new Date(iso);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);
  let relative = "";
  if (diffMin < 1) relative = "just now";
  else if (diffMin < 60) relative = `${diffMin}m ago`;
  else if (diffH < 24) relative = `${diffH}h ago`;
  else if (diffD < 7) relative = `${diffD}d ago`;
  return {
    date: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
    relative,
  };
}

export function fmtDuration(ms?: number): string {
  if (!ms || ms <= 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function parseUA(ua: string = "") {
  const profile = parseDeviceInfo(ua);
  return { os: profile.os, browser: profile.browser, isMobile: profile.isMobile };
}

export function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() || "")
    .join("");
}

/** A row of figures in the sheet's ink: label, number, and a short note under it. */
export const Figures: React.FC<{ items: { label: string; value: number | string; note?: string; red?: boolean }[]; loading?: boolean }> = ({ items, loading }) => (
  <div className="bg-card" style={{ border: RULE }}>
    <div className={`statrow ${items.length === 4 ? "four" : ""}`} style={{ padding: "16px 16px 18px" }}>
      {items.map((x) => (
        <div key={x.label}>
          <p className="label" style={x.red ? { color: "var(--red)" } : undefined}>{x.label}</p>
          <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>
            {loading ? "…" : typeof x.value === "number" ? x.value.toLocaleString("en-IN") : x.value}
          </p>
          {x.note && <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>}
        </div>
      ))}
    </div>
  </div>
);

// Module-level cache — avatars rarely change mid-session, and every
// SessionCard would otherwise trigger its own /api/users fetch.
let avatarMapCache: Record<string, string> | null = null;
let avatarMapPromise: Promise<Record<string, string>> | null = null;

export function useUserAvatars() {
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>(avatarMapCache ?? {});

  useEffect(() => {
    if (avatarMapCache) {
      setAvatarMap(avatarMapCache);
      return;
    }
    if (!avatarMapPromise) {
      avatarMapPromise = fetchWithAuth("/api/users")
        .then((r) => (r.ok ? r.json() : []))
        .then((list: { id: number | string; avatar_url?: string | null }[]) => {
          const map: Record<string, string> = {};
          (Array.isArray(list) ? list : []).forEach((u) => {
            if (u.avatar_url) map[String(u.id)] = u.avatar_url;
          });
          avatarMapCache = map;
          return map;
        })
        .catch(() => ({}));
    }
    avatarMapPromise.then(setAvatarMap);
  }, []);

  return avatarMap;
}
