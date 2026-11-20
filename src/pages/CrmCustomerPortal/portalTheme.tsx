// Shared design system for the Customer Portal — deliberately distinct from
// the internal staff ERP's utilitarian look. Customers see a formal record
// of their purchase, not another admin dashboard: ink/violet + antique gold,
// serif headings, monospaced reference numbers, paper-toned surfaces.
import React from "react";
import { DialogContent as ShadcnDialogContent, DialogTitle as ShadcnDialogTitle, DialogDescription as ShadcnDialogDescription } from "@/components/ui/dialog";

// These read from CSS custom properties (defaulted in index.css, overridden
// by applyPortalAccent() below) rather than fixed hex, so every component
// that imports them repaints instantly when a customer switches their
// accent theme on the Customer 360 page — including Radix Dialogs, which
// render into document.body outside this page's own DOM subtree.
export const INK = "var(--portal-ink)";
export const VIOLET_DEEP = "var(--portal-violet-deep)";
export const VIOLET = "var(--portal-violet)";
export const VIOLET_LIGHT = "var(--portal-violet-light)";
export const GOLD = "var(--portal-gold)";
export const GOLD_SOFT = "var(--portal-gold-soft)";

// Surface/text tokens flip with Light/Dark/System mode (applyPortalMode()
// below) — independent of the accent hue above. INK/VIOLET* stay fixed-dark
// on purpose: they're the sidebar gradient and solid button backgrounds
// (white text sits on them), not body text, so they must NOT invert in dark
// mode or those buttons would go light-on-light. Anything that renders as
// text/border ON a card surface uses these instead.
export const PORCELAIN = "var(--portal-bg)";
export const SURFACE = "var(--portal-surface)";
export const SURFACE_ALT = "var(--portal-surface-alt)";
export const HAIRLINE = "var(--portal-hairline)";
export const TEXT = "var(--portal-text)";
export const TEXT_MUTED = "var(--portal-text-muted)";
export const TEXT_FAINT = "var(--portal-text-faint)";

export type PortalMode = "light" | "dark" | "system";
export const PORTAL_MODE_STORAGE_KEY = "crm_portal_mode";

export function getStoredPortalMode(): PortalMode {
  try {
    const v = localStorage.getItem(PORTAL_MODE_STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

function resolveSystemMode(): "light" | "dark" {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Applies the actual light/dark surface, persists the *choice* (which may be
// "system"), and — for "system" — keeps listening so the portal follows the
// OS setting live instead of only checking it once at load.
let systemModeListener: ((e: MediaQueryListEvent) => void) | null = null;
export function applyPortalMode(mode: PortalMode) {
  const mql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (systemModeListener && mql) {
    mql.removeEventListener("change", systemModeListener);
    systemModeListener = null;
  }
  const resolved = mode === "system" ? resolveSystemMode() : mode;
  document.documentElement.setAttribute("data-portal-mode", resolved);
  if (mode === "system" && mql) {
    systemModeListener = (e) => document.documentElement.setAttribute("data-portal-mode", e.matches ? "dark" : "light");
    mql.addEventListener("change", systemModeListener);
  }
  try { localStorage.setItem(PORTAL_MODE_STORAGE_KEY, mode); } catch { /* private browsing */ }
}

export const PORTAL_ACCENTS: Record<string, { label: string; ink: string; violetDeep: string; violet: string; violetLight: string; gold: string; goldSoft: string }> = {
  gold:     { label: "Ink & Gold",      ink: "#1E0B42", violetDeep: "#2E1065", violet: "#4C1D95", violetLight: "#5B21B6", gold: "#C9A227", goldSoft: "rgba(201,162,39,0.10)" },
  emerald:  { label: "Emerald & Bronze",ink: "#052E22", violetDeep: "#064E3B", violet: "#0D6D52", violetLight: "#10B981", gold: "#B7935A", goldSoft: "rgba(183,147,90,0.12)" },
  sapphire: { label: "Sapphire & Amber",ink: "#0B1A3A", violetDeep: "#122A5C", violet: "#1E40AF", violetLight: "#3B82F6", gold: "#D9A441", goldSoft: "rgba(217,164,65,0.12)" },
  rose:     { label: "Wine & Rose Gold",ink: "#3A0A1E", violetDeep: "#5C1030", violet: "#9D174D", violetLight: "#BE185D", gold: "#C98A72", goldSoft: "rgba(201,138,114,0.12)" },
};
export const PORTAL_ACCENT_STORAGE_KEY = "crm_portal_accent";

export function getStoredPortalAccent(): string {
  try {
    const v = localStorage.getItem(PORTAL_ACCENT_STORAGE_KEY);
    return v && PORTAL_ACCENTS[v] ? v : "gold";
  } catch {
    return "gold";
  }
}

export function applyPortalAccent(key: string) {
  const a = PORTAL_ACCENTS[key] || PORTAL_ACCENTS.gold;
  const root = document.documentElement;
  root.style.setProperty("--portal-ink", a.ink);
  root.style.setProperty("--portal-violet-deep", a.violetDeep);
  root.style.setProperty("--portal-violet", a.violet);
  root.style.setProperty("--portal-violet-light", a.violetLight);
  root.style.setProperty("--portal-gold", a.gold);
  root.style.setProperty("--portal-gold-soft", a.goldSoft);
  try { localStorage.setItem(PORTAL_ACCENT_STORAGE_KEY, key); } catch { /* private browsing */ }
}

export const serif: React.CSSProperties = { fontFamily: "'Fraunces', serif" };
export const mono: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };

export function Mono({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span style={mono} className={className}>{children}</span>;
}

// Small-caps eyebrow + serif title, used at the top of every page.
export function PageHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <p className="text-[0.6875rem] font-semibold tracking-[0.18em] uppercase" style={{ color: GOLD }}>{eyebrow}</p>
      <h1 className="text-[1.625rem] sm:text-[1.75rem] font-semibold mt-1" style={{ ...serif, color: TEXT }}>{title}</h1>
      {subtitle && <p className="text-sm mt-1.5 max-w-xl" style={{ color: TEXT_MUTED }}>{subtitle}</p>}
    </div>
  );
}

export function Card({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`rounded-2xl ${className}`}
      style={{ background: SURFACE, border: `1px solid ${HAIRLINE}`, boxShadow: "0 1px 2px rgba(30,11,66,0.05)", ...style }}>
      {children}
    </div>
  );
}

export function CardHeader({ icon: Icon, title, action }: { icon: any; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
      <h2 className="text-sm font-semibold flex items-center gap-2.5" style={{ ...serif, color: TEXT }}>
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: GOLD_SOFT, color: GOLD }}>
          <Icon size={14} />
        </span>
        {title}
      </h2>
      {action}
    </div>
  );
}

export function InfoField({ label, value, mono: isMono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[0.625rem] uppercase tracking-wide" style={{ color: TEXT_FAINT }}>{label}</p>
      <p className="text-sm font-medium mt-1" style={{ color: TEXT, ...(isMono ? mono : {}) }}>{value ?? "—"}</p>
    </div>
  );
}

const STATUS_TONES: Record<string, { bg: string; fg: string }> = {
  Approved: { bg: "rgba(16,150,80,0.10)", fg: "#0F7A44" },
  Paid: { bg: "rgba(16,150,80,0.10)", fg: "#0F7A44" },
  Resolved: { bg: "rgba(16,150,80,0.10)", fg: "#0F7A44" },
  Closed: { bg: "rgba(16,150,80,0.10)", fg: "#0F7A44" },
  Welcomed: { bg: "rgba(16,150,80,0.10)", fg: "#0F7A44" },
  Confirmed: { bg: "rgba(16,150,80,0.10)", fg: "#0F7A44" },
  Completed: { bg: "rgba(16,150,80,0.10)", fg: "#0F7A44" },
  Issued: { bg: "rgba(16,150,80,0.10)", fg: "#0F7A44" },
  Pending: { bg: GOLD_SOFT, fg: "#8A6D14" },
  Open: { bg: GOLD_SOFT, fg: "#8A6D14" },
  NotApplied: { bg: GOLD_SOFT, fg: "#8A6D14" },
  InProgress: { bg: "rgba(76,29,149,0.08)", fg: VIOLET },
  InfoSent: { bg: "rgba(76,29,149,0.08)", fg: VIOLET },
  Scheduled: { bg: "rgba(76,29,149,0.08)", fg: VIOLET },
  RecheckRequested: { bg: "rgba(190,50,60,0.10)", fg: "#A32C36" },
  Rejected: { bg: "rgba(190,50,60,0.10)", fg: "#A32C36" },
  Overdue: { bg: "rgba(190,50,60,0.10)", fg: "#A32C36" },
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const tone = STATUS_TONES[status] || { bg: SURFACE_ALT, fg: TEXT_MUTED };
  return (
    <span className="text-[0.6875rem] font-semibold px-2.5 py-1 rounded-full" style={{ background: tone.bg, color: tone.fg }}>
      {label || status}
    </span>
  );
}

// The staff ERP supports a switchable "glass"/dark theme driven by CSS
// variables (see [data-theme="glass"] rules in index.css) that shadcn's
// Dialog reads via bg-background/text-foreground. That's fine for internal
// tooling, but the customer portal is not theme-aware anywhere else — every
// page is hardcoded light/porcelain — so if a browser happens to carry a
// dark/glass theme flag, the default Dialog silently goes dark-on-dark
// while our own ink/gold text and card backgrounds stay light, producing
// unreadable contrast. These wrappers pin every portal dialog to the same
// fixed light surface the rest of the portal already uses, independent of
// whatever theme is active elsewhere in the app.
export function PortalDialogContent({ className = "", style, children, ...props }: React.ComponentProps<typeof ShadcnDialogContent>) {
  return (
    <ShadcnDialogContent className={className} style={{ background: SURFACE, color: TEXT, borderColor: HAIRLINE, ...style }} {...props}>
      {children}
    </ShadcnDialogContent>
  );
}
export function PortalDialogTitle({ className = "", ...props }: React.ComponentProps<typeof ShadcnDialogTitle>) {
  return <ShadcnDialogTitle className={className} style={{ ...serif, color: TEXT }} {...props} />;
}
export function PortalDialogDescription({ className = "", ...props }: React.ComponentProps<typeof ShadcnDialogDescription>) {
  return <ShadcnDialogDescription className={className} style={{ color: TEXT_MUTED }} {...props} />;
}

export type StepState = "done" | "current" | "upcoming" | "blocked";

// A horizontal lifecycle stepper — used to show a customer exactly where a
// document (agreement, sales deed) sits in its approval chain, since a bare
// status pill doesn't communicate "what already happened" vs "what's next."
export function Stepper({ steps }: { steps: { label: string; state: StepState; note?: string }[] }) {
  return (
    <div className="flex items-start w-full overflow-x-auto pb-1">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-start" style={{ minWidth: 0 }}>
          <div className="flex flex-col items-center text-center" style={{ width: 92 }}>
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[0.6875rem] font-semibold shrink-0"
              style={
                s.state === "done" ? { background: INK, color: "#fff" }
                : s.state === "current" ? { background: GOLD_SOFT, color: GOLD, border: `2px solid ${GOLD}` }
                : s.state === "blocked" ? { background: "rgba(190,50,60,0.10)", color: "#A32C36" }
                : { background: SURFACE_ALT, color: TEXT_FAINT }
              }
            >
              {s.state === "done" ? "✓" : i + 1}
            </div>
            <p className="text-[0.6562rem] font-medium mt-1.5 leading-tight" style={{ color: s.state === "upcoming" ? TEXT_FAINT : TEXT }}>{s.label}</p>
            {s.note && <p className="text-[0.5938rem] leading-tight mt-0.5" style={{ color: TEXT_FAINT }}>{s.note}</p>}
          </div>
          {i < steps.length - 1 && (
            <div className="h-[2px] mt-3.5 shrink-0" style={{ width: 28, background: s.state === "done" ? INK : HAIRLINE }} />
          )}
        </div>
      ))}
    </div>
  );
}

// A hairline gold rail on the left edge — the one repeated motif tying the
// sidebar's active-nav indicator to the Record Card border to section
// dividers, instead of scattering unrelated accent treatments everywhere.
export function GoldRail({ className = "" }: { className?: string }) {
  return <span className={`block w-0.5 rounded-full ${className}`} style={{ background: GOLD }} />;
}


// --- PREMIUM DESIGN SYSTEM v2 ------------------------------------------------

// HeroStrip: Full-width gradient hero at the top of every page
// Use instead of PageHeader for a more premium feel
export function HeroStrip({
  eyebrow,
  title,
  subtitle,
  children,
  gradient = "violet",
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  gradient?: "violet" | "gold" | "green" | "red";
}) {
  const gradients = {
    violet: `linear-gradient(135deg, var(--portal-ink) 0%, var(--portal-violet-deep) 50%, var(--portal-violet) 100%)`,
    gold: `linear-gradient(135deg, #2D1A00 0%, #5A3800 50%, #8A5C00 100%)`,
    green: `linear-gradient(135deg, #052E22 0%, #064E3B 50%, #065F46 100%)`,
    red: `linear-gradient(135deg, #3B0A0A 0%, #5C1010 50%, #7F1D1D 100%)`,
  };
  return (
    <div
      className="relative -mx-5 lg:-mx-8 -mt-5 lg:-mt-8 mb-6 px-6 lg:px-10 pt-8 pb-6 overflow-hidden"
      style={{ background: gradients[gradient] }}
    >
      {/* Dot grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      {/* Glow blob */}
      <div
        className="absolute top-0 right-0 w-64 h-64 rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(201,162,39,0.18) 0%, transparent 70%)",
          transform: "translate(30%, -40%)",
        }}
      />
      <div className="relative z-10">
        <p className="text-[0.6875rem] font-semibold tracking-[0.18em] uppercase mb-1" style={{ color: "rgba(201,162,39,0.85)" }}>
          {eyebrow}
        </p>
        <h1 className="text-2xl sm:text-[1.75rem] font-semibold text-white leading-tight" style={{ fontFamily: "'Fraunces', serif" }}>
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm mt-1.5 text-white/60 max-w-xl">{subtitle}</p>
        )}
        {children && <div className="mt-5">{children}</div>}
      </div>
    </div>
  );
}

// GlassCard: Frosted-glass card for premium info panels
export function GlassCard({
  children,
  className = "",
  style,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`rounded-2xl ${onClick ? "w-full text-left cursor-pointer hover:shadow-lg transition-all active:scale-[0.99]" : ""} ${className}`}
      style={{
        background: "rgba(255,255,255,0.07)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderTop: "1px solid rgba(255,255,255,0.22)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.1)",
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

// HeroStatCard: Large number stat for use inside HeroStrip
export function HeroStatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{
        background: highlight ? "rgba(201,162,39,0.18)" : "rgba(255,255,255,0.08)",
        border: highlight ? "1px solid rgba(201,162,39,0.4)" : "1px solid rgba(255,255,255,0.12)",
      }}
    >
      <p className="text-[0.625rem] font-semibold uppercase tracking-widest mb-1" style={{ color: highlight ? "rgba(201,162,39,0.9)" : "rgba(255,255,255,0.55)" }}>
        {label}
      </p>
      <p className="text-xl font-semibold text-white leading-tight tabular-nums" style={{ fontFamily: "'Fraunces', serif" }}>
        {value}
      </p>
      {sub && <p className="text-[0.6875rem] mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>{sub}</p>}
    </div>
  );
}

// PulseBar: Animated progress bar with optional shimmer
export function PulseBar({
  pct,
  color,
  height = 10,
  animated = true,
}: {
  pct: number;
  color?: string;
  height?: number;
  animated?: boolean;
}) {
  const barColor = color || "var(--portal-gold)";
  return (
    <div
      className="w-full rounded-full overflow-hidden"
      style={{ height, background: "var(--portal-hairline)" }}
    >
      <div
        className="h-full rounded-full relative overflow-hidden"
        style={{
          width: `${Math.min(100, Math.max(0, pct))}%`,
          background: barColor,
          transition: "width 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {animated && (
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)",
              animation: "shimmer 2s infinite",
              backgroundSize: "200% 100%",
            }}
          />
        )}
      </div>
    </div>
  );
}

// RingProgress: SVG donut/ring progress for construction page
export function RingProgress({
  pct,
  size = 120,
  strokeWidth = 10,
  color,
  label,
  sublabel,
}: {
  pct: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
  sublabel?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const ringColor = color || "var(--portal-gold)";
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--portal-hairline)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={ringColor} strokeWidth={strokeWidth}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.16, 1, 0.3, 1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-2xl font-semibold tabular-nums" style={{ fontFamily: "'Fraunces', serif", color: "var(--portal-text)" }}>
          {pct}%
        </span>
        {label && <span className="text-[0.6875rem] font-medium mt-0.5" style={{ color: "var(--portal-text-muted)" }}>{label}</span>}
        {sublabel && <span className="text-[0.625rem]" style={{ color: "var(--portal-text-faint)" }}>{sublabel}</span>}
      </div>
    </div>
  );
}

// UrgencyBanner: Full-width alert banner for overdue or action-needed states
export function UrgencyBanner({
  icon: Icon,
  title,
  sub,
  cta,
  onCta,
  level = "warning",
}: {
  icon: any;
  title: string;
  sub?: string;
  cta?: string;
  onCta?: () => void;
  level?: "warning" | "error" | "info" | "success";
}) {
  const themes = {
    warning: { bg: "rgba(201,162,39,0.10)", border: "rgba(201,162,39,0.35)", iconBg: "rgba(201,162,39,0.18)", iconColor: "var(--portal-gold)", titleColor: "#7A5C0A", subColor: "#8A6D14", ctaBg: "var(--portal-gold)", ctaColor: "#1E0B42" },
    error: { bg: "rgba(220,38,38,0.07)", border: "rgba(220,38,38,0.3)", iconBg: "rgba(220,38,38,0.14)", iconColor: "#DC2626", titleColor: "#991B1B", subColor: "#B91C1C", ctaBg: "#DC2626", ctaColor: "#fff" },
    info: { bg: "rgba(76,29,149,0.07)", border: "rgba(76,29,149,0.25)", iconBg: "rgba(76,29,149,0.12)", iconColor: "var(--portal-violet-light)", titleColor: "var(--portal-ink)", subColor: "var(--portal-text-muted)", ctaBg: "var(--portal-ink)", ctaColor: "#fff" },
    success: { bg: "rgba(16,150,80,0.07)", border: "rgba(16,150,80,0.25)", iconBg: "rgba(16,150,80,0.14)", iconColor: "#059669", titleColor: "#065F46", subColor: "#047857", ctaBg: "#059669", ctaColor: "#fff" },
  };
  const t = themes[level];
  return (
    <div
      className="rounded-2xl p-4 flex items-center gap-4"
      style={{ background: t.bg, border: `1.5px solid ${t.border}` }}
    >
      <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: t.iconBg, color: t.iconColor }}>
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: t.titleColor }}>{title}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color: t.subColor }}>{sub}</p>}
      </div>
      {cta && onCta && (
        <button
          onClick={onCta}
          className="shrink-0 px-4 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-85"
          style={{ background: t.ctaBg, color: t.ctaColor }}
        >
          {cta}
        </button>
      )}
    </div>
  );
}

// TimelineRow: Premium vertical timeline entry
export function TimelineRow({
  icon: Icon,
  title,
  detail,
  time,
  type = "default",
  isLast = false,
  onClick,
}: {
  icon: any;
  title: string;
  detail?: string;
  time?: string;
  type?: "agreement" | "payment" | "document" | "ticket" | "default";
  isLast?: boolean;
  onClick?: () => void;
}) {
  const typeStyles: Record<string, { iconBg: string; iconColor: string; lineColor: string }> = {
    agreement: { iconBg: "rgba(76,29,149,0.10)", iconColor: "var(--portal-violet-light)", lineColor: "var(--portal-violet-light)" },
    payment: { iconBg: "rgba(201,162,39,0.12)", iconColor: "var(--portal-gold)", lineColor: "var(--portal-gold)" },
    document: { iconBg: "rgba(16,150,80,0.10)", iconColor: "#059669", lineColor: "#059669" },
    ticket: { iconBg: "rgba(220,38,38,0.08)", iconColor: "#DC2626", lineColor: "#DC2626" },
    default: { iconBg: "var(--portal-surface-alt)", iconColor: "var(--portal-text-muted)", lineColor: "var(--portal-hairline)" },
  };
  const s = typeStyles[type] || typeStyles.default;
  const Tag = onClick ? "button" : "div";
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 z-10" style={{ background: s.iconBg, color: s.iconColor }}>
          <Icon size={16} />
        </div>
        {!isLast && <div className="w-px flex-1 mt-2" style={{ background: "var(--portal-hairline)" }} />}
      </div>
      <Tag
        onClick={onClick}
        className={`flex-1 pb-5 min-w-0 ${onClick ? "text-left hover:opacity-80 transition-opacity" : ""}`}
      >
        <p className="text-sm font-semibold leading-snug" style={{ color: "var(--portal-text)", fontFamily: "'Fraunces', serif" }}>
          {title}
        </p>
        {detail && <p className="text-xs mt-0.5" style={{ color: "var(--portal-text-muted)" }}>{detail}</p>}
        {time && <p className="text-[0.6875rem] mt-1" style={{ color: "var(--portal-text-faint)" }}>{time}</p>}
      </Tag>
    </div>
  );
}

export const SHIMMER_KEYFRAMES = `
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
`;

// ---