import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/payroll-run";

export type PayrollRunStatus = "Draft" | "Processed" | "Locked";

export interface PayrollRunRow {
  PayrollRunId: number;
  CompanyId: number | null;
  CompanyName: string | null;
  PeriodMonth: number;
  PeriodYear: number;
  Status: PayrollRunStatus;
  ProcessedAt: string | null;
  CreatedAt: string;
  EmployeeCount: number;
}

export interface PayrollRunEmployeeRow {
  PayrollRunEmployeeId: number;
  EmployeeId: number;
  EmployeeCode: string;
  EmployeeName: string;
  SalaryStructureId: number | null;
  SalaryStructureName: string | null;
  CTCUsed: number;
  MonthlyCTCUsed: number;
  GrossSalary: number;
  TotalEmployeeDeduction: number;
  NetSalary: number;
  TotalEmployerContribution: number;
  TotalCTC: number;
  ComputedAt: string;
}

export interface PayrollRunDetail extends PayrollRunRow {
  Employees: PayrollRunEmployeeRow[];
}

export interface PayslipLine {
  HeadName: string;
  HeadCode: string;
  ComponentType: string;
  Amount: number;
  IncludeInGross: boolean;
  IncludeInCTC: boolean;
  IncludeInNet: boolean;
  Taxable: boolean;
}

export interface PayslipResult {
  Run: PayrollRunRow;
  Employee: { EmployeeId: number; EmployeeCode: string; EmployeeName: string; Designation: string | null; Department: string | null };
  SalaryStructureName: string | null;
  CTCUsed: number;
  MonthlyCTCUsed: number;
  Earnings: PayslipLine[];
  Deductions: PayslipLine[];
  EmployerContributions: PayslipLine[];
  Informational: PayslipLine[];
  GrossSalary: number;
  TotalEmployeeDeduction: number;
  NetSalary: number;
  TotalEmployerContribution: number;
  TotalCTC: number;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getPayrollRuns = async (): Promise<PayrollRunRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const getPayrollRun = async (id: number): Promise<PayrollRunDetail> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  return handle(res);
};

export const createPayrollRun = async (payload: { CompanyId: number | null; PeriodMonth: number; PeriodYear: number }) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string; id: number }>(res);
};

export const processPayrollRun = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}/process`, { method: "POST" });
  return handle<{ message: string; processed: number; skipped: { EmployeeId: number; EmployeeName: string; reason: string }[] }>(res);
};

export const lockPayrollRun = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}/lock`, { method: "POST" });
  return handle<{ message: string }>(res);
};

export const getPayslip = async (runId: number, employeeId: number): Promise<PayslipResult> => {
  const res = await fetchWithAuth(`${BASE}/${runId}/employee/${employeeId}/payslip`);
  return handle(res);
};
