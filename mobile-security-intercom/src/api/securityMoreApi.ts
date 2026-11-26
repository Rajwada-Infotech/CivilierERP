// Calls (LiveKit), guest passes, the visitor log, alerts and the live view. Staff use /api/security; residents use the
// customer-portal routes /api/security-portal (backend/routes/securityIntercom.js, securityPortal.js).
import { fetchWithAuth } from "@/services/fetchWithAuth";
import type { SecurityView } from "@/navigation/securityRole";

async function read<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `The request failed (${res.status}).`);
  return body as T;
}
const post = (path: string, body: unknown = {}) => fetchWithAuth(path, { method: "POST", body: JSON.stringify(body) });
const base = (view: SecurityView | null) => (view === "customer" ? "/api/security-portal" : "/api/security");

// ── Calls ──
export interface CallInfo {
  callId: number;
  status: "RINGING" | "ANSWERED" | "MISSED" | "DECLINED" | "ENDED" | "FAILED";
  startedAt?: string;
  answeredAt?: string | null;
  durationSec?: number | null;
  incoming?: boolean;
  otherName?: string | null;
  calleeName?: string | null;
  requestId?: number | null;
  /** Present when this side may join the call's room. */
  url?: string;
  token?: string;
  ringSeconds?: number;
}
export const callsAvailable = async (view: SecurityView | null) => read<{ inApp: boolean }>(await fetchWithAuth(`${base(view)}/calls/available`));
export const callResident = async (requestId: number, customerId: number) => read<CallInfo>(await post("/api/security/calls", { requestId, customerId }));
export const callGate = async (gateId: number) => read<CallInfo>(await post("/api/security-portal/calls", { gateId }));
export const getCall = async (view: SecurityView | null, id: number) => read<CallInfo>(await fetchWithAuth(`${base(view)}/calls/${id}`));
export const incomingCall = async (view: SecurityView | null) => read<CallInfo | null>(await fetchWithAuth(`${base(view)}/calls/incoming`));
export const callAction = async (view: SecurityView | null, id: number, action: "answer" | "decline" | "end") => read<CallInfo>(await post(`${base(view)}/calls/${id}/${action}`));

// ── Resident: gates and guest passes ──
export interface ResidentGate { id: number; name: string; projectId: number; projectName: string; guardOnDuty: boolean }
export const myGates = async () => read<ResidentGate[]>(await fetchWithAuth("/api/security-portal/gates"));
export interface GuestPass {
  id: number;
  block: string | null;
  flat: string;
  guestName: string;
  guestPhone: string | null;
  vehicleNo: string | null;
  note: string | null;
  code: string;
  validFrom: string;
  validTo: string;
  maxUses: number;
  uses: number;
  cancelledAt: string | null;
  active: boolean;
}
export const myPasses = async () => read<GuestPass[]>(await fetchWithAuth("/api/security-portal/passes"));
export const createPass = async (p: { residentId: number; guestName: string; guestPhone?: string; vehicleNo?: string; note?: string; validFrom: string; validTo: string; maxUses: number }) =>
  read<{ id: number; code: string }>(await post("/api/security-portal/passes", p));
export const cancelPass = async (id: number) => read<{ success: true }>(await post(`/api/security-portal/passes/${id}/cancel`));

// ── Guard: expected guests ──
export interface ExpectedGuest { id: number; block: string | null; flat: string; guestName: string; vehicleNo: string | null; note: string | null; validTo: string; usesLeft: number }
export const expectedGuests = async () => read<ExpectedGuest[]>(await fetchWithAuth("/api/security/passes/expected"));

// ── Admin: visitor log, live view (alerts are on the Notifications page) ──
export interface LogRow {
  id: number;
  requestedAt: string;
  status: "PENDING" | "APPROVED" | "DENIED" | "NO_RESPONSE";
  gateName: string;
  projectName: string;
  block: string | null;
  flat: string;
  visitorName: string | null;
  vehicleNo: string | null;
  reason: string;
  decidedBy: string | null;
  guardName: string | null;
}
export const getVisitorLog = async (p: { q?: string; status?: string; page?: number; days?: number }) => {
  const qs = new URLSearchParams();
  if (p.q) qs.set("q", p.q);
  if (p.status) qs.set("status", p.status);
  if (p.page) qs.set("page", String(p.page));
  qs.set("from", new Date(Date.now() - (p.days ?? 30) * 86400000).toISOString());
  return read<{ rows: LogRow[]; total: number; page: number; pageSize: number }>(await fetchWithAuth(`/api/security/visitor-log?${qs.toString()}`));
};

export interface LiveData {
  guards: {
    guardUserId: number;
    name: string;
    gateName: string;
    projectName: string;
    shiftStart: string;
    shiftEnd: string;
    last: { at: string; lat: number; lng: number; accuracy: number | null; battery: number | null; inZone: boolean | null } | null;
    trail: [number, number][];
  }[];
  zones: { id: number; name: string; gateName: string | null; shapes: [number, number][][] }[];
}
export const getLive = async () => read<LiveData>(await fetchWithAuth("/api/security/live"));

// ── Complaints about guards ──
export type ComplaintStatus = "OPEN" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";
export interface Complaint {
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
  guardUserId: number | null;
  guardName: string | null;
  gateName: string | null;
  requestId: number | null;
  projectName: string;
  /** Admins only. */
  residentName?: string | null;
  residentMobile?: string | null;
}
export interface ComplaintOptions {
  flats: { residentId: number; projectId: number; projectName: string; block: string | null; flat: string }[];
  gates: { id: number; name: string; projectId: number }[];
  guards: { id: number; name: string }[];
  visits: { id: number; requestedAt: string; visitorName: string | null; reason: string; status: string; gateName: string; guardUserId: number; block: string | null; flat: string }[];
  categories: Record<string, string>;
}
export const complaintOptions = async () => read<ComplaintOptions>(await fetchWithAuth("/api/security-portal/complaints/options"));
export const myComplaints = async () => read<Complaint[]>(await fetchWithAuth("/api/security-portal/complaints"));
export const raiseComplaint = async (c: { residentId: number; category: string; description: string; guardUserId?: number | null; gateId?: number | null; requestId?: number | null; incidentAt?: string | null }) =>
  read<{ id: number }>(await post("/api/security-portal/complaints", c));
export const allComplaints = async (status?: ComplaintStatus) => read<Complaint[]>(await fetchWithAuth(`/api/security/complaints${status ? `?status=${status}` : ""}`));
export const reviewComplaint = async (id: number, status: ComplaintStatus, adminNote: string) =>
  read<{ success: true }>(await fetchWithAuth(`/api/security/complaints/${id}`, { method: "PUT", body: JSON.stringify({ status, adminNote }) }));

// ── Patrol (residents): the patrol rounds walked at their project(s), and one round's route, for the replay.
export interface PatrolRound {
  id: number;
  guardName: string | null;
  gateName: string;
  startedAt: string;
  endedAt: string | null; // null: still going
}
export interface PatrolList {
  patrols: PatrolRound[];
  zones: { id: number; name: string; shapes: [number, number][][] }[];
}
export interface PatrolTrail {
  points: { at: string; lat: number; lng: number; inZone: boolean | null }[];
  count: number;
  distanceM: number;
  outside: number;
  judged: number;
}
export const patrolList = async (from: Date, to: Date) =>
  read<PatrolList>(await fetchWithAuth(`/api/security-portal/patrol?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`));
export const patrolTrail = async (patrolId: number) => read<PatrolTrail>(await fetchWithAuth(`/api/security-portal/patrol/${patrolId}`));
