import { fetchWithAuth } from "@/lib/fetchWithAuth";

export interface MaintenanceState {
  active: boolean;
  /** False while it is only announced (people can still finish their work), true once everyone is held. */
  enforced: boolean;
  title: string | null;
  message: string | null;
  startedAt: string | null;
  /** When maintenance begins holding people; null = at once. */
  startsAt: string | null;
  endsAt: string | null;
  updatedBy: string | null;
}

/**
 * Public: no sign-in needed, and it keeps answering while maintenance is on. When there IS a signed-in person the token
 * is sent anyway, only so the server counts the request against that person's rate limit instead of the shared
 * anonymous one (behind Docker every anonymous request comes from the same address).
 */
export async function getMaintenanceStatus(): Promise<MaintenanceState> {
  let token: string | null = null;
  try {
    token = sessionStorage.getItem("token");
  } catch {
    /* storage can be blocked */
  }
  const res = await fetch("/api/system-maintenance/status", {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error("Could not check the system status");
  return res.json();
}

export async function setMaintenanceMode(input: {
  active: boolean;
  title?: string;
  message?: string;
  endsAt?: string | null;
  /** Minutes of warning before everyone is held (0 = at once). */
  startInMinutes?: number;
}): Promise<MaintenanceState> {
  const res = await fetchWithAuth("/api/system-maintenance", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || "Could not change maintenance mode");
  return body as MaintenanceState;
}
