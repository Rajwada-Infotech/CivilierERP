// Payment Plan Master and its parts: the APIs and loaders, a plan's milestones and tagged projects, and the split bar.
import React from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export { RULE, RULE_SOFT, LBL, KEY_INK, KEY_LINE, KEY_RED, INP } from "../customers/config";

export const API = "/api/crm/payment-plans";
const MILESTONE_MASTER_API = "/api/crm/milestone-master";
export const PAGE_SIZE = 20;
export const NUM = "font-heading tabular-nums";

export type MilestoneRow = { name: string; pct: number };
export function parseMilestones(json: string | null | undefined): MilestoneRow[] {
  if (!json) return [];
  try {
    return (JSON.parse(json) as any[]).map((r) => ({ name: r.name, pct: Number(r.pct) || 0 }));
  } catch { return []; }
}

export type TaggedProjectRow = { ProjectId: number; ProjectName: string };
export function parseTaggedProjects(json: string | null | undefined): TaggedProjectRow[] {
  if (!json) return [];
  try {
    return (JSON.parse(json) as any[]).map((r) => ({ ProjectId: Number(r.ProjectId), ProjectName: r.ProjectName }));
  } catch { return []; }
}

export type Company = { id: number; name: string };
export type Project = { id: number; name: string; company_id: number; company_ids?: string };
// A project can belong to several companies (company_ids); company_id is only its primary one.
export const companiesOf = (p: Project) => String(p.company_ids ?? p.company_id ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export interface PlanListFilters { companyId: string; projectId: string }
// Plans tag to a project (no block), so the list scopes by company / project. Paged only when ?page= is sent — the
// other callers (Unit Master, Block Master, the application wizard, bookings) never send it and get a bare array.
// A failed load says so; it used to come back as "No payment plans yet".
export async function fetchPlansList(filters: PlanListFilters, page: number): Promise<{ rows: any[]; total: number }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  const r = await fetchWithAuth(`${API}?${params}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load the payment plans (${r.status}).`);
  return { rows: data.rows || [], total: data.total || 0 };
}
export async function fetchMilestoneMaster(): Promise<any[]> {
  const r = await fetchWithAuth(MILESTONE_MASTER_API);
  if (!r.ok) throw new Error("Could not load the milestones");
  return r.json();
}
export async function fetchCompanyProjectDropdown(): Promise<{ companies: Company[]; projects: Project[] }> {
  const r = await fetchWithAuth("/api/business/dropdown");
  if (!r.ok) throw new Error("Could not load the companies and projects");
  return r.json();
}
export async function fetchPlanDetail(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "Could not load the plan");
  return data;
}

// Each milestone's share of the bar, told apart by ink, blue and their washes in turn.
const SEGMENTS = [
  "hsl(var(--foreground))", "hsl(var(--primary))", "hsl(var(--foreground) / 0.5)",
  "hsl(var(--primary) / 0.5)", "hsl(var(--foreground) / 0.25)", "hsl(var(--primary) / 0.25)",
];
export const segmentColor = (i: number) => SEGMENTS[i % SEGMENTS.length];

/** The plan's split after Booking, as one ruled bar — the thing worth seeing at a glance. */
export const MilestoneBar: React.FC<{ milestones: MilestoneRow[]; height?: number }> = ({ milestones, height = 8 }) => {
  const after = milestones.slice(1);
  return (
    <div className="flex w-full overflow-hidden bg-card border border-foreground/40" style={{ height }}>
      {after.map((m, i) => (
        <div key={i} title={`${m.name} — ${m.pct}%`} style={{ width: `${m.pct}%`, background: segmentColor(i + 1) }}
          className="border-r border-card last:border-r-0" />
      ))}
    </div>
  );
};
