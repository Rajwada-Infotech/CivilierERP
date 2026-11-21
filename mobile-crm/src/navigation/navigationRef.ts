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

/** Open one of the bottom tabs from anywhere. */
export function openTab(tab: keyof TabParamList) {
  go("Tabs", { screen: tab });
}

/** What a notification is about, as the server sends it: a bell item (dbo.SaNotification — type, refId, refType) or
 * a push's data (approvalNotifications.js: type "approval-waiting" / "approval-outcome"; notify.js: type "reminder"
 * with notificationType, refId, refType). */
export interface NotificationRef { type?: unknown; notificationType?: unknown; refId?: unknown; refType?: unknown }

/** The screen a notification opens: an approval → the Approval Inbox, a booking (or a payment Finance returned on
 * one) → that booking, a service ticket → that ticket, a payment milestone → Demands; anything else → Notifications. */
export function notificationTarget(n: NotificationRef): { route: string; params?: object } {
  const type = String(n.type ?? "");
  const refType = String(n.refType ?? "");
  const refId = Number(n.refId);
  if (type.startsWith("approval-")) return { route: "Tabs", params: { screen: "Approvals" } };
  if (refId > 0 && (refType === "crm_booking" || refType === "crm_payment")) return { route: "CrmBooking", params: { bookingId: refId } };
  if (refId > 0 && refType === "service_ticket") return { route: "CrmTicket", params: { ticketId: refId } };
  if (refType === "payment_milestone") return { route: "CrmRegister", params: { register: "demands" } };
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
