import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/security-attendance";

export interface SecurityShift {
  Id: number;
  Name: string;
  StartTime: string; // "1970-01-01THH:MM:SS.000Z" — time-of-day only
  EndTime: string;
  GraceMinutes: number;
  Status: "Active" | "Inactive";
  CreatedAt: string | null;
}

export interface SecurityPersonnelRow {
  Id: number;
  SecurityCode: string;
  Name: string;
  Phone: string | null;
  Status: "Active" | "Inactive";
  Remarks: string | null;
  DefaultShiftId: number | null;
  DefaultShiftName: string | null;
  StartTime: string | null;
  EndTime: string | null;
  CreatedAt: string | null;
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
  VerifiedBy: string | null;
  VerifiedAt: string | null;
  VerificationRemarks: string | null;
  Remarks: string | null;
  IsCancelled: boolean;
  CreatedAt: string | null;
  CreatedBy: string | null;
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

export interface SecurityDailyReport {
  date: string;
  totalSecurity: number;
  present: number;
  late: number;
  absent: number;
  currentlyOnDuty: number;
  records: SecurityAttendanceRow[];
}

export interface SecurityHistorySummary {
  PresentCount: number;
  LateCount: number;
  AbsentCount: number;
  HalfDayCount: number;
  TotalRecords: number;
  TotalDutyMinutes: number;
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

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(body?.error || body?.message || fallback);
}

async function postJson<T>(path: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetchWithAuth(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res, fallback);
  return res.json();
}

async function putJson<T>(path: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetchWithAuth(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res, fallback);
  return res.json();
}

// ── Shifts ───────────────────────────────────────────────────────────────
export const getSecurityShifts = (): Promise<SecurityShift[]> =>
  fetchWithAuth(`${BASE}/shifts`).then((r) => r.json().catch(() => []));

export const createSecurityShift = (payload: { name: string; startTime: string; endTime: string; graceMinutes?: number }) =>
  postJson<{ id: number; message: string }>("/shifts", payload, "Failed to create shift");

export const updateSecurityShift = (
  id: number,
  payload: { name: string; startTime: string; endTime: string; graceMinutes?: number; status?: string },
) => putJson<{ message: string }>(`/shifts/${id}`, payload, "Failed to update shift");

// ── Personnel ────────────────────────────────────────────────────────────
export const getSecurityPersonnel = (search?: string): Promise<SecurityPersonnelRow[]> => {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  return fetchWithAuth(`${BASE}/personnel${qs}`).then((r) => r.json().catch(() => []));
};

export const createSecurityPersonnel = (payload: {
  securityCode: string; name: string; phone?: string; defaultShiftId?: number | null; remarks?: string;
}) => postJson<{ id: number; message: string }>("/personnel", payload, "Failed to add security personnel");

export const updateSecurityPersonnel = (
  id: number,
  payload: { name: string; phone?: string; defaultShiftId?: number | null; status?: string; remarks?: string },
) => putJson<{ message: string }>(`/personnel/${id}`, payload, "Failed to update security personnel");

// ── Attendance list / history ────────────────────────────────────────────
export interface AttendanceFilters {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  securityId?: number | string;
  shiftId?: number | string;
  status?: string;
  verificationStatus?: string;
}

function toQueryString(filters: AttendanceFilters): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  });
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export const getSecurityAttendance = (filters: AttendanceFilters = {}): Promise<SecurityAttendanceRow[]> =>
  fetchWithAuth(`${BASE}${toQueryString(filters)}`).then((r) => r.json().catch(() => []));

export const getSecurityAttendanceDashboard = (): Promise<SecurityAttendanceDashboard> =>
  fetchWithAuth(`${BASE}/dashboard`).then((r) => r.json());

export const getSecurityDailyReport = (date?: string): Promise<SecurityDailyReport> => {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  return fetchWithAuth(`${BASE}/report/daily${qs}`).then((r) => r.json());
};

export const getSecurityHistorySummary = (
  dateFrom: string,
  dateTo: string,
  securityId?: number | string,
): Promise<SecurityHistorySummary> => {
  const params = new URLSearchParams({ dateFrom, dateTo });
  if (securityId) params.set("securityId", String(securityId));
  return fetchWithAuth(`${BASE}/history-summary?${params.toString()}`).then((r) => r.json());
};

export const getSecurityAttendanceLogs = (attendanceId: number): Promise<SecurityAttendanceLogRow[]> =>
  fetchWithAuth(`${BASE}/${attendanceId}/logs`).then((r) => r.json().catch(() => []));

// ── Actions ──────────────────────────────────────────────────────────────
export const checkInSecurity = (payload: { securityId: number; shiftId: number; remarks?: string }) =>
  postJson<{ id: number; status: AttendanceStatus; checkIn: string; message: string }>(
    "/check-in", payload, "Check-in failed",
  );

export const checkOutSecurity = (attendanceId: number, remarks?: string) =>
  postJson<{ id: number; status: AttendanceStatus; checkOut: string; dutyMinutes: number; dutyHoursLabel: string; message: string }>(
    `/${attendanceId}/check-out`, { remarks }, "Check-out failed",
  );

export const markSecurityAbsent = (payload: { securityId: number; shiftId: number; date?: string; remarks?: string }) =>
  postJson<{ id: number; message: string }>("/mark-absent", payload, "Failed to mark absent");

export const verifySecurityAttendance = (attendanceId: number, remarks?: string) =>
  postJson<{ message: string }>(`/${attendanceId}/verify`, { remarks }, "Failed to verify attendance");

export const rejectSecurityAttendance = (attendanceId: number, remarks: string) =>
  postJson<{ message: string }>(`/${attendanceId}/reject`, { remarks }, "Failed to reject attendance");

export const cancelSecurityAttendance = (attendanceId: number, remarks: string) =>
  postJson<{ message: string }>(`/${attendanceId}/cancel`, { remarks }, "Failed to cancel attendance");
