// Hex conversion of the web app's default dark theme HSL tokens
// (src/index.css :root, @layer base — "DARK THEME (default)"). RN styles
// take hex/rgba, not CSS custom properties, so these are computed once
// here rather than re-deriving HSL math in every component.
//
//   --background: 240 20% 6%   --foreground: 220 20% 92%
//   --card: 240 18% 10%        --primary: 239 84% 67%
//   --secondary: 263 70% 58%   --muted: 240 15% 15%
//   --muted-foreground: 220 10% 55%  --destructive: 0 72% 51%
//   --border: 240 15% 18%      --surface: 240 18% 12%
//   --accent-3: 217 91% 60%
export const colors = {
  background: "#0c0c12",
  foreground: "#e7e9ef",
  card: "#15151e",
  primary: "#6467f2",
  secondary: "#8249df",
  muted: "#21212c",
  mutedForeground: "#818898",
  destructive: "#dc2828",
  border: "#272735",
  surface: "#191924",
  accentBlue: "#3c83f6",
};
// Not `as const`: the light / dark switch and the accent picker (ThemeContext.tsx) rewrite these in place through
// applyPalette below, so every screen that reads them — the Maintenance and Approval screens included — follows.

// Per-module accent colors — these are hardcoded hex in the web app too
// (Home.tsx passes them as literal props, not theme tokens), so they're
// identical across every theme there and here.
export const moduleAccents = {
  finance: "#3b82f6",
  material: "#8b5cf6",
  engineering: "#ec4899",
  civilworkdpr: "#0891b2",
  followup: "#0d9488",
  approvals: "#f59e0b",
  sales: "#7c3aed",
  salesAutomation: "#f97316",
  ticket: "#ef4444",
  admin: "#a855f7",
  dba: "#10b981",
  // This app's own module — matches web's MAINTENANCE_ACCENT
  // (src/components/maintenance/MaintenanceShell.tsx).
  maintenance: "#65a30d",
  // The CRM module — the web's own CRM tile colour (src/pages/home/homeTiles.ts).
  crm: "#e11d48",
};

// The drawing sheet's own tones, the same derivation the other CivilierERP apps use (mobile-employee / mobile-admin
// src/theme/colors.ts sheetOf, from the web's .crm-sheet): ink is the foreground colour, everything else a step of
// it, the border or the primary. Read by components/sheet/Sheet.tsx (the customer screens' kit).
const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
export const sheet: Record<string, string> = {
  paper: colors.card,
  ink: colors.foreground,
  ink2: rgba(colors.foreground, 0.78),
  graphite: colors.mutedForeground,
  faint: rgba(colors.mutedForeground, 0.6),
  rule: colors.border,
  ruleSoft: rgba(colors.border, 0.55),
  line40: rgba(colors.foreground, 0.4),
  line15: rgba(colors.foreground, 0.15),
  blue: colors.primary,
  blueWash: rgba(colors.primary, 0.1),
  blueTint: rgba(colors.primary, 0.18),
  red: colors.destructive,
  redWash: rgba(colors.destructive, 0.1),
  grid: rgba(colors.foreground, 0.04),
  hatch: rgba(colors.foreground, 0.24),
};

/** The palette the app shows, from the theme (ThemeContext.tsx): the page, card, text and line colours as hex (screens
 * add an alpha to them, e.g. `${colors.border}80`), the accent, and the drawing sheet's tones derived from them. */
export interface Palette {
  background: string; card: string; surface: string; muted: string;
  foreground: string; mutedForeground: string; border: string; accent: string; destructive: string;
}
/** The accent the person picked (ThemeContext.tsx) — read it as a live value (`import { accent }`), not copied once. */
export let accent = moduleAccents.crm;
export function applyPalette(p: Palette) {
  accent = p.accent;
  Object.assign(colors, {
    background: p.background, card: p.card, surface: p.surface, muted: p.muted,
    foreground: p.foreground, mutedForeground: p.mutedForeground, border: p.border, primary: p.accent, destructive: p.destructive,
  });
  moduleAccents.crm = p.accent;
  Object.assign(sheet, {
    paper: colors.card, ink: colors.foreground, ink2: rgba(colors.foreground, 0.78), graphite: colors.mutedForeground,
    faint: rgba(colors.mutedForeground, 0.6), rule: colors.border, ruleSoft: rgba(colors.border, 0.55),
    line40: rgba(colors.foreground, 0.4), line15: rgba(colors.foreground, 0.15), blue: colors.primary,
    blueWash: rgba(colors.primary, 0.1), blueTint: rgba(colors.primary, 0.18), red: colors.destructive,
    redWash: rgba(colors.destructive, 0.1), grid: rgba(colors.foreground, 0.04), hatch: rgba(colors.foreground, 0.24),
  });
}
