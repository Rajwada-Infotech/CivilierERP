import { useState, useEffect, useCallback, useRef } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";

export type ReminderType =
  | "purchase_order"
  | "work_order"
  | "tds"
  | "grn"
  | "emi_installment"
  | "material_request"
  | "pdc"
  | "followup";

// Which module owns each reminder type — drives the bell's "only this
// module's reminders" scoping everywhere except the Home dashboard, which
// shows every type unfiltered.
export const REMINDER_TYPE_MODULE: Record<ReminderType, string> = {
  purchase_order: "material",
  work_order: "material",
  grn: "material",
  emi_installment: "material",
  material_request: "material",
  tds: "finance",
  pdc: "finance",
  followup: "followup",
};

export interface ReminderItem {
  id: string | number;
  type: ReminderType;
  title: string;
  subtitle: string;
  dueDate: string;
  urgency: "overdue" | "today" | "soon" | "upcoming";
  amount?: number;
  path: string;
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

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

async function fetchEmiReminders(): Promise<ReminderItem[]> {
  try {
    const res = await fetchWithAuth("/api/expense-booking/emi-reminders");
    if (!res.ok) return [];
    const rows: any[] = await res.json();
    return rows.map((inst) => ({
      id: `emi-${inst.expenseBookingId}-${inst.installmentNo}`,
      type: "emi_installment" as ReminderType,
      title: `${inst.refNumber || `${inst.parentDocNo}-EMI-${String(inst.installmentNo).padStart(2, "0")}`}`,
      subtitle: `${inst.projectName || inst.partyName || "Expense Booking"} · Installment ${inst.installmentNo}/${inst.totalInstallments ?? "?"}`,
      dueDate: String(inst.dueDate).slice(0, 10),
      urgency: classifyUrgency(String(inst.dueDate).slice(0, 10)),
      amount: inst.amount,
      path: `/material/expense-booking?view=${inst.expenseBookingId}`,
    }));
  } catch {
    return [];
  }
}

async function fetchMaterialRequestReminders(): Promise<ReminderItem[]> {
  try {
    const res = await fetchWithAuth("/api/material-requests?limit=500&page=1");
    if (!res.ok) return [];
    const raw = await res.json();
    const list: any[] = Array.isArray(raw) ? raw : (raw.data ?? []);

    const ACTIONABLE = new Set(["pending", "approved"]);

    return list
      .filter((r) => {
        const status = (r.Status || "").toLowerCase();
        // RequiredByDate is an optional field most requesters never fill
        // in — falling back to RequestDate (always set) is what actually
        // keeps MRs from being dropped out of the bell entirely.
        return ACTIONABLE.has(status) && (r.RequiredByDate || r.RequestDate);
      })
      .map((r) => {
        const dueDate = String(r.RequiredByDate || r.RequestDate).slice(0, 10);
        return {
          id: `mr-${r.MRId}`,
          type: "material_request" as ReminderType,
          title: `MR ${r.DocNo || `#${r.MRId}`}`,
          subtitle: `${r.ProjectName || r.CompanyName || "Material Request"} · ${r.Status} · ${r.Priority || "Normal"} priority`,
          dueDate,
          urgency: classifyUrgency(dueDate),
          path: `/material/material-request?view=${r.MRId}`,
        };
      });
  } catch {
    return [];
  }
}

// Pending PDCs due soon plus overdue-but-unmatched ones — both surface as
// bell reminders (the report itself is the source of truth; this just
// re-shapes its rows into ReminderItems). "Overdue" from the report already
// means Pending + ChequeDate < today, so a single fetch covers both halves
// of the spec's due-soon/overdue split; classifyUrgency below re-derives the
// bucket per row from ChequeDate so ordering (overdue > today > soon) stays
// consistent with every other reminder source.
async function fetchPdcReminders(): Promise<ReminderItem[]> {
  try {
    const res = await fetchWithAuth(
      "/api/reports/pdc?status=Pending&limit=500",
    );
    const overdueRes = await fetchWithAuth(
      "/api/reports/pdc?status=Overdue&limit=500",
    );
    const rows: any[] = [];
    if (res.ok) rows.push(...((await res.json()).data ?? []));
    if (overdueRes.ok) rows.push(...((await overdueRes.json()).data ?? []));

    return rows
      .filter((r) => r.ChequeDate)
      .map((r) => {
        const dueDate = String(r.ChequeDate).slice(0, 10);
        return {
          id: `pdc-${r.SourceType}-${r.SourceID}`,
          type: "pdc" as ReminderType,
          title: `Cheque ${r.ChequeNo || r.SourceID}`,
          subtitle: `${r.PartyName || "Unknown"} · ${r.Direction} · ${r.BankName || "—"}`,
          dueDate,
          urgency: classifyUrgency(dueDate),
          amount: r.Amount,
          path: "/reports",
        };
      });
  } catch {
    return [];
  }
}

// Follow-Up task reminders — only tasks that actually have a scheduled
// (not-yet-done) follow-up reminder date surface here; a task's own DueDate
// alone doesn't (that's what the Follow-Up board's Overdue/Today buckets are
// for), so the bell reflects "you told yourself to check back on this."
async function fetchFollowUpReminders(): Promise<ReminderItem[]> {
  try {
    const res = await fetchWithAuth("/api/task-master/followup-board");
    if (!res.ok) return [];
    const rows: any[] = await res.json().catch(() => []);
    return rows
      .filter((t) => t.NextFollowUpAt)
      .map((t) => {
        const dueDate = String(t.NextFollowUpAt).slice(0, 10);
        return {
          id: `followup-${t.Id}`,
          type: "followup" as ReminderType,
          title: `${t.TaskNo || `Task #${t.Id}`} · ${t.Subject}`,
          subtitle: t.CaseProjectName || t.CaseCompanyName || t.Department || "Follow-Up",
          dueDate,
          urgency: classifyUrgency(dueDate),
          path: `/followup?view=${t.Id}`,
        };
      });
  } catch {
    return [];
  }
}

export async function fetchCustomerReminders(): Promise<ReminderItem[]> {
  // /api/expense-booking is restricted to internal roles.
  // Return empty until a customer-scoped endpoint exists.
  return [];
}

// Roles that bypass page-level gating entirely (mirrors backend
// SUPERUSER_ROLES in middleware/permissions.js).
const PRIVILEGED_REMINDER_ROLES = new Set(["super_admin", "admin", "dba"]);

// Page keys (as stored in pagePermissions / RoleRights-derived rights) that
// gate each reminder source. Kept in sync with the candidate page keys
// middleware/permissions.js's getCandidatePageKeys() maps each module to.
const REMINDER_PAGE_KEYS: Record<string, string[]> = {
  purchase_order: ["purchase-orders"],
  grn: ["grn-master", "grns"],
  tds: ["tds-master"],
  work_order: ["work-order", "engineering-work-order"],
};

function hasReminderAccess(
  role: string | undefined,
  pagePermissions: { page: string; actions: string[] }[] | undefined,
  reminderType: keyof typeof REMINDER_PAGE_KEYS,
): boolean {
  if (role && PRIVILEGED_REMINDER_ROLES.has(role)) return true;
  if (!Array.isArray(pagePermissions)) return false;
  const candidates = REMINDER_PAGE_KEYS[reminderType];
  return pagePermissions.some(
    (p) =>
      candidates.includes(String(p.page).toLowerCase()) &&
      Array.isArray(p.actions) &&
      p.actions.map((a) => String(a).toLowerCase()).includes("view"),
  );
}

export async function fetchAllReminders(
  role?: string,
  pagePermissions?: { page: string; actions: string[] }[],
): Promise<ReminderItem[]> {
  if (role === "customer") return fetchCustomerReminders();

  // Only fetch the sources this user/role actually has view rights to —
  // previously this called all five endpoints unconditionally for every
  // role, which always 403'd (and logged console errors) for anyone whose
  // role lacked, e.g., Work Order or GRN access, even though the bell is
  // just a best-effort notification widget.
  const maybeFetch = (url: string, type: keyof typeof REMINDER_PAGE_KEYS) =>
    hasReminderAccess(role, pagePermissions, type)
      ? fetchWithAuth(url)
      : Promise.resolve(null);

  const [poRes, grnRes, tdsRes, woRes] = await Promise.allSettled([
    maybeFetch("/api/purchase-orders", "purchase_order"),
    maybeFetch("/api/grns", "grn"),
    maybeFetch("/api/tds-master", "tds"),
    maybeFetch("/api/work-orders", "work_order"),
  ]);

  const toList = async (res: PromiseSettledResult<Response | null>) => {
    if (res.status !== "fulfilled" || !res.value || !res.value.ok) return [];
    const raw = await res.value.json().catch(() => ({}));
    return Array.isArray(raw) ? raw : (raw.data ?? []);
  };
  const grnList: any[] = await toList(grnRes);

  // PO/GRN reminders are a "build the next document" nudge — a PO reminder
  // is still relevant until a GRN exists against it, and a GRN reminder is
  // still relevant until an Invoice/Expense Booking exists against it,
  // *regardless* of the PO/GRN's own Approved status. Once that next link
  // in the chain has actually been created, the reminder has done its job
  // and should drop off — it no longer matters whether that next document
  // has itself been paid.
  const poIdsWithGrn = new Set<string>();
  for (const grn of grnList) {
    if (grn.POID) poIdsWithGrn.add(String(grn.POID));
  }

  const invoicedSources = new Set<string>();
  try {
    const ebRes = await fetchWithAuth("/api/expense-booking?limit=200");
    if (ebRes.ok) {
      const ebRaw = await ebRes.json();
      const ebList: any[] = Array.isArray(ebRaw) ? ebRaw : (ebRaw.data ?? []);
      for (const eb of ebList) {
        const sourceType = String(eb.ESourceType || eb.eSourceType || "").toUpperCase();
        const sourceId = eb.ESourceId ?? eb.eSourceId;
        if (!sourceId) continue;
        if (sourceType === "PO" || sourceType === "WO_PO") {
          invoicedSources.add(`purchase_order-${sourceId}`);
        } else if (sourceType === "GRN") {
          invoicedSources.add(`grn-${sourceId}`);
        }
      }
    }
  } catch {
    // Best-effort — if this fails, PO/GRN reminders just fall back to the
    // chain-link check below (GRN existence for PO) rather than blocking
    // the whole bell.
  }

  const items: ReminderItem[] = [];
  const process = (
    list: any[],
    type: ReminderType,
    idKey: string,
    titlePre: string,
    route: string,
  ) => {
    list.forEach((obj: any) => {
      const d =
        obj.ExpectedDeliveryDate ||
        obj.PODate ||
        obj.GRNDate ||
        obj.ChequeDate ||
        obj.DueDate;
      const recordId = obj[idKey];
      if (!d || !recordId) return;

      // PO: drop once a GRN has been built against it.
      // GRN: drop once an Invoice/Expense Booking has been built against it.
      if (type === "purchase_order" && poIdsWithGrn.has(String(recordId))) return;
      if (
        (type === "purchase_order" || type === "grn") &&
        invoicedSources.has(`${type}-${recordId}`)
      )
        return;

      const urgency = classifyUrgency(d);

      // PO/GRN pages support `?view=<id>` deep-linking; cheque/TDS/work
      // order pages don't yet, so they keep landing on the plain list.
      const deepLinkable = type === "purchase_order" || type === "grn";

      items.push({
        id: `${type}-${recordId}`,
        type,
        title: `${titlePre} #${obj.PurchaseOrderNo || obj.GRNNo || recordId}`,
        subtitle: obj.SupplierName || obj.PartyName || "Civilier System",
        dueDate: d,
        urgency,
        amount: obj.TotalAmount || obj.TDSAmount || obj.Amount,
        path: deepLinkable ? `${route}?view=${recordId}` : route,
      });
    });
  };

  const [poList, tdsList, woList] = await Promise.all([
    toList(poRes),
    toList(tdsRes),
    toList(woRes),
  ]);
  const [, emiItems, mrItems, pdcItems, followupItems] = await Promise.all([
    Promise.resolve().then(() => {
      process(poList, "purchase_order", "PurchaseOrderID", "PO", "/material/purchase-order");
      process(grnList, "grn", "GRNID", "GRN", "/material/grn");
      process(tdsList, "tds", "Id", "TDS", "/masters/tds");
      process(woList, "work_order", "Id", "WO", "/material/work-order");
    }),
    fetchEmiReminders().catch(() => [] as ReminderItem[]),
    fetchMaterialRequestReminders().catch(() => [] as ReminderItem[]),
    fetchPdcReminders().catch(() => [] as ReminderItem[]),
    fetchFollowUpReminders().catch(() => [] as ReminderItem[]),
  ]);

  items.push(...emiItems);
  items.push(...mrItems);
  items.push(...pdcItems);
  items.push(...followupItems);

  return items.sort((a, b) => {
    const order = { overdue: 0, today: 1, soon: 2, upcoming: 3 };
    return order[a.urgency] - order[b.urgency];
  });
}

export function useReminders(options: { pollingInterval?: number } = {}) {
  const { pollingInterval = 0 } = options;
  const { currentUser } = useAuth();
  const role = currentUser?.role;
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  const isFetching = useRef(false);
  const clickCount = useRef(0);
  const lockTimer = useRef<NodeJS.Timeout | null>(null);
  const failCount = useRef(0);
  const backoffTimer = useRef<NodeJS.Timeout | null>(null);

  const refresh = useCallback(
    async (isManual = false) => {
      if (isFetching.current || isLocked) return;

      if (isManual) {
        clickCount.current += 1;
        if (clickCount.current > 5) {
          setIsLocked(true);
          if (lockTimer.current) clearTimeout(lockTimer.current);
          lockTimer.current = setTimeout(() => {
            setIsLocked(false);
            clickCount.current = 0;
          }, 5000);
          return;
        }
        setTimeout(() => {
          clickCount.current = 0;
        }, 2000);
      }

      if (!role) {
        isFetching.current = false;
        return;
      }
      isFetching.current = true;
      if (isManual) setLoading(true);

      try {
        const items = await fetchAllReminders(
          role,
          currentUser?.pagePermissions,
        );
        setReminders([...items]);
        failCount.current = 0;
      } catch {
        failCount.current += 1;
      } finally {
        setTimeout(() => {
          setLoading(false);
          isFetching.current = false;
        }, 600);
      }
    },
    [isLocked, role, currentUser?.pagePermissions],
  );

  useEffect(() => {
    if (!role) return;
    let cancelled = false;

    refresh();

    if (pollingInterval <= 0) {
      return () => {
        cancelled = true;
        if (backoffTimer.current) clearTimeout(backoffTimer.current);
      };
    }

    const schedule = () => {
      if (cancelled) return;

      const delay =
        failCount.current > 3
          ? Math.min(
              pollingInterval * Math.pow(2, failCount.current - 3),
              5 * 60 * 1000,
            )
          : pollingInterval;

      backoffTimer.current = setTimeout(() => {
        // Do NOT use .finally(schedule) because that can schedule twice
        // when the component unmounts/re-mounts or when refresh exits early.
        // Instead, schedule only after refresh() settles.
        void refresh(false).then(() => {
          if (!cancelled) schedule();
        });
      }, delay);
    };

    schedule();

    return () => {
      cancelled = true;
      if (backoffTimer.current) clearTimeout(backoffTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const badgeCount = reminders.length; // all items with a due date trigger the bell
  return { reminders, loading, badgeCount, refresh, isLocked };
}
