// On-duty movement tracking. While the employee is punched in, Android reports the location after every 100 m move
// (not on a timer), also when the app is closed, through a foreground-service notification. Each point goes to the
// server, which records trips outside the employee's own work location and visits to other Work Location Master offices.
// Started after Punch In (and whenever the app sees the employee is on duty); stopped at Punch Out and on sign-out.
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { api, type LocationPoint } from "@/api/employeeApi";

export const MOVEMENT_TASK = "civilier-on-duty-movement";

// Must be defined at module load (imported from index.ts) so Android can run it with the app closed.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(MOVEMENT_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const points: LocationPoint[] = data.locations.map((l) => ({
    lat: l.coords.latitude, lng: l.coords.longitude, acc: l.coords.accuracy ?? null, at: new Date(l.timestamp).toISOString(),
  }));
  try {
    const r = await api.sendLocation(points);
    if (!r.tracking) await stopMovementTracking(); // punched out elsewhere (web / HR)
  } catch { /* offline or signed out — the next move sends again */ }
});

export async function isTracking() {
  try { return await Location.hasStartedLocationUpdatesAsync(MOVEMENT_TASK); } catch { return false; }
}

/** Ask for "Allow all the time" and start the 100 m updates. Returns false when the employee did not allow it. */
export async function startMovementTracking(): Promise<boolean> {
  try {
    if (await isTracking()) return true;
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== "granted") return false;
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== "granted") return false;
    await Location.startLocationUpdatesAsync(MOVEMENT_TASK, {
      accuracy: Location.Accuracy.High,
      distanceInterval: 100,
      deferredUpdatesDistance: 100,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "On duty",
        notificationBody: "Your location is shared with HR while you are punched in.",
        notificationColor: "#1a1a1a",
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function stopMovementTracking() {
  try { if (await isTracking()) await Location.stopLocationUpdatesAsync(MOVEMENT_TASK); } catch { /* not running */ }
}
