// RN port of src/hooks/useReminders.ts: what the header's bell shows, from the same endpoints and with the same rules.
// Each source is fetched only when the user may open its page; PO reminders drop once a GRN exists against the order,
// PO / GRN reminders drop once an invoice (expense booking) has been built from them; everything is sorted overdue →
// today → this week → later. Scoped to this app's two modules (material and finance), as the web's bell is scoped to
// the module the user is in: the follow-up and loan reminders belong to the other apps.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { useAuth } from "@/auth/AuthContext";
import type { MainStackParamList } from "@/navigation/MainStack";

export type ReminderType = "purchase_order" | "work_order" | "tds" | "grn" | "emi_installment" | "material_request" | "pdc";

export interface ReminderItem {
  id: string;
  type: ReminderType;
  title: string;
  subtitle: string;
  dueDate: string;
  urgency: "overdue" | "today" | "soon" | "upcoming";
  amount?: number;
  /** The screen in this app a tap opens, when there is one (TDS, work orders, EMIs and cheques have none yet). */
  screen?: keyof MainStackParamList;
}

export function classifyUrgency(dueDateStr: string): ReminderItem["urgency"] {
  const due = new Date(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "today";
  if (diffDays <= 7) return "soon";
  return "upcoming";
}

export function formatRelative(dueDateStr: string): string {
  const due = new Date(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return "Due today";
  return `Due in ${diffDays}d`;
}

export const formatDay = (dateStr: string) => new Date(dateStr).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

const PRIVILEGED = new Set(["super_admin", "admin", "dba"]);
const PAGE_KEYS: Record<string, string[]> = {
  purchase_order: ["purchase-orders"],
  grn: ["grn-master", "grns"],
  tds: ["tds-master"],
  work_order: ["work-order", "engineering-work-order"],
  expense_emi: ["expense-booking"],
  material_request: ["material-request"],
  pdc: ["reports"],
};

type Perm = { page: string; actions: string[] };
const allowed = (role: string | undefined, perms: Perm[] | undefined, type: string) =>
  (!!role && PRIVILEGED.has(role)) ||
  (Array.isArray(perms) &&
    perms.some((p) => PAGE_KEYS[type].includes(String(p.page).toLowerCase()) && Array.isArray(p.actions) && p.actions.map((a) => String(a).toLowerCase()).includes("view")));

async function list(url: string): Promise<any[]> {
  try {
    const res = await fetchWithAuth(url, { skipActivityLog: true });
    if (!res.ok) return [];
    const raw = await res.json().catch(() => ({}));
    return Array.isArray(raw) ? raw : raw?.data ?? [];
  } catch {
    return [];
  }
}

async function emiReminders(): Promise<ReminderItem[]> {
  return (await list("/api/expense-booking/emi-reminders")).map((inst) => {
    const dueDate = String(inst.dueDate).slice(0, 10);
    return {
      id: `emi-${inst.expenseBookingId}-${inst.installmentNo}`,
      type: "emi_installment",
      title: `${inst.refNumber || `${inst.parentDocNo}-EMI-${String(inst.installmentNo).padStart(2, "0")}`}`,
      subtitle: `${inst.projectName || inst.partyName || "Expense Booking"} · Installment ${inst.installmentNo}/${inst.totalInstallments ?? "?"}`,
      dueDate,
      urgency: classifyUrgency(dueDate),
      amount: inst.amount,
    };
  });
}

async function mrReminders(): Promise<ReminderItem[]> {
  const ACTIONABLE = new Set(["pending", "approved"]);
  return (await list("/api/material-requests?limit=500&page=1"))
    // RequiredByDate is optional and most requesters leave it blank; RequestDate is always set.
    .filter((r) => ACTIONABLE.has(String(r.Status || "").toLowerCase()) && (r.RequiredByDate || r.RequestDate))
    .map((r) => {
      const dueDate = String(r.RequiredByDate || r.RequestDate).slice(0, 10);
      return {
        id: `mr-${r.MRId}`,
        type: "material_request" as const,
        title: `MR ${r.DocNo || `#${r.MRId}`}`,
        subtitle: `${r.ProjectName || r.CompanyName || "Material Request"} · ${r.Status} · ${r.Priority || "Normal"} priority`,
        dueDate,
        urgency: classifyUrgency(dueDate),
        screen: "MaterialRequest" as const,
      };
    });
}

// Pending cheques due soon plus overdue ones (Pending with ChequeDate before today).
async function pdcReminders(): Promise<ReminderItem[]> {
  const [pending, overdue] = await Promise.all([list("/api/reports/pdc?status=Pending&limit=500"), list("/api/reports/pdc?status=Overdue&limit=500")]);
  return [...pending, ...overdue]
    .filter((r) => r.ChequeDate)
    .map((r) => {
      const dueDate = String(r.ChequeDate).slice(0, 10);
      return {
        id: `pdc-${r.SourceType}-${r.SourceID}`,
        type: "pdc" as const,
        title: `Cheque ${r.ChequeNo || r.SourceID}`,
        subtitle: `${r.PartyName || "Unknown"} · ${r.Direction} · ${r.BankName || "—"}`,
        dueDate,
        urgency: classifyUrgency(dueDate),
        amount: r.Amount,
      };
    });
}

export async function fetchReminders(role?: string, perms?: Perm[]): Promise<ReminderItem[]> {
  if (!role || role === "customer") return [];
  const may = (type: string) => allowed(role, perms, type);
  const [poList, grnList, tdsList, woList] = await Promise.all([
    may("purchase_order") ? list("/api/purchase-orders?limit=500") : [],
    may("grn") ? list("/api/grns?limit=500") : [],
    may("tds") ? list("/api/tds-master") : [],
    may("work_order") ? list("/api/work-orders?limit=100") : [],
  ]);

  // A PO reminder has done its job once a GRN exists against the order; a PO or GRN reminder once an invoice has
  // been built from it — whatever that next document's own status.
  const poIdsWithGrn = new Set(grnList.filter((g) => g.POID).map((g) => String(g.POID)));
  const invoiced = new Set<string>();
  if (may("purchase_order") || may("grn")) {
    for (const eb of await list("/api/expense-booking?limit=200")) {
      const t = String(eb.ESourceType || eb.eSourceType || "").toUpperCase();
      const id = eb.ESourceId ?? eb.eSourceId;
      if (!id) continue;
      if (t === "PO" || t === "WO_PO") invoiced.add(`purchase_order-${id}`);
      else if (t === "GRN") invoiced.add(`grn-${id}`);
    }
  }

  const items: ReminderItem[] = [];
  const take = (rows: any[], type: ReminderType, idKey: string, pre: string, screen?: keyof MainStackParamList) =>
    rows.forEach((o) => {
      const d = o.ExpectedDeliveryDate || o.PODate || o.GRNDate || o.ChequeDate || o.DueDate;
      const id = o[idKey];
      if (!d || !id) return;
      if (type === "purchase_order" && poIdsWithGrn.has(String(id))) return;
      if ((type === "purchase_order" || type === "grn") && invoiced.has(`${type}-${id}`)) return;
      items.push({
        id: `${type}-${id}`,
        type,
        title: `${pre} #${o.PurchaseOrderNo || o.GRNNo || id}`,
        subtitle: o.SupplierName || o.PartyName || "Civilier System",
        dueDate: d,
        urgency: classifyUrgency(d),
        amount: o.TotalAmount || o.TDSAmount || o.Amount,
        screen,
      });
    });
  take(poList, "purchase_order", "PurchaseOrderID", "PO", "PurchaseOrder");
  take(grnList, "grn", "GRNID", "GRN", "GRN");
  take(tdsList, "tds", "Id", "TDS");
  take(woList, "work_order", "Id", "WO");

  const [emi, mr, pdc] = await Promise.all([
    may("expense_emi") ? emiReminders() : [],
    may("material_request") ? mrReminders() : [],
    may("pdc") ? pdcReminders() : [],
  ]);
  items.push(...emi, ...mr, ...pdc);

  const order = { overdue: 0, today: 1, soon: 2, upcoming: 3 };
  return items.sort((a, b) => order[a.urgency] - order[b.urgency]);
}

// The reminders download whole lists (POs, GRNs, MRs, expense bookings, cheques…). Fetched the moment the header drew,
// they raced the dashboard's own requests on the phone and the server, and the stats sometimes came back late or not at
// all. As the web does (runWhenIdle), they now wait until the app has settled: a few seconds after start, once nothing
// is animating. Opening the bell fetches them at once. Once started, it stays started for the session.
const SETTLE_MS = 4000;
let started = false;
const startListeners = new Set<() => void>();
function startNow() {
  if (started) return;
  started = true;
  startListeners.forEach((l) => l());
}
function useStarted() {
  const [ready, setReady] = useState(started);
  useEffect(() => {
    if (started) return setReady(true);
    const mark = () => setReady(true);
    startListeners.add(mark);
    const t = setTimeout(() => {
      // React Native 0.88 dropped InteractionManager; requestIdleCallback waits for the JS thread to go quiet.
      const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
      if (idle) idle(startNow, { timeout: 3000 });
      else startNow();
    }, SETTLE_MS);
    return () => {
      clearTimeout(t);
      startListeners.delete(mark);
    };
  }, []);
  return ready;
}

/**
 * The reminders, shared by every caller (the header's badge and its panel). Refreshing by hand more than five times in
 * a couple of seconds locks the key for five seconds, as on the web, since each refresh downloads whole lists.
 */
export function useReminders() {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const role = currentUser?.role;
  const perms = currentUser?.pagePermissions as Perm[] | undefined;
  const key = ["reminders", role, currentUser?.id];
  const ready = useStarted();
  // Every screen's header mounts a bell; the list is shared and kept five minutes, not re-downloaded per screen.
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchReminders(role, perms),
    enabled: !!role && ready,
    staleTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  const [locked, setLocked] = useState(false);
  const taps = useRef(0);
  const refresh = useCallback(() => {
    if (locked) return;
    taps.current += 1;
    setTimeout(() => (taps.current = Math.max(0, taps.current - 1)), 2000);
    if (taps.current > 5) {
      setLocked(true);
      setTimeout(() => {
        setLocked(false);
        taps.current = 0;
      }, 5000);
      return;
    }
    if (!started) return startNow(); // the first open fetches straight away
    void qc.invalidateQueries({ queryKey: key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, qc, role, currentUser?.id]);

  return { reminders: query.data ?? [], loading: query.isFetching, refresh, locked };
}
