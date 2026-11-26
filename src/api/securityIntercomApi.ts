// The Civilier Security app's web admin (Maintenance → Security Gates / Security Guards / Residents):
// backend/routes/securityIntercom.js, mounted at /api/security.
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/security";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithAuth(`${BASE}${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body as T;
}
const send = <T>(method: string, path: string, data: unknown) =>
  call<T>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

export interface ProjectOption { id: number; name: string }

// ── Gates ──
export interface SecurityGate {
  id: number;
  projectId: number;
  projectName: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  guards: number;
  noResponsePolicy: NoResponsePolicy;
}
/** What the guard does when nobody at the flat answers. */
export type NoResponsePolicy = "HOLD" | "ALLOW" | "CALL_OFFICE";
export interface GateInput { projectId: number; name: string; latitude: number | null; longitude: number | null; noResponsePolicy: NoResponsePolicy; isActive?: boolean }
export const getGates = () => call<{ gates: SecurityGate[]; projects: ProjectOption[] }>("/gates");
export const createGate = (g: GateInput) => send<{ id: number }>("POST", "/gates", g);
export const updateGate = (id: number, g: GateInput) => send<{ success: true }>("PUT", `/gates/${id}`, g);
export const deleteGate = (id: number) => call<{ success: true }>(`/gates/${id}`, { method: "DELETE" });

// ── Guard assignments ──
export interface GuardOptions {
  guards: { id: number; name: string; email: string }[];
  shifts: { id: number; name: string; startTime: string; endTime: string }[];
  gates: { id: number; name: string; projectName: string }[];
}
export interface GuardAssignment {
  id: number;
  guardUserId: number;
  guardName: string | null;
  gateId: number;
  gateName: string;
  projectName: string;
  shiftId: number;
  shiftName: string;
  startTime: string;
  endTime: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}
export interface AssignmentInput { guardUserId: number; gateId: number; shiftId: number; effectiveFrom: string; effectiveTo: string | null; isActive?: boolean }
export const getGuardOptions = () => call<GuardOptions>("/guard-options");
export const getGuardAssignments = () => call<GuardAssignment[]>("/guard-assignments");
export const createGuardAssignment = (a: AssignmentInput) => send<{ id: number }>("POST", "/guard-assignments", a);
export const updateGuardAssignment = (id: number, a: AssignmentInput) => send<{ success: true }>("PUT", `/guard-assignments/${id}`, a);
export const deleteGuardAssignment = (id: number) => call<{ success: true }>(`/guard-assignments/${id}`, { method: "DELETE" });

// ── Residents ──
export interface SecurityResident {
  id: number;
  customerId: number;
  customerName: string | null;
  mobile: string | null;
  projectId: number;
  projectName: string;
  block: string;
  flatNo: string;
  isPrimary: boolean;
  isActive: boolean;
  source: "CRM_SYNC" | "ADMIN";
  bookingId: number | null;
  bookingNo: string | null;
  hasPortalLogin: boolean;
  createdAt: string;
  deactivatedAt: string | null;
}
export interface CustomerOption { id: number; name: string; mobile: string; customerNo: string; hasPortalLogin: boolean }
export interface ResidentAuditRow { id: number; action: string; source: string | null; detail: string | null; at: string; byName: string | null }
export interface SyncResult { added: number; reactivated: number; updated: number; deactivated: number }

export const getResidents = (projectId?: number | null) =>
  call<{ residents: SecurityResident[]; projects: ProjectOption[] }>(`/residents${projectId ? `?projectId=${projectId}` : ""}`);
export const searchResidentCustomers = (q: string) => call<CustomerOption[]>(`/residents/customers?q=${encodeURIComponent(q)}`);
export const addResident = (r: { customerId: number; projectId: number; block: string; flatNo: string; isPrimary: boolean; note?: string }) =>
  send<{ id: number }>("POST", "/residents", r);
export const updateResident = (id: number, r: { isActive?: boolean; isPrimary?: boolean; note?: string }) => send<{ success: true }>("PUT", `/residents/${id}`, r);
export const getResidentAudit = (id: number) => call<ResidentAuditRow[]>(`/residents/${id}/audit`);
export const syncResidents = (projectId?: number | null) => send<SyncResult>("POST", "/residents/sync", { projectId: projectId ?? null });

// ── Live map, replay, alerts, visitor log (page security-live) ──
export type LatLng = [number, number];
export interface LivePing { at: string; lat: number; lng: number; accuracy: number | null; battery: number | null; inZone: boolean | null }
export interface LiveGuard {
  guardUserId: number;
  name: string;
  gateName: string;
  projectName: string;
  shiftStart: string;
  shiftEnd: string;
  last: LivePing | null;
  trail: LatLng[];
}
export interface LiveZone { id: number; name: string; gateName: string | null; shapes: LatLng[][] }
export interface TrailResult { points: LivePing[]; count: number; distanceM: number; outside: number; judged: number }
export interface SecurityAlertItem {
  id: number;
  type: "LEFT_ZONE" | "DEVICE_OFFLINE" | "UNANSWERED";
  detail: string | null;
  at: string;
  escalatedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  guardName: string | null;
  zoneName: string | null;
  requestId: number | null;
  projectName: string;
}
export interface VisitorLogRow {
  id: number;
  requestedAt: string;
  status: "PENDING" | "APPROVED" | "DENIED" | "NO_RESPONSE";
  gateName: string;
  projectName: string;
  block: string | null;
  flat: string;
  visitorName: string | null;
  visitorPhone: string | null;
  vehicleNo: string | null;
  reason: string;
  hasPhoto: boolean;
  decidedAt: string | null;
  decidedBy: string | null;
  guardName: string | null;
  noResponseBy: "TIMEOUT" | "GUARD" | null;
}
export const getLive = () => call<{ guards: LiveGuard[]; zones: LiveZone[] }>("/live");
export const getTrackedGuards = () => call<{ id: number; name: string }[]>("/guards/tracked");
export const getTrail = (guardId: number, from: string, to: string) =>
  call<TrailResult>(`/guards/${guardId}/trail?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
export const getAlerts = (openOnly: boolean) => call<SecurityAlertItem[]>(`/alerts${openOnly ? "?open=1" : ""}`);
export const acknowledgeAlert = (id: number) => send<{ success: true }>("POST", `/alerts/${id}/acknowledge`, {});
export const getVisitorLog = (p: { from?: string; to?: string; gateId?: number | null; status?: string; q?: string; page?: number; exportAll?: boolean }) => {
  const qs = new URLSearchParams();
  if (p.exportAll) qs.set("export", "1");
  if (p.from) qs.set("from", p.from);
  if (p.to) qs.set("to", p.to);
  if (p.gateId) qs.set("gateId", String(p.gateId));
  if (p.status) qs.set("status", p.status);
  if (p.q) qs.set("q", p.q);
  if (p.page) qs.set("page", String(p.page));
  return call<{ rows: VisitorLogRow[]; total: number; page: number; pageSize: number }>(`/visitor-log?${qs.toString()}`);
};
/** The visitor photo through the signed-in request (it isn't a public link); returns an object URL to show. */
export async function fetchVisitorPhoto(id: number): Promise<string> {
  const res = await fetchWithAuth(`${BASE}/visitors/${id}/photo`);
  if (!res.ok) throw new Error("No photo.");
  return URL.createObjectURL(await res.blob());
}

// ── Geofences (page security-geofences) ──
export interface GeofenceZone {
  id: number;
  projectId: number;
  projectName: string;
  gateId: number | null;
  gateName: string | null;
  name: string;
  kind: "H3" | "POLYGON";
  resolution: number | null;
  allowedDistanceM: number | null;
  isActive: boolean;
  cells: string[];
  polygon: LatLng[];
  shapes: LatLng[][];
}
export interface GeofenceGate { id: number; name: string; projectId: number; projectName: string; latitude: number | null; longitude: number | null }
export interface ZoneInput {
  projectId: number;
  gateId: number | null;
  name: string;
  kind: "H3" | "POLYGON";
  cells?: string[];
  polygon?: LatLng[];
  allowedDistanceM: number | null;
  isActive?: boolean;
}
export const getGeofences = () => call<{ zones: GeofenceZone[]; gates: GeofenceGate[]; projects: ProjectOption[] }>("/geofences");
export const previewHexagons = (p: { lat: number; lng: number; radiusM: number; resolution: number }) => send<{ cells: string[]; shapes: LatLng[][] }>("POST", "/geofences/preview", p);
export const createZone = (z: ZoneInput) => send<{ id: number }>("POST", "/geofences", z);
export const updateZone = (id: number, z: ZoneInput) => send<{ success: true }>("PUT", `/geofences/${id}`, z);
export const deleteZone = (id: number) => call<{ success: true }>(`/geofences/${id}`, { method: "DELETE" });

// ── Residents' complaints about guards (page security-live) ──
export type ComplaintStatus = "OPEN" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";
export interface SecurityComplaint {
  id: number;
  category: string;
  categoryLabel: string;
  description: string;
  incidentAt: string | null;
  status: ComplaintStatus;
  adminNote: string | null;
  handledAt: string | null;
  handledBy: string | null;
  createdAt: string;
  block: string | null;
  flat: string;
  guardName: string | null;
  gateName: string | null;
  requestId: number | null;
  residentName: string | null;
  residentMobile: string | null;
  projectName: string;
}
export const getComplaints = (status?: ComplaintStatus) => call<SecurityComplaint[]>(`/complaints${status ? `?status=${status}` : ""}`);
export const reviewComplaint = (id: number, status: ComplaintStatus, adminNote: string) => send<{ success: true }>("PUT", `/complaints/${id}`, { status, adminNote });
