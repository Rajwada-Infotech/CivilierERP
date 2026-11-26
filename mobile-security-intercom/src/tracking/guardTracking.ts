// On-shift location tracking for guards (doc phase 3). Runs only between shift start and end: started from the guard's
// home when the shift is on and the guard has agreed, stopped when the shift ends (the server answers onShift: false),
// at sign-out, or by the guard. Android keeps it alive with a persistent "On shift" notification (a foreground service);
// iOS shows the blue location indicator.
//
// Adaptive: the phone reports every ~5 s; a point is kept every 5 s while moving (faster than walking pace, or 15 m from
// the last kept point) and once a minute when still. Kept points are queued in a file and uploaded in batches (every
// 30 s or 6 points), so nothing is lost while offline; the server stores each point once.
//
// Must be imported at app start (index.ts) so the task exists when Android runs it with the app closed.
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as Battery from "expo-battery";
import * as SecureStore from "expo-secure-store";
import * as FileSystem from "expo-file-system/legacy";
import { AppState } from "react-native";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { inExpoGo } from "@/screens/calls/callSupport";

export const TRACKING_TASK = "civilier-security-guard-tracking";
const QUEUE_FILE = `${FileSystem.documentDirectory ?? ""}ping-queue.json`;
const CONSENT_KEY = "security-tracking-consent";
const MOVING_EVERY_MS = 5_000;
const STILL_EVERY_MS = 60_000;
const UPLOAD_EVERY_MS = 30_000;
const UPLOAD_AT = 6;
const MAX_QUEUE = 5_000;

type Ping = { at: string; lat: number; lng: number; accuracy: number | null; battery: number | null };

let queue: Ping[] | null = null;
let lastKept: { t: number; lat: number; lng: number } | null = null;
let lastUpload = 0;
let uploading = false;

function metres(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const x = r(bLng - aLng) * Math.cos(r((aLat + bLat) / 2));
  const y = r(bLat - aLat);
  return Math.sqrt(x * x + y * y) * 6371000;
}

async function loadQueue(): Promise<Ping[]> {
  if (queue) return queue;
  try {
    const info = await FileSystem.getInfoAsync(QUEUE_FILE);
    queue = info.exists ? JSON.parse(await FileSystem.readAsStringAsync(QUEUE_FILE)) : [];
  } catch {
    queue = [];
  }
  return queue!;
}
async function saveQueue() {
  try {
    await FileSystem.writeAsStringAsync(QUEUE_FILE, JSON.stringify(queue ?? []));
  } catch {
    /* kept in memory until the next write */
  }
}

/** Sends the queued points (up to 200 per request). Stops tracking when the server says the shift is over. */
export async function uploadPings(force = false) {
  if (uploading) return;
  const q = await loadQueue();
  if (!q.length || (!force && q.length < UPLOAD_AT && Date.now() - lastUpload < UPLOAD_EVERY_MS)) return;
  uploading = true;
  try {
    while (q.length) {
      const batch = q.slice(0, 200);
      const res = await fetchWithAuth("/api/security/pings", { method: "POST", body: JSON.stringify({ pings: batch }), skipActivityLog: true });
      if (!res.ok) break; // refused (signed out, no longer a guard): keep them for now
      const body = await res.json().catch(() => ({}));
      q.splice(0, batch.length);
      await saveQueue();
      lastUpload = Date.now();
      if (body?.onShift === false) {
        await stopTracking(false);
        break;
      }
    }
  } catch {
    /* offline: the next point tries again */
  } finally {
    uploading = false;
  }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TRACKING_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const q = await loadQueue();
  let battery: number | null = null;
  try {
    const level = await Battery.getBatteryLevelAsync();
    battery = level >= 0 ? Math.round(level * 100) : null;
  } catch {
    /* no battery reading */
  }
  for (const l of data.locations) {
    const t = l.timestamp;
    const { latitude: lat, longitude: lng, accuracy, speed } = l.coords;
    const moving = (speed ?? 0) > 0.7 || (lastKept ? metres(lastKept.lat, lastKept.lng, lat, lng) > 15 : true);
    const gap = lastKept ? t - lastKept.t : Infinity;
    if (gap < (moving ? MOVING_EVERY_MS : STILL_EVERY_MS)) continue;
    lastKept = { t, lat, lng };
    q.push({ at: new Date(t).toISOString(), lat, lng, accuracy: accuracy ?? null, battery });
  }
  if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE);
  await saveQueue();
  await uploadPings();
});

export async function isTracking() {
  try {
    return await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK);
  } catch {
    return false;
  }
}

export async function hasConsent() {
  try {
    return (await SecureStore.getItemAsync(CONSENT_KEY)) === "yes";
  } catch {
    return false;
  }
}
export async function setConsent(yes: boolean) {
  try {
    if (yes) await SecureStore.setItemAsync(CONSENT_KEY, "yes");
    else await SecureStore.deleteItemAsync(CONSENT_KEY);
  } catch {
    /* asked again next time */
  }
}

export type StartResult = "started" | "no-permission" | "no-background-permission" | "unavailable" | "background" | "failed";

let lastError: string | null = null;
/** Why the last start failed ("failed" result): the phone's own error text. */
export const lastTrackingError = () => lastError;

/** Asks for location "all the time" and starts the shift tracking. */
export async function startTracking(): Promise<StartResult> {
  lastError = null;
  // Only Expo Go lacks background location; the installed app has it.
  if (inExpoGo()) return "unavailable";
  try {
    if (await isTracking()) return "started";
    // Android won't start the "On shift" service while the app is in the background; it is retried on return.
    if (AppState.currentState !== "active") return "background";
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== "granted") return "no-permission";
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== "granted") return "no-background-permission";
    await Location.startLocationUpdatesAsync(TRACKING_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: MOVING_EVERY_MS,
      distanceInterval: 0,
      deferredUpdatesInterval: MOVING_EVERY_MS,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Other,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "On shift",
        notificationBody: "Your location is shared with the security supervisor until your shift ends.",
        notificationColor: "#1a1a1a",
        killServiceOnDestroy: false,
      },
    });
    return "started";
  } catch (e) {
    lastError = (e as Error)?.message ?? String(e);
    console.warn("[tracking] start failed:", lastError);
    return "failed";
  }
}

/** Stops tracking; sends what is queued first unless the caller is already doing so. */
export async function stopTracking(flush = true) {
  try {
    if (await isTracking()) await Location.stopLocationUpdatesAsync(TRACKING_TASK);
  } catch {
    /* not running */
  }
  lastKept = null;
  if (flush) await uploadPings(true);
}

/** How many points are waiting to be uploaded. */
export async function queuedPings() {
  return (await loadQueue()).length;
}
