// Shared accent color per module — mirrors the palette used in the sidebar
// header (AppSidebar.tsx's MODULE_HEADER) so cross-cutting UI (like the
// reminder bell) can pick up the same "feel" as whichever module the user
// is currently in.
export const MODULE_ACCENT: Record<string, string> = {
  finance: "#6366f1",
  material: "#10b981",
  followup: "#0d9488",
  engineering: "#f97316",
  ticket: "#ec4899",
  sales: "#a855f7",
  records: "#e11d48",
  civilworkdpr: "#0891b2",
  "sales-automation": "#f59e0b",
  admin: "#3b82f6",
  super_admin: "#eab308",
  dba: "#10b981",
};

export const DEFAULT_ACCENT = "#6366f1";

export function getModuleAccent(module: string | null | undefined): string {
  if (!module) return DEFAULT_ACCENT;
  return MODULE_ACCENT[module] ?? DEFAULT_ACCENT;
}
