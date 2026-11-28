// Auto Project Setup and its parts: the APIs and loaders, block naming, and 5-theme enterprise UI primitives.
import React from "react";
import { AlertTriangle, Check, Info } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { GRID_CARD, GRID_KEY, GRID_KEY_BRAND, GRID_KEY_DANGER, GRID_SHEET_KEYS, GridToneMark } from "@/components/crm/CrmDataTable";
import type { LayoutType } from "@/api/unitBhkConfigApi";

export type MarkTone = "done" | "waiting" | "moving" | "stopped" | "draft";

export const TONE_EMERALD_TEXT = "text-emerald-400 [[data-theme]_&]:text-emerald-700";
export const TONE_AMBER_TEXT = "text-amber-300 [[data-theme]_&]:text-amber-700";
export const TONE_ROSE_TEXT = "text-rose-400 [[data-theme]_&]:text-rose-700";
export const TONE_SKY_TEXT = "text-sky-400 [[data-theme]_&]:text-sky-700";

export const TONE_EMERALD_PILL = "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 [[data-theme]_&]:bg-emerald-500/10 [[data-theme]_&]:border-emerald-500/25 [[data-theme]_&]:text-emerald-700";
export const TONE_AMBER_PILL = "bg-amber-500/15 border-amber-500/30 text-amber-300 [[data-theme]_&]:bg-amber-500/10 [[data-theme]_&]:border-amber-500/30 [[data-theme]_&]:text-amber-700";
export const TONE_ROSE_PILL = "bg-rose-500/15 border-rose-500/35 text-rose-300 [[data-theme]_&]:bg-rose-500/10 [[data-theme]_&]:border-rose-500/30 [[data-theme]_&]:text-rose-700";
export const TONE_SKY_PILL = "bg-sky-500/15 border-sky-500/30 text-sky-300 [[data-theme]_&]:bg-sky-500/10 [[data-theme]_&]:border-sky-500/25 [[data-theme]_&]:text-sky-700";

export const SEG_WRAP = "inline-flex items-center rounded-lg border border-border bg-muted/40 p-1 gap-1";
export const segBtn = (on: boolean) =>
  `h-7 px-3 rounded-md text-xs font-medium transition-all inline-flex items-center justify-center gap-1.5 whitespace-nowrap ${
    on ? "bg-card text-foreground shadow-sm border border-border/80 font-semibold" : "text-muted-foreground hover:text-foreground"
  }`;

export const KEY_INK = GRID_KEY_BRAND;
export const KEY_LINE = GRID_KEY;
export const KEY_RED = GRID_KEY_DANGER;
export const { LBL, RULE, RULE_SOFT, INP } = GRID_SHEET_KEYS;

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

// ── 5-theme enterprise pieces ──
/** A rounded tag: blocks, floors and units at rest. `on` = the one opened. */
export const chip = (on = false) =>
  `inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-medium border transition-colors ${
    on
      ? "bg-primary text-primary-foreground border-primary shadow-sm"
      : "bg-card border-border text-foreground hover:border-primary/45 hover:bg-muted/40"
  }`;
/** A panel inside a section (one block's floors, one block's plots). */
export const PANEL = "rounded-xl bg-card border border-border";
export const NUM = "font-heading tabular-nums";
/** A small action written as a link. */
export const TEXT_LINK = "text-xs font-medium text-primary hover:underline underline-offset-2 disabled:opacity-40 disabled:no-underline";

/** One step of the setup: a rounded enterprise card with numbered badge, subtitle and right-aligned actions. */
export const Section: React.FC<{ tag?: string; title: string; note?: React.ReactNode; done?: boolean; right?: React.ReactNode; children: React.ReactNode }> =
  ({ tag, title, note, done, right, children }) => (
    <section className={`${GRID_CARD} rounded-xl overflow-hidden`}>
      <header className="px-4 py-3 border-b border-border bg-muted/20 flex flex-wrap items-center gap-x-3 gap-y-2">
        {tag && (
          <span
            className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold shrink-0 border ${
              done
                ? "bg-emerald-500/15 border-emerald-500/35 text-emerald-300 [[data-theme]_&]:bg-emerald-500/10 [[data-theme]_&]:text-emerald-700"
                : "bg-primary/10 border-primary/30 text-primary"
            }`}
          >
            {done ? <Check size={13} /> : tag}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h2 className="text-sm font-bold text-foreground leading-tight">{title}</h2>
            {done && <GridToneMark text="Done" tone="done" />}
          </div>
          {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
        </div>
        {right && <div className="flex flex-wrap items-center gap-2 ml-auto">{right}</div>}
      </header>
      <div className="p-4 space-y-4">{children}</div>
    </section>
  );

/** A rounded callout: plain (note), action-needed (fix), or failure (error). */
export const Notice: React.FC<{ tone?: "note" | "fix" | "error"; children: React.ReactNode }> = ({ tone = "note", children }) => {
  const cls =
    tone === "error"
      ? `border-rose-500/35 bg-rose-500/10 ${TONE_ROSE_TEXT}`
      : tone === "fix"
        ? "border-amber-500/35 bg-amber-500/10 text-foreground"
        : "border-primary/25 bg-primary/5 text-foreground";
  const Icon = tone === "note" ? Info : AlertTriangle;
  const iconCls = tone === "error" ? TONE_ROSE_TEXT : tone === "fix" ? TONE_AMBER_TEXT : "text-primary";
  return (
    <div className={`rounded-xl border px-4 py-3 text-xs leading-relaxed flex items-start gap-2.5 ${cls}`} role="status">
      <Icon size={15} className={`shrink-0 mt-0.5 ${iconCls}`} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
};

/** The setup's steps in a rounded progress bar: what each holds, which are done, and which comes next. */
export const SetupProgress: React.FC<{ steps: { label: string; detail: string; done: boolean; active: boolean }[] }> = ({ steps }) => (
  <ol className={`grid grid-cols-1 rounded-xl border border-border bg-card overflow-hidden divide-y sm:divide-y-0 sm:divide-x divide-border ${steps.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
    {steps.map((s, i) => (
      <li
        key={s.label}
        className={`px-4 py-3 min-w-0 transition-colors ${s.active && !s.done ? "bg-primary/[0.04]" : ""}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <span
              className={`w-5 h-5 rounded-full text-[0.6875rem] font-bold inline-flex items-center justify-center ${
                s.done
                  ? "bg-emerald-500 text-white"
                  : s.active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {s.done ? <Check size={11} /> : i + 1}
            </span>
            <span className={s.done || s.active ? "text-foreground" : "text-muted-foreground"}>{s.label}</span>
          </span>
          {s.done ? <GridToneMark text="Done" tone="done" /> : s.active ? <GridToneMark text="Next" tone="waiting" /> : null}
        </div>
        <p className="mt-1.5 text-sm font-medium text-foreground truncate">{s.detail}</p>
      </li>
    ))}
  </ol>
);
