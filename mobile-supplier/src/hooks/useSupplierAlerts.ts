// RN port of the alert-derivation logic in src/pages/supplier/SupplierNotifications.tsx
// (web) — there's no dedicated notifications table/endpoint on the backend;
// both the web bell and this one compute the same list client-side from
// quotations + GRN summary, which the app is already fetching elsewhere.
// Shared by TopHeader (badge count) and NotificationsScreen (full list) —
// same queryKeys mean React Query serves both from one network fetch.
import { useQuery } from "@tanstack/react-query";
import * as spApi from "@/api/supplierPortalApi";

export type SupplierAlertType = "overdue" | "due_soon" | "new" | "submitted" | "goods_pending";

export interface SupplierAlert {
  id: string;
  type: SupplierAlertType;
  title: string;
  subtitle: string;
  time?: string | null;
  route: "QuotationDetail" | "OrderDetail";
  params: { id: number };
}

const ORDER: Record<SupplierAlertType, number> = {
  overdue: 0,
  due_soon: 1,
  new: 2,
  goods_pending: 3,
  submitted: 4,
};

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function useSupplierAlerts() {
  const quotationsQ = useQuery({
    queryKey: ["supplier-quotations"],
    queryFn: spApi.getSupplierQuotations,
    refetchInterval: 60_000,
  });
  const grnQ = useQuery({
    queryKey: ["supplier-grns"],
    queryFn: spApi.getSupplierGrnSummary,
    refetchInterval: 60_000,
  });

  const quotations = quotationsQ.data ?? [];
  const grnOrders = grnQ.data ?? [];
  const isLoading = quotationsQ.isLoading || grnQ.isLoading;
  const isFetching = quotationsQ.isFetching || grnQ.isFetching;
  const refetch = () => {
    quotationsQ.refetch();
    grnQ.refetch();
  };

  const now = Date.now();
  const THREE_DAYS = 3 * 86_400_000;
  const alerts: SupplierAlert[] = [];

  quotations.forEach((q) => {
    const due = q.DueDate ? new Date(q.DueDate).getTime() : null;
    const invited = q.InvitedAt ? new Date(q.InvitedAt).getTime() : null;
    const isPending = q.MySubmissionStatus === "Pending";
    const isSubmitted = q.MySubmissionStatus === "Submitted";

    if (isPending && due && due < now) {
      alerts.push({
        id: `overdue-${q.QuotationId}`,
        type: "overdue",
        title: `${q.DocNo} is overdue`,
        subtitle: `Due ${fmtDate(q.DueDate)} — ${q.ItemCount} item${q.ItemCount !== 1 ? "s" : ""} awaiting your rates`,
        time: q.DueDate,
        route: "QuotationDetail",
        params: { id: q.QuotationId },
      });
    } else if (isPending && due && due - now <= THREE_DAYS) {
      alerts.push({
        id: `soon-${q.QuotationId}`,
        type: "due_soon",
        title: `${q.DocNo} due soon`,
        subtitle: `Closes ${fmtDate(q.DueDate)} — ${q.ItemCount} item${q.ItemCount !== 1 ? "s" : ""} need rates`,
        time: q.DueDate,
        route: "QuotationDetail",
        params: { id: q.QuotationId },
      });
    } else if (isPending && invited && now - invited < 7 * 86_400_000) {
      alerts.push({
        id: `new-${q.QuotationId}`,
        type: "new",
        title: `New RFQ: ${q.DocNo}`,
        subtitle: `${q.CompanyName ?? "Company"} — ${q.ItemCount} item${q.ItemCount !== 1 ? "s" : ""}, due ${fmtDate(q.DueDate)}`,
        time: q.InvitedAt,
        route: "QuotationDetail",
        params: { id: q.QuotationId },
      });
    } else if (isSubmitted) {
      alerts.push({
        id: `submitted-${q.QuotationId}`,
        type: "submitted",
        title: `${q.DocNo} submitted`,
        subtitle: "Your prices have been shared with the procurement team",
        time: q.SubmittedAt ?? q.InvitedAt,
        route: "QuotationDetail",
        params: { id: q.QuotationId },
      });
    }
  });

  grnOrders.forEach((o) => {
    if (o.isFullyReceived) return;
    const shortfall = o.items.filter((it) => it.remainingQty > 0);
    alerts.push({
      id: `goods-${o.purchaseOrderId}`,
      type: "goods_pending",
      title: `${o.docNo}: ${o.totalRemaining} item${o.totalRemaining !== 1 ? "s" : ""} still pending`,
      subtitle: shortfall.map((it) => `${it.remainingQty} ${it.uom ?? ""} ${it.itemName}`.trim()).join(", "),
      route: "OrderDetail",
      params: { id: o.purchaseOrderId },
    });
  });

  alerts.sort((a, b) => ORDER[a.type] - ORDER[b.type]);

  return { alerts, isLoading, isFetching, refetch };
}
