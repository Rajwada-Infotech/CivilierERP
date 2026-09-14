// RN client for Security Attendance — full parity with web's
// src/api/securityAttendanceApi.ts: check-in/out, personnel and shift
// management, history (verify/reject/cancel), audit log.
import { fetchWithAuth } from "@/services/fetchWithAuth";

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetchWithAuth(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
  return res.json();
}
async function mutate<T>(url: string, method: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetchWithAuth(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
  return res.json().catch(() => ({} as T));
}

export interface SecurityShift {
  Id: number;
  Name: string;
  StartTime: string;
  EndTime: string;
  GraceMinutes: number;
  Status: "Active" | "Inactive";
}

export interface SecurityPersonnelRow {
  Id: number;
  SecurityCode: string;
  Name: string;
  Phone: string | null;
  Status: "Active" | "Inactive";
  DefaultShiftId: number | null;
  DefaultShiftName: string | null;
  // Which agency/party supplies this guard — Supplier/Contractor/Broker/
  // Customer head, same set Vendor Ledger Report searches.
  VendorId: number | null;
  VendorName: string | null;
  VendorType: "S" | "C" | "BR" | "A" | null;
  ProjectId: number | null;
  ProjectName: string | null;
}

export interface VendorOption {
  id: number;
  name: string;
  type: "S" | "C" | "BR" | "A";
  typeLabel: string;
}

export interface ProjectOption {
  id: number;
  label: string;
}

export type AttendanceStatus = "Present" | "Late" | "Absent" | "HalfDay";
export type VerificationStatus = "Pending" | "Verified" | "Rejected";

export interface SecurityAttendanceRow {
  Id: number;
  SecurityId: number;
  SecurityCode: string;
  SecurityName: string;
  ShiftId: number;
  ShiftName: string;
  AttendanceDate: string;
  ScheduledIn: string;
  ScheduledOut: string;
  CheckIn: string | null;
  CheckOut: string | null;
  Status: AttendanceStatus;
  VerificationStatus: VerificationStatus;
  IsCancelled: boolean;
}

export interface SecurityAttendanceLogRow {
  Id: number;
  Action: string;
  OldValue: string | null;
  NewValue: string | null;
  PerformedBy: string | null;
  PerformedAt: string;
  DeviceInfo: string | null;
  IPAddress: string | null;
  Remarks: string | null;
}

export interface SecurityAttendanceDashboard {
  totalPersonnel: number;
  presentToday: number;
  absentToday: number;
  lateToday: number;
  currentlyOnDuty: number;
  totalAttendanceRecords: number;
  asOf: string;
}

export interface AttendanceFilters {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  securityId?: number | string;
  shiftId?: number | string;
  status?: string;
  verificationStatus?: string;
}

function toQs(params: object): string {
  const p = new URLSearchParams();
  Object.entries(params as Record<string, unknown>).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") p.set(k, String(v)); });
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const getSecurityShifts = (): Promise<SecurityShift[]> =>
  getJson("/api/security-attendance/shifts", "Failed to load shifts");

export const createSecurityShift = (payload: { name: string; startTime: string; endTime: string; graceMinutes?: number }) =>
  mutate<{ id: number; message: string }>("/api/security-attendance/shifts", "POST", payload, "Failed to create shift");

export const updateSecurityShift = (
  id: number,
  payload: { name: string; startTime: string; endTime: string; graceMinutes?: number; status?: string },
) => mutate<{ message: string }>(`/api/security-attendance/shifts/${id}`, "PUT", payload, "Failed to update shift");

export const getSecurityPersonnel = (search?: string): Promise<SecurityPersonnelRow[]> =>
  getJson(`/api/security-attendance/personnel${search ? `?search=${encodeURIComponent(search)}` : ""}`, "Failed to load personnel");

export const createSecurityPersonnel = (payload: {
  securityCode: string; name: string; phone?: string; defaultShiftId?: number | null;
  vendorId?: number | null; projectId?: number | null; remarks?: string;
}) => mutate<{ id: number; message: string }>("/api/security-attendance/personnel", "POST", payload, "Failed to add security personnel");

export const updateSecurityPersonnel = (
  id: number,
  payload: {
    name: string; phone?: string; defaultShiftId?: number | null;
    vendorId?: number | null; projectId?: number | null; status?: string; remarks?: string;
  },
) => mutate<{ message: string }>(`/api/security-attendance/personnel/${id}`, "PUT", payload, "Failed to update security personnel");

// Typeahead over Supplier/Contractor/Broker/Customer heads — the Personnel
// form's "Vendor" field (which agency supplies this guard).
export const searchSecurityVendors = (q: string): Promise<VendorOption[]> => {
  if (q.trim().length < 2) return Promise.resolve([]);
  return getJson(`/api/security-attendance/vendor-search?q=${encodeURIComponent(q)}`, "Failed to search vendors");
};

// Project options for the Personnel form — mirrors web's
// getEnterpriseOptions(undefined, "P").
export const getProjectOptions = (): Promise<ProjectOption[]> =>
  getJson("/api/enterprises/options?business_type=P", "Failed to load projects");

export const getSecurityAttendance = (filters: AttendanceFilters = {}): Promise<SecurityAttendanceRow[]> =>
  getJson(`/api/security-attendance${toQs(filters)}`, "Failed to load attendance");

export const getSecurityAttendanceDashboard = (): Promise<SecurityAttendanceDashboard> =>
  getJson("/api/security-attendance/dashboard", "Failed to load dashboard");

export const getSecurityAttendanceLogs = (attendanceId: number): Promise<SecurityAttendanceLogRow[]> =>
  getJson(`/api/security-attendance/${attendanceId}/logs`, "Failed to load audit log");

// ── Actions ──────────────────────────────────────────────────────────────
export const checkInSecurity = (payload: { securityId: number; shiftId: number; remarks?: string }) =>
  mutate<{ id: number; status: AttendanceStatus; checkIn: string; message: string }>(
    "/api/security-attendance/check-in", "POST", payload, "Check-in failed",
  );

export const checkOutSecurity = (attendanceId: number, remarks?: string) =>
  mutate<{ id: number; status: AttendanceStatus; checkOut: string; dutyMinutes: number; dutyHoursLabel: string; message: string }>(
    `/api/security-attendance/${attendanceId}/check-out`, "POST", { remarks }, "Check-out failed",
  );

export const markSecurityAbsent = (payload: { securityId: number; shiftId: number; date?: string; remarks?: string }) =>
  mutate<{ id: number; message: string }>("/api/security-attendance/mark-absent", "POST", payload, "Failed to mark absent");

export const verifySecurityAttendance = (attendanceId: number, remarks?: string) =>
  mutate<{ message: string }>(`/api/security-attendance/${attendanceId}/verify`, "POST", { remarks }, "Failed to verify attendance");

export const rejectSecurityAttendance = (attendanceId: number, remarks: string) =>
  mutate<{ message: string }>(`/api/security-attendance/${attendanceId}/reject`, "POST", { remarks }, "Failed to reject attendance");

export const cancelSecurityAttendance = (attendanceId: number, remarks: string) =>
  mutate<{ message: string }>(`/api/security-attendance/${attendanceId}/cancel`, "POST", { remarks }, "Failed to cancel attendance");
