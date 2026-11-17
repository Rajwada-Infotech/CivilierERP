// The existing Employee Portal API (backend/routes/employeePortal.js, /api/employee-portal). The backend finds the
// employee from the signed-in login; the app never sends an employee id.
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/employee-portal";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithAuth(`${BASE}${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || "Request failed");
  return body as T;
}
const post = (body?: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body ?? {}) });

export interface Me {
  EmployeeId: number; EmployeeCode: string; EmployeeName: string; Email: string; Mobile: string | null;
  Department: string | null; Designation: string | null; BranchLocation: string | null; EmploymentType: string | null;
  JoiningDate: string | null; CompanyName: string | null; Photo: string | null;
}

export interface BreakRow {
  breakId: number; no: number; start: string; end: string | null; seconds: number | null; open: boolean;
  type: string; note: string | null; deduct: boolean; overSeconds: number;
}
export interface AttendanceRec {
  attendanceId: number; attendanceDate: string; inTime: string; outTime: string | null;
  breaks: BreakRow[]; breakSeconds: number; officialSeconds: number; extraSeconds: number;
  totalSeconds: number | null; netSeconds: number | null; status: string; flags: string[];
  inLocation: { lat: number; lng: number; accuracyM: number | null } | null;
  outLocation: { lat: number; lng: number; accuracyM: number | null } | null;
  live: { sessionSeconds: number; breakSeconds: number; netSeconds: number } | null;
}
export type PunchState = "NOT_STARTED" | "WORKING" | "ON_BREAK" | "COMPLETED";
export interface TodayState {
  employee: { id: number; code: string; name: string; companyName: string | null; department: string | null; designation: string | null };
  serverNow: string; today: string; state: PunchState;
  allowed: { in: boolean; out: boolean; breakStart: boolean; breakStop: boolean };
  current: AttendanceRec | null;
  history: AttendanceRec[];
}
export interface BreakType { type: string; deduct: boolean; allowedMinutes: number | null; requiresNote: boolean }
export interface Evidence { photo: string; latitude: number; longitude: number; accuracy: number | null }

export interface MonthDay {
  Date: string; Status: string | null; CheckIn: string | null; CheckOut: string | null; Hours: number | null; Note: string | null;
  CheckInText?: string | null; CheckOutText?: string | null; BreakMinutes?: number; OfficialMinutes?: number; ExtraMinutes?: number;
}
export interface MonthAttendance {
  Month: string;
  Summary: { Present: number; Absent: number; HalfDay: number; OnLeave: number; Holiday: number; WeekOff: number; BreakMinutes: number; ExtraMinutes: number };
  Days: MonthDay[];
}

export type LeaveType = "Casual" | "Sick" | "Earned" | "Unpaid";
export interface LeaveBalance { LeaveType: LeaveType; Entitled: number | null; Used: number; Pending: number; Balance: number | null }
export interface LeaveRow {
  LeaveId: number; LeaveType: LeaveType; FromDate: string; ToDate: string; TotalDays: number; Reason: string | null;
  Status: "Pending" | "Approved" | "Rejected" | string; HrRemarks: string | null; CreatedAt: string;
}

export interface PayRow { PayrollRunId: number; PeriodMonth: number; PeriodYear: number; GrossSalary: number; TotalEmployeeDeduction: number; NetSalary: number }
export interface PayLine { HeadName: string; HeadCode: string | null; ComponentType: string; Amount: number }
export interface Payslip {
  Employee: { EmployeeCode: string; EmployeeName: string; Designation: string | null; Department: string | null; CompanyName: string | null; JoiningDate: string | null; BankName: string | null; BankAccountNumber: string | null };
  PayrollRunId: number; PeriodMonth: number; PeriodYear: number; SalaryStructureName: string | null;
  Earnings: PayLine[]; Deductions: PayLine[]; GrossSalary: number; TotalEmployeeDeduction: number; NetSalary: number;
}
export interface Salary { CTCAmount: number | null; CTCFrequency: string | null; SalaryStructureName: string | null; Latest: Payslip | null; History: PayRow[] }

export interface Holiday { HolidayId: number; HolidayName: string; HolidayDate: string }
export interface LoginRow { LoginHistoryId: number; LoginAt: string; Success: boolean; FailureReason: string | null; IpAddress: string | null; UserAgent: string | null; Portal: string | null }

export const api = {
  me: () => call<Me>("/me"),
  today: () => call<TodayState>("/attendance/today"),
  breakTypes: () => call<BreakType[]>("/attendance/break-types"),
  punchIn: (e: Evidence) => call<TodayState>("/attendance/in", post(e)),
  punchOut: (e: Evidence) => call<TodayState>("/attendance/out", post(e)),
  breakStart: (type: string, note?: string) => call<TodayState>("/attendance/break-start", post({ type, note })),
  breakStop: () => call<TodayState>("/attendance/break-stop", post()),
  month: (month: string) => call<MonthAttendance>(`/attendance?month=${month}`),
  balances: (year: number) => call<{ Year: number; Balances: LeaveBalance[] }>(`/leave/balances?year=${year}`),
  leaves: () => call<LeaveRow[]>("/leave"),
  applyLeave: (b: { LeaveType: LeaveType; FromDate: string; ToDate: string; Reason: string }) => call<{ message: string }>("/leave", post(b)),
  withdrawLeave: (id: number) => call<{ message: string }>(`/leave/${id}`, { method: "DELETE" }),
  salary: () => call<Salary>("/salary"),
  payslips: () => call<PayRow[]>("/payslips"),
  payslip: (runId: number) => call<Payslip>(`/payslips/${runId}`),
  holidays: (year: number) => call<Holiday[]>(`/holidays?year=${year}`),
  loginHistory: () => call<LoginRow[]>("/login-history"),
};
