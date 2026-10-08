import type { MaintenanceState } from "@/api/maintenanceModeApi";

// While maintenance is on, the server answers every call from anyone but a super admin with a 503 whose JSON
// carries code "MAINTENANCE" plus the message and the expected end. Any such answer - from any page, to any
// request - sends the person to the Maintenance page, which shows that message and counts down to the end.

export const MAINTENANCE_STORAGE_KEY = "maintenance:state";
export const MAINTENANCE_ROUTE = "/system-maintenance";

interface MaintenanceBody {
  code?: string;
  title?: string | null;
  message?: string | null;
  startedAt?: string | null;
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

/** If this 503 is the maintenance answer, remember it and go to the Maintenance page. Never throws. */
export async function sendToMaintenancePage(response: Response): Promise<boolean> {
  try {
    if (!(response.headers.get("content-type") || "").includes("application/json")) return false;
    const body = (await response.clone().json()) as MaintenanceBody;
    if (body?.code !== "MAINTENANCE") return false;
    try {
      const state: MaintenanceState = {
        active: true,
        title: body.title ?? null,
        message: body.message ?? null,
        startedAt: body.startedAt ?? null,
        endsAt: body.endsAt ?? null,
        updatedBy: null,
      };
      sessionStorage.setItem(MAINTENANCE_STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage can be blocked; the page asks the server anyway */
    }
    if (typeof window !== "undefined" && window.location.pathname !== MAINTENANCE_ROUTE) {
      window.location.replace(MAINTENANCE_ROUTE);
    }
    return true;
  } catch {
    return false;
  }
}
