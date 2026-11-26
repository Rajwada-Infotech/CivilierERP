// Service entries (guard): vehicles and workers in for maintenance or other official work, logged in and out at the gate.
// No resident is asked or notified. backend/routes/securityIntercom.js → /api/security/service-entries.
import { fetchWithAuth } from "@/services/fetchWithAuth";

export type ServiceKind = "VEHICLE" | "WORKER";
export type ServicePurpose = "MAINTENANCE" | "REPAIR" | "DELIVERY" | "CONTRACTOR" | "OFFICIAL" | "OTHER";

export const PURPOSE_LABEL: Record<ServicePurpose, string> = {
  MAINTENANCE: "Maintenance",
  REPAIR: "Repair",
  DELIVERY: "Delivery",
  CONTRACTOR: "Contractor",
  OFFICIAL: "Official",
  OTHER: "Other",
};

export interface ServiceEntry {
  id: number;
  kind: ServiceKind;
  purpose: ServicePurpose;
  personName: string;
  company: string | null;
  phone: string | null;
  vehicleNo: string | null;
  peopleCount: number;
  workArea: string | null;
  note: string | null;
  inAt: string;
  outAt: string | null;
  gateName: string;
  loggedBy: string | null;
}

export interface ServiceEntryInput {
  kind: ServiceKind;
  purpose: ServicePurpose;
  personName: string;
  company?: string;
  phone?: string;
  vehicleNo?: string;
  peopleCount?: number;
  workArea?: string;
  note?: string;
}

async function read<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `The request failed (${res.status}).`);
  return body as T;
}

export const serviceEntries = async () => read<ServiceEntry[]>(await fetchWithAuth("/api/security/service-entries"));
export const logServiceIn = async (e: ServiceEntryInput) =>
  read<ServiceEntry>(await fetchWithAuth("/api/security/service-entries", { method: "POST", body: JSON.stringify(e) }));
export const logServiceOut = async (id: number) =>
  read<ServiceEntry>(await fetchWithAuth(`/api/security/service-entries/${id}/out`, { method: "POST", body: "{}" }));
