import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/attendance-record";

export type AttendanceStatus = "Present" | "Absent" | "Half Day" | "On Leave" | "Holiday" | "Week Off";

export interface AttendanceRow {
  AttendanceId: number;
  EmployeeId: number;
  EmployeeCode: string;
  EmployeeName: string;
  AttendanceDate: string;
  Status: AttendanceStatus;
  CheckIn: string | null;
  CheckOut: string | null;
  Remarks: string | null;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string | null;
}

export interface PunchLocation { lat: number; lng: number; accuracyM: number | null }
export interface PunchEvidence {
  inTime: string | null; outTime: string | null;
  inLocation: PunchLocation | null; outLocation: PunchLocation | null;
  inPhoto: string | null; outPhoto: string | null;
}
/** The punch (times, device location, live photo) behind one Attendance Record, or null for a day entered by hand. */
export const getAttendancePunch = async (id: number): Promise<PunchEvidence | null> => {
  const res = await fetchWithAuth(`${BASE}/${id}/punch`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string })?.error || "Failed to load the punch details");
  return (data as { punch: PunchEvidence | null }).punch;
};

export interface AttendancePayload {
  EmployeeId: number;
  AttendanceDate: string;
  Status: AttendanceStatus;
  CheckIn?: string | null;
  CheckOut?: string | null;
  Remarks?: string | null;
  IsActive?: boolean;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getAttendanceRecords = async (): Promise<AttendanceRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const addAttendanceRecord = async (payload: AttendancePayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const updateAttendanceRecord = async (id: number, payload: AttendancePayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string }>(res);
};

export const deleteAttendanceRecord = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle<{ message: string }>(res);
};
