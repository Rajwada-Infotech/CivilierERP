import { useEffect, useRef } from "react";
import type * as NotificationsModule from "expo-notifications";
import { useAuth } from "@/auth/AuthContext";
import { notifications, registerForPushAsync } from "./pushNotifications";
import { CUSTOMER_PUSH } from "@/api/customerPortalApi";
import { queryClient } from "@/services/queryClient";

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
  // A customer's phone registers through their own sign-in (migration 692).
  const userId = currentUser ? `customer:${currentUser.id}` : undefined;
  const endpoint = CUSTOMER_PUSH;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const Notifications = notifications();
    if (!userId || !Notifications) return;
    void registerForPushAsync(appKey, endpoint);
    const sub = Notifications.addPushTokenListener(() => void registerForPushAsync(appKey, endpoint));
    return () => sub.remove();
  }, [userId, appKey, endpoint]);

  useEffect(() => {
    const Notifications = notifications();
    if (!userId || !Notifications) return;
    const handle = (response: NotificationsModule.NotificationResponse) => {
      const data = (response.notification.request.content.data ?? {}) as PushPayload;
      onOpenRef.current?.(data);
    };
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    // A message arriving while the app is open means something changed for this person: refresh what is on screen.
    const arrived = Notifications.addNotificationReceivedListener(() => { void queryClient.invalidateQueries(); });
    // The tap that started the app from closed.
    const launched = Notifications.getLastNotificationResponse();
    if (launched) {
      handle(launched);
      Notifications.clearLastNotificationResponse();
    }
    return () => { sub.remove(); arrived.remove(); };
  }, [userId]);

  return null;
}
