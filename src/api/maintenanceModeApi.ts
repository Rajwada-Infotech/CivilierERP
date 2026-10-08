import { fetchWithAuth } from "@/lib/fetchWithAuth";

export interface MaintenanceState {
  active: boolean;
  title: string | null;
  message: string | null;
  startedAt: string | null;
  endsAt: string | null;
  updatedBy: string | null;
}

/** Public: no sign-in needed, and it keeps answering while maintenance is on. */
export async function getMaintenanceStatus(): Promise<MaintenanceState> {
  const res = await fetch("/api/system-maintenance/status", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not check the system status");
  return res.json();
}

export async function setMaintenanceMode(input: {
  active: boolean;
  title?: string;
  message?: string;
  endsAt?: string | null;
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
