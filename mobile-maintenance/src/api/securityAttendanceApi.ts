// RN client for Security Attendance. Check-In/Check-Out get full depth —
// they're genuinely on-site, phone-in-hand actions. Everything else
// (Shifts, verification, cancel, audit log) is read-only here or omitted;
// do those on web. Mirrors web's src/api/securityAttendanceApi.ts shapes.
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

export const getSecurityPersonnel = (search?: string): Promise<SecurityPersonnelRow[]> =>
  getJson(`/api/security-attendance/personnel${search ? `?search=${encodeURIComponent(search)}` : ""}`, "Failed to load personnel");

export const getSecurityAttendance = (filters: AttendanceFilters = {}): Promise<SecurityAttendanceRow[]> =>
  getJson(`/api/security-attendance${toQs(filters)}`, "Failed to load attendance");

export const getSecurityAttendanceDashboard = (): Promise<SecurityAttendanceDashboard> =>
  getJson("/api/security-attendance/dashboard", "Failed to load dashboard");

// ── The headline actions ────────────────────────────────────────────────
export const checkInSecurity = (payload: { securityId: number; shiftId: number; remarks?: string }) =>
  mutate<{ id: number; status: AttendanceStatus; checkIn: string; message: string }>(
    "/api/security-attendance/check-in", "POST", payload, "Check-in failed",
  );

export const checkOutSecurity = (attendanceId: number, remarks?: string) =>
  mutate<{ id: number; status: AttendanceStatus; checkOut: string; dutyMinutes: number; dutyHoursLabel: string; message: string }>(
    `/api/security-attendance/${attendanceId}/check-out`, "POST", { remarks }, "Check-out failed",
  );
