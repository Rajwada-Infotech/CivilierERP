// Shared look for the Admin → Integrations page and its sections.
export const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
export const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
export const RULE = "1px solid hsl(var(--foreground))";
export const SOFT_RULE = "1px solid hsl(var(--foreground) / 0.2)";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
export const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
export const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
export const FIELD = "w-full h-9 px-2.5 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none";
export const TAG = "inline-flex items-center gap-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap";

export const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

const DAY = 24 * 60 * 60 * 1000;
/** Days until a date (negative = past), or null. */
export const daysUntil = (v: string | null | undefined) => (v ? Math.ceil((new Date(v).getTime() - Date.now()) / DAY) : null);
