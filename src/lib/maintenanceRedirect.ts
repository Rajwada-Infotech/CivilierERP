import type { MaintenanceState } from "@/api/maintenanceModeApi";

// Once maintenance has started, the server answers every call from anyone but a super admin with a 503 whose JSON
// carries code "MAINTENANCE" plus the message and the expected end. Any such answer - from any page, to any
// request - raises MAINTENANCE_EVENT; the full-screen overlay (MaintenanceWatcher) listens and covers the app
// without reloading it, so nothing on screen is lost.

export const MAINTENANCE_STORAGE_KEY = "maintenance:state";
export const MAINTENANCE_ROUTE = "/system-maintenance";
export const MAINTENANCE_EVENT = "maintenance:enforced";

interface MaintenanceBody {
  code?: string;
  title?: string | null;
  message?: string | null;
  startedAt?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
}

/** What the last blocked call told us, so the page has something to show before its own status check answers. */
export function readStoredMaintenance(): MaintenanceState | null {
  try {
    const raw = sessionStorage.getItem(MAINTENANCE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MaintenanceState) : null;
  } catch {
    return null;
  }
}

/** If this 503 is the maintenance answer, remember it and tell the overlay to cover the app. Never throws. */
export async function sendToMaintenancePage(response: Response): Promise<boolean> {
  try {
    if (!(response.headers.get("content-type") || "").includes("application/json")) return false;
    const body = (await response.clone().json()) as MaintenanceBody;
    if (body?.code !== "MAINTENANCE") return false;
    try {
      const state: MaintenanceState = {
        active: true,
        enforced: true,
        title: body.title ?? null,
        message: body.message ?? null,
        startedAt: body.startedAt ?? null,
        startsAt: body.startsAt ?? null,
        endsAt: body.endsAt ?? null,
        updatedBy: null,
      };
      sessionStorage.setItem(MAINTENANCE_STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage can be blocked; the overlay asks the server anyway */
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(MAINTENANCE_EVENT, { detail: readStoredMaintenance() }));
    }
    return true;
  } catch {
    return false;
  }
}
