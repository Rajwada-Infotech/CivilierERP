// The dashboard's one read. Staff: GET /api/security/dashboard?view=<guard|admin>. Residents (customer-portal token):
// GET /api/security-portal/dashboard[?residentId=<id>]. The server answers for the signed-in person only (a guard's own
// gate, a resident's own flats). A 404 means security isn't set up on this server yet, and comes back as null.
import { fetchWithAuth } from "@/services/fetchWithAuth";
import type { SecurityView } from "@/navigation/securityRole";

export type VisitorStatus = "PENDING" | "APPROVED" | "DENIED" | "NO_RESPONSE";

export interface VisitorRow {
  id: number;
  visitorName: string | null;
  reason: string;
  gateName: string;
  block: string | null;
  flat: string;
  vehicleNo: string | null;
  status: VisitorStatus;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  guardName: string | null;
  /** The guard took a photo (served only through the signed-in photo route). */
  hasPhoto?: boolean;
}

export interface SecurityAlertRow {
  id: number;
  type: "LEFT_ZONE" | "DEVICE_OFFLINE" | "UNANSWERED";
  guardName: string | null;
  zoneName: string | null;
  at: string;
  acknowledgedBy: string | null;
}

export interface GuardOnDutyRow {
  guardId: number;
  name: string;
  gateName: string | null;
  lastPingAt: string | null;
  inZone: boolean | null;
}

export interface FlatRow {
  residentId: number;
  projectName: string;
  block: string | null;
  flat: string;
  isPrimary: boolean;
}

export interface DayCount {
  date: string; // YYYY-MM-DD (IST)
  approved: number;
  denied: number;
  noResponse: number;
}

export interface SecurityDashboard {
  /** A guard's assignment for today (guard view). */
  assignment?: { gateName: string; projectName: string; shiftStart: string | null; shiftEnd: string | null; onDuty: boolean } | null;
  /** The resident's flats and which one these figures are for (customer view). */
  flats?: FlatRow[];
  residentId?: number | null;
  counts: {
    today: number;
    approved: number;
    denied: number;
    noResponse: number;
    pending: number;
    guardsOnDuty?: number;
    openAlerts?: number;
  };
  pending: VisitorRow[];
  recent: VisitorRow[];
  alerts?: SecurityAlertRow[];
  guards?: GuardOnDutyRow[];
  week?: DayCount[];
}

export async function fetchSecurityDashboard(view: SecurityView, residentId?: number | null): Promise<SecurityDashboard | null> {
  const qs = new URLSearchParams();
  if (view === "customer") {
    if (residentId) qs.set("residentId", String(residentId));
  } else qs.set("view", view);
  const base = view === "customer" ? "/api/security-portal/dashboard" : "/api/security/dashboard";
  const res = await fetchWithAuth(`${base}${qs.toString() ? `?${qs.toString()}` : ""}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `The dashboard could not be read (${res.status}).`);
  }
  return res.json();
}
