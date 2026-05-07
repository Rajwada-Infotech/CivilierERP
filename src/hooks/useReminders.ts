import { useState, useEffect, useCallback, useRef } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export type ReminderType =
  | "cheque"
  | "purchase_order"
  | "work_order"
  | "tds"
  | "grn"
  | "emi_installment";

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
      } catch {}
      const schedule: any[] = emiData?.schedule ?? [];

      for (const inst of schedule) {
        if (inst.status === "Paid") continue;
        const urgency = classifyUrgency(inst.dueDate);
        if (urgency === "upcoming") continue; // only overdue / today / soon

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

export async function fetchAllReminders(): Promise<ReminderItem[]> {
  const [poRes, grnRes, chequeRes, tdsRes, woRes] = await Promise.allSettled([
    fetchWithAuth("/api/purchase-orders"),
    fetchWithAuth("/api/grns"),
    fetchWithAuth("/api/cheque-master"),
    fetchWithAuth("/api/tds-master"),
    fetchWithAuth("/api/work-orders"),
  ]);

  const items: ReminderItem[] = [];
  const process = async (
    res: PromiseSettledResult<Response>,
    type: ReminderType,
    idKey: string,
    titlePre: string,
    route: string,
  ) => {
    if (res.status === "fulfilled" && res.value.ok) {
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
        if (urgency === "upcoming") return;

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

  const [, emiItems] = await Promise.all([
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
    fetchEmiReminders(),
  ]);

  items.push(...emiItems);

  return items.sort((a, b) => {
    const order = { overdue: 0, today: 1, soon: 2, upcoming: 3 };
    return order[a.urgency] - order[b.urgency];
  });
}

export function useReminders(options: { pollingInterval?: number } = {}) {
  const { pollingInterval = 0 } = options;
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

      isFetching.current = true;
      if (isManual) setLoading(true);

      try {
        const items = await fetchAllReminders();
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
    [isLocked],
  );

  useEffect(() => {
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
  }, []);

  const badgeCount = reminders.filter(
    (r) => r.urgency === "overdue" || r.urgency === "today",
  ).length;
  return { reminders, loading, badgeCount, refresh, isLocked };
}
