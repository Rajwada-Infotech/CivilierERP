// Hex conversions of the web app's theme tokens (src/index.css) — the five the web's ThemeSwitcher offers: Dark (the
// default, ":root"), Light, Glass, BW and Sage. RN styles take hex / rgba, not CSS custom properties, so the values are
// computed once here. Every value is a 6-digit hex: screens append an alpha byte (`${colors.card}80`), which an rgba()
// string would break.
//
// `colors` and `sheet` are the palette in use. They are plain objects that applyTheme() rewrites in place, and every
// screen reads them as it draws — so switching theme rewrites them and redraws the app (ThemeContext remounts the
// navigator, keeping the open page). Nothing may copy a colour out of them at import time.
export type ThemeName = "dark" | "light" | "glass" | "bw" | "sage";
type Palette = { background: string; foreground: string; card: string; primary: string; muted: string; mutedForeground: string; destructive: string; border: string };

const PALETTES: Record<ThemeName, Palette> = {
  // --background 225 14% 7% · --foreground 220 14% 88% · --card 225 13% 10.5% · --primary 239 84% 67% …
  dark: { background: "#0f1114", foreground: "#dcdfe5", card: "#17191e", primary: "#6467f2", muted: "#24272d", mutedForeground: "#9ba0ab", destructive: "#e34545", border: "#373a43" },
  light: { background: "#fafafa", foreground: "#14141f", card: "#ffffff", primary: "#6467f2", muted: "#ebecf0", mutedForeground: "#606876", destructive: "#dc2828", border: "#dadce2" },
  glass: { background: "#f6f7f9", foreground: "#0f141f", card: "#fcfcfd", primary: "#0d7cf2", muted: "#edeff2", mutedForeground: "#424957", destructive: "#db2424", border: "#d6d9e1" },
  bw: { background: "#f5f5f5", foreground: "#171717", card: "#ffffff", primary: "#171717", muted: "#ededed", mutedForeground: "#616161", destructive: "#333333", border: "#e0e0e0" },
  sage: { background: "#eff3ed", foreground: "#16221c", card: "#fafbf9", primary: "#40684c", muted: "#e2e7de", mutedForeground: "#516157", destructive: "#b62b2b", border: "#cbd4c4" },
};

/** The themes in the web's order, with the web switcher's swatch colour and name (THEME_DOTS in ThemeContext.tsx). */
export const THEMES: { name: ThemeName; label: string; swatch: string }[] = [
  { name: "dark", label: "Dark", swatch: "#4f46e5" },
  { name: "light", label: "Light", swatch: "#a78bfa" },
  { name: "glass", label: "Glass", swatch: "#f3e6cf" },
  { name: "bw", label: "BW", swatch: "#111111" },
  { name: "sage", label: "Sage", swatch: "#9caf88" },
];
export const isLightTheme = (t: ThemeName) => t !== "dark";

export const colors: Palette = { ...PALETTES.dark };

// The drawing sheet's own tones (web: .crm-sheet in components/sheet/Sheet.tsx) — the same derivations from the
// tokens above. Ink is the foreground colour; everything else is a step of it, the border, or the primary.
const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
const sheetOf = (c: Palette) => ({
  paper: c.card, // --sheet
  ink: c.foreground,
  ink2: rgba(c.foreground, 0.78),
  graphite: c.mutedForeground, // labels, captions
  faint: rgba(c.mutedForeground, 0.6),
  rule: c.border, // hairlines between cells
  ruleSoft: rgba(c.border, 0.55), // between rows
  line40: rgba(c.foreground, 0.4), // input borders
  line15: rgba(c.foreground, 0.15),
  blue: c.primary,
  blueWash: rgba(c.primary, 0.1),
  blueTint: rgba(c.primary, 0.18),
  red: c.destructive,
  redWash: rgba(c.destructive, 0.1),
  grid: rgba(c.foreground, 0.04),
  hatch: rgba(c.foreground, 0.24),
});
export const sheet = sheetOf(colors);

/** Makes `theme` the palette in use. Only ThemeContext should call this — it also redraws the app. */
export function applyTheme(theme: ThemeName) {
  Object.assign(colors, PALETTES[theme] ?? PALETTES.dark);
  Object.assign(sheet, sheetOf(colors));
}

// The sheet has no per-module colours: a module is told by its name and icon, drawn in ink like everything else. Kept
// as a map so the screens that look an accent up by module still compile; every entry is ink.
const ink = { get value() { return colors.foreground; } };
export const moduleAccents = {
  get finance() { return ink.value; },
  get material() { return ink.value; },
  get engineering() { return ink.value; },
  get civilworkdpr() { return ink.value; },
  get followup() { return ink.value; },
  get approvals() { return ink.value; },
  get sales() { return ink.value; },
  get salesAutomation() { return ink.value; },
  get ticket() { return ink.value; },
  get admin() { return ink.value; },
  get dba() { return ink.value; },
};
