import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/employee-attendance";

export type AttendanceStatus = "Working" | "On Break" | "Present" | "Incomplete";
export type AttendanceFlag = "MISSING_OUT" | "OPEN_BREAK";

export interface AttendanceBreak {
  breakId: number;
  no: number;
  start: string;
  end: string | null;
  seconds: number | null;
  open: boolean;
  hrEdited: boolean;
}

export interface AttendanceRecord {
  attendanceId: number;
  employeeId: number;
  employeeCode: string | null;
  employeeName: string | null;
  companyId: number | null;
  companyName: string | null;
  department: string | null;
  projectId: number | null;
  projectName: string | null;
  /** Indian calendar date of the In Time, YYYY-MM-DD. */
  attendanceDate: string;
  inTime: string;
  outTime: string | null;
  breakCount: number;
  breaks: AttendanceBreak[];
  breakSeconds: number;
  /** Out − In; null until Out Time is recorded. */
  totalSeconds: number | null;
  /** Total − breaks; null until Out Time is recorded. */
  netSeconds: number | null;
  status: AttendanceStatus;
  flags: AttendanceFlag[];
  hrEdited: boolean;
  live: { sessionSeconds: number; breakSeconds: number; netSeconds: number } | null;
}

export type MyState = "NOT_STARTED" | "WORKING" | "ON_BREAK" | "COMPLETED";

export interface MyAttendance {
  employee: { id: number; code: string; name: string; companyName: string | null; department: string | null; designation: string | null };
  serverNow: string;
  today: string;
  state: MyState;
  allowed: { in: boolean; out: boolean; breakStart: boolean; breakStop: boolean };
  current: AttendanceRecord | null;
  history: AttendanceRecord[];
}

export interface AuditEntry {
  AuditId: number;
  Action: string;
  Detail: string | null;
  Reason: string | null;
  ChangedBy: string;
  ChangedAt: string;
}

export interface HrFilterOptions {
  companies: { id: number; label: string }[];
  departments: string[];
  projects: { id: number; label: string }[];
  employees: { id: number; label: string; code: string }[];
}

export interface HrFilters {
  from?: string;
  to?: string;
  employeeId?: number;
  companyId?: number;
  department?: string;
  projectId?: number;
  status?: string;
}

export interface EmployeeSummary {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  companyName: string | null;
  department: string | null;
  days: number;
  completeDays: number;
  incompleteDays: number;
  breakCount: number;
  breakSeconds: number;
  totalSeconds: number;
  netSeconds: number;
}

export interface AttendanceSummary {
  employees: EmployeeSummary[];
  totals: { employees: number; days: number; completeDays: number; incompleteDays: number; breakCount: number; breakSeconds: number; totalSeconds: number; netSeconds: number };
}

export interface NotMarkedEmployee {
  EmployeeId: number;
  EmployeeCode: string;
  EmployeeName: string;
  CompanyName: string | null;
  Department: string | null;
}

async function parse<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
  return res.json();
}

const post = (path: string, body?: unknown, method = "POST") =>
  fetchWithAuth(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const qs = (f: HrFilters & { date?: string }) => {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v !== undefined && v !== "" && v !== null) p.set(k, String(v)); });
  return p.toString();
};

// ── Employee self-service ──
export const getMyAttendance = async () => parse<MyAttendance>(await fetchWithAuth(`${BASE}/me`), "Failed to load your attendance");
export const clockIn = async (projectId?: number) => parse<MyAttendance>(await post("/me/in", { projectId }), "Could not record In Time");
export const clockOut = async () => parse<MyAttendance>(await post("/me/out"), "Could not record Out Time");
export const startBreak = async () => parse<MyAttendance>(await post("/me/break-start"), "Could not start the break");
export const stopBreak = async () => parse<MyAttendance>(await post("/me/break-stop"), "Could not stop the break");

// ── HR ──
export const getHrFilterOptions = async () => parse<HrFilterOptions>(await fetchWithAuth(`${BASE}/hr/filters`), "Failed to load filters");
export const getHrRecords = async (f: HrFilters) => parse<AttendanceRecord[]>(await fetchWithAuth(`${BASE}/hr/records?${qs(f)}`), "Failed to load attendance");
export const getHrSummary = async (f: HrFilters) => parse<AttendanceSummary>(await fetchWithAuth(`${BASE}/hr/summary?${qs(f)}`), "Failed to load summary");
export const getNotMarked = async (f: HrFilters & { date: string }) => parse<NotMarkedEmployee[]>(await fetchWithAuth(`${BASE}/hr/not-marked?${qs(f)}`), "Failed to load employees");
export const getHrRecord = async (id: number) =>
  parse<{ record: AttendanceRecord; audit: AuditEntry[] }>(await fetchWithAuth(`${BASE}/hr/records/${id}`), "Failed to load the record");

type Corrected = { record: AttendanceRecord; audit: AuditEntry[] };
export const hrUpdateRecord = async (id: number, body: { inTime?: string; outTime?: string | null; reason: string }) =>
  parse<Corrected>(await post(`/hr/records/${id}`, body, "PUT"), "Could not save the correction");
export const hrAddBreak = async (id: number, body: { start: string; end?: string | null; reason: string }) =>
  parse<Corrected>(await post(`/hr/records/${id}/breaks`, body), "Could not add the break");
export const hrUpdateBreak = async (breakId: number, body: { start?: string; end?: string | null; reason: string }) =>
  parse<Corrected>(await post(`/hr/breaks/${breakId}`, body, "PUT"), "Could not save the break");
export const hrDeleteBreak = async (breakId: number, reason: string) =>
  parse<Corrected>(await post(`/hr/breaks/${breakId}`, { reason }, "DELETE"), "Could not delete the break");
