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
import * as Application from "expo-application";
import type * as NotificationsModule from "expo-notifications";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { isRunningInExpoGo } from "expo";
import * as SecureStore from "expo-secure-store";
import { fetchWithAuth } from "@/services/fetchWithAuth";

const TOKEN_KEY = "push_token";

/** Expo Go (SDK 53 and later) has no remote push on Android, and on SDK 58 its push calls throw. Push needs a real
 * build (the APK); in Expo Go and on the web the app runs without it. */
export const pushAvailable =
  Platform.OS !== "web" && !isRunningInExpoGo() && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

/** expo-notifications, loaded only where push can work. Importing it in Expo Go is what prints the "Push
 * notifications are unavailable in Expo Go" and "not fully supported in Expo Go" warnings on every start, so it is
 * required on first use in a real build instead of imported at the top. Null in Expo Go and on the web. */
let loaded: typeof NotificationsModule | null | undefined;
export function notifications(): typeof NotificationsModule | null {
  if (loaded !== undefined) return loaded;
  if (!pushAvailable) return (loaded = null);
  const mod: typeof NotificationsModule = require("expo-notifications");
  // While the app is open, still show the notification as a banner.
  mod.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  return (loaded = mod);
}

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
  const Notifications = notifications();
  if (!Notifications) return null;
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

    // The installed build (Android version code), so publishing a newer one in APK Manager notifies this phone.
    const versionCode = Number(Application.nativeBuildVersion) || undefined;
    const ok = await post("/api/push-devices/register", { token, appKey, platform: Platform.OS, versionCode });
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
