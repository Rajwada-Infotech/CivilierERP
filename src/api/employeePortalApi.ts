// Employee Portal (the signed-in employee's own data) and the HR-side Employee Portal Access screen.
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const PORTAL = "/api/employee-portal";
const ADMIN = "/api/employee-portal-admin";

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`);
  return data as T;
}
const get = <T,>(url: string) => fetchWithAuth(url).then((r) => handle<T>(r));
const send = <T,>(url: string, method: string, body?: unknown) =>
  fetchWithAuth(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => handle<T>(r));

// ── Employee side ────────────────────────────────────────────────────────────
export interface PortalProfile {
  EmployeeId: number; EmployeeCode: string; EmployeeName: string; Email: string | null; Mobile: string | null;
  Department: string | null; Designation: string | null; BranchLocation: string | null; EmploymentType: string | null;
  JoiningDate: string | null; CompanyName: string | null; Photo: string | null;
}
export interface PayslipLine { HeadName: string; HeadCode: string; ComponentType: string; Amount: number }
export interface PayslipSummary { PayrollRunId: number; PeriodMonth: number; PeriodYear: number; GrossSalary: number; TotalEmployeeDeduction: number; NetSalary: number }
export interface Payslip {
  Employee: { EmployeeCode: string; EmployeeName: string; Designation: string | null; Department: string | null; CompanyName: string | null; JoiningDate: string | null; BankName: string | null; BankAccountNumber: string | null };
  PayrollRunId: number; PeriodMonth: number; PeriodYear: number; SalaryStructureName: string | null;
  Earnings: PayslipLine[]; Deductions: PayslipLine[];
  GrossSalary: number; TotalEmployeeDeduction: number; NetSalary: number;
}
export interface SalaryDetails { CTCAmount: number | null; CTCFrequency: string | null; SalaryStructureName: string | null; Latest: Payslip | null; History: PayslipSummary[] }
export interface LoginHistoryRow { LoginHistoryId: string; LoginAt: string; Success: boolean; FailureReason: string | null; IpAddress: string | null; UserAgent: string | null; Portal: string | null }
export interface Holiday { HolidayId: number; HolidayName: string; HolidayDate: string }
export interface AttendanceDay { BreakMinutes?: number; OfficialMinutes?: number; ExtraMinutes?: number; Date: string; Status: string | null; CheckIn: string | null; CheckOut: string | null; CheckInText?: string | null; CheckOutText?: string | null; Hours: number | null; Note: string | null }
export interface AttendanceMonth { Month: string; Summary: { Present: number; Absent: number; HalfDay: number; OnLeave: number; Holiday: number; WeekOff: number; BreakMinutes: number; ExtraMinutes: number }; Days: AttendanceDay[] }
export interface LeaveBalance { LeaveType: string; Entitled: number | null; Used: number; Pending: number; Balance: number | null }
export interface LeaveApplication { LeaveId: number; LeaveType: string; FromDate: string; ToDate: string; TotalDays: number; Reason: string | null; Status: string; HrRemarks: string | null; CreatedAt: string }

export const getPortalProfile = () => get<PortalProfile>(`${PORTAL}/me`);
export const getPortalSalary = () => get<SalaryDetails>(`${PORTAL}/salary`);
export const getPortalPayslips = () => get<PayslipSummary[]>(`${PORTAL}/payslips`);
export const getPortalPayslip = (runId: number) => get<Payslip>(`${PORTAL}/payslips/${runId}`);
export const getPortalLoginHistory = () => get<LoginHistoryRow[]>(`${PORTAL}/login-history`);
export const getPortalHolidays = (year: number) => get<Holiday[]>(`${PORTAL}/holidays?year=${year}`);
export const getPortalAttendance = (month: string) => get<AttendanceMonth>(`${PORTAL}/attendance?month=${month}`);
export interface PunchLocation { lat: number; lng: number; accuracyM: number | null }
export interface PunchBreak {
  breakId: number; no: number; start: string; end: string | null; seconds: number | null; open: boolean;
  type: string; note: string | null; deduct: boolean; allowedSeconds: number | null; overSeconds: number;
}
export interface BreakType { type: string; deduct: boolean; allowedMinutes: number | null; requiresNote: boolean }
export interface PunchState {
  serverNow: string; today: string; state: "NOT_STARTED" | "WORKING" | "ON_BREAK" | "COMPLETED";
  allowed: { in: boolean; out: boolean; breakStart: boolean; breakStop: boolean };
  current: {
    attendanceId: number; inTime: string; outTime: string | null; status: string;
    inLocation: PunchLocation | null; outLocation: PunchLocation | null; hasInPhoto: boolean; hasOutPhoto: boolean;
    breaks: PunchBreak[]; breakSeconds: number; officialSeconds: number; extraSeconds: number; totalSeconds: number | null; netSeconds: number | null;
    live: { sessionSeconds: number; breakSeconds: number; netSeconds: number } | null;
  } | null;
}
export interface PunchEvidence { photo: string; latitude: number; longitude: number; accuracy: number | null }
export const getPortalPunchState = () => get<PunchState>(`${PORTAL}/attendance/today`);
export const getPortalBreakTypes = () => get<BreakType[]>(`${PORTAL}/attendance/break-types`);
export const portalBreakStart = (type: string, note: string) => send<PunchState>(`${PORTAL}/attendance/break-start`, "POST", { type, note });
export const portalBreakStop = () => send<PunchState>(`${PORTAL}/attendance/break-stop`, "POST");
export const portalPunch = (kind: "in" | "out", evidence: PunchEvidence) => send<PunchState>(`${PORTAL}/attendance/${kind}`, "POST", evidence);
export const getPortalLeaveBalances = (year: number) => get<{ Year: number; Balances: LeaveBalance[] }>(`${PORTAL}/leave/balances?year=${year}`);
export const getPortalLeaves = () => get<LeaveApplication[]>(`${PORTAL}/leave`);
export const applyPortalLeave = (body: { LeaveType: string; FromDate: string; ToDate: string; Reason: string }) =>
  send<{ message: string; LeaveId: number; TotalDays: number }>(`${PORTAL}/leave`, "POST", body);
export const withdrawPortalLeave = (id: number) => send<{ message: string }>(`${PORTAL}/leave/${id}`, "DELETE");

// ── HR side ──────────────────────────────────────────────────────────────────
export type PortalAccess = "none" | "active" | "disabled" | "other";
export interface PortalEmployee {
  EmployeeId: number; EmployeeCode: string; EmployeeName: string; Email: string | null; Department: string | null; Designation: string | null;
  Access: PortalAccess; UserRole: string | null; LastLoginAt: string | null;
}
export interface LeavePolicyRow { LeaveType: string; DaysPerYear: number }
export interface EntitlementRow { LeaveType: string; PolicyDays: number; OverrideDays: number | null }

export const getPortalEmployees = () => get<PortalEmployee[]>(`${ADMIN}/employees`);
export const enablePortalAccess = (id: number, password: string) => send<{ message: string }>(`${ADMIN}/employees/${id}/enable`, "POST", { password });
export const resetPortalPassword = (id: number, password: string) => send<{ message: string }>(`${ADMIN}/employees/${id}/reset-password`, "POST", { password });
export const disablePortalAccess = (id: number) => send<{ message: string }>(`${ADMIN}/employees/${id}/disable`, "POST");
export const getLeavePolicy = () => get<LeavePolicyRow[]>(`${ADMIN}/leave-policy`);
export const saveLeavePolicy = (items: LeavePolicyRow[]) => send<{ message: string }>(`${ADMIN}/leave-policy`, "PUT", { items });
export interface BreakRule { BreakType: string; DeductFromWork: boolean; AllowedMinutes: number | null; RequiresNote: boolean; IsActive: boolean }
export const getBreakRules = () => get<BreakRule[]>(`${ADMIN}/break-types`);
export const saveBreakRules = (items: { BreakType: string; AllowedMinutes: number | null; DeductFromWork: boolean; IsActive: boolean }[]) =>
  send<{ message: string }>(`${ADMIN}/break-types`, "PUT", { items });
export const getEntitlements = (id: number, year: number) => get<{ Year: number; Items: EntitlementRow[] }>(`${ADMIN}/employees/${id}/entitlements?year=${year}`);
export const saveEntitlements = (id: number, year: number, items: { LeaveType: string; Days: number | null }[]) =>
  send<{ message: string }>(`${ADMIN}/employees/${id}/entitlements`, "PUT", { year, items });
