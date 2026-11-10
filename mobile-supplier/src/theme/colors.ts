// Hex conversion of the web app's default (dark) theme tokens — src/index.css, ":root" / "DARK THEME (default)":
// neutral graphite, so ink rules, hairlines and capital labels read on it. RN styles take hex / rgba, not CSS
// custom properties, so the values are computed once here.
//
//   --background: 225 14% 7%     --foreground: 220 14% 88%
//   --card: 225 13% 10.5%        --primary: 239 84% 67%
//   --muted: 225 11% 16%         --muted-foreground: 220 9% 64%
//   --destructive: 0 74% 58%     --border: 225 10% 24%
export const colors = {
  background: "#0f1114",
  foreground: "#dcdfe5",
  card: "#17191e",
  primary: "#6467f2",
  muted: "#24272d",
  mutedForeground: "#9ba0ab",
  destructive: "#e34545",
  border: "#373a43",
} as const;

// The drawing sheet's own tones (web: .crm-sheet in components/sheet/Sheet.tsx) — the same derivations from the
// tokens above. Ink is the foreground colour; everything else is a step of it, the border, or the primary.
const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
export const sheet = {
  paper: colors.card, // --sheet
  ink: colors.foreground,
  ink2: rgba(colors.foreground, 0.78),
  graphite: colors.mutedForeground, // labels, captions
  faint: rgba(colors.mutedForeground, 0.6),
  rule: colors.border, // hairlines between cells
  ruleSoft: rgba(colors.border, 0.55), // between rows
  line40: rgba(colors.foreground, 0.4), // input borders
  line15: rgba(colors.foreground, 0.15),
  blue: colors.primary,
  blueWash: rgba(colors.primary, 0.1),
  blueTint: rgba(colors.primary, 0.18),
  red: colors.destructive,
  redWash: rgba(colors.destructive, 0.1),
  grid: rgba(colors.foreground, 0.04),
  hatch: rgba(colors.foreground, 0.24),
} as const;
