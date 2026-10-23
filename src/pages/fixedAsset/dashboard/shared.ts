// What GET /api/fixed-assets/dashboard sends (backend/services/fixedAssetDashboard.js), and how it is written out.
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export interface Breakdown { name: string; count: number; cost: number; bookValue: number }
export interface Activity { at: string; kind: string; ref: string | null; detail: string | null; who: string | null; path: string }

export interface FixedAssetDashboardData {
  register: { assets: number; cost: number; depreciated: number; bookValue: number; addedThisYear: number; addedThisYearCost: number };
  byStatus: { status: string; count: number; cost: number }[];
  byCategory: Breakdown[];
  byProject: Breakdown[];
  inventory: { untaggedBatches: number; untaggedQty: number; noTemplate: number; codesTagged: number; codesTaggedThisYear: number };
  imports: { count: number; qty: number; value: number; lastDate: string | null };
  assignment: { assigned: number; unassigned: number };
  transfers: { thisYear: number; lastDate: string | null };
  qualityCheck: { checks: number; followUpsOpen: number; overdue: number; dueThisWeek: number; byStatus: { status: string; count: number }[] };
  maintenance: { thisYear: number; spentThisYear: number; notPosted: number; notPostedAmount: number };
  depreciation: { thisYear: number; lastPeriod: string | null; dueLastMonth: number; months: { month: string; amount: number }[] };
  recent: Activity[];
  fyStart: string;
}

export async function getFixedAssetDashboard(): Promise<FixedAssetDashboardData> {
  const res = await fetchWithAuth("/api/fixed-assets/dashboard");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as FixedAssetDashboardData;
}

export const fmt = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n ?? 0);
export const fmtNum = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n ?? 0);
export const short = (v: number) =>
  v >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(Math.round(v));
export const share = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0);
export const monthName = (iso: string | null, opts: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" }) =>
  iso ? new Date(iso.length === 7 ? `${iso}-01T00:00:00` : iso).toLocaleDateString("en-IN", opts) : "—";
export const dayName = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
export const whenName = (iso: string) => {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};
