import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/salary-structure";

export type CalculationType = "Fixed" | "Percentage" | "Formula";
export type RoundingRule = "None" | "Nearest" | "Up" | "Down";
export type CTCFrequency = "Annual" | "Monthly";

export interface SalaryStructureLineRow {
  LineId: number;
  SalaryStructureId: number;
  DeductionAdditionId: number;
  CalculationType: CalculationType;
  CalculationBase: string | null;
  Percentage: number | null;
  Amount: number | null;
  Formula: string | null;
  MinAmount: number | null;
  MaxAmount: number | null;
  RoundingRule: RoundingRule;
  Sequence: number;
  IncludeInGross: boolean;
  IncludeInCTC: boolean;
  IncludeInNet: boolean;
  Taxable: boolean;
  IsBalancing: boolean;
  IsActive: boolean;
  HeadName: string;
  HeadCode: string;
  HeadType: "Earning" | "Deduction" | "Employer Contribution" | "Informational";
  HeadActive: boolean;
}

export interface SalaryStructureRow {
  SalaryStructureId: number;
  CompanyId: number | null;
  CompanyName: string | null;
  Name: string;
  Code: string;
  Description: string | null;
  EffectiveFrom: string | null;
  EffectiveTo: string | null;
  CTCFrequency: CTCFrequency;
  Version: number;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string | null;
  Lines: SalaryStructureLineRow[];
}

export interface SalaryStructureLinePayload {
  DeductionAdditionId: number;
  CalculationType: CalculationType;
  CalculationBase: string | null;
  Percentage: number | null;
  Amount: number | null;
  Formula: string | null;
  MinAmount: number | null;
  MaxAmount: number | null;
  RoundingRule: RoundingRule;
  Sequence: number;
  IncludeInGross: boolean;
  IncludeInCTC: boolean;
  IncludeInNet: boolean;
  Taxable: boolean;
  IsBalancing: boolean;
  IsActive: boolean;
}

export interface SalaryStructurePayload {
  CompanyId: number | null;
  Name: string;
  Code: string;
  Description: string | null;
  EffectiveFrom: string | null;
  EffectiveTo: string | null;
  CTCFrequency: CTCFrequency;
  IsActive: boolean;
  Lines: SalaryStructureLinePayload[];
}

export interface ValidationError {
  message: string;
}

export interface CalculatedLine {
  DeductionAdditionId: number;
  HeadCode: string;
  HeadName: string;
  HeadType: string;
  Calculation: string;
  Amount: number;
}

export interface CalculationTotals {
  AnnualCTC: number;
  MonthlyCTC: number;
  GrossSalary: number;
  TotalEmployeeDeduction: number;
  NetSalary: number;
  TotalEmployerContribution: number;
  TotalCTC: number;
}

export interface CalculationResult {
  valid: boolean;
  errors: ValidationError[];
  lines: CalculatedLine[];
  totals: CalculationTotals | null;
}

export interface StructureFamily {
  Code: string;
  Name: string;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`) as Error & { errors?: ValidationError[] };
    err.errors = data?.errors;
    throw err;
  }
  return data as T;
}

export const getSalaryStructures = async (): Promise<SalaryStructureRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const getSalaryStructureFamilies = async (): Promise<StructureFamily[]> => {
  const res = await fetchWithAuth(`${BASE}/families`);
  return handle(res);
};

export const addSalaryStructure = async (payload: SalaryStructurePayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string; id: number; warnings: ValidationError[] }>(res);
};

export const updateSalaryStructure = async (id: number, payload: SalaryStructurePayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ message: string; warnings: ValidationError[] }>(res);
};

export const deleteSalaryStructure = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle<{ message: string }>(res);
};

export const validateSalaryStructure = async (payload: Partial<SalaryStructurePayload>) => {
  const res = await fetchWithAuth(`${BASE}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ errors: ValidationError[] }>(res);
};

export const previewCalculate = async (
  payload:
    | (Partial<SalaryStructurePayload> & { TestCTC: number; TestCTCFrequency: CTCFrequency })
    | { Id: number; TestCTC: number; TestCTCFrequency: CTCFrequency },
) => {
  const res = await fetchWithAuth(`${BASE}/calculate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<CalculationResult>(res);
};

export const activateSalaryStructure = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}/activate`, { method: "POST" });
  return handle<{ message: string }>(res);
};

export const deactivateSalaryStructure = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}/deactivate`, { method: "POST" });
  return handle<{ message: string }>(res);
};

export const copySalaryStructure = async (id: number, code: string, name?: string) => {
  const res = await fetchWithAuth(`${BASE}/${id}/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Code: code, Name: name }),
  });
  return handle<{ message: string; id: number }>(res);
};
