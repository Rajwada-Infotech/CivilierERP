import { useEffect, useRef } from "react";
import type * as NotificationsModule from "expo-notifications";
import { useAuth } from "@/auth/AuthContext";
import { notifications, registerForPushAsync } from "./pushNotifications";

export type PushPayload = Record<string, unknown>;

/**
 * Mount once inside <AuthProvider>. Registers this phone for push whenever a user
 * is signed in, re-registers if Expo rotates the token, and calls `onOpen` with the
 * notification's data when one is tapped (including the tap that launched the app).
 */
export function PushNotificationsGate({
  appKey, onOpen,
}: { appKey: string; onOpen?: (data: PushPayload) => void }) {
  const { currentUser } = useAuth();
  // Residents (customer-portal sign-in) register through the portal's own route; staff through the staff one.
  const userId = currentUser ? `${currentUser.kind ?? "staff"}:${currentUser.id}` : undefined;
  const portal = currentUser?.kind === "customer";
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const Notifications = notifications();
    if (!userId || !Notifications) return;
    void registerForPushAsync(appKey, portal);
    const sub = Notifications.addPushTokenListener(() => void registerForPushAsync(appKey, portal));
    return () => sub.remove();
  }, [userId, appKey, portal]);

  useEffect(() => {
    const Notifications = notifications();
    if (!userId || !Notifications) return;
    const handle = (response: NotificationsModule.NotificationResponse) => {
      const data = (response.notification.request.content.data ?? {}) as PushPayload;
      onOpenRef.current?.(data);
    };
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    // The tap that started the app from closed.
    const launched = Notifications.getLastNotificationResponse();
    if (launched) {
      handle(launched);
      Notifications.clearLastNotificationResponse();
    }
    return () => sub.remove();
  }, [userId]);

  return null;
}
