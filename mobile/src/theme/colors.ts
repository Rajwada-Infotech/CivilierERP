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
} as const;

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
} as const;
