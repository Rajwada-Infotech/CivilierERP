// Phone push notifications (Expo push service -> FCM on Android).
//
//   registerForPushAsync(appKey)  ask permission, get this phone's Expo push
//                                 token, and tell the backend which user owns it
//   unregisterPushAsync()         tell the backend to stop (call BEFORE logout
//                                 clears the session token)
//
// Everything here is best-effort and never throws: a phone without Firebase
// configured, a denied permission, or a flaky connection must not break login.
// Identical in every Civilier mobile app; only the `appKey` differs.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { fetchWithAuth } from "@/services/fetchWithAuth";

const TOKEN_KEY = "push_token";

// While the app is open, still show the notification as a banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function post(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetchWithAuth(path, { method: "POST", body: JSON.stringify(body), skipActivityLog: true });
    return res.ok;
  } catch {
    return false;
  }
}

/** Returns the Expo push token once it is registered with the backend, else null. */
export async function registerForPushAsync(appKey: string): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    // Android needs a channel before it will show the permission prompt (13+) or any notification.
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Notifications",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== "granted") return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return null;

    const ok = await post("/api/push-devices/register", { token, appKey, platform: Platform.OS });
    if (!ok) return null;
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    return token;
  } catch (err) {
    // Typically: this build has no Firebase (google-services.json) configured yet.
    console.warn("[push] could not register for notifications:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Stop this phone receiving the signed-in user's notifications. Needs the session token, so call it before clearing auth. */
export async function unregisterPushAsync(): Promise<void> {
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!token) return;
    await post("/api/push-devices/unregister", { token });
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    /* logging out must always succeed */
  }
}
