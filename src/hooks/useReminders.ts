import { useState, useEffect, useCallback, useRef } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";

export type ReminderType =
  | "cheque"
  | "purchase_order"
  | "work_order"
  | "tds"
  | "grn"
  | "emi_installment"
  | "material_request";

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
    // Fetch all expense bookings and look for pending EMI installments due soon
    const res = await fetchWithAuth("/api/expense-booking?limit=200");
    if (!res.ok) return [];
    const data = await res.json();
    const rows: any[] = Array.isArray(data) ? data : (data.data ?? []);

    const items: ReminderItem[] = [];

    for (const row of rows) {
      if (!row.EEmiPayment) continue;
      let emiData: any = null;
      try {
        emiData = JSON.parse(row.EEmiData || "{}");
      } catch (_e) {
        // ignore malformed EMI JSON — treat as empty schedule
      }
      const schedule: any[] = emiData?.schedule ?? [];

      for (const inst of schedule) {
        if (inst.status === "Paid") continue;
        const urgency = classifyUrgency(inst.dueDate);

        items.push({
          id: `emi-${row.Eid}-${inst.installmentNo}`,
          type: "emi_installment",
          title: `EMI #${inst.installmentNo} — ${inst.refNumber || row.EDocNo || "—"}`,
          subtitle: `${row.EProjectName || "Expense Booking"} · Installment ${inst.installmentNo}/${emiData?.installmentCount ?? "?"}`,
          dueDate: inst.dueDate,
          urgency,
          amount: inst.amount,
          path: "/material/expense-booking",
        });
      }
    }
    return items;
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

    // Statuses that need action / attention
    const ACTIONABLE = new Set(["Pending", "Approved", "Partially Ordered"]);

    return list
      .filter((r) => ACTIONABLE.has(r.Status))
      .map((r) => {
        // Use RequiredByDate for urgency if set; otherwise treat as "upcoming"
        // so MRs without a deadline don't incorrectly show as overdue.
        const dueDate: string = r.RequiredByDate
          ? String(r.RequiredByDate).slice(0, 10)
          : String(r.RequestDate ?? new Date().toISOString()).slice(0, 10);

        const urgency: ReminderItem["urgency"] = r.RequiredByDate
          ? classifyUrgency(String(r.RequiredByDate).slice(0, 10))
          : "upcoming";

        return {
          id: `mr-${r.MRId}`,
          type: "material_request" as ReminderType,
          title: `MR ${r.DocNo || `#${r.MRId}`}`,
          subtitle: `${r.ProjectName || r.CompanyName || "Material Request"} · ${r.Status} · ${r.Priority || "Normal"} priority`,
          dueDate,
          urgency,
          path: "/material/material-request",
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
  cheque: ["cheque-master"],
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

  const [poRes, grnRes, chequeRes, tdsRes, woRes] = await Promise.allSettled([
    maybeFetch("/api/purchase-orders", "purchase_order"),
    maybeFetch("/api/grns", "grn"),
    maybeFetch("/api/cheque-master", "cheque"),
    maybeFetch("/api/tds-master", "tds"),
    maybeFetch("/api/work-orders", "work_order"),
  ]);

  const items: ReminderItem[] = [];
  const process = async (
    res: PromiseSettledResult<Response | null>,
    type: ReminderType,
    idKey: string,
    titlePre: string,
    route: string,
  ) => {
    if (res.status === "fulfilled" && res.value && res.value.ok) {
      const raw = await res.value.json();
      const list = Array.isArray(raw) ? raw : (raw.data ?? []);
      list.forEach((obj: any) => {
        const d =
          obj.ExpectedDeliveryDate ||
          obj.PODate ||
          obj.GRNDate ||
          obj.ChequeDate ||
          obj.DueDate;
        const recordId = obj[idKey];
        if (!d || !recordId) return;

        const urgency = classifyUrgency(d);

        items.push({
          id: `${type}-${recordId}`,
          type,
          title: `${titlePre} #${obj.PurchaseOrderNo || obj.GRNNo || recordId}`,
          subtitle: obj.SupplierName || obj.PartyName || "Civilier System",
          dueDate: d,
          urgency,
          amount: obj.TotalAmount || obj.TDSAmount || obj.Amount,
          path: `${route}`,
        });
      });
    }
  };

  const FINANCE_ROLES = [
    "admin",
    "super_admin",
    "dba",
    "finance_manager",
    "branch_manager",
  ];
  const hasFinanceAccess = FINANCE_ROLES.includes(role || "");
  const [, emiItems, mrItems] = await Promise.all([
    Promise.all([
      process(
        poRes,
        "purchase_order",
        "PurchaseOrderID",
        "PO",
        "/material/purchase-order",
      ),
      process(grnRes, "grn", "GRNID", "GRN", "/material/grn"),
      process(chequeRes, "cheque", "CId", "CHQ", "/masters/cheque"),
      process(tdsRes, "tds", "Id", "TDS", "/masters/tds"),
      process(woRes, "work_order", "Id", "WO", "/material/work-order"),
    ]),
    (hasFinanceAccess
      ? fetchEmiReminders()
      : Promise.resolve([] as ReminderItem[])
    ).catch(() => [] as ReminderItem[]),
    fetchMaterialRequestReminders().catch(() => [] as ReminderItem[]),
  ]);

  items.push(...emiItems);
  items.push(...mrItems);

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
