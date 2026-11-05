import type React from "react";
import {
  Activity,
  Banknote,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock,
  CreditCard,
  FileCheck,
  Hammer,
  HardHat,
  HeartHandshake,
  IndianRupee,
  Layers,
  Megaphone,
  Package,
  PauseCircle,
  Receipt,
  ShoppingCart,
  Target,
  Ticket,
  TriangleAlert,
  TrendingUp,
  Users,
  Warehouse,
  Wrench,
} from "lucide-react";

export type HomeModuleId =
  | "finance"
  | "material"
  | "engineering"
  | "followup"
  | "ticket"
  | "sales"
  | "salesAutomation"
  | "civilworkdpr"
  | "crm"
  | "fixedasset"
  | "admin";

export const MODULE_LABELS: Record<HomeModuleId, string> = {
  finance: "Finance",
  material: "Material",
  engineering: "Engineering",
  followup: "Follow-up",
  ticket: "Tickets",
  sales: "Sales",
  salesAutomation: "Sales Automation",
  civilworkdpr: "Civil Work DPR",
  crm: "CRM",
  fixedasset: "Fixed Assets",
  admin: "Admin",
};

export const MODULE_COLORS: Record<HomeModuleId, string> = {
  finance: "#10b981",
  material: "#8b5cf6",
  engineering: "#ec4899",
  followup: "#f59e0b",
  ticket: "#0d9488",
  sales: "#7c3aed",
  salesAutomation: "#06b6d4",
  civilworkdpr: "#f97316",
  crm: "#e11d48",
  fixedasset: "#3b82f6",
  admin: "#a855f7",
};

// Everything a tile needs to compute its number. Each field is the raw
// payload Home already fetches for that module — null until it has loaded or
// when the user has no access to it.
export interface HomeTileData {
  loading: boolean;
  fin: any;
  mat: any;
  eng: any;
  adm: any;
  tick: any;
  fol: any;
  sal: any;
  crm: {
    bookings: { Status: string; Count: number }[];
    applications: { Status: string; Count: number }[];
    serviceTickets: { Status: string; Count: number }[];
    overdue: number;
  } | null;
  dpr: any;
  sa: any;
  fa: { count: number; active: number; pending: number; totalCost: number } | null;
}

export interface HomeTileValue {
  value: number | string | null;
  prefix?: string;
  suffix?: string;
}

export interface HomeTileDef {
  id: string;
  module: HomeModuleId;
  label: string;
  icon: React.ElementType;
  color: string;
  compute: (d: HomeTileData) => HomeTileValue;
}

// Compact rupees: crores above 1 Cr, lakhs above 1 L, plain below.
const rupees = (n: number): HomeTileValue => {
  if (Math.abs(n) >= 1e7) return { value: (n / 1e7).toFixed(2), prefix: "₹", suffix: "Cr" };
  if (Math.abs(n) >= 1e5) return { value: Math.round(n / 1e5), prefix: "₹", suffix: "L" };
  return { value: Math.round(n), prefix: "₹" };
};

const num = (n: unknown): HomeTileValue => ({ value: Number(n) || 0 });
const countOf = (rows: { Status: string; Count: number }[] | undefined, status: string) =>
  rows?.find((r) => r.Status === status)?.Count ?? 0;

const tile = (
  id: string,
  module: HomeModuleId,
  label: string,
  icon: React.ElementType,
  compute: HomeTileDef["compute"],
): HomeTileDef => ({ id, module, label, icon, color: MODULE_COLORS[module], compute });

// A few tiles for every module, in the order each module offers them. Which
// ones lead the page is decided per user by orderTiles/pickHeroTiles below.
export const HOME_TILES: HomeTileDef[] = [
  // Finance
  tile("fin-transferred", "finance", "Transferred all-time", IndianRupee, (d) => rupees(d.fin?.payments?.totalAmount ?? 0)),
  tile("fin-month", "finance", "Payments this month", Banknote, (d) => rupees(d.fin?.payments?.thisMonthAmount ?? 0)),
  tile("fin-today", "finance", "Payments today", CreditCard, (d) => num(d.fin?.payments?.todayCount)),
  tile("fin-suppliers", "finance", "Active suppliers", Building2, (d) => num(d.fin?.parties?.activeSupplierCount)),
  tile("fin-cheques", "finance", "Active cheques", Receipt, (d) => num(d.fin?.cheques?.activeCount)),

  // Material
  tile("mat-po-value", "material", "Open PO value", Layers, (d) => rupees(d.mat?.purchaseOrders?.openValue ?? d.fin?.purchaseOrders?.openValue ?? 0)),
  tile("mat-po-open", "material", "Open purchase orders", Package, (d) => num(d.mat?.purchaseOrders?.open)),
  tile("mat-grn-month", "material", "GRNs this month", Warehouse, (d) => num(d.mat?.grns?.thisMonth)),
  tile("mat-grn-today", "material", "GRNs today", ClipboardList, (d) => num(d.mat?.grns?.today)),
  tile("mat-items", "material", "Catalogue items", Layers, (d) => num(d.mat?.items?.count)),

  // Engineering
  tile("eng-wo-open", "engineering", "Open work orders", Hammer, (d) => num(d.eng?.workOrders?.open)),
  tile("eng-projects", "engineering", "Active projects", Building2, (d) => num(d.eng?.projects?.active)),
  tile("eng-boq", "engineering", "Approved BOQs", FileCheck, (d) => num(d.eng?.boq?.approved)),
  tile("eng-certified", "engineering", "Work certified", IndianRupee, (d) => rupees(d.eng?.workDone?.certifiedAmount ?? 0)),
  tile("eng-pending", "engineering", "Work awaiting sign-off", Clock, (d) => num(d.eng?.workDone?.pending)),

  // Follow-up
  tile("fol-active", "followup", "Active follow-ups", ClipboardList, (d) => num(d.fol?.totalActive)),
  tile("fol-overdue", "followup", "Follow-ups overdue", TriangleAlert, (d) => num(d.fol?.overdue)),
  tile("fol-today", "followup", "Due today", Clock, (d) => num(d.fol?.dueToday)),
  tile("fol-hold", "followup", "On hold", PauseCircle, (d) => num(d.fol?.onHold)),

  // Tickets
  tile("tick-rate", "ticket", "Resolution rate", CheckCircle2, (d) => ({ value: `${d.tick?.resolvedPct ?? 0}%` })),
  tile("tick-urgent", "ticket", "Urgent tickets", TriangleAlert, (d) => num(d.tick?.urgent)),
  tile("tick-open", "ticket", "Open tickets", Ticket, (d) => num((d.tick?.pending ?? 0) + (d.tick?.inProgress ?? 0))),
  tile("tick-total", "ticket", "All tickets", Ticket, (d) => num(d.tick?.total)),

  // Sales
  tile("sal-month", "sales", "Sales this month", TrendingUp, (d) => rupees(d.sal?.thisMonthAmount ?? 0)),
  tile("sal-pending", "sales", "Orders awaiting approval", ShoppingCart, (d) => num(d.sal?.pendingApproval)),
  tile("sal-approved", "sales", "Approved orders", CheckCircle2, (d) => num(d.sal?.approved)),
  tile("sal-total", "sales", "Total sale orders", ShoppingCart, (d) => num(d.sal?.total)),

  // Sales Automation
  tile("sa-leads", "salesAutomation", "Leads", Target, (d) => num(d.sa?.totalLeads)),
  tile("sa-campaigns", "salesAutomation", "Campaigns", Megaphone, (d) => num(d.sa?.totalCampaigns)),
  tile("sa-spend", "salesAutomation", "Marketing spend", IndianRupee, (d) => rupees(d.sa?.marketingSpend ?? 0)),
  tile("sa-bookings", "salesAutomation", "Bookings from leads", HeartHandshake, (d) => num(d.sa?.bookingsGenerated)),

  // Civil Work DPR
  tile("dpr-activities", "civilworkdpr", "Active activities", Hammer, (d) => num(d.dpr?.activities?.activeCount)),
  tile("dpr-labour", "civilworkdpr", "Labour on site today", Users, (d) => num(d.dpr?.labour?.totalToday)),
  tile("dpr-progress", "civilworkdpr", "Work in progress", HardHat, (d) => num(d.dpr?.assignedWork?.inProgressCount)),
  tile("dpr-pending", "civilworkdpr", "Work not started", Clock, (d) => num(d.dpr?.assignedWork?.pendingCount)),

  // CRM
  tile("crm-bookings", "crm", "Total bookings", HeartHandshake, (d) => num((d.crm?.bookings ?? []).reduce((s, b) => s + b.Count, 0))),
  tile("crm-confirmed", "crm", "Confirmed bookings", CheckCircle2, (d) => num(countOf(d.crm?.bookings, "Confirmed"))),
  tile("crm-apps", "crm", "Applications pending", ClipboardList, (d) => num(countOf(d.crm?.applications, "Pending"))),
  tile("crm-overdue", "crm", "Payments overdue", TriangleAlert, (d) => num(d.crm?.overdue)),
  tile("crm-tickets", "crm", "Open service tickets", Wrench, (d) =>
    num((d.crm?.serviceTickets ?? []).filter((t) => t.Status !== "Closed" && t.Status !== "Resolved").reduce((s, t) => s + t.Count, 0)),
  ),

  // Fixed Assets
  tile("fa-count", "fixedasset", "Fixed assets", Building2, (d) => num(d.fa?.count)),
  tile("fa-active", "fixedasset", "Active assets", CheckCircle2, (d) => num(d.fa?.active)),
  tile("fa-pending", "fixedasset", "Assets pending", Clock, (d) => num(d.fa?.pending)),
  tile("fa-cost", "fixedasset", "Asset cost", IndianRupee, (d) => rupees(d.fa?.totalCost ?? 0)),

  // Admin — not a usage-ranked module, always last
  tile("adm-users", "admin", "Active users", Users, (d) => num(d.adm?.stats?.activeUsers)),
];

export const TILE_ICON_FALLBACK = Activity;

// Modules the user can open, best first: their ranked modules, then any
// accessible module the ranking hasn't seen yet (default order), then admin.
export function rankedModuleOrder(
  ranked: string[] | undefined,
  accessible: HomeModuleId[],
  defaultOrder: HomeModuleId[],
): HomeModuleId[] {
  const allow = new Set(accessible);
  const out: HomeModuleId[] = [];
  for (const m of ranked ?? []) {
    if (allow.has(m as HomeModuleId) && !out.includes(m as HomeModuleId)) out.push(m as HomeModuleId);
  }
  for (const m of defaultOrder) if (allow.has(m) && !out.includes(m)) out.push(m);
  return out;
}

// Tiles of the accessible modules, grouped by module in the given order and
// keeping each module's own tile order.
export function orderTiles(tiles: HomeTileDef[], moduleOrder: HomeModuleId[]): HomeTileDef[] {
  const rank = new Map(moduleOrder.map((m, i) => [m, i]));
  return tiles
    .filter((t) => rank.has(t.module))
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank.get(a.t.module)! - rank.get(b.t.module)! || a.i - b.i)
    .map(({ t }) => t);
}

// The hero row: the top module gets two slots, the next modules one each, so
// the page leads with what the user works in but still shows breadth. Any slot
// a module can't fill (it has fewer tiles) goes to the next in order.
export function pickHeroTiles(ordered: HomeTileDef[], moduleOrder: HomeModuleId[], count = 4): HomeTileDef[] {
  const byModule = new Map<HomeModuleId, HomeTileDef[]>(moduleOrder.map((m) => [m, []]));
  for (const t of ordered) byModule.get(t.module)?.push(t);

  const picked: HomeTileDef[] = [];
  const quotas = [2, 1, 1];
  moduleOrder.forEach((m, i) => {
    const q = quotas[i] ?? 0;
    picked.push(...(byModule.get(m) ?? []).slice(0, q));
  });
  for (const t of ordered) {
    if (picked.length >= count) break;
    if (!picked.includes(t)) picked.push(t);
  }
  return picked.slice(0, count);
}
