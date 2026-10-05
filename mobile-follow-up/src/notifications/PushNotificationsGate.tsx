import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { useAuth } from "@/auth/AuthContext";
import { registerForPushAsync } from "./pushNotifications";

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
  const userId = currentUser?.id;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (!userId) return;
    void registerForPushAsync(appKey);
    const sub = Notifications.addPushTokenListener(() => void registerForPushAsync(appKey));
    return () => sub.remove();
  }, [userId, appKey]);

  useEffect(() => {
    if (!userId) return;
    const handle = (response: Notifications.NotificationResponse) => {
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
