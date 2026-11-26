// Lets code outside a screen (the header, a tapped push notification in App.tsx) open a screen, and decides where a
// notification goes — one place for both the bell (NotificationsScreen) and a tapped push.
import { createNavigationContainerRef } from "@react-navigation/native";
import type { MainStackParamList, TabParamList } from "./MainStack";

export const navigationRef = createNavigationContainerRef<MainStackParamList>();

type Go = (name: string, params?: object) => void;
const go: Go = (name, params) => {
  if (navigationRef.isReady()) (navigationRef.navigate as Go)(name, params);
};

export function navigate<RouteName extends keyof MainStackParamList>(name: RouteName, params?: MainStackParamList[RouteName]) {
  go(name, params);
}

/** The CRM lists that have their own tab (MainStack.tsx): Bookings. The CRM tab leaves it out, so no page is in
 * two places. */
export const TAB_LISTS = ["bookings"];

/** Open one of the bottom tabs from anywhere. */
export function openTab(tab: keyof TabParamList) {
  go("Tabs", { screen: tab });
}

/** What a notification is about, as the server sends it: a bell item (dbo.SaNotification — type, refId, refType) or
 * a push's data (approvalNotifications.js: type "approval-waiting" / "approval-outcome"; notify.js: type "reminder"
 * with notificationType, refId, refType). */
export interface NotificationRef { type?: unknown; notificationType?: unknown; refId?: unknown; refType?: unknown }

/** The screen a notification opens — one place for the bell and tapped push notifications.
 * refType values come from backend/services/notify.js callers and crmSlaEngine.js. */
export function notificationTarget(n: NotificationRef): { route: string; params?: object } {
  const type = String(n.type ?? "");
  const refType = String(n.refType ?? "");
  const refId = Number(n.refId);
  if (type.startsWith("approval-")) return { route: "Approvals" };
  // Entity detail screens: open the specific record when we have its id.
  if (refId > 0 && (refType === "crm_booking" || refType === "crm_payment")) return { route: "CrmBooking", params: { bookingId: refId } };
  if (refId > 0 && refType === "service_ticket") return { route: "CrmTicket", params: { ticketId: refId } };
  if (refId > 0 && refType === "crm_cancellation") return { route: "CrmCancellation", params: { cancellationId: refId } };
  if (refId > 0 && refType === "crm_refund") return { route: "CrmRefund", params: { refundId: refId } };
  if (refId > 0 && refType === "crm_invoice") return { route: "CrmInvoice", params: { invoiceId: refId } };
  if (refId > 0 && refType === "crm_money_receipt") return { route: "CrmMoneyReceipt", params: { receiptId: refId } };
  if (refId > 0 && refType === "crm_resale") return { route: "CrmResale", params: { resaleId: refId } };
  if (refId > 0 && refType === "crm_transfer_deed") return { route: "CrmTransferDeed", params: { deedId: refId } };
  if (refId > 0 && refType === "crm_ownership_change") return { route: "CrmOwnershipChange", params: { changeId: refId } };
  if (refId > 0 && refType === "crm_brokerage") return { route: "CrmBrokerage", params: { brokerageId: refId } };
  // Register lists: best destination when we only have an entity id but no dedicated screen,
  // or when the notification is about an overdue aggregate (no single record to open).
  if (refType === "payment_milestone") return { route: "CrmRegister", params: { register: "demands" } };
  if (refType === "crm_unit_change") return { route: "CrmRegister", params: { register: "unit-changes" } };
  if (refType === "crm_agreement") return { route: "CrmRegister", params: { register: "agreements" } };
  if (refType === "crm_sales_deed") return { route: "CrmRegister", params: { register: "sales-deed" } };
  if (refType === "crm_possession_notice") return { route: "CrmRegister", params: { register: "possession" } };
  return { route: "Notifications" };
}

/** A tapped push: waits for the navigator (the app may have just started), then opens what it is about. */
export function openNotification(data?: NotificationRef) {
  const { route, params } = notificationTarget(data ?? {});
  let tries = 0;
  const attempt = () => {
    if (navigationRef.isReady()) go(route, params);
    else if (tries++ < 20) setTimeout(attempt, 250);
  };
  attempt();
}
