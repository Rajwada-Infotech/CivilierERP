// Auto Project Setup and its parts: the APIs and loaders, block naming, and the sheet pieces every section draws with.
import React from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SheetMark, type MarkTone } from "@/components/sheet/Sheet";
import { RULE, RULE_SOFT, LBL } from "../customers/config";
import type { LayoutType } from "@/api/unitBhkConfigApi";

export { RULE, RULE_SOFT, LBL, KEY_INK, KEY_LINE, KEY_RED, INP } from "../customers/config";

export const API = "/api/crm/project-auto-setup";
const DROPDOWN_API = "/api/business/dropdown";
export const EMPTY_ITEMS: any[] = [];

export type NamingScheme = "Alphabetical" | "Numeric" | "Custom";
export type PaymentPlan = { Id: number; PlanName: string; IsActive: boolean };
export type KindRow = { Code: string; Name: string; IsCommercial: boolean };
export type UnitEdit = { UnitName: string; FloorNo: string; UnitType: string; UnitKind?: string; AreaSqFt: string; CarpetAreaSqFt: string; BuiltUpAreaSqFt: string; SuperBuiltUpAreaSqFt: string; OpenTerraceAreaSqFt: string; RatePerSqFt: string };
// GET /projects/:id/plot-summary — where a plotted project's land and villas stand.
export type PlotSummary = {
  Plots: number; Available: number; Held: number; Sold: number; BuiltOn: number;
  Villas: number; VillasWithDpr: number; VillaRoomsWithoutDpr: number;
  VillaTypes: number; VillaTypesWithLayout: number; PlannedNotBuilt: number;
};

/** Companies and projects (one cache entry shared by both tabs). A failed load says so instead of showing empty lists. */
export async function fetchDropdown(): Promise<{ companies: any[]; projects: any[] }> {
  const r = await fetchWithAuth(DROPDOWN_API);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `Could not load the companies and projects (${r.status}).`);
  return { companies: body.companies || [], projects: body.projects || [] };
}

/** A project's blocks, floors and type. It used to come back as nothing on a failure, leaving a blank page. */
export async function fetchStatus(projectId: string): Promise<any> {
  const r = await fetchWithAuth(`${API}/status?projectId=${projectId}`);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `Could not load this project's setup (${r.status}).`);
  return body;
}

export async function fetchApplicablePlans(projectId: string): Promise<PaymentPlan[]> {
  try {
    const r = await fetchWithAuth(`/api/unit-master/applicable-payment-plans?projectId=${projectId}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}

/** The company's projects (a project may belong to several companies). */
export const projectsOfCompany = (projects: any[], companyId: string) =>
  companyId ? projects.filter((p: any) => String(p.company_ids || p.company_id || p.CompanyId || "").split(",").includes(companyId)) : [];

// Unit Types come from Unit Composition (dbo.RoomLayoutType) — only types
// with a defined room layout are offered for a new pick (see unitTypeOptions),
// since every generated unit's rooms are built from its layout.
export function firstPickableType(types: LayoutType[]): string {
  return types.find((t) => t.roomCount > 0)?.label ?? "";
}

// A-Z, then AA, AB, ... for anything beyond 26 — same wrap-around scheme
// spreadsheet columns use, so it stays readable at any block count.
function alphabeticalName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

// Skips any candidate name already taken (case-insensitive), however far it has to walk the sequence. Custom has no
// generated candidates (blank inputs).
export function generateNames(count: number, scheme: NamingScheme, existingLower?: Set<string>): string[] {
  if (scheme === "Custom") return Array.from({ length: count }, () => "");
  const names: string[] = [];
  let i = 0;
  let guard = 0; // safety valve — never loop forever even in a pathological all-taken case
  while (names.length < count && guard < count + 10000) {
    guard++;
    const candidate = scheme === "Alphabetical" ? alphabeticalName(i) : String(i + 1);
    i++;
    if (existingLower && existingLower.has(candidate.toLowerCase())) continue;
    names.push(candidate);
  }
  return names;
}

// True if `name` collides (case-insensitive, trimmed) with an existing block, or with another name in the batch
// being added (idx excluded so a field isn't flagged against itself).
export function isDuplicateBlockName(name: string, idx: number, batch: string[], existingLower: Set<string>): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (existingLower.has(n)) return true;
  return batch.some((other, i) => i !== idx && other.trim().toLowerCase() === n);
}

/** Why a unit, plot or slot can't be changed — booked, on hold or applied for — or null when it's free. */
export function lockOf(u: any): { text: string; tone: MarkTone } | null {
  if (u.LockBookingNo) return { text: `Booked · ${u.LockBookingNo}`, tone: "stopped" };
  if (u.LockHoldId) return { text: "On hold", tone: "waiting" };
  if (u.LockApplicationNo) return { text: `Applied · ${u.LockApplicationNo}`, tone: "waiting" };
  if (u.LockAllotmentId) return { text: "Allotted", tone: "waiting" };
  return null;
}

export const plural = (n: number, word: string) => `${n.toLocaleString("en-IN")} ${word}${n === 1 ? "" : "s"}`;

// ── Sheet pieces ──
/** A square tag: blocks, floors and units at rest. `on` = the one opened. */
export const chip = (on = false) =>
  `inline-flex items-center gap-1.5 h-7 px-2.5 text-xs border transition-colors ${on ? "bg-foreground text-card border-foreground" : "bg-card border-foreground/30 hover:border-foreground"}`;
/** A panel inside a section (one block's floors, one block's plots). */
export const PANEL = "bg-card border border-foreground/25";
export const NUM = "font-heading tabular-nums";
/** A small action written as a link. */
export const TEXT_LINK = "text-xs underline underline-offset-2 decoration-foreground/40 hover:decoration-foreground disabled:opacity-40 disabled:no-underline";

/** One step of the setup: a numbered, ruled section with its note and its keys. */
export const Section: React.FC<{ tag?: string; title: string; note?: React.ReactNode; done?: boolean; right?: React.ReactNode; children: React.ReactNode }> =
  ({ tag, title, note, done, right, children }) => (
    <section className="bg-card" style={{ border: RULE }}>
      <header className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2" style={{ borderBottom: RULE }}>
        {tag && (
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border-[1.5px] border-foreground font-heading text-[0.6875rem] font-semibold shrink-0">{tag}</span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">{title}</h2>
            {done && <SheetMark text="Done" tone="done" />}
          </div>
          {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
        </div>
        {right && <div className="flex flex-wrap items-center gap-2 ml-auto">{right}</div>}
      </header>
      <div className="p-4 space-y-4">{children}</div>
    </section>
  );

/** A line the reader should act on: plain (note), edged (to fix), or red (a failure). */
export const Notice: React.FC<{ tone?: "note" | "fix" | "error"; children: React.ReactNode }> = ({ tone = "note", children }) => (
  <div
    className={`px-4 py-2.5 text-xs leading-relaxed ${tone === "error" ? "text-destructive" : "text-foreground"} ${tone === "note" ? "bg-primary/5" : "bg-card"}`}
    style={{
      border: tone === "error" ? "1px solid hsl(var(--destructive))" : tone === "fix" ? RULE : RULE_SOFT,
      boxShadow: tone === "fix" ? "inset 3px 0 0 hsl(var(--foreground))" : undefined,
    }}
  >
    {children}
  </div>
);

/** The setup's steps in a ruled strip: what each holds, which are done, and which comes next. */
export const SetupProgress: React.FC<{ steps: { label: string; detail: string; done: boolean; active: boolean }[] }> = ({ steps }) => (
  <ol className={`grid grid-cols-1 bg-card ${steps.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`} style={{ border: RULE }}>
    {steps.map((s, i) => (
      <li key={s.label} className={`px-4 py-3 min-w-0 ${i ? "border-t sm:border-t-0 sm:border-l border-foreground/15" : ""}`}
        style={{ boxShadow: s.active && !s.done ? "inset 0 -3px 0 hsl(var(--foreground))" : undefined }}>
        <div className="flex items-center justify-between gap-2">
          <span className={LBL}>{i + 1} · {s.label}</span>
          {s.done ? <SheetMark text="Done" tone="done" /> : s.active ? <SheetMark text="Next" tone="waiting" /> : null}
        </div>
        <p className="mt-1.5 text-sm text-foreground truncate">{s.detail}</p>
      </li>
    ))}
  </ol>
);
